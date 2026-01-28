import { z } from '@zod/zod';

import type { SearchOptions } from './search.schema.ts';

/**
 * Zod schemas for brand information.
 * Used for validation in backend and type inference in frontend.
 *
 * ⚠️ This file should contain ONLY schema definitions.
 * No business logic, prompts, or function implementations.
 */

/**
 * Schema for a product or service offered by a brand.
 */
const ProductSchema = z.object({
	name: z.string().describe('Name of the product or service.'),
	category: z.string().nullable().describe('Category of the product or service.')
}).describe('Represents a product or service offered by a brand.');

/**
 * Schema for brand information including products, markets, and positioning.
 */
export const BrandSchema = z.object({
	name: z.string().describe('Full name of the brand. E.g. "Tesla, Inc." or "Automobiles Peugeot".'),
	shortName: z.string().describe(
		'Short, common/canonical name of the brand, if different from the official name. ' +
		'E.g. "Tesla" instead of "Tesla, Inc.", or "Peugeot" instead of "Automobiles Peugeot".'
	),
	description: z.string().describe('Description of the brand.'),
	domain: z.string().min(1).describe('Official website of the brand.'),
	sectors: z.array(z.string()).describe('List of main industrial sectors the brand operates in.'),
	markets: z.array(z.string()).describe('List of main geographical markets the brand operates in.'),
	portfolio: z.array(ProductSchema).describe('List of products or services offered by the brand.'),
	marketPosition: z.enum(['leader', 'challenger', 'niche', 'follower']).describe('Market position of the brand.'),
	favicon: z.string().nullable().describe('URL of the brand\'s favicon, if available.')
}).describe('Represents a brand and its attributes.');

/**
 * Base TypeScript type inferred from ProductSchema.
 * Extended with keywordSeeds which is added after OpenAI response.
 */
export type Product = z.infer<typeof ProductSchema> & {
	keywordSeeds?: Array<string>;
};

/**
 * TypeScript type inferred from BrandSchema.
 * Extended to use the enriched Product type for portfolio.
 * Safe to import in frontend with `import type`.
 */
export type Brand = Omit<z.infer<typeof BrandSchema>, 'portfolio'> & {
	portfolio: Array<Product>;
};

/**
 * Brand with additional context fields for pipeline processing.
 * Extends Brand with optional fields that provide context for analysis.
 */
export type BrandContext = Brand & {
	/** Language of the brand information (ISO 639-1 code). */
	language: string;
	/** Primary market/country for the brand (ISO or free text). */
	country: string;
	/** Primary sector for the brand. */
	sector: string;
	/** Additional context or briefing about the brand. */
	briefing: string | null;
};

/**
 * Base schema for brand list endpoints (e.g., /ai_audit/competitors).
 * Exported schema adds uniqueness validation below.
 */
const BrandListBaseSchema = z.object({
	brands: z.array(BrandSchema).min(3).describe('List of brands.'),
	explanation: z.string().describe('Brief explanation of the identified competitors and the reasoning behind their selection')
}).describe('List of brands.');

/**
 * Response schema for brand list endpoints (e.g., /ai_audit/competitors).
 */
export const BrandListSchema = BrandListBaseSchema.refine(
	(data: z.infer<typeof BrandListBaseSchema>) => {
		const shortNames = data.brands.map(brand => brand.shortName);
		const uniqueShortNames = new Set(shortNames);
		return shortNames.length === uniqueShortNames.size;
	},
	{
		message: 'All brands must be unique! Don\'t repeat the same brand!'
	}
).describe('List of brands.');

/**
 * Response type for brand list endpoints including explanation.
 */
export type BrandListResponse = z.infer<typeof BrandListBaseSchema>;

/**
 * Helper type for brands with competitor flag.
 * Used in frontend to distinguish own brands from competitors.
 */
export type FlaggedBrand = Brand & {
	isCompetitor: boolean;
};


/**
 * Base options for brand-related operations.
 */
export type BrandOptions = {
	/** User's preferred language, for response localization. */
	userLanguage?: string | null;
	/** Name of the brand to search for or analyze. */
	brand?: string;
	/** Official website domain of the brand (e.g., "tesla.com"). */
	brandDomain?: string;
	/** Language for the returned keywords, default is English ("en"), for both info and keywords. */
	language: string;
	/** Industry sector the brand operates in (e.g., "automotive", "technology"), will be used to
	 * specify the initial brand context and the keywords sector, default value for keywords is 'general' */
	sector?: string | null;
	/** Geographical market or region (e.g., "United States", "Europe"), will be used to
	 * specify the initial brand context and the keywords market, default value for keywords is 'global' */
	market?: string | null;
	/** Additional context or briefing about the brand, will be added to the initial brand context. */
	briefing?: string | null;
};

/**
 * Options for competitor search operations.
 */
interface CompetitorOptions extends Omit<BrandOptions, 'brand' | 'brandDomain'> {
	/** Single brand name or array of brand names to search competitors for. */
	brand?: string | Array<string>;
	/** Single brand domain or array of brand domains. */
	brandDomain?: string | Array<string>;
	/** Only consider as competitors those that do NOT belong to the same parent
	 * company as the original brand(s) (e.g. Fanta is NOT a competitor of Coca-Cola
	 * in this sense). Default is true. */
	strict?: boolean;
	/** Additional instructions for the competitor search. */
	instructions?: string | null;
	/** List of brands the user already has information about. */
	brands?: Array<Brand> | null;
};

/**
 * Options for competitor search combining competitor-specific options with search parameters.
 */
export type CompetitorSearchOptions = CompetitorOptions & Omit<SearchOptions, 'prompt'>;

/**
 * Options for brand information search operations.
 * Combines brand-specific options with general search parameters.
 */
export type BrandSearchOptions = BrandOptions & Omit<SearchOptions, 'prompt'> & {
	/** ISO 3166-1 alpha-2 country code to narrow search results for the brand info
	 * to a specific country (e.g., "US", "ES", "FR"). */
	countryISOCode?: string | null;
};
