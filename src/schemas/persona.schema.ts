import { z } from '@zod/zod';

import type { BrandOptions } from './brand.schema.ts';

/**
 * Zod schema for customer persona.
 * Used for validation in backend and type inference in frontend.
 *
 * ⚠️ This file should contain ONLY schema definitions.
 * No business logic, prompts, or function implementations.
 */
export const PersonaSchema = z.object({
	name: z.string().describe('A short and catchy name for the persona'),
	description: z.string().describe('A brief description of the persona\'s characteristics, needs, and behaviors'),
	keywordSeeds: z.array(z.string()).describe('List of keyword seed phrases this persona would typically search for')
});

/**
 * TypeScript type inferred from PersonaSchema.
 * Safe to import in frontend with `import type`.
 */
export type Persona = z.infer<typeof PersonaSchema>;

/**
 * Response schema for /ai_audit/personas endpoint.
 */
export const PersonasResponseSchema = z.object({
	personas: z.array(PersonaSchema),
	explanation: z.string().describe('Brief explanation of the generated personas and the reasoning behind them')
});

export type PersonasResponse = z.infer<typeof PersonasResponseSchema>;

/**
 * Options for persona generation.
 * Requires sector and market to be specified (overrides BrandOptions optionality).
 */
export interface PersonasOptions extends Omit<BrandOptions, 'sector' | 'market'> {
	/** Industry sector the brand operates in (required for persona generation). */
	sector: string;
	/** Geographical market or region (required for persona generation). */
	market: string;
	/** Number of personas to generate. */
	count?: number;
	/** AI model to use for generation. */
	model?: string;
	/** Additional instructions for persona generation. */
	instructions?: string | null;
	/** Existing personas to consider during generation. */
	personas?: Array<Persona> | null;
};