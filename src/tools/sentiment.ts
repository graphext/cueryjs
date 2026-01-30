import { mapParallel } from '../helpers/async.ts';
import { askLLMSafe, type LLMResponse, type Message } from '../llm.ts';
import { BatchResponse } from '../response.ts';
import type { BrandContext } from '../schemas/brand.schema.ts';
import { ABSentimentsSchema, type ABSentiment } from '../schemas/sentiment.schema.ts';
import { dedent } from '../helpers/utils.ts';

const ABS_PROMPT_SYSTEM = dedent(`
You're an expert in Aspect-Based Sentiment Analysis. Your task involves identifying specific
entities mentioned in a text (e.g. a person, product, service, or experience) and determining the
polarity of the sentiment expressed toward each.

Specifically:

1. Identify aspects in the text that have either a positive or negative sentiment expressed toward them.
2. Ignore(!) all aspects that do not have a sentiment associated with them or where the sentiment is neutral.
3. Output a list of objects, where each object contains
    a. the aspect as it occurs in the text (key "aspect")
    b. the sentiment label as either "positive" or "negative" (key "sentiment")
    c. the reason for the sentiment assignment as a short text (key "reason")
4. If there are no sentiment-bearing aspects in the text, the output should be an empty list

Example Output format:
[{"aspect": "room service", "sentiment": "negative", "reason": "Room service was mentioned being rude."}, ...]

Only extract aspects that have an explicitly expressed sentiment associated with them, i.e.
subjective opinions, feelings, or evaluations. Do not infer sentiment from factual statements,
e.g. just because a feature is mentioned as "new", a product or service is mentioned as having
a certain feature, or because something is mentioned as "modern", "efficient" etc. it shouldn't be
considered a sentiment. Look for explicit expressions of positive or negative feelings, especially
adjectives or adverbs that indicate a sentiment.

{instructions}
`);

const ABS_PROMPT_USER = dedent(`
Return the entities and their sentiments with reasons from the following text section.

# Text

{text}
`);

/**
 * Parameters for extractAspectBasedSentiments.
 */
export interface ExtractSentimentsParams {
	/** Text to analyze */
	text: string | null;
	/** Additional instructions */
	instructions?: string;
	/** Model to use (default: 'gpt-4.1-mini') */
	model?: string;
}

/**
 * Extracts aspect-based sentiments from a text.
 * Returns LLMResult with usage tracking.
 */
export async function extractAspectBasedSentiments({
	text,
	instructions = '',
	model = 'gpt-4.1-mini',
}: ExtractSentimentsParams): Promise<LLMResponse<Array<ABSentiment> | null>> {
	if (text == null || text.trim() === '') {
		return { parsed: null, text: null, usage: null, error: null };
	}

	const promptSystem = ABS_PROMPT_SYSTEM.replace('{instructions}', instructions);
	const promptUser = ABS_PROMPT_USER.replace('{text}', text);

	const conversation: Message[] = [
		{ role: 'system', content: promptSystem },
		{ role: 'user', content: promptUser },
	];

	const response = await askLLMSafe({
		prompt: conversation,
		model,
		schema: ABSentimentsSchema,
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
		parsed: response.parsed.aspects,
		text: response.text,
		usage: response.usage,
		error: null,
	};
}

/**
 * Parameters for extractABSForBrandBatch.
 */
export interface ExtractSentimentsBatchParams {
	/** Array of texts to analyze */
	texts: Array<string | null>;
	/** Brand context for focused analysis */
	brand?: BrandContext | null;
	/** Model to use (default: 'gpt-4.1-mini') */
	model?: string;
	/** Max concurrent requests (default: 100) */
	maxConcurrency?: number;
	/** Enable cost tracking (default: false) */
	trackCost?: boolean;
}

/**
 * Extracts aspect-based sentiments from multiple texts with usage tracking.
 * Returns BatchResponse where individual items are null on failure.
 */
export async function extractABSForBrandBatch({
	texts,
	brand = null,
	model = 'gpt-4.1-mini',
	maxConcurrency = 100,
	trackCost = false,
}: ExtractSentimentsBatchParams): Promise<BatchResponse<Array<ABSentiment> | null>> {
	const instructions = brand
		? dedent(`
    When analyzing the text, pay special attention to any mentions of the brand "${brand.shortName}"
    or its products/services (${brand.portfolio}). Ensure that any sentiments expressed toward this
    brand or its offerings are accurately captured in your output. Respond in language code ${brand.language}.
    `)
		: '';

	const responses = await mapParallel(texts, maxConcurrency, (text) =>
		extractAspectBasedSentiments({ text, instructions, model })
	);

	return new BatchResponse(
		responses.map((r) => r.parsed),
		trackCost ? responses.map((r) => r.usage) : undefined,
		trackCost ? model : undefined
	);
}
