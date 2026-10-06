import { assertEquals, assertInstanceOf, assertRejects } from '@std/assert';
import { createBrightdataProvider } from '../src/apis/brightdata/llmScraper/brightdata.ts';
import { createLLMScraper, LLMSnapshotError } from '../src/apis/brightdata/llmScraper/scrape.ts';
import {
	getMaxPromptsPerRequest,
	triggerAIMBatchOutcomes,
	triggerGPTBatchOutcomes,
} from '../src/apis/brightdata/llmScraper/index.ts';

async function mocked(test: (setFetch: (fn: typeof fetch) => void) => Promise<void>) {
	const originalFetch = globalThis.fetch;
	const originalKey = Deno.env.get('BRIGHTDATA_API_KEY');
	const globals = globalThis as Record<string, unknown>;
	const originalSignal = globals.abortSignal;
	Deno.env.set('BRIGHTDATA_API_KEY', 'test-key');
	delete globals.abortSignal;
	try {
		await test((fn) => {
			globalThis.fetch = fn;
		});
	} finally {
		globalThis.fetch = originalFetch;
		globals.abortSignal = originalSignal;
		if (originalKey == null) Deno.env.delete('BRIGHTDATA_API_KEY');
		else Deno.env.set('BRIGHTDATA_API_KEY', originalKey);
	}
}

Deno.test('BrightData submits real twenty-input batches with one ordered receipt per prompt', async () => {
	await mocked(async (setFetch) => {
		for (const count of [0, 1, 20, 21, 41]) {
			const inputs: Array<Array<{ prompt: string; index: number; country: string; web_search: boolean }>> = [];
			setFetch((_url, init) => {
				const body = JSON.parse(String(init != null && 'body' in init ? init.body : undefined));
				inputs.push(body.input);
				return Promise.resolve(Response.json({ snapshot_id: `sd_${inputs.length}` }));
			});
			const scraper = createLLMScraper(
				createBrightdataProvider({ extraInputs: ({ useSearch }) => ({ web_search: useSearch }) }),
			);
			const prompts = Array.from({ length: count }, (_, index) => `prompt ${index}`);
			const outcomes = await scraper.triggerLLMBatchOutcomes({ prompts, countryISOCode: 'ES', useSearch: true });
			assertEquals(inputs.length, Math.ceil(count / 20));
			assertEquals(inputs.flat().map((input) => input.prompt), prompts);
			assertEquals(outcomes.length, count);
			for (let index = 0; index < count; index++) {
				assertEquals(outcomes[index], {
					jobId: `sd_${Math.floor(index / 20) + 1}`,
					failure: null,
					inputIndex: index % 20,
					inputCount: Math.min(20, count - Math.floor(index / 20) * 20),
				});
				assertEquals(inputs.flat()[index].index, index % 20);
				assertEquals(inputs.flat()[index].country, 'ES');
				assertEquals(inputs.flat()[index].web_search, true);
			}
		}
	});
});

Deno.test('legacy trigger APIs retain one job per prompt', async () => {
	await mocked(async (setFetch) => {
		let calls = 0;
		setFetch((_url, init) => {
			assertEquals(JSON.parse(String(init != null && 'body' in init ? init.body : undefined)).input.length, 1);
			return Promise.resolve(Response.json({ snapshot_id: `sd_${++calls}` }));
		});
		assertEquals(await createLLMScraper(createBrightdataProvider()).triggerLLMBatch({ prompts: ['a', 'b'] }), [
			'sd_1',
			'sd_2',
		]);
		assertEquals(calls, 2);
	});
});

