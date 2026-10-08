import { assert, assertEquals, assertExists } from '@std/assert';
import { z } from '@zod/zod';
import { OpenAIProvider } from '../src/providers/openai.ts';
import { normalizeOpenAIParams } from '../src/providers/openai-params.ts';
import { calculateCost, getModelInfo } from '../src/providers/pricing.ts';
import { searchBatch, searchWithFormat } from '../src/tools/search.ts';

interface RequestBody {
	model: string;
	reasoning: { effort: string };
	temperature?: number;
	input: Array<{ content: string }>;
	tools: Array<{ type: string }>;
	text?: { format: { strict: boolean; schema: { additionalProperties: boolean } } };
}

Deno.test('GPT-6 options preserve explicit effort, normalize aliases, and leave other models alone', () => {
	assertEquals(normalizeOpenAIParams('gpt-6-luna'), { reasoning: { effort: 'none' } });
	assertEquals(normalizeOpenAIParams('gpt-6.1-sol'), { reasoning: { effort: 'medium' } });
	for (const effort of ['none', 'low', 'medium', 'high', 'xhigh', 'max']) {
		const params = {
			reasoning: { effort: 'high', summary: 'auto' },
			reasoning_effort: effort,
			temperature: 0.3,
			top_p: 0.8,
		};
		const normalized = normalizeOpenAIParams('gpt-6-luna', params);
		assertEquals(normalized.reasoning, { effort, summary: 'auto' });
		assertEquals(normalized.temperature, effort === 'none' ? 0.3 : undefined);
		assertEquals(normalized.top_p, effort === 'none' ? 0.8 : undefined);
		assertEquals(params.reasoning.effort, 'high');
	}
	assertEquals(normalizeOpenAIParams('gpt-6.1-sol', { reasoning_effort: 'none' }), { reasoning: { effort: 'low' } });
	assertEquals(normalizeOpenAIParams('gpt-6-luna', { reasoning_effort: 'minimal' }), {
		reasoning: { effort: 'low' },
	});
	assertEquals(normalizeOpenAIParams('gpt-4.1-mini', { temperature: 0.3 }), { temperature: 0.3 });
});

Deno.test('Responses SDK parses strict Zod output in parallel and rejects invalid schema output', async () => {
	const original = globalThis.fetch;
	const requests: Array<RequestBody> = [];
	globalThis.fetch = async (_input, init) => {
		await Promise.resolve();
		const body = JSON.parse(String(init?.body));
		requests.push(body);
		const text = body.input[0].content === 'invalid' ? '{"answer":42}' : '{"answer":"ok"}';
		return Response.json({
			id: 'resp_test',
			object: 'response',
			status: 'completed',
			output: [{
				type: 'message',
				role: 'assistant',
				status: 'completed',
				content: [{ type: 'output_text', text, annotations: [] }],
			}],
			usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
		});
	};
	try {
		const provider = new OpenAIProvider('test-key');
		const schema = z.object({ answer: z.string() });
		const results = await Promise.all(
			['gpt-6-luna', 'gpt-6.1-sol'].map((model) =>
				provider.complete([{ role: 'user', content: 'valid' }], model, schema, { temperature: 0.2 })
			),
		);
		for (const result of results) {
			assertEquals(result.parsed, { answer: 'ok' });
			assertEquals(result.error, null);
			assertEquals(result.usage?.totalTokens, 12);
		}
		assertEquals(requests.map((r) => r.reasoning.effort), ['none', 'medium']);
		assertEquals(requests.map((r) => r.temperature), [0.2, undefined]);
		assert(requests.every((r) => r.text?.format.strict && r.text.format.schema.additionalProperties === false));
		const invalid = await provider.complete([{ role: 'user', content: 'invalid' }], 'gpt-6-luna', schema);
		assertExists(invalid.error);
		assertEquals(invalid.parsed, null);
	} finally {
		globalThis.fetch = original;
	}
});

Deno.test('web search and formatted parallel searches send Luna none and Sol explicit effort', async () => {
	const original = globalThis.fetch;
	const originalKey = Deno.env.get('OPENAI_API_KEY');
	Deno.env.set('OPENAI_API_KEY', 'test-key');
	const requests: Array<RequestBody> = [];
	globalThis.fetch = async (_input, init) => {
		await Promise.resolve();
		const body = JSON.parse(String(init?.body));
		requests.push(body);
		return Response.json({
			id: 'resp_test',
			object: 'response',
			status: 'completed',
			output: [
				{ type: 'web_search_call', id: 'search', status: 'completed' },
				{
					type: 'message',
					role: 'assistant',
					status: 'completed',
					content: [{
						type: 'output_text',
						text: body.text ? '{"answer":"ok"}' : 'Found answer',
						annotations: [],
					}],
				},
			],
		});
	};
	try {
		const batch = await searchBatch({ prompts: ['first', 'second'], maxConcurrency: 2 });
		assertEquals(batch.map((r) => r.answer), ['Found answer', 'Found answer']);
		assert(
			requests.every((r) =>
				r.model === 'gpt-6-luna' && r.reasoning.effort === 'none' && r.tools[0].type === 'web_search'
			),
		);
		const parsed = await searchWithFormat({
			prompt: 'question',
			model: 'gpt-6.1-sol',
			reasoningEffort: 'high',
			responseSchema: z.object({ answer: z.string() }),
		});
		assertEquals(parsed, { answer: 'ok' });
		assertEquals(requests[2].reasoning.effort, 'high');
		assertEquals(requests[3].model, 'gpt-6-luna');
		assertEquals(requests[3].reasoning.effort, 'none');
	} finally {
		globalThis.fetch = original;
		if (originalKey == null) Deno.env.delete('OPENAI_API_KEY');
		else Deno.env.set('OPENAI_API_KEY', originalKey);
	}
});

Deno.test('GPT-6 pricing is available for usage tracking', () => {
	assertEquals(calculateCost('gpt-6-luna', { inputTokens: 1000000, outputTokens: 1000000, totalTokens: 2000000 })?.totalCost, 0.6);
	assertEquals(calculateCost('gpt-6.1-sol', { inputTokens: 1000000, outputTokens: 1000000, totalTokens: 2000000 })?.totalCost, 12);
	assertEquals(getModelInfo('gpt-6-luna')?.provider, 'openai');
});
