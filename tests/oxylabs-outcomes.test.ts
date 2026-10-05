import { assertEquals, assertRejects } from '@std/assert';
import { createOxylabsProvider } from '../src/apis/brightdata/llmScraper/oxy.ts';
import { createLLMScraper, LLMSnapshotError } from '../src/apis/brightdata/llmScraper/scrape.ts';

async function mocked(test: (setFetch: (fn: typeof fetch) => void) => Promise<void>) {
	const previousFetch = globalThis.fetch;
	const username = Deno.env.get('OXYLABS_USERNAME');
	const password = Deno.env.get('OXYLABS_PASSWORD');
	const globals = globalThis as Record<string, unknown>;
	const signal = globals.abortSignal;
	Deno.env.set('OXYLABS_USERNAME', 'test-user');
	Deno.env.set('OXYLABS_PASSWORD', 'test-password');
	delete globals.abortSignal;
	try {
		await test((fn) => {
			globalThis.fetch = fn;
		});
	} finally {
		globalThis.fetch = previousFetch;
		globals.abortSignal = signal;
		if (username == null) Deno.env.delete('OXYLABS_USERNAME');
		else Deno.env.set('OXYLABS_USERNAME', username);
		if (password == null) Deno.env.delete('OXYLABS_PASSWORD');
		else Deno.env.set('OXYLABS_PASSWORD', password);
	}
}

Deno.test('Oxylabs explicit submissions keep one input per job and correct target payloads', async () => {
	await mocked(async (setFetch) => {
		for (const aim of [false, true]) {
			const provider = createOxylabsProvider(
				aim ? { source: 'google_ai_mode', inputKey: 'query', search: undefined, render: 'html' } : {},
			);
			const bodies: Array<Record<string, unknown>> = [];
			setFetch((url, init) => {
				assertEquals(String(url), 'https://data.oxylabs.io/v1/queries');
				assertEquals(
					new Headers(init != null && 'headers' in init ? init.headers : undefined).get('Authorization'),
					`Basic ${btoa('test-user:test-password')}`,
				);
				bodies.push(JSON.parse(String(init != null && 'body' in init ? init.body : undefined)));
				return Promise.resolve(Response.json({ id: String(bodies.length) }));
			});
			const outcomes = await createLLMScraper(provider).triggerLLMBatchOutcomes({
				prompts: ['one', 'two'],
				countryISOCode: 'ES',
			});
			assertEquals(outcomes.length, 2);
			assertEquals(outcomes.map((item) => item.jobId), ['1', '2']);
			assertEquals(bodies.map((body) => body[aim ? 'query' : 'prompt']), ['one', 'two']);
			assertEquals(bodies[0].geo_location, 'ES');
			assertEquals(provider.maxPromptsPerRequest, 1);
		}
	});
});

Deno.test('Oxylabs uncertain submissions are never repeated and contain no remote details', async () => {
	await mocked(async (setFetch) => {
		for (
			const reply of [
				new Error('secret'),
				new Response('secret', { status: 503 }),
				Response.json({}),
				Response.json({ id: 123 }),
				Response.json({ id: 'secret/path' }),
			]
		) {
			let calls = 0;
			setFetch(() => {
				calls++;
				return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
			});
			const outcome = await createOxylabsProvider().triggerJobOutcome!('private prompt', false, null);
			assertEquals(calls, 1);
			assertEquals(outcome.failure?.kind, 'trigger_uncertain');
			assertEquals(JSON.stringify(outcome).includes('secret'), false);
		}
	});
});

Deno.test('Oxylabs rate limits retry while configuration failures and cancellation propagate', async () => {
	await mocked(async (setFetch) => {
		let calls = 0;
		setFetch(() =>
			Promise.resolve(
				++calls <= 5
					? new Response(null, { status: 429, headers: { 'Retry-After': '0' } })
					: Response.json({ id: '123' }),
			)
		);
		assertEquals((await createOxylabsProvider().triggerJobOutcome!('prompt', false, null)).jobId, '123');
		assertEquals(calls, 6);
		for (const status of [400, 401, 402, 403, 422]) {
			setFetch(() => Promise.resolve(new Response('private', { status })));
			await assertRejects(
				() => createOxylabsProvider().triggerJobOutcome!('prompt', false, null),
				Error,
				'configuration rejected',
			);
			await assertRejects(() => createOxylabsProvider().monitorJob('123'), Error, 'configuration rejected');
			await assertRejects(() => createOxylabsProvider().downloadJob('123'), Error, 'configuration rejected');
		}
		Deno.env.delete('OXYLABS_PASSWORD');
		await assertRejects(
			() => createOxylabsProvider().triggerJobOutcome!('prompt', false, null),
			Error,
			'environment variables',
		);
		Deno.env.set('OXYLABS_PASSWORD', 'test-password');
		for (const operation of ['trigger', 'monitor', 'download']) {
			const controller = new AbortController();
			const reason = new DOMException('Cancelled', 'AbortError');
			(globalThis as Record<string, unknown>).abortSignal = controller.signal;
			setFetch(() => {
				controller.abort(reason);
				return Promise.reject(new Error('private'));
			});
			const provider = createOxylabsProvider();
			assertEquals(
				await assertRejects(() =>
					operation === 'trigger'
						? provider.triggerJobOutcome!('prompt', false, null)
						: operation === 'monitor'
						? provider.monitorJob('123')
						: provider.downloadJob('123')
				),
				reason,
			);
		}
	});
});