Deno.test('public ChatGPT and AI Mode outcome APIs target their own dataset with twenty inputs', async () => {
	await mocked(async (setFetch) => {
		const originalProvider = Deno.env.get('LLM_SCRAPER_PROVIDER');
		Deno.env.set('LLM_SCRAPER_PROVIDER', 'brightdata');
		const calls: Array<
			{ url: string; body: { input: Array<{ index: number; url: string; prompt: string; country: string }> } }
		> = [];
		setFetch((url, init) => {
			calls.push({
				url: String(url),
				body: JSON.parse(String(init != null && 'body' in init ? init.body : undefined)),
			});
			return Promise.resolve(Response.json({ snapshot_id: 'sd_public' }));
		});
		try {
			for (const trigger of [triggerGPTBatchOutcomes, triggerAIMBatchOutcomes]) {
				const outcomes = await trigger({ prompts: Array.from({ length: 20 }, () => 'same prompt') });
				assertEquals(outcomes.length, 20);
				assertEquals(outcomes[19].inputIndex, 19);
			}
			assertEquals(getMaxPromptsPerRequest('chatgpt'), 20);
			assertEquals(getMaxPromptsPerRequest('aim'), 20);
			assertEquals(calls.length, 2);
			assertEquals(new URL(calls[0].url).searchParams.get('dataset_id'), 'gd_m7aof0k82r803d5bjm');
			assertEquals(new URL(calls[1].url).searchParams.get('dataset_id'), 'gd_mcswdt6z2elth3zqr2');
			assertEquals(calls.map((call) => call.body.input.length), [20, 20]);
			assertEquals(calls[1].body.input[19], {
				url: 'https://google.com/aimode',
				prompt: 'same prompt',
				country: '',
				index: 19,
			});
		} finally {
			if (originalProvider == null) Deno.env.delete('LLM_SCRAPER_PROVIDER');
			else Deno.env.set('LLM_SCRAPER_PROVIDER', originalProvider);
		}
	});
});

Deno.test('batch download propagates cancellation before and after fetching without partial results', async () => {
	await mocked(async (setFetch) => {
		for (const abortAt of [0, 1, 2]) {
			const controller = new AbortController();
			const reason = new Error('cancel download');
			(globalThis as Record<string, unknown>).abortSignal = controller.signal;
			let calls = 0;
			if (abortAt === 0) controller.abort(reason);
			setFetch(() => {
				calls++;
				if (calls === abortAt) controller.abort(reason);
				return Promise.resolve(Response.json(calls === 1 ? { status: 'ready' } : [response(0), response(1)]));
			});
			assertEquals(
				await assertRejects(
					() => createLLMScraper(createBrightdataProvider()).downloadSnapshotOutcomes('sd_job', 2),
					Error,
				),
				reason,
			);
			assertEquals(calls, abortAt);
		}
	});
});

const response = (index: number) => ({ index, prompt: 'duplicate prompt', answer_text: `answer ${index}` });

Deno.test('batch transforms preserve indexed successes around failed and missing inputs', () => {
	const transform = createBrightdataProvider().transformBatchResponse!;
	const outcomes = transform([
		response(3),
		{ input: { index: 1 }, error_code: 'failed', error: 'private detail' },
		response(0),
	], 4);
	assertEquals('answer' in outcomes[0] && outcomes[0].answer, 'answer 0');
	assertInstanceOf(outcomes[1], LLMSnapshotError);
	assertEquals(outcomes[1].kind, 'snapshot_error');
	assertEquals(outcomes[1].providerCode, 'failed');
	assertEquals(outcomes[1].message.includes('private'), false);
	assertInstanceOf(outcomes[2], LLMSnapshotError);
	assertEquals(outcomes[2].kind, 'malformed');
	assertEquals('answer' in outcomes[3] && outcomes[3].answer, 'answer 3');
	const duplicate = transform([response(1), response(0), response(0), response(0)], 2);
	assertInstanceOf(duplicate[0], LLMSnapshotError);
	assertEquals('answer' in duplicate[1] && duplicate[1].answer, 'answer 1');
});

Deno.test('anonymous provider errors preserve nineteen shuffled successes in a twenty-input batch', () => {
	const transform = createBrightdataProvider().transformBatchResponse!;
	const successes = [4, 19, 16, 6, 17, 2, 15, 18, 9, 5, 12, 0, 10, 7, 8, 1, 14, 3, 13].map(response);
	for (const position of [0, 10, 19]) {
		const raw: Array<unknown> = [...successes];
		raw.splice(position, 0, { error: 'private crawler detail', error_code: 'no_peers' });
		const outcomes = transform(raw, 20);
		assertEquals(outcomes.length, 20);
		for (let index = 0; index < 20; index++) {
			const outcome = outcomes[index];
			if (index === 11) {
				assertInstanceOf(outcome, LLMSnapshotError);
				assertEquals(outcome.kind, 'snapshot_error');
				assertEquals(outcome.providerCode, 'no_peers');
				assertEquals(outcome.message.includes('private'), false);
			} else {
				assertEquals('answer' in outcome && outcome.answer, `answer ${index}`);
			}
		}
	}
});

