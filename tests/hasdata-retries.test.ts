import { assertEquals, assertRejects } from '@std/assert';
import { fetchHasDataWithRetry, HasDataError } from '../src/apis/hasdata/helpers.ts';
import { fetchSerpBatch } from '../src/apis/hasdata/serp.ts';

async function withMockRequests(
	responses: Array<Response | Error>,
	run: (delays: Array<number>, requestCount: () => number, controller: AbortController) => Promise<void>,
	abortOnWait = false
): Promise<void> {
	const originalFetch = globalThis.fetch;
	const originalTimeout = globalThis.setTimeout;
	const globals = globalThis as Record<string, unknown>;
	const originalSignal = globals.abortSignal;
	const originalKey = Deno.env.get('HASDATA_API_KEY');
	const controller = new AbortController();
	const delays: Array<number> = [];
	let calls = 0;
	Deno.env.set('HASDATA_API_KEY', 'test-key');
	globals.abortSignal = controller.signal;
	globalThis.fetch = () => {
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
			if (abortOnWait) {
				controller.abort(new Error('Stopped'));
			} else {
				callback();
			}
		});
		return 0;
	}) as unknown as typeof setTimeout;
	try {
		await run(delays, () => calls, controller);
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