Deno.test('Oxylabs explicit transforms reject missing and failed content but preserve empty answers and legacy behavior', () => {
	const provider = createOxylabsProvider();
	for (
		const content of [{}, { response_text: 12 }, { response_text: '', parse_status_code: 12002 }, {
			response_text: '',
			citations: [null],
		}]
	) {
		assertEquals(
			provider.transformBatchResponse!({ results: [{ content }] }, 1)[0] instanceof LLMSnapshotError,
			true,
		);
	}
	const valid = {
		results: [{ status_code: 200, content: { prompt: 'question', response_text: '', parse_status_code: 12000 } }],
	};
	assertEquals(provider.transformBatchResponse!(valid, 1)[0] instanceof LLMSnapshotError, false);
	assertEquals(provider.transformResponse({ results: [{ content: {} }] })?.answer, '');
});

Deno.test('Oxylabs snapshot outcomes retain operational failures without submitting replacement jobs', async () => {
	await mocked(async (setFetch) => {
		for (
			const reply of [
				Response.json({ results: [{ content: { response_text: '' } }] }),
				Response.json({ results: [{ content: { parse_status_code: 12002, response_text: '' } }] }),
				Response.json({ results: [] }),
			]
		) {
			let calls = 0;
			setFetch((_url, init) => {
				assertEquals(init != null && 'method' in init ? init.method : undefined, undefined);
				return Promise.resolve(++calls === 1 ? Response.json({ status: 'done' }) : reply);
			});
			const outcomes = await createLLMScraper(createOxylabsProvider()).downloadSnapshotOutcomes('123', 1);
			assertEquals(outcomes.length, 1);
			assertEquals(calls, 2);
		}
		setFetch(() => Promise.resolve(Response.json({ status: 'faulted' })));
		await assertRejects(
			() => createLLMScraper(createOxylabsProvider()).downloadSnapshotOutcomes('123', 1),
			LLMSnapshotError,
		);
		setFetch((url) =>
			Promise.resolve(
				String(url).endsWith('/results')
					? new Response(null, { status: 404 })
					: Response.json({ status: 'done' }),
			)
		);
		await assertRejects(
			() => createLLMScraper(createOxylabsProvider()).downloadSnapshotOutcomes('123', 1),
			LLMSnapshotError,
		);
		setFetch(() => Promise.resolve(new Response(null, { status: 401 })));
		await assertRejects(
			() => createLLMScraper(createOxylabsProvider()).downloadSnapshotOutcomes('123', 1),
			Error,
			'configuration rejected',
		);
	});
});

Deno.test('Oxylabs explicit context signals cancel trigger backoff and snapshot download without global state', async () => {
	await mocked(async (setFetch) => {
		assertEquals((globalThis as Record<string, unknown>).abortSignal, undefined);
		for (const operation of ['trigger', 'monitor', 'download']) {
			const controller = new AbortController();
			const reason = new DOMException(`Cancel ${operation}`, 'AbortError');
			let calls = 0;
			setFetch((url, init) => {
				assertEquals(init != null && 'signal' in init ? init.signal : undefined, controller.signal);
				calls++;
				if (operation === 'download' && !String(url).endsWith('/results')) {
					return Promise.resolve(Response.json({ status: 'done' }));
				}
				queueMicrotask(() => controller.abort(reason));
				return Promise.resolve(
					new Response(null, {
						status: operation === 'trigger' ? 429 : operation === 'monitor' ? 204 : 503,
						headers: { 'Retry-After': '60' },
					}),
				);
			});
			const scraper = createLLMScraper(createOxylabsProvider());
			assertEquals(
				await assertRejects(() =>
					operation === 'trigger'
						? scraper.triggerLLMBatchOutcomes({ prompts: ['question'], signal: controller.signal })
						: scraper.downloadSnapshotOutcomes('123', 1, controller.signal)
				),
				reason,
			);
			assertEquals(calls, operation === 'download' ? 2 : 1);
			assertEquals((globalThis as Record<string, unknown>).abortSignal, undefined);
		}
	});
});
