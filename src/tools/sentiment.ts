import { dedent } from '../helpers/utils.ts';
import type { LLMResponse, Message } from '../llm.ts';
import type { BrandContext, Product } from '../schemas/brand.schema.ts';
import { ABSentimentsSchema, type ABSentiment, type ABSentiments } from '../schemas/sentiment.schema.ts';
import { Tool, type ModelConfig } from '../tool.ts';
import { Classifier } from './classifier.ts';

/**
 * Formats a portfolio array as a comma-separated list of product/service names.
 * Includes category in parentheses if available.
 */
function formatPortfolio(portfolio: Array<Product>): string {
	return portfolio
		.map((p) => (p.category ? `${p.name} (${p.category})` : p.name))
		.join(', ');
}


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
    d. the exact text fragment containing both the aspect and what is said about it (key "quote") - must be a verbatim substring
    e. optional contextual information about the aspect, such as the brand or entity it relates to (key "context") - use null if not applicable
4. If there are no sentiment-bearing aspects in the text, the output should be an empty list

IMPORTANT: The "quote" field must be an EXACT verbatim substring from the input text. It should
include the complete phrase mentioning both the aspect and the sentiment expressed about it.

Example:

Input text: "The room service at the Grand Hotel was absolutely terrible and the staff were rude, but the view from our room was breathtaking."

Output:
[
  {"aspect": "The room service at the Grand Hotel", "sentiment": "negative", "reason": "Described as terrible.", "quote": "The room service at the Grand Hotel was absolutely terrible", "context": "Grand Hotel"},
  {"aspect": "the staff", "sentiment": "negative", "reason": "Described as rude.", "quote": "the staff were rude", "context": "Grand Hotel"},
  {"aspect": "the view from our room", "sentiment": "positive", "reason": "Described as breathtaking.", "quote": "the view from our room was breathtaking", "context": "Grand Hotel"}
]

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


export interface SentimentExtractorConfig {
	/** Additional instructions for sentiment extraction */
	instructions?: string;
	/** Brand context for focused analysis */
	brand?: BrandContext | null;
}

/**
 * A tool that extracts aspect-based sentiments from text.
 * 
 * The extractor validates that each sentiment's quote is an exact substring of the input text.
 * If invalid quotes are detected:
 * - Valid sentiments are still returned in the `parsed` field
 * - The `error` field is populated with details about invalid quotes
 * - This allows callers to distinguish between "no sentiments found" and "sentiments dropped"
 */
export class SentimentExtractor extends Tool<string | null, ABSentiments, Array<ABSentiment>> {
	private readonly systemPrompt: string;

	constructor(config: SentimentExtractorConfig = {}, modelConfig: ModelConfig) {
		super(modelConfig);
		const { instructions = '', brand = null } = config;

		const brandInstructions = brand
			? dedent(`
				Pay special attention to mentions of "${brand.shortName}" or its products/services (${formatPortfolio(brand.portfolio)}).
				When an aspect relates to a brand/entity, set the "context" field to "${brand.shortName}".
				Keep aspect names and quoted text exactly as they appear in the original input.
				Respond in language code ${brand.language}.
			`)
			: '';

		const combinedInstructions = [instructions, brandInstructions].filter(Boolean).join('\n\n');
		this.systemPrompt = ABS_PROMPT_SYSTEM.replace('{instructions}', combinedInstructions);
	}

	protected override schema() {
		return ABSentimentsSchema;
	}

	protected prompt(text: string | null): Message[] {
		const userPrompt = ABS_PROMPT_USER.replace('{text}', text ?? '');
		return [
			{ role: 'system', content: this.systemPrompt },
			{ role: 'user', content: userPrompt }
		];
	}

	protected override isEmpty(text: string | null): boolean {
		return text == null || text.trim() === '';
	}

	protected override extractResult(parsed: ABSentiments): Array<ABSentiment> {
		return parsed.aspects;
	}

