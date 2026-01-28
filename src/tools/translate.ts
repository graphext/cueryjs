import { mapParallel } from '../async.ts';
import { askOpenAISafe } from '../openai.ts';


import { dedent } from '../utils.ts';
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
 */
export async function translate(
	{ keyword, language = 'en', model = 'gpt-5-mini', brandContext, instructions = '' }: translateParams
): Promise<string> {
	const prompt = TRANSLATE_PROMPT
		.replace('{keyword}', keyword)
		.replace('{language}', language)
		.replace('{sector}', brandContext.sector)
		.replace('{country}', brandContext.country)
		.replace('{additional_instructions}', instructions);
	const { parsed } = await askOpenAISafe(prompt, model);

	if (!parsed) {
		throw new Error('Failed to parse translation from OpenAI response');
	}

	return parsed;
}

/**
 * Translates multiple Google search keywords to LLM prompts concurrently while preserving order.
 */

export interface translateBatchParams {
	keywords: Array<string>;
	language?: string;
	model?: string;
	maxConcurrency?: number;
	instructions?: string;
	brandContext: BrandContext;
}

export async function translateBatch(
	params: translateBatchParams
): Promise<Array<string>> {
	const { keywords, language = 'en', model = 'gpt-4.1-mini', maxConcurrency = 100, brandContext, instructions = '' } = params;

	return mapParallel(
		keywords,
		maxConcurrency,
		kwd => translate({ keyword: kwd, language, model, brandContext, instructions })
	);
}

const REVERSE_TRANSLATE_PROMPT = dedent(`
You are an expert in understanding search intent.

Convert the following natural language prompt into an equivalent Google search keyword.
The keyword should:

- Be concise (typically 2-5 words)
- Capture the core search intent
- Remove conversational filler and politeness
- Use common search terms

For example:
- "What are the best running shoes?" → "best running shoes"
- "How do I train for a marathon?" → "how to train marathon"
- "Can you give me a review of Nike Air Max shoes?" → "nike air max review"
- "What's the weather like in New York?" → "weather new york"

Make sure the keyword is in the language "{language}".

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
 */
export async function reverseTranslate(
	{ prompt, language = 'en', model = 'gpt-4.1-mini' }: reverseTranslateParams
): Promise<string> {
	const requestPrompt = REVERSE_TRANSLATE_PROMPT
		.replace('{prompt}', prompt)
		.replace('{language}', language);
	const { parsed } = await askOpenAISafe(requestPrompt, model);

	if (!parsed) {
		throw new Error('Failed to parse reverse translation from OpenAI response');
	}

	return parsed;
}

export interface reverseTranslateBatchParams {
	prompts: Array<string>;
	language?: string;
	model?: string;
	maxConcurrency?: number;
}

/**
 * Converts multiple natural language prompts to Google search keywords concurrently while preserving order.
 */
export async function reverseTranslateBatch(
	params: reverseTranslateBatchParams
): Promise<Array<string>> {
	const { prompts, language = 'en', model = 'gpt-5-mini', maxConcurrency = 100 } = params;

	return mapParallel(
		prompts,
		maxConcurrency,
		p => reverseTranslate({ prompt: p, language, model })
	);
}