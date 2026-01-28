import { z } from '@zod/zod';

import type { Brand } from './brand.schema.ts';
import type { Funnel } from './funnel.schema.ts';
import type { Persona } from './persona.schema.ts';

export const KeywordSchema = z.string().describe('A search keyword phrase');

export const KeywordsResponseSchema = z.object({
	keywords: z.array(KeywordSchema).describe('List of keyword phrases for the brand and sector'),
	explanation: z.string().describe('Brief explanation of the generated keywords and the reasoning behind them')
});

export type Keyword = z.infer<typeof KeywordSchema>;
export type KeywordsResponse = z.infer<typeof KeywordsResponseSchema>;

/**
 * Options for keyword generation.
 * Requires sector and market to be specified.
 */
export interface KeywordsOptions {
	/** Industry sector (e.g., "running shoes", "CRM software"). */
	sector: string;
	/** Geographic market (e.g., "United States", "Spain", "global"). */
	market: string;
	/** Brand name to analyze. */
	brand?: string;
	/** Brand domain to analyze. */
	brandDomain?: string;
	/** Language for keyword output. Default is 'english'. */
	language?: string;
	/** Language for system messages (defaults to language). */
	userLanguage?: string | null;
	/** OpenAI model to use. Default is 'gpt-4.1'. */
	model?: string;
	/** Additional context about the brand. */
	briefing?: string;
	/** Specific instructions for keyword generation. */
	instructions?: string;
	/** Existing keywords to maintain or modify. */
	keywords?: Array<Keyword> | null;
	/** Brand information including competitors. */
	brands?: Array<Brand> | null;
	/** Customer personas to target. */
	personas?: Array<Persona> | null;
	/** Marketing funnel with stages and categories. */
	funnel?: Funnel | null;
}
