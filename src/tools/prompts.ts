import type { z } from '@zod/zod';
import { Tool, type ModelConfig } from '../tool.ts';
import type { Message } from '../llm.ts';
import {
	PromptListSchema,
	PromptListResponseSchema,
	type PromptList,
	type PromptListResponse,
	type PromptIntent
} from '../schemas/prompt.schema.ts';
import { dedent } from '../helpers/utils.ts';

const PROMPT_SYSTEM = dedent(`
You generate realistic natural-language prompts for AI visibility testing with LLM search engines.

Follow the user's instructions exactly and only use the context they provide.

Output requirements:
- Return a JSON object with a "prompts" array.
- Each object must include: prompt, intent.
- The "intent" must be one of: informational, navigational, transactional, commercial, comparison, troubleshooting, local.
- Generate between {min} and {max} prompts unless the instructions request a number within that range.
- If the instructions specify how many prompts to generate, follow that.

Quality rules:
- Prompts should read like real user questions or requests for an AI assistant, not keyword fragments.
- Cover a mix of intents and realistic personas; avoid repeating the same intent across many prompts.
- If topics or personas are provided, use them as context to shape prompts (but do not output them).
- Avoid brand names unless the instructions explicitly include them.
- Keep prompts focused on the topic and avoid hallucinated claims.
`);

const PROMPT_USER = dedent(`
# Instructions

{instructions}
`);

export interface PromptGeneratorConfig {
	/** Minimum number of prompts to generate (default: 5) */
	minPrompts?: number;
	/** Maximum number of prompts to generate (default: 100) */
	maxPrompts?: number;
	/** Language for prompts (default: inferred from instructions) */
	language?: string;
	/** Optional topic context to guide prompt generation */
	topics?: Array<string | { topic: string; subtopics?: Array<string> }>;
	/** Optional persona context to guide prompt generation */
	personas?: Array<string | { name: string; description?: string }>;
	/** Optional intent whitelist to focus generation */
	intents?: Array<PromptIntent>;
	/** Optional extra instructions to always apply */
	instructions?: string;
}

/**
 * A tool that generates realistic LLM prompts for AI visibility analysis.
 * Input is a single "instructions" string describing the topic and constraints.
 */
export class PromptGenerator extends Tool<string | null, PromptListResponse, PromptList> {
	private readonly systemPrompt: string;
	private readonly contextBlocks: string;
	private readonly responseSchema: z.ZodType<PromptListResponse>;

	constructor(config: PromptGeneratorConfig = {}, modelConfig: ModelConfig) {
		super(modelConfig);
		const {
			minPrompts = 5,
			maxPrompts = 100,
			language,
			topics,
			personas,
			intents,
			instructions
		} = config;

		if (minPrompts < 0) {
			throw new Error('minPrompts must be >= 0');
		}
		if (maxPrompts < minPrompts) {
			throw new Error('maxPrompts must be >= minPrompts');
		}

		const contextParts: Array<string> = [];
		if (instructions && instructions.trim() !== '') {
			contextParts.push(dedent(`
			# Additional Instructions

			${instructions}
			`));
		}
		if (language) {
			contextParts.push(dedent(`
			# Language

			Generate prompts in: ${language}
			`));
		}
		if (topics && topics.length > 0) {
			contextParts.push(dedent(`
			# Topics (Optional Context)

			${JSON.stringify(topics, null, 2)}
			`));
		}
		if (personas && personas.length > 0) {
			contextParts.push(dedent(`
			# Personas (Optional Context)

			${JSON.stringify(personas, null, 2)}
			`));
		}
		if (intents && intents.length > 0) {
			contextParts.push(dedent(`
			# Intent Focus (Optional)

			${JSON.stringify(intents, null, 2)}
			`));
		}

		this.contextBlocks = contextParts.join('\n\n');
		this.systemPrompt = PROMPT_SYSTEM
			.replace('{min}', String(minPrompts))
			.replace('{max}', String(maxPrompts));
		this.responseSchema = PromptListResponseSchema.extend({
			prompts: PromptListSchema.min(minPrompts).max(maxPrompts)
		});
	}

	protected override schema() {
		return this.responseSchema;
	}

	protected prompt(instructions: string | null): Message[] {
		const userPrompt = PROMPT_USER.replace('{instructions}', instructions ?? '');
		return [
			{ role: 'system', content: this.systemPrompt },
			{ role: 'user', content: this.contextBlocks ? `${userPrompt}\n\n${this.contextBlocks}` : userPrompt }
		];
	}

	protected override isEmpty(instructions: string | null): boolean {
		return instructions == null || instructions.trim() === '';
	}

	protected override extractResult(parsed: PromptListResponse): PromptList {
		return parsed.prompts;
	}
}

export type { PromptList, PromptListResponse, PromptIdea, PromptIntent } from '../schemas/prompt.schema.ts';
export {
	PromptListSchema,
	PromptListResponseSchema,
	PromptIdeaSchema,
	PromptIntentSchema
} from '../schemas/prompt.schema.ts';
