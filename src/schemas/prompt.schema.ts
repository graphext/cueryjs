import { z } from '@zod/zod';

/**
 * Zod schemas for AI visibility prompt generation.
 *
 * ⚠️ This file should contain ONLY schema definitions.
 * No business logic, prompts, or function implementations.
 */

export const PromptIntentSchema = z.enum([
	'informational',
	'navigational',
	'transactional',
	'commercial',
	'comparison',
	'troubleshooting',
	'local'
]);

export type PromptIntent = z.infer<typeof PromptIntentSchema>;

export const PromptIdeaSchema = z.object({
	prompt: z.string().min(3).describe('A realistic natural-language prompt a user would type into an LLM search engine.'),
	intent: PromptIntentSchema.describe('Primary intent of the prompt.')
});

export type PromptIdea = z.infer<typeof PromptIdeaSchema>;

export const PromptListSchema = z.array(PromptIdeaSchema)
	.describe('Generated prompt ideas with intent labels.');

export type PromptList = z.infer<typeof PromptListSchema>;

export const PromptListResponseSchema = z.object({
	prompts: PromptListSchema
});

export type PromptListResponse = z.infer<typeof PromptListResponseSchema>;
