import { assertEquals, assertRejects } from '@std/assert';
import { createBrightdataProvider } from '../src/apis/brightdata/llmScraper/brightdata.ts';
import { createLLMScraper } from '../src/apis/brightdata/llmScraper/scrape.ts';

async function mocked(test: (setFetch: (fn: typeof fetch) => void) => Promise<void>) {
	const oldFetch = globalThis.fetch;
	const key = Deno.env.get('BRIGHTDATA_API_KEY');
	const globals = globalThis as Record<string, unknown>;
	const signal = globals.abortSignal;
	Deno.env.set('BRIGHTDATA_API_KEY', 'test-key');
	delete globals.abortSignal;
	try {
		await test((fn) => {
			globalThis.fetch = fn;
		});
	} finally {
		globalThis.fetch = oldFetch;
		globals.abortSignal = signal;
		if (key == null) Deno.env.delete('BRIGHTDATA_API_KEY');
		else Deno.env.set('BRIGHTDATA_API_KEY', key);
	}
}

Deno.test('explicit trigger outcomes retain receipts and never repeat uncertain submissions', async () => {
	await mocked(async (setFetch) => {
		for (
			const reply of [
				Response.json({ snapshot_id: 'not-a-confirmed-snapshot' }),
				new Response('{}', { status: 503 }),
				new Response('{}'),
				new Response('invalid'),
				new Error('secret'),
			]
		) {
			let calls = 0;
			setFetch(() => {
				calls++;
				return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
			});
			const result = await createLLMScraper(createBrightdataProvider()).triggerLLMBatchOutcomes({
				prompts: ['secret prompt'],
			});
			assertEquals(calls, 1);
			assertEquals(result[0].jobId, null);
			assertEquals(result[0].failure?.kind, 'trigger_uncertain');
			assertEquals(JSON.stringify(result).includes('secret'), false);
		}
		setFetch(() => Promise.resolve(Response.json({ snapshot_id: 'sd_existing' })));
		assertEquals(
			await createLLMScraper(createBrightdataProvider()).triggerLLMBatchOutcomes({ prompts: ['prompt'] }),
			[{ jobId: 'sd_existing', failure: null, inputIndex: 0, inputCount: 1 }],
		);
	});
});

Deno.test('trigger configuration rejection and missing credentials are not partial operational failures', async () => {
	await mocked(async (setFetch) => {
		for (const status of [400, 401, 402, 403, 404, 422]) {
			let calls = 0;
			setFetch(() => {
				calls++;
				return Promise.resolve(new Response('secret body', { status }));
			});
			await assertRejects(
				() => createLLMScraper(createBrightdataProvider()).triggerLLMBatchOutcomes({ prompts: ['prompt'] }),
				Error,
				'configuration rejected',
			);
			assertEquals(calls, 1);
		}
		Deno.env.delete('BRIGHTDATA_API_KEY');
		await assertRejects(
			() => createLLMScraper(createBrightdataProvider()).triggerLLMBatchOutcomes({ prompts: ['prompt'] }),
			Error,
			'environment variable',
		);
	});
});

Deno.test('mixed trigger receipts retain input order and sanitized uncertainty metadata', async () => {
	await mocked(async (setFetch) => {
		setFetch((_url, init) => {
			const body = JSON.parse(String(init != null && 'body' in init ? init.body : undefined));
			return Promise.resolve(
				body.input[0].prompt === 'second'
					? Response.json({ error_code: 'provider_busy', error: 'private prompt' }, { status: 503 })
					: Response.json({ snapshot_id: 'sd_first' }),
			);
		});
		assertEquals(
			await createLLMScraper(createBrightdataProvider({ maxPromptsPerRequest: 1 })).triggerLLMBatchOutcomes({
				prompts: ['first', 'second'],
			}),
			[
				{ jobId: 'sd_first', failure: null, inputIndex: 0, inputCount: 1 },
				{
					jobId: null,
					inputIndex: 0,
					inputCount: 1,
					failure: {
						provider: 'Brightdata',
						kind: 'trigger_uncertain',
						status: 503,
						providerCode: 'provider_busy',
					},
				},
			],
		);
	});
});

Deno.test('rate limits do not consume attempts and cancellation preserves the caller reason', async () => {
	await mocked(async (setFetch) => {
		let calls = 0;
		setFetch(() =>
			Promise.resolve(
				++calls <= 5
					? new Response('{}', { status: 429, headers: { 'Retry-After': '0' } })
					: Response.json({ snapshot_id: 'sd_ready' }),
			)
		);
		assertEquals(
			(await createLLMScraper(createBrightdataProvider()).triggerLLMBatchOutcomes({ prompts: ['prompt'] }))[0]
				.jobId,
			'sd_ready',
		);
		assertEquals(calls, 6);
		const controller = new AbortController();
		(globalThis as Record<string, unknown>).abortSignal = controller.signal;
		setFetch(() => {
			controller.abort(new Error('Cancelled'));
			return Promise.reject(new Error('Network'));
		});
		await assertRejects(
			() => createLLMScraper(createBrightdataProvider()).triggerLLMBatchOutcomes({ prompts: ['prompt'] }),
			Error,
			'Cancelled',
		);
	});
});

Deno.test('trigger rate limiting honors Retry-After HTTP dates', async () => {
	await mocked(async (setFetch) => {
		const originalNow = Date.now;
		const originalTimeout = globalThis.setTimeout;
		const now = Date.parse('2026-10-02T20:00:00Z');
		const delays: Array<number> = [];
		let calls = 0;
		Date.now = () => now;
		globalThis.setTimeout = ((callback: () => void, delay: number) => {
			delays.push(delay);
			queueMicrotask(callback);
			return 0;
		}) as unknown as typeof setTimeout;
		setFetch(() =>
			Promise.resolve(
				++calls === 1
					? new Response('{}', {
						status: 429,
						headers: { 'Retry-After': new Date(now + 60000).toUTCString() },
					})
					: Response.json({ snapshot_id: 'sd_after_wait' }),
			)
		);
		try {
			const result = await createLLMScraper(createBrightdataProvider()).triggerLLMBatchOutcomes({
				prompts: ['prompt'],
			});
			assertEquals(delays, [60000]);
			assertEquals(calls, 2);
			assertEquals(result[0].jobId, 'sd_after_wait');
		} finally {
			Date.now = originalNow;
			globalThis.setTimeout = originalTimeout;
		}
	});
});
