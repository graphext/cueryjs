import mapParallel from './mapParallel.ts';
import { askOpenAISafe, type AIConversation } from './openai.ts';

import { type BrandContext } from './schemas/brand.schema.ts';
import { ABSentimentsSchema, type ABSentiment } from './schemas/sentiment.schema.ts';
import { dedent } from './utils.ts';

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
 * Extracts aspect-based sentiments from a text.
 */
export async function extractAspectBasedSentiments(
	text: string | null,
	instructions: string = '',
	model: string = 'gpt-4.1-mini'
): Promise<Array<ABSentiment>> {

	if (text == null || text.trim() === '') {
		return [];
	}

	const promptSystem = ABS_PROMPT_SYSTEM.replace('{instructions}', instructions);
	const promptUser = ABS_PROMPT_USER.replace('{text}', text);

	const conversation: AIConversation = [
		{ role: 'system', content: promptSystem },
		{ role: 'user', content: promptUser }
	];

	const { parsed } = await askOpenAISafe(conversation, model, ABSentimentsSchema);
	if (!parsed) {
		throw new Error('Failed to parse response from OpenAI');
	}

	return parsed.aspects;
}

/**
 * Classifies multiple data records concurrently while preserving order.
 */
export async function extractABSForBrandBatch(
	texts: Array<string | null>,
	brand: BrandContext | null = null,
	model: string = 'gpt-4.1-mini',
	maxConcurrency: number = 100
): Promise<Array<Array<ABSentiment>>> {
	const instructions = brand ? dedent(`
    When analyzing the text, pay special attention to any mentions of the brand "${brand.shortName}"
    or its products/services (${brand.portfolio}). Ensure that any sentiments expressed toward this
    brand or its offerings are accurately captured in your output. Respond in language code ${brand.language}.
    `) : '';

	return mapParallel(
		texts,
		maxConcurrency,
		(text: string | null) => extractAspectBasedSentiments(text, instructions, model)
	);
}