Deno.test('ambiguous anonymous errors do not overwrite indexed outcomes or guess error assignments', () => {
	const transform = createBrightdataProvider().transformBatchResponse!;
	const outcomes = transform([
		{ error_code: 'no_peers' },
		{ ...response(2), index: undefined, input: { index: 2 } },
		{ error: 'another private error' },
		response(0),
	], 4);
	assertEquals('answer' in outcomes[0] && outcomes[0].answer, 'answer 0');
	assertEquals('answer' in outcomes[2] && outcomes[2].answer, 'answer 2');
	for (const index of [1, 3]) {
		assertInstanceOf(outcomes[index], LLMSnapshotError);
		assertEquals((outcomes[index] as LLMSnapshotError).kind, 'malformed');
		assertEquals((outcomes[index] as LLMSnapshotError).providerCode, undefined);
	}
	const duplicate = transform([response(0), response(0), { error_code: 'no_peers' }], 2);
	assertEquals(
		duplicate.every((outcome) => outcome instanceof LLMSnapshotError && outcome.kind === 'malformed'),
		true,
	);
	assertEquals(transform([response(0), { error_code: 'no_peers' }], 1)[0], transform([response(0)], 1)[0]);
});

Deno.test('anonymous errors reuse provider-code sanitization and cannot hide invalid indices', () => {
	const transform = createBrightdataProvider().transformBatchResponse!;
	const sanitized = transform([response(0), { error_code: 'private detail with spaces' }], 2)[1];
	assertInstanceOf(sanitized, LLMSnapshotError);
	assertEquals(sanitized.kind, 'snapshot_error');
	assertEquals(sanitized.providerCode, undefined);
	assertEquals(sanitized.message.includes('private'), false);
	for (
		const record of [
			{ error: '', error_code: '' },
			{ error: null, error_code: null },
			{ error_code: 'no_peers', index: -1 },
			{ error_code: 'no_peers', index: 2 },
			{ error_code: 'no_peers', index: '1' },
			{ error_code: 'no_peers', index: 1, input: { index: 0 } },
		]
	) {
		assertEquals(
			transform([response(0), record], 2).every((outcome) =>
				outcome instanceof LLMSnapshotError && outcome.kind === 'malformed'
			),
			true,
		);
	}
});

Deno.test('anonymous errors retain job metadata without another download or trigger', async () => {
	await mocked(async (setFetch) => {
		let calls = 0;
		setFetch(() =>
			Promise.resolve(
				Response.json(++calls === 1 ? { status: 'ready' } : [response(1), { error_code: 'no_peers' }]),
			)
		);
		const outcomes = await createLLMScraper(createBrightdataProvider()).downloadSnapshotOutcomes('sd_existing', 2);
		assertEquals(calls, 2);
		assertEquals(outcomes.length, 2);
		assertInstanceOf(outcomes[0], LLMSnapshotError);
		assertEquals(outcomes[0].kind, 'snapshot_error');
		assertEquals(outcomes[0].providerCode, 'no_peers');
		assertEquals(outcomes[0].jobId, 'sd_existing');
		assertEquals('answer' in outcomes[1] && outcomes[1].answer, 'answer 1');
	});
});

Deno.test('unidentifiable and contradictory indices invalidate the ambiguous snapshot', () => {
	const transform = createBrightdataProvider().transformBatchResponse!;
	for (const invalid of [undefined, null, -1, 2, 0.5, '0', NaN]) {
		const outcomes = transform([response(0), { ...response(1), index: invalid }], 2);
		assertEquals(
			outcomes.every((outcome) => outcome instanceof LLMSnapshotError && outcome.kind === 'malformed'),
			true,
		);
	}
	assertEquals(
		transform([response(0), { ...response(1), input: { index: 0 } }], 2).every((outcome) =>
			outcome instanceof LLMSnapshotError
		),
		true,
	);
	assertEquals(
		transform([{ prompt: 'single', answer_text: 'legacy' }], 1)[0],
		createBrightdataProvider().transformResponse([{ prompt: 'single', answer_text: 'legacy' }]),
	);
});

