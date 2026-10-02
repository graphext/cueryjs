import { assertEquals, assertRejects, assertThrows } from '@std/assert';
import {
	createBrightdataProvider,
	transformBrightdataLLMResponse,
} from '../src/apis/brightdata/llmScraper/brightdata.ts';
import {
	createLLMScraper,
	LLMSnapshotError,
	type ProviderFunctions,
} from '../src/apis/brightdata/llmScraper/scrape.ts';

const brightdata = createBrightdataProvider();

Deno.test('Bright Data rejects error snapshots without leaking provider text or prompts', () => {
	for (
		const payload of [
			[{ error: 'secret prompt token=abc', error_code: 'ai_mode_failed' }],
			{ error_code: 'ai_mode_failed' },
			[{ prompt: 'valid', answer_text: 'answer' }, { error_code: 'ai_mode_failed' }],
			[{ prompt: 'secret', answer_text: 'partial', error: 'secret failure' }],
		]
	) {
		const error = assertThrows(() => brightdata.transformResponse(payload), LLMSnapshotError);
		assertEquals(error.kind, 'snapshot_error');
		assertEquals(error.message.includes('secret'), false);
	}
	const error = assertThrows(() => brightdata.transformResponse([{ error_code: 'token=secret' }]), LLMSnapshotError);
	assertEquals(error.providerCode, undefined);
});

Deno.test('Bright Data distinguishes explicit empty answers from malformed payloads', () => {
	assertEquals(
		transformBrightdataLLMResponse([{ prompt: 'Valid question', answer_text: 'answer' }]).answer,
		'answer',
	);
	assertEquals(brightdata.transformResponse([{ prompt: 'Valid question', answer_text: '' }])?.answer, '');
	assertEquals(brightdata.transformResponse([{ prompt: 'Valid question', answer_text_markdown: '' }])?.answer, '');
	for (
		const payload of [
			null,
			[],
			{},
			[null],
			['text'],
			[{ prompt: 'Only prompt' }],
			[{ answer_text: 'Missing prompt' }],
			[{ prompt: '', answer_text: '' }],
			[{ prompt: 'question', answer_text: 123 }],
			[{ prompt: 'question', answer_text: 'a', citations: {} }],
			[{ prompt: 'question', answer_text: 'a', citations: [null] }],
			[{ prompt: 'question', answer_text: 'a', links_attached: [null] }],
			[{ prompt: 'question', answer_text: 'a', web_search_query: [123] }],
		]
	) {
		assertEquals(assertThrows(() => brightdata.transformResponse(payload), LLMSnapshotError).kind, 'malformed');
	}
});

Deno.test('Other scraper providers preserve their existing nullable snapshot behavior', async () => {
	const scraper = createLLMScraper(provider({ strictSnapshots: false, monitorJob: () => Promise.resolve(false) }));
	assertEquals((await scraper.downloadLLMSnapshots(['existing']))[0].answer, '');
});

function provider(overrides: Partial<ProviderFunctions> = {}): ProviderFunctions {
	return {
		name: 'Test provider',
		strictSnapshots: true,
		maxConcurrency: 1,
		maxPromptsPerRequest: 1,
		triggerJob: () => Promise.resolve('new-job'),
		monitorJob: () => Promise.resolve(true),
		downloadJob: () => Promise.resolve([{ prompt: 'question', answer_text: 'answer' }]),
		transformResponse: brightdata.transformResponse,
		...overrides,
	};
}

Deno.test('Snapshot download rejects readiness and download failures instead of persisting blanks', async () => {
	for (
		const [kind, overrides] of [
			['not_ready', { monitorJob: () => Promise.resolve(false) }],
			['download', { downloadJob: () => Promise.resolve(null) }],
			['malformed', { transformResponse: () => null }],
			['snapshot_error', { downloadJob: () => Promise.resolve([{ error_code: 'failed' }]) }],
		] as const
	) {
		let triggers = 0;
		const scraper = createLLMScraper(provider({
			...overrides,
			triggerJob: () => {
				triggers++;
				return Promise.resolve('new');
			},
		}));
		const error = await assertRejects(() => scraper.downloadLLMSnapshots(['existing-job']), LLMSnapshotError);
		assertEquals(error.kind, kind);
		assertEquals(error.jobId, 'existing-job');
		await assertRejects(() => scraper.downloadLLMSnapshots(['existing-job']), LLMSnapshotError);
		assertEquals(triggers, 0);
	}
	assertEquals(
		(await assertRejects(() => createLLMScraper(provider()).downloadLLMSnapshots([null]), LLMSnapshotError)).kind,
		'missing_job',
	);
});

