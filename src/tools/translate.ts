import { mapParallel } from '../helpers/async.ts';
import { askLLMSafe, calculateCost, type LLMResponse } from '../llm.ts';
import { BatchResponse } from '../response.ts';
import { dedent } from '../helpers/utils.ts';
import type { BrandContext } from '../schemas/brand.schema.ts';

const TRANSLATE_PROMPT = dedent(`
You are an expert in understanding search intent and conversational AI interactions.

Convert the following Google search keyword into an equivalent natural language prompt that
someone would use when interacting with an LLM like ChatGPT. The LLM prompt should:

- Be conversational and natural, as if speaking to an assistant
- Capture the same intent and information need as the keyword
- Be a complete sentence or question
- Not be overly verbose - keep it concise but natural
- Be written in "{language}"

For example:
- "best running shoes" → "What are the best running shoes?"
- "how to train for marathon" → "How do I train for a marathon?"
- "nike air max review" → "Can you give me a review of Nike Air Max shoes?"
- "weather new york" → "What's the weather like in New York?"

## Brand Context Rules

You will receive brand context (sector, country). Follow these rules strictly:

1. **DO NOT** change the core intent or meaning of the keyword
2. **DO** use brand context to disambiguate terms when multiple interpretations exist
3. The keyword's original intent must be preserved - brand context only helps clarify ambiguous terms

**Example of correct disambiguation:**
- Keyword: "geo"
- Brand sector: "ai visibility search"
- WRONG: "Tell me about geography" (ignores sector context)
- CORRECT: "What is GEO in AI visibility and search optimization?" (uses sector to disambiguate the acronym)

{additional_instructions}

# Keyword

{keyword}

# Brand Context (for reference only)
- Sector: {sector}
- Country: {country}

Return only the converted prompt, nothing else.
`);

export interface translateParams {
	keyword: string;
	language?: string;
	model?: string;
	instructions?: string;
	brandContext: BrandContext;
}

/**
 * Translates a single Google search keyword into an equivalent LLM prompt.
 * Returns LLMResult with usage tracking.
 */
export async function translate({
	keyword,
	language = 'en',
	model = 'gpt-5-mini',
	brandContext,
	instructions = '',
}: translateParams): Promise<LLMResponse<string | null>> {
	if (keyword == null || keyword.trim() === '') {
		return { parsed: null, text: null, usage: null, error: null };
	}

	const prompt = TRANSLATE_PROMPT.replace('{keyword}', keyword)
		.replace('{language}', language)
		.replace('{sector}', brandContext.sector)
		.replace('{country}', brandContext.country)
		.replace('{additional_instructions}', instructions);

	const response = await askLLMSafe({
		prompt,
		model,
		maxRetries: 3,
		onError: 'return',
	});

	if (response.error != null || response.parsed == null) {
		return {
			parsed: null,
			text: response.text,
			usage: response.usage,
			error: response.error,
		};
	}

	return {
		parsed: response.parsed,
		text: response.text,
		usage: response.usage,
		error: null,
	};
}

export interface translateBatchParams {
	keywords: Array<string>;
	language?: string;
	model?: string;
	maxConcurrency?: number;
	instructions?: string;
	brandContext: BrandContext;
	trackCost?: boolean;
}

/**
 * Translates multiple Google search keywords to LLM prompts with usage tracking.
 * Returns BatchResponse where individual items are null on failure.
 */
export async function translateBatch({
	keywords,
	language = 'en',
	model = 'gpt-4.1-mini',
	maxConcurrency = 100,
	brandContext,
	instructions = '',
	trackCost = false,
}: translateBatchParams): Promise<BatchResponse<string | null>> {
	const responses = await mapParallel(keywords, maxConcurrency, (kwd) =>
		translate({ keyword: kwd, language, model, brandContext, instructions })
	);

	return new BatchResponse(
		responses.map((r) => r.parsed),
		trackCost ? responses.map((r) => r.usage) : undefined,
		trackCost ? model : undefined,
		trackCost ? calculateCost : undefined
	);
}

const REVERSE_TRANSLATE_PROMPT = dedent(`
You are an expert in understanding search intent.

Convert the following natural language prompt into an equivalent Google search keyword.
The keyword should:

- Be concise
- Capture the core search intent
- Remove conversational filler and politeness
- Use common search terms

For example:
- "What are the best running shoes?" → "best running shoes"
- "How do I train for a marathon?" → "how to train marathon"
- "Can you give me a review of Nike Air Max shoes?" → "nike air max review"
- "What's the weather like in New York?" → "weather new york"

Make sure the keyword is in the language "{language}".

It's mandatory that the keyword contains no more than 4 words, ideally 2-3 words.
Otherwise, Google keyword planner will not accept it.

# Prompt

{prompt}

Return only the keyword, nothing else.
`);

export interface reverseTranslateParams {
	prompt: string;
	language?: string;
	model?: string;
}

/**
 * Converts a natural language prompt into an equivalent Google search keyword.
 * Returns LLMResult with usage tracking.
 */
export async function reverseTranslate({
	prompt,
	language = 'en',
	model = 'gpt-4.1-mini',
}: reverseTranslateParams): Promise<LLMResponse<string | null>> {
	if (prompt == null || prompt.trim() === '') {
		return { parsed: null, text: null, usage: null, error: null };
	}

	const requestPrompt = REVERSE_TRANSLATE_PROMPT.replace('{prompt}', prompt).replace(
		'{language}',
		language
	);

	const response = await askLLMSafe({
		prompt: requestPrompt,
		model,
		maxRetries: 3,
		onError: 'return',
	});

	if (response.error != null || response.parsed == null) {
		return {
			parsed: null,
			text: response.text,
			usage: response.usage,
			error: response.error,
		};
	}

	return {
		parsed: response.parsed,
		text: response.text,
		usage: response.usage,
		error: null,
	};
}

export interface reverseTranslateBatchParams {
	prompts: Array<string>;
	language?: string;
	model?: string;
	maxConcurrency?: number;
	trackCost?: boolean;
}

/**
 * Converts multiple natural language prompts to Google search keywords with usage tracking.
 * Returns BatchResponse where individual items are null on failure.
 */
export async function reverseTranslateBatch({
	prompts,
	language = 'en',
	model = 'gpt-5-mini',
	maxConcurrency = 100,
	trackCost = false,
}: reverseTranslateBatchParams): Promise<BatchResponse<string | null>> {
	const responses = await mapParallel(prompts, maxConcurrency, (p) =>
		reverseTranslate({ prompt: p, language, model })
	);

	return new BatchResponse(
		responses.map((r) => r.parsed),
		trackCost ? responses.map((r) => r.usage) : undefined,
		trackCost ? model : undefined,
		trackCost ? calculateCost : undefined
	);
}
