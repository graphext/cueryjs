/**
 * Seed Keyword Types
 *
 * Pure TypeScript types for seed keywords.
 * No runtime dependencies - safe to import in both frontend and backend.
 */

export type SeedKeywordSource = 'persona' | 'funnel' | 'portfolio' | 'custom' | 'brand-portfolio';

export interface SeedKeyword {
	id: string;
	keyword: string;
	source: SeedKeywordSource;
	sourceId?: string;
	sourceName?: string;
}
