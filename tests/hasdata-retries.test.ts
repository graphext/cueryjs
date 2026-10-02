import { assertEquals, assertRejects } from '@std/assert';
import { fetchHasDataWithRetry, HasDataError } from '../src/apis/hasdata/helpers.ts';
import { fetchSerpBatch } from '../src/apis/hasdata/serp.ts';

async function withMockRequests(
	responses: Array<Response | Error>,
	run: (delays: Array<number>, requestCount: () => number, controller: AbortController, urls: Array<string>) => Promise<void>,
	abortOnWait = false,
	onWait?: (delay: number) => void
): Promise<void> {
	const originalFetch = globalThis.fetch;
	const originalTimeout = globalThis.setTimeout;
	const globals = globalThis as Record<string, unknown>;
	const originalSignal = globals.abortSignal;
	const originalKey = Deno.env.get('HASDATA_API_KEY');
	const controller = new AbortController();
	const delays: Array<number> = [];
	const urls: Array<string> = [];
	let calls = 0;
	Deno.env.set('HASDATA_API_KEY', 'test-key');
	globals.abortSignal = controller.signal;
	globalThis.fetch = (url) => {
		urls.push(String(url));
		const response = responses[calls++];
		if (response instanceof Error) {
			return Promise.reject(response);
		}
		if (response == null) {
			return Promise.reject(new Error('Unexpected extra request'));
		}
		return Promise.resolve(response);
	};
	globalThis.setTimeout = ((callback: () => void, delay: number) => {
		delays.push(delay);
		queueMicrotask(() => {
			onWait?.(delay);
			if (abortOnWait) {
				controller.abort(new Error('Stopped'));
			} else {
				callback();
			}
		});
		return 0;
	}) as unknown as typeof setTimeout;
	try {
		await run(delays, () => calls, controller, urls);
	} finally {
		globalThis.fetch = originalFetch;
		globalThis.setTimeout = originalTimeout;
		globals.abortSignal = originalSignal;
		if (originalKey == null) {
			Deno.env.delete('HASDATA_API_KEY');
		} else {
			Deno.env.set('HASDATA_API_KEY', originalKey);
		}
	}
}

const limited = (retryAfter?: string): Response => new Response('limited', {
	status: 429,
	headers: retryAfter == null ? undefined : { 'Retry-After': retryAfter }
});

Deno.test('HasData retries transient 400 responses with a bounded failure budget', async () => {
	await withMockRequests([
		new Response(null, { status: 400 }), limited('0'), new Response('ok')
	], async (delays, calls) => {
		assertEquals(await (await fetchHasDataWithRetry('https://example.test')).text(), 'ok');
		assertEquals(calls(), 3);
		assertEquals(delays, [1000, 0]);
	});
	await withMockRequests(Array.from({ length: 4 }, () => new Response(null, { status: 400 })), async (delays, calls) => {
		const error = await assertRejects(() => fetchHasDataWithRetry('https://example.test'), HasDataError);
		assertEquals(error.retryable, true);
		assertEquals(calls(), 4);
		assertEquals(delays, [1000, 2000, 4000]);
	});
});

Deno.test('HasData logs sanitized validation diagnostics without exposing them in errors or retrying 422', async () => {
	const originalError = console.error;
	const messages: Array<unknown> = [];
	console.error = (...values) => { messages.push(values); };
	try {
		await withMockRequests([Response.json({
			detail: [{ loc: ['query', 'pageToken'], type: 'invalid_token',
				msg: 'Rejected confidential-query and private-token using test-key https://example.test/?secret=yes',
				input: 'private-input', ctx: { secret: 'private-context' } }]
		}, { status: 422, headers: { 'x-request-id': 'ba3419b0-ea51-49d2-8801-bea6f74d57df' } })], async (delays, calls) => {
			const error = await assertRejects(() => fetchHasDataWithRetry(
				'https://example.test/aio?pageToken=private-token&gl=it', undefined, undefined,
				{ diagnosticSensitiveValues: ['confidential-query'] }
			), HasDataError);
			assertEquals(error.message, 'HasData API error: 422 ');
			assertEquals(error.retryable, false);
			assertEquals(error.cause, undefined);
			assertEquals(calls(), 1);
			assertEquals(delays, []);
			const logged = JSON.stringify(messages);
			for (const secret of ['confidential-query', 'private-token', 'test-key', 'private-input', 'private-context', 'secret=yes']) {
				assertEquals(logged.includes(secret), false);
			}
			assertEquals(logged.includes('invalid_token'), true);
			assertEquals(logged.includes('pageToken'), true);
			assertEquals(logged.includes('ba3419b0-ea51-49d2-8801-bea6f74d57df'), true);
		});
	} finally { console.error = originalError; }
});

