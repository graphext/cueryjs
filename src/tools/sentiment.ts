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
3. Output a JSON object with an "aspects" key containing an array of objects, where each object contains:
    a. the aspect as it occurs in the text (key "aspect")
    b. the sentiment label as either "positive" or "negative" (key "sentiment")
    c. the reason for the sentiment assignment as a short text (key "reason")
    d. the exact text fragment containing both the aspect and what is said about it (key "quote") - must be a verbatim substring
4. If there are no sentiment-bearing aspects in the text, return {"aspects": []}

IMPORTANT: The "quote" field must be an EXACT verbatim substring from the input text. It should
include the complete phrase mentioning both the aspect and the sentiment expressed about it.

Example:

Input text: "The room service at the Grand Hotel was absolutely terrible and the staff were rude, but the view from our room was breathtaking."

Output:
{
  "aspects": [
    {"aspect": "The room service at the Grand Hotel", "sentiment": "negative", "reason": "Described as terrible.", "quote": "The room service at the Grand Hotel was absolutely terrible"},
    {"aspect": "the staff", "sentiment": "negative", "reason": "Described as rude.", "quote": "the staff were rude"},
    {"aspect": "the view from our room", "sentiment": "positive", "reason": "Described as breathtaking.", "quote": "the view from our room was breathtaking"}
  ]
}

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
 */
export class SentimentExtractor extends Tool<string | null, ABSentiments, Array<ABSentiment>> {
	private readonly systemPrompt: string;

	constructor(config: SentimentExtractorConfig = {}, modelConfig: ModelConfig) {
		super(modelConfig);
		const { instructions = '', brand = null } = config;

		const brandInstructions = brand
			? dedent(`
				Pay special attention to mentions of "${brand.shortName}" or its products/services (${formatPortfolio(brand.portfolio)}).
				When the brand name or its products/services are explicitly mentioned in the text, you may reference them in your reasoning,
				but keep aspect names and quoted text exactly as they appear in the original input.
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
	 * Override invoke to add quote validation
	 */
	override async invoke(
		input: string | null,
		options: Partial<ModelConfig> = {}
	): Promise<LLMResponse<Array<ABSentiment> | null>> {
		const response = await super.invoke(input, options);

		// If we have a successful result and non-empty input, validate quotes
		if (response.parsed && input && input.trim() !== '') {
			const validatedResult = response.parsed.filter((sentiment) => {
				if (!input.includes(sentiment.quote)) {
					console.warn(
						`Quote not found in text: "${sentiment.quote}" for aspect "${sentiment.aspect}"`
					);
					return false;
				}
				return true;
			});

			return {
				...response,
				parsed: validatedResult,
			};
		}

		return response;
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