Deno.test('Snapshot cancellation propagates unchanged before and during monitoring', async () => {
	const globals = globalThis as Record<string, unknown>;
	const original = globals.abortSignal;
	try {
		for (const immediate of [true, false]) {
			const controller = new AbortController();
			const reason = new DOMException('Cancelled', 'AbortError');
			globals.abortSignal = controller.signal;
			if (immediate) controller.abort(reason);
			const scraper = createLLMScraper(provider({
				monitorJob: () => {
					controller.abort(reason);
					return Promise.resolve(false);
				},
			}));
			assertEquals(await assertRejects(() => scraper.downloadLLMSnapshots(['job']), DOMException), reason);
		}
		const controller = new AbortController();
		const reason = new DOMException('Cancelled after download', 'AbortError');
		globals.abortSignal = controller.signal;
		const scraper = createLLMScraper(provider({
			downloadJob: () => {
				controller.abort(reason);
				return Promise.resolve([{ prompt: 'question', answer_text: 'answer' }]);
			},
		}));
		assertEquals(await assertRejects(() => scraper.downloadLLMSnapshots(['job']), DOMException), reason);
	} finally {
		globals.abortSignal = original;
	}
});

Deno.test('Bright Data HTTP200 error-only download and terminal progress never become answers', async () => {
	const fetchOriginal = globalThis.fetch;
	const keyOriginal = Deno.env.get('BRIGHTDATA_API_KEY');
	Deno.env.set('BRIGHTDATA_API_KEY', 'test-only-key');
	try {
		let calls = 0;
		globalThis.fetch = () => {
			calls++;
			return Promise.resolve(
				Response.json(
					calls === 1 ? { status: 'ready' } : [{ error: 'unsafe detail', error_code: 'collector_failed' }],
				),
			);
		};
		const error = await assertRejects(
			() => createLLMScraper(brightdata).downloadLLMSnapshots(['existing']),
			LLMSnapshotError,
		);
		assertEquals(error.kind, 'snapshot_error');
		assertEquals(error.providerCode, 'collector_failed');
		assertEquals(error.jobId, 'existing');
		assertEquals(calls, 2);
		globalThis.fetch = () => Promise.resolve(Response.json({ status: 'failed' }));
		assertEquals(
			(await assertRejects(() => brightdata.monitorJob('failed-job'), LLMSnapshotError)).kind,
			'snapshot_error',
		);
		globalThis.fetch = () => Promise.resolve(new Response('unsafe detail', { status: 403 }));
		assertEquals(
			(await assertRejects(() => createLLMScraper(brightdata).downloadLLMSnapshots(['job']), LLMSnapshotError))
				.kind,
			'not_ready',
		);
		calls = 0;
		globalThis.fetch = () =>
			Promise.resolve(
				++calls === 1 ? Response.json({ status: 'ready' }) : new Response('unsafe detail', { status: 403 }),
			);
		assertEquals(
			(await assertRejects(() => createLLMScraper(brightdata).downloadLLMSnapshots(['job']), LLMSnapshotError))
				.kind,
			'download',
		);
	} finally {
		globalThis.fetch = fetchOriginal;
		if (keyOriginal == null) Deno.env.delete('BRIGHTDATA_API_KEY');
		else Deno.env.set('BRIGHTDATA_API_KEY', keyOriginal);
	}
});

Deno.test('Bright Data cancellation propagates through trigger, monitor and download', async () => {
	const fetchOriginal = globalThis.fetch;
	const globals = globalThis as Record<string, unknown>;
	const signalOriginal = globals.abortSignal;
	const keyOriginal = Deno.env.get('BRIGHTDATA_API_KEY');
	Deno.env.set('BRIGHTDATA_API_KEY', 'test-only-key');
	try {
		for (
			const operation of [
				() => brightdata.triggerJob('question', false, null),
				() => brightdata.monitorJob('existing'),
				() => brightdata.downloadJob('existing'),
			]
		) {
			const controller = new AbortController();
			const reason = new DOMException('Cancelled', 'AbortError');
			globals.abortSignal = controller.signal;
			globalThis.fetch = () => {
				controller.abort(reason);
				return Promise.reject(reason);
			};
			assertEquals(await assertRejects(operation, DOMException), reason);
		}
	} finally {
		globalThis.fetch = fetchOriginal;
		globals.abortSignal = signalOriginal;
		if (keyOriginal == null) Deno.env.delete('BRIGHTDATA_API_KEY');
		else Deno.env.set('BRIGHTDATA_API_KEY', keyOriginal);
	}
});