const tokenSerp = (token: string): Response => Response.json({
	organicResults: [], aiOverview: { pageToken: token, hasdataLink: `https://example.test/aio?pageToken=${token}` }
});

Deno.test('HasData retries AIO 400 without repeating the successful initial search', async () => {
	await withMockRequests([tokenSerp('first'), new Response(null, { status: 400 }), Response.json({ textBlocks: [] })], async (_delays, calls, _controller, urls) => {
		await fetchSerpBatch(['example']);
		assertEquals(calls(), 3);
		assertEquals(urls[1], urls[2]);
	});
});

Deno.test('HasData exhausted AIO retries propagate and a caller retry obtains a fresh token', async () => {
	await withMockRequests([
		tokenSerp('first'), ...Array.from({ length: 4 }, () => new Response(null, { status: 400 })),
		tokenSerp('fresh'), Response.json({ textBlocks: [] })
	], async (_delays, calls, _controller, urls) => {
		const error = await assertRejects(() => fetchSerpBatch(['example']), HasDataError);
		assertEquals(error.retryable, true);
		await fetchSerpBatch(['example']);
		assertEquals(calls(), 7);
		assertEquals(urls[5], urls[0]);
		assertEquals(urls[6], 'https://example.test/aio?pageToken=fresh');
	});
});

Deno.test('HasData aborts AIO rate limiting without refreshing or hiding caller cancellation', async () => {
	await withMockRequests([tokenSerp('first'), limited('1000')], async (_delays, calls, controller) => {
		await assertRejects(() => fetchSerpBatch(['example'], { signal: controller.signal }), Error, 'Stopped');
		assertEquals(calls(), 2);
	}, true);
});

Deno.test('HasData rejects AIO tokens that age after SERP receipt before requesting them', async () => {
	const originalNow = Date.now;
	let reads = 0;
	Date.now = () => reads++ === 0 ? 0 : 180001;
	try {
		await withMockRequests([tokenSerp('stale')], async (_delays, calls) => {
			const error = await assertRejects(() => fetchSerpBatch(['example']), HasDataError, 'refresh the search');
			assertEquals(error.retryable, true);
			assertEquals(calls(), 1);
		});
	} finally { Date.now = originalNow; }
});

Deno.test('HasData accepts fresh AIO tokens after a prolonged initial SERP rate-limit wait', async () => {
	const originalNow = Date.now;
	let now = 0;
	Date.now = () => now;
	try {
		await withMockRequests([
			limited('240'), tokenSerp('fresh'), Response.json({ textBlocks: [] })
		], async (delays, calls, _controller, urls) => {
			await fetchSerpBatch(['example']);
			assertEquals(calls(), 3);
			assertEquals(delays, [240000]);
			assertEquals(urls[0], urls[1]);
			assertEquals(urls[2], 'https://example.test/aio?pageToken=fresh');
		}, false, delay => { now += delay; });
	} finally { Date.now = originalNow; }
});

Deno.test('HasData redacts space and Unicode query values in URL and form encodings', async () => {
	const query = 'hipotecas más económicas';
	const encoded = [
		query,
		encodeURIComponent(query),
		new URLSearchParams({ q: query }).toString().slice(2),
		new URLSearchParams({ q: query }).toString().slice(2).replace(/%[A-F\d]{2}/g, part => part.toLowerCase())
	];
	const originalError = console.error;
	const logs: Array<unknown> = [];
	console.error = (...values) => { logs.push(values); };
	try {
		await withMockRequests([Response.json({ message: encoded.join(' | ') }, { status: 422 })], async () => {
			await assertRejects(() => fetchHasDataWithRetry(
				`https://example.test/search?${new URLSearchParams({ q: query })}`
			), HasDataError);
			const logged = JSON.stringify(logs);
			for (const value of encoded) { assertEquals(logged.includes(value), false); }
			assertEquals(logged.includes('hipotecas'), false);
			assertEquals(logged.includes('[redacted]'), true);
		});
	} finally { console.error = originalError; }
});

