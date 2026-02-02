import { Tool, type ModelConfig } from '../tool.ts';
import type { Message } from '../llm.ts';
import { SummarySchema, type Summary } from '../schemas/summary.schema.ts';
import { dedent } from '../helpers/utils.ts';

const SUMMARIZE_PROMPT_SYSTEM = dedent(`
You are an expert at summarizing text. Your task is to condense the given text while preserving
the most important information, key points, and main ideas.

Guidelines:
1. Maintain the original tone and style where possible
2. Preserve key facts, figures, and important details
3. Remove redundant or less important information
4. Keep the summary coherent and well-structured
5. Target approximately {wordCount} words (some variance is acceptable)

{instructions}
`);

const SUMMARIZE_PROMPT_USER = dedent(`
Summarize the following text to approximately {wordCount} words.

# Text

{text}
`);

export interface SummarizerConfig {
	/** Target word count for the summary (default: 100) */
	targetWordCount?: number;
	/** Additional instructions for summarization */
	instructions?: string;
}

/**
 * A tool that summarizes long texts into shorter ones.
 */
export class Summarizer extends Tool<string | null, Summary, string> {
	private readonly systemPrompt: string;
	private readonly targetWordCount: number;

	constructor(config: SummarizerConfig = {}, modelConfig: ModelConfig) {
		super(modelConfig);
		const { targetWordCount = 100, instructions = '' } = config;

		this.targetWordCount = targetWordCount;
		this.systemPrompt = SUMMARIZE_PROMPT_SYSTEM
			.replace('{wordCount}', String(targetWordCount))
			.replace('{instructions}', instructions);
	}

	protected override schema() {
		return SummarySchema;
	}

	protected prompt(text: string | null): Message[] {
		const userPrompt = SUMMARIZE_PROMPT_USER
			.replace('{wordCount}', String(this.targetWordCount))
			.replace('{text}', text ?? '');
		return [
			{ role: 'system', content: this.systemPrompt },
			{ role: 'user', content: userPrompt }
		];
	}

	protected override isEmpty(text: string | null): boolean {
		return text == null || text.trim() === '';
	}

	protected override extractResult(parsed: Summary): string {
		return parsed.summary;
	}
}

export type { Summary } from '../schemas/summary.schema.ts';
export { SummarySchema } from '../schemas/summary.schema.ts';
