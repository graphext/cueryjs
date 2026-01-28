import { z } from '@zod/zod';

/**
 * Zod schemas for marketing funnel stages and categories.
 * Used for validation in backend and type inference in frontend.
 *
 * ⚠️ This file should contain ONLY schema definitions.
 * No business logic, prompts, or function implementations.
 */

/**
 * A category of Google search keywords within a marketing funnel stage.
 */
export const FunnelCategorySchema = z.object({
	name: z.string().describe('The name of a keyword category within a marketing funnel stage.'),
	description: z.string().describe('A brief description of the category and its purpose.'),
	keywordPatterns: z.array(z.string()).describe('Common keyword patterns or phrases associated with this category.'),
	intent: z.string().describe('The primary search intent for this category (e.g., Informational, Commercial, Transactional, Navigational).'),
	keywordSeeds: z.array(z.string()).describe('Example Google search keywords that fit within this category.')
});

export type FunnelCategory = z.infer<typeof FunnelCategorySchema>;

/**
 * A stage in the marketing funnel containing multiple keyword categories.
 */
export const FunnelStageSchema = z.object({
	stage: z.string().describe('The name of the marketing funnel stage (e.g., Awareness, Consideration).'),
	goal: z.string().describe('The primary goal or objective of this funnel stage.'),
	categories: z.array(FunnelCategorySchema).describe('A list of keyword categories within this funnel stage.')
});

export type FunnelStage = z.infer<typeof FunnelStageSchema>;

/**
 * A complete marketing funnel with multiple stages.
 */
export const FunnelSchema = z.object({
	stages: z.array(FunnelStageSchema)
});

export type Funnel = z.infer<typeof FunnelSchema>;

/**
 * Funnel schema with AI explanation - used for OpenAI response_format
 * which requires all fields to be in the 'required' array.
 */
export const FunnelWithExplanationSchema = z.object({
	stages: z.array(FunnelStageSchema),
	explanation: z.string().describe('Brief explanation of the customized funnel and the reasoning behind the adaptations')
});

export type FunnelWithExplanation = z.infer<typeof FunnelWithExplanationSchema>;

/**
 * A list of seed keywords for a particular funnel category.
 */
export const SeedsSchema = z.object({
	seeds: z.array(z.string()).min(3).max(10)
});

export type Seeds = z.infer<typeof SeedsSchema>;

export type FunnelOptions = {
	/** Industry sector (e.g., "automotive", "technology") */
	sector: string;
	/** Language for the funnel keywords (e.g., "en" for English) */
	language: string;
	/** Optional user language preference (e.g., "en" for English) */
	userLanguage?: string | null;
	/** Optional country to be used as market for the funnel (e.g., "US" for United States), default is "global" */
	country?: string | null;
	briefing?: string | null;
	instructions?: string | null;
	/** AI model to use for generation (e.g., "gpt-4.1"), default is "gpt-4.1" */
	model?: string | null;
	funnel?: Funnel | Array<FunnelStage> | null;
	maxConcurrency?: number;
};