Deno.test('HasData honors the full AIO Retry-After before refreshing an expired token', async () => {
	const originalNow = Date.now;
	let now = 0;
	Date.now = () => now;
	try {
		await withMockRequests([
			tokenSerp('first'), limited('1000'), tokenSerp('fresh'), Response.json({ textBlocks: [] })
		], async (delays, calls, _controller, urls) => {
			const error = await assertRejects(() => fetchSerpBatch(['example']), HasDataError, 'refresh the search');
			assertEquals(error.retryable, true);
			assertEquals(delays, [1000000]);
			assertEquals(now, 1000000);
			assertEquals(calls(), 2);
			await fetchSerpBatch(['example']);
			assertEquals(calls(), 4);
			assertEquals(urls[2], urls[0]);
			assertEquals(urls[3], 'https://example.test/aio?pageToken=fresh');
		}, false, delay => { now += delay; });
	} finally { Date.now = originalNow; }
});

Deno.test('HasData caller cancellation takes precedence when AIO deadline also expires', async () => {
	const originalNow = Date.now;
	let now = 0;
	Date.now = () => now;
	try {
		await withMockRequests([tokenSerp('first'), limited('1000')], async (_delays, calls, controller) => {
			await assertRejects(() => fetchSerpBatch(['example'], { signal: controller.signal }), Error, 'Stopped');
			assertEquals(calls(), 2);
		}, true, delay => { now += delay; });
	} finally { Date.now = originalNow; }
});

Deno.test('HasData does not retry a rejected AIO token or silently return partial SERP', async () => {
	await withMockRequests([tokenSerp('invalid'), Response.json({ detail: 'Invalid token' }, { status: 422 })], async (delays, calls) => {
		const error = await assertRejects(() => fetchSerpBatch(['example']), HasDataError);
		assertEquals(error.status, 422);
		assertEquals(error.retryable, false);
		assertEquals(delays, []);
		assertEquals(calls(), 2);
	});
});

Deno.test('HasData bounds diagnostics and never logs raw non-JSON response bodies', async () => {
	const originalError = console.error;
	const logs: Array<unknown> = [];
	console.error = (...values) => { logs.push(values); };
	try {
		await withMockRequests([
			new Response('private raw error', { status: 422 }),
			Response.json({ message: 'sensitive'.repeat(2000) }, { status: 422 })
		], async () => {
			await assertRejects(() => fetchHasDataWithRetry('https://example.test'), HasDataError);
			await assertRejects(() => fetchHasDataWithRetry('https://example.test'), HasDataError);
			const logged = JSON.stringify(logs);
			assertEquals(logged.includes('private raw error'), false);
			assertEquals(logged.includes('sensitive'), false);
			assertEquals(logged.includes('exceeds diagnostic limit'), true);
			assertEquals(logged.length < 1000, true);
		});
	} finally { console.error = originalError; }
});

Deno.test('HasData does not classify unsupported server capabilities as transient', () => {
	assertEquals(new HasDataError('Not implemented', 501).retryable, false);
	assertEquals(new HasDataError('HTTP version not supported', 505).retryable, false);
});

Deno.test('HasData honors Retry-After seconds without consuming retries', async () => {
	await withMockRequests([
		limited('12'), limited('0'), limited('0'), limited('0'), limited('0'), new Response('ok')
	], async (delays, calls) => {
		assertEquals(await (await fetchHasDataWithRetry('https://example.test')).text(), 'ok');
		assertEquals(calls(), 6);
		assertEquals(delays, [12000, 0, 0, 0, 0]);
	});
});

Deno.test('HasData honors Retry-After HTTP date', async () => {
	const originalNow = Date.now;
	Date.now = () => Date.parse('2026-09-28T12:00:00Z');
	try {
		await withMockRequests([limited('Mon, 28 Sep 2026 12:00:20 GMT'), new Response('ok')], async (delays) => {
			await fetchHasDataWithRetry('https://example.test');
			assertEquals(delays, [20000]);
		});
	} finally {
		Date.now = originalNow;
	}
});