Deno.test('download outcomes downloads once, attaches job metadata, and validates count before requests', async () => {
	await mocked(async (setFetch) => {
		let calls = 0;
		setFetch(() => Promise.resolve(Response.json(++calls === 1 ? { status: 'ready' } : [response(1)])));
		const scraper = createLLMScraper(createBrightdataProvider());
		for (const count of [0, -1, 0.5, NaN, Infinity, 21]) {
			await assertRejects(
				() => scraper.downloadSnapshotOutcomes('sd_job', count),
				Error,
				'Invalid scraper input count',
			);
		}
		assertEquals(calls, 0);
		const outcomes = await scraper.downloadSnapshotOutcomes('sd_job', 2);
		assertEquals(calls, 2);
		assertInstanceOf(outcomes[0], LLMSnapshotError);
		assertEquals(outcomes[0].jobId, 'sd_job');
		assertEquals('answer' in outcomes[1] && outcomes[1].answer, 'answer 1');
	});
});

Deno.test('twenty-input uncertainty is not resubmitted and 429 retries preserve the identical payload', async () => {
	await mocked(async (setFetch) => {
		const prompts = Array.from({ length: 20 }, (_, index) => `prompt ${index}`);
		let calls = 0;
		const bodies: Array<string> = [];
		setFetch((_url, init) => {
			bodies.push(String(init != null && 'body' in init ? init.body : undefined));
			return Promise.resolve(
				++calls === 1
					? new Response('', { status: 429, headers: { 'Retry-After': '0' } })
					: new Response('', { status: 503 }),
			);
		});
		const outcomes = await createLLMScraper(createBrightdataProvider()).triggerLLMBatchOutcomes({ prompts });
		assertEquals(calls, 2);
		assertEquals(bodies[0], bodies[1]);
		assertEquals(outcomes.every((outcome) => outcome.failure?.kind === 'trigger_uncertain'), true);
		assertEquals(outcomes.map((outcome) => outcome.inputIndex), Array.from({ length: 20 }, (_, index) => index));
		const controller = new AbortController();
		(globalThis as Record<string, unknown>).abortSignal = controller.signal;
		setFetch(() => {
			controller.abort(new Error('cancel batch'));
			return Promise.resolve(new Response('', { status: 429 }));
		});
		await assertRejects(
			() => createLLMScraper(createBrightdataProvider()).triggerLLMBatchOutcomes({ prompts }),
			Error,
			'cancel batch',
		);
	});
});

Deno.test('explicit signals cancel trigger rate-limit waits without a global signal', async () => {
	await mocked(async (setFetch) => {
		const controller = new AbortController();
		const reason = new Error('explicit trigger cancellation');
		let calls = 0;
		setFetch((_url, init) => {
			calls++;
			assertEquals(init != null && 'signal' in init ? init.signal : undefined, controller.signal);
			setTimeout(() => controller.abort(reason), 0);
			return Promise.resolve(new Response('', { status: 429, headers: { 'Retry-After': '60' } }));
		});
		assertEquals(
			await assertRejects(() =>
				createLLMScraper(createBrightdataProvider()).triggerLLMBatchOutcomes({
					prompts: ['a', 'b'],
					signal: controller.signal,
				}), Error),
			reason,
		);
		assertEquals(calls, 1);
		assertEquals((globalThis as Record<string, unknown>).abortSignal, undefined);
	});
});

Deno.test('explicit signals cancel monitoring and download retry waits with the original reason', async () => {
	await mocked(async (setFetch) => {
		for (const stage of ['monitor', 'download']) {
			const controller = new AbortController();
			const reason = new Error(`explicit ${stage} cancellation`);
			let calls = 0;
			setFetch((_url, init) => {
				calls++;
				assertEquals(init != null && 'signal' in init ? init.signal : undefined, controller.signal);
				if (stage === 'download' && calls === 1) return Promise.resolve(Response.json({ status: 'ready' }));
				setTimeout(() => controller.abort(reason), 0);
				return Promise.resolve(new Response('', { status: 503 }));
			});
			assertEquals(
				await assertRejects(() =>
					createLLMScraper(createBrightdataProvider()).downloadSnapshotOutcomes(
						'sd_existing',
						2,
						controller.signal,
					), Error),
				reason,
			);
			assertEquals(calls, stage === 'monitor' ? 1 : 2);
			assertEquals((globalThis as Record<string, unknown>).abortSignal, undefined);
		}
	});
});