	/**
	 * Override invoke to add quote validation.
	 * If invalid quotes are detected, returns an error but includes valid sentiments.
	 * This allows callers to distinguish between "no sentiments found" vs "sentiments dropped due to invalid quotes".
	 */
	override async invoke(
		input: string | null,
		options: Partial<ModelConfig> = {}
	): Promise<LLMResponse<Array<ABSentiment> | null>> {
		// Get the initial response using parent's invoke
		const response = await super.invoke(input, options);

		// If no result, error, or empty input, return immediately
		if (!response.parsed || response.error || !input || input.trim() === '') {
			return response;
		}

		// Validate quotes and separate valid from invalid sentiments
		const validSentiments: Array<ABSentiment> = [];
		const invalidSentiments: Array<{ aspect: string; quote: string }> = [];

		for (const sentiment of response.parsed) {
			if (input.includes(sentiment.quote)) {
				validSentiments.push(sentiment);
			} else {
				invalidSentiments.push({
					aspect: sentiment.aspect,
					quote: sentiment.quote,
				});
				console.warn(
					`Invalid quote detected: "${sentiment.quote}" for aspect "${sentiment.aspect}"`
				);
			}
		}

		// If all quotes are valid, return success
		if (invalidSentiments.length === 0) {
			return {
				...response,
				parsed: validSentiments,
			};
		}

		// If there are invalid quotes, return an error with metadata about what was dropped
		const errorMessage = dedent(`
			Sentiment extraction completed but ${invalidSentiments.length} sentiment(s) had invalid quotes.
			The "quote" field must be an exact verbatim substring from the input text.
			Invalid quotes were: ${invalidSentiments.map(s => `"${s.quote}" (aspect: ${s.aspect})`).join(', ')}.
			${validSentiments.length > 0 
				? `Returning ${validSentiments.length} valid sentiment(s).`
				: 'No valid sentiments found.'}
		`);

		console.error(errorMessage);

		// Return the valid sentiments but with an error to signal the issue
		return {
			parsed: validSentiments.length > 0 ? validSentiments : null,
			text: response.text,
			usage: response.usage,
			error: new Error(errorMessage),
		};
	}
}

// =============================================================================
// SentimentPolarityClassifier (overall sentiment polarity)
// =============================================================================

/**
 * Sentiment polarity labels for classification.
 */
export const SENTIMENT_POLARITY_LABELS: Record<string, string> = {
	positive: 'Expresses favorable opinions, approval, satisfaction, or optimism.',
	neutral: 'No clear sentiment expressed; factual, balanced, or ambiguous.',
	negative: 'Expresses unfavorable opinions, criticism, dissatisfaction, or pessimism.'
};

/**
 * Predefined instructions for sentiment polarity classification.
 */
const SENTIMENT_POLARITY_INSTRUCTIONS = dedent(`
Analyze the overall sentiment polarity of the text.
Focus on the dominant emotional tone, not individual aspects or entities.
Consider both explicit sentiment expressions and implicit tone.
`);

/**
 * Configuration for the SentimentPolarityClassifier tool.
 */
export interface SentimentPolarityClassifierConfig {
	/** Additional instructions for the classifier */
	instructions?: string;
}

/**
 * A tool that classifies the overall sentiment polarity of text into positive, neutral, or negative.
 */
export class SentimentPolarityClassifier extends Classifier {
	constructor(config: SentimentPolarityClassifierConfig = {}, modelConfig: ModelConfig) {
		const { instructions = '' } = config;
		const combinedInstructions = instructions
			? `${SENTIMENT_POLARITY_INSTRUCTIONS}\n\n${instructions}`
			: SENTIMENT_POLARITY_INSTRUCTIONS;
		super({ labels: SENTIMENT_POLARITY_LABELS, instructions: combinedInstructions }, modelConfig);
	}
}

export { ABSentimentSchema, ABSentimentsSchema } from '../schemas/sentiment.schema.ts';
export type { ABSentiment, ABSentiments } from '../schemas/sentiment.schema.ts';