Deno.test('HasData uses bounded exponential backoff for absent or invalid Retry-After', async () => {
	await withMockRequests([
		limited(), limited('invalid'), limited(), limited(), limited(), new Response('ok')
	], async (delays) => {
		await fetchHasDataWithRetry('https://example.test');
		assertEquals(delays, [1000, 2000, 4000, 8000, 8000]);
	});
});

Deno.test('HasData preserves the failure budget across rate-limited retries', async () => {
	await withMockRequests([
		new Response(null, { status: 500 }), limited('0'), limited('0'),
		new Response(null, { status: 500 }), limited('0'),
		new Response(null, { status: 500 }), limited('0'),
		new Response(null, { status: 500 })
	], async (delays, calls) => {
		const error = await assertRejects(() => fetchHasDataWithRetry('https://example.test'), HasDataError, '500');
		assertEquals(error.status, 500);
		assertEquals(calls(), 8);
		assertEquals(delays, [1000, 0, 0, 2000, 0, 4000, 0]);
	});
});

Deno.test('HasData aborts during a Retry-After wait without issuing another request', async () => {
	await withMockRequests([limited('3600')], async (_delays, calls) => {
		await assertRejects(() => fetchHasDataWithRetry('https://example.test'), Error, 'Stopped');
		assertEquals(calls(), 1);
	}, true);
});

Deno.test('HasData does not fetch when already aborted', async () => {
	await withMockRequests([], async (_delays, calls, controller) => {
		controller.abort();
		await assertRejects(() => fetchHasDataWithRetry('https://example.test'));
		assertEquals(calls(), 0);
	});
});

Deno.test('HasData preserves network failure retry budget', async () => {
	await withMockRequests([
		new Error('offline'), limited('0'), new Error('offline'), new Error('offline'), new Error('offline')
	], async (delays, calls) => {
		const error = await assertRejects(() => fetchHasDataWithRetry('https://example.test'), HasDataError, '4 attempts');
		assertEquals(error.status, undefined);
		assertEquals(error.retryable, true);
		assertEquals((error.cause as Error).message, 'offline');
		assertEquals(calls(), 5);
		assertEquals(delays, [1000, 0, 2000, 4000]);
	});
});

Deno.test('HasData releases a rate-limited response body before retrying', async () => {
	const response = limited('0');
	await withMockRequests([response, new Response('ok')], async () => {
		await fetchHasDataWithRetry('https://example.test');
		assertEquals(response.bodyUsed, true);
	});
});

Deno.test('HasData falls back for negative, infinite and overflowing Retry-After values', async () => {
	await withMockRequests([
		limited('-1'), limited('Infinity'), limited('999999999999999999999999'), new Response('ok')
	], async (delays) => {
		await fetchHasDataWithRetry('https://example.test');
		assertEquals(delays, [1000, 2000, 4000]);
	});
});

Deno.test('HasData retries immediately for a valid past Retry-After date', async () => {
	await withMockRequests([limited('Mon, 01 Jan 2001 00:00:00 GMT'), new Response('ok')], async (delays) => {
		await fetchHasDataWithRetry('https://example.test');
		assertEquals(delays, [0]);
	});
});

Deno.test('HasData splits long Retry-After waits without overflowing setTimeout', async () => {
	await withMockRequests([limited('2147484'), new Response('ok')], async (delays) => {
		await fetchHasDataWithRetry('https://example.test');
		assertEquals(delays, [2147483647, 353]);
	});
});

for (const status of [429, 500]) {
	Deno.test(`HasData SERP honors request cancellation while waiting after ${status}`, async () => {
		await withMockRequests([new Response(null, { status })], async (_delays, calls, controller) => {
			(globalThis as Record<string, unknown>).abortSignal = undefined;
			await assertRejects(
				() => fetchSerpBatch(['example'], { signal: controller.signal }), Error, 'Stopped'
			);
			assertEquals(calls(), 1);
		}, true);
	});
}

Deno.test('HasData preserves typed permanent HTTP failures', async () => {
	await withMockRequests([new Response(null, { status: 403 })], async (delays, calls) => {
		const error = await assertRejects(
			() => fetchHasDataWithRetry('https://example.test'), HasDataError, 'credits exhausted'
		);
		assertEquals(error.status, 403);
		assertEquals(error.retryable, false);
		assertEquals(calls(), 1);
		assertEquals(delays, []);
	});
});
