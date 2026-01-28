import { z } from '@zod/zod';
import mapParallel from './mapParallel.ts';
import { askOpenAISafe } from './openai.ts';

import { buildBrandContext } from './brandContext.ts';
import type { CompetitorSearchOptions, BrandSearchOptions, BrandListResponse } from './schemas/brand.schema.ts';
import { BrandSchema, BrandListSchema, type Brand, type FlaggedBrand, type Product } from './schemas/brand.schema.ts';
import { searchWithFormat } from './search.ts';
import { dedent } from './utils.ts';
import { extractDomain } from './urls.ts';
import type { Entity } from './entities.ts';

const DEFAULT_SEARCH_MODEL = 'gpt-4.1';

const PORTFOLIO_KEYWORDS_PROMPT = dedent(`
Generate 5 Google search keywords that real users would type when researching this product or service.

Product/Service: {product_name}
Category: {category}
Sector: {sector}
Market: {market}

Context:
- The product/service is part of a brand in the {sector} sector operating in {market}
- Generate what people ACTUALLY search, NOT literal product names or brand mentions
- Keywords should be broad (1-3 words) suitable for Google Keyword Planner seed expansion
- Focus on generic search terms that potential customers would use
- DO NOT include brand names in the keywords

Examples of GOOD keywords for different contexts:
- Running shoe product → "running shoes", "athletic footwear", "trail running"
- CRM software → "customer management", "sales automation", "crm tools"
- Online course → "learn programming", "coding tutorials", "web development"

Requirements:
- Natural language people actually type in search bars
- 5 realistic search queries
- Broad enough for keyword expansion (1-3 words typically)
- Output in {language}
- No brand names or specific product names

What would someone in {market} naturally search when looking for products/services like {product_name}?
`);

const PortfolioKeywordsSchema = z.object({
	keywords: z.array(z.string()).describe('List of 5 seed keywords for the product or service.')
});

const COMPETITORS_PROMPT = dedent(`
You are an expert in market analysis and competitive intelligence. Given the brand(s)
information in the below section, find and return an exhaustive list of competitors. Consider
competitors to be brands that offer similar products or services and target the same or similar
customer segments. {strictness_clause}

The output should be a JSON array with one object for each competitor. Each competitor object
should have the following fields:

- name: Name of the competitor brand.
- shortName: A short, common/canonical name of the competitor brand, if different from the official name.
  E.g. "Tesla" instead of "Tesla, Inc.", or "Peugeot" instead of "Automobiles Peugeot". If not applicable,
  set same as name.
- description: A brief description of the competitor brand's main activity.
- domain: The official website of the competitor brand, if available.
- sectors: A list of main industrial sectors the competitor brand operates in.
- markets: A list of main geographical markets the competitor brand operates in.
- marketPosition: The market position of the competitor brand, which can be one of the following values:
  "leader", "challenger", "niche", "follower".
- portfolio: A list of products or services offered by the competitor brand. Each product or service should
  have a name and a category.
- favicon: URL of the brand's favicon, if available.

It's more important to be comprehensive than selective, so include more competitors rather than less.
Try to order them by relevance, with the most direct and bigger competitors first.

Return the answer (field values) in the language "{language}".

Also provide an "explanation" field with a brief summary (2-3 sentences) explaining the reasoning behind
the competitors you identified: what makes them relevant competitors, how they relate to the original brand,
and what competitive landscape they represent.

{instructions}

# Brand(s) information

{context}

{currentCompetitorsInfo}
`);

const STRICT_CLAUSE = 'Only consider as competitors those that do NOT belong to the same parent company as the original brand(s) (e.g. Fanta is NOT a competitor of Coca-Cola in this sense).';
const NON_STRICT_CLAUSE = 'Consider all relevant competitors, including those from the same parent company (e.g. Fanta IS a competitor of Coca-Cola in this sense).';

const CURRENT_DATA_CLAUSE = dedent(`
# Current Competitors Information

The following is the current information the user has about competitors for the brand(s).

{currentData}

IMPORTANT: Unless the instructions explicitly specify to modify, replace, add, or remove competitors
from this list, you MUST return at least all the same competitors that are already present in the
current data. If no modification instructions are provided, maintain the existing list and only add
new competitors if they are relevant.
`);


const BRAND_PROMPT = dedent(`
You are an expert in market analysis and competitive intelligence investigating the brand{brand_context}.
Find out the following information about this brand:

- name: Brand/company name
- shortName: A short, common/canonical name of the brand, if different from the official name.
  E.g. "Tesla" instead of "Tesla, Inc.", or "Peugeot" instead of "Automobiles Peugeot". If not applicable,
  set same as name.
- description: A brief description of the brand's main activity.
- domain: The official website of the brand, if available.
- sectors: A list of specific industrial sectors the brand operates in, ordered by relevance. Be precise and concrete rather than generic - for example, instead of "education", use "professional training for unemployed", "corporate learning and development", or "online coding bootcamps". Adapt the specificity level to match the brand's actual focus and niche.
- markets: A list of main geographical markets the brand operates in.
- marketPosition: The market position of the brand, which can be one of the following values:
  "leader", "challenger", "niche", "follower".
- portfolio: A list of products or services offered by the competitor brand. Each product or service should
  have a name and a category.
- favicon: URL of the brand's favicon, if available.

Return the answer as a JSON object with field values in the language "{language}".
`);

/**
 * Generate seed keywords for a single portfolio item using an LLM.
 */
export async function generatePortfolioKeywords(
	product: Product,
	sector: string,
	market: string,
	language: string = 'en',
	model: string = 'gpt-4.1'
): Promise<Array<string>> {
	const prompt = PORTFOLIO_KEYWORDS_PROMPT
		.replace('{product_name}', product.name)
		.replace('{category}', product.category || 'general')
		.replaceAll('{sector}', sector)
		.replaceAll('{market}', market)
		.replaceAll('{language}', language);

	const { parsed } = await askOpenAISafe(prompt, model, PortfolioKeywordsSchema);
	if (!parsed) {
		throw new Error('Failed to parse portfolio keywords from OpenAI response');
	}
	return parsed.keywords;
}

/**
 * Generate seed keywords for all portfolio items in a brand concurrently,
 * updating the keywordSeeds field in-place for each product.
 */
export async function enrichBrandPortfolioWithKeywords(
	brand: Brand,
	language: string = 'en',
	model: string = 'gpt-4.1',
	maxConcurrency: number = 100,
	sector?: string | null,
	market?: string | null
): Promise<Brand> {
	if (!brand.portfolio || brand.portfolio.length === 0) {
		return brand;
	}

	sector = sector || brand.sectors[0] || 'general';
	market = market || brand.markets[0] || 'global';

	await mapParallel(brand.portfolio, maxConcurrency, async (product) => {
		const keywords = await generatePortfolioKeywords(
			product,
			sector,
			market,
			language,
			model
		);
		product.keywordSeeds = keywords;
	});

	return brand;
}


export async function generateCompetitorsInfo({
	brand,
	brandDomain,
	sector = null,
	market = null,
	briefing,
	strict = true,
	instructions = '',
	brands = null,
	language = 'en',
	userLanguage = null,
	model = DEFAULT_SEARCH_MODEL,
	useSearch = true,
	countryISOCode = null,
	contextSize = 'medium',
	reasoningEffort = 'low'
}: CompetitorSearchOptions): Promise<BrandListResponse> {

	if (!brand && !brandDomain) {
		throw new Error('Either brand or brandDomain must be provided');
	}

	const strictnessClause = strict ? STRICT_CLAUSE : NON_STRICT_CLAUSE;

	const context = buildBrandContext({
		brand,
		brandDomain,
		sector,
		market,
		briefing
	});

	const currentData = brands ? CURRENT_DATA_CLAUSE.replace('{currentData}', JSON.stringify(brands, null, 2)) : '';

	const formattedPrompt = COMPETITORS_PROMPT
		.replace('{strictness_clause}', strictnessClause)
		.replace('{instructions}', instructions || '')
		.replace('{language}', userLanguage ?? language)
		.replace('{context}', context)
		.replace('{currentCompetitorsInfo}', currentData);

	const response = await searchWithFormat({
		prompt: formattedPrompt,
		model: model,
		useSearch: useSearch,
		responseSchema: BrandListSchema,
		countryISOCode,
		contextSize,
		reasoningEffort
	});

	// Make sure these are clean domains
	response.brands.map(brand => {
		if (brand.domain) {
			brand.domain = extractDomain(brand.domain);
		}
	});

	const enrichedBrands = await mapParallel(
		response.brands,
		100,
		async (brand) => enrichBrandPortfolioWithKeywords(brand, language, model, undefined, sector, market)
	);

	return {
		brands: enrichedBrands,
		explanation: response.explanation
	};
}

export async function generateBrandInfo({
	brand,
	brandDomain,
	language = 'en',
	userLanguage = null,
	sector,
	market,
	briefing,
	model = DEFAULT_SEARCH_MODEL,
	useSearch = true,
	countryISOCode = null,
	contextSize = 'medium',
	reasoningEffort = 'low'
}: BrandSearchOptions): Promise<Brand> {

	if (!brand && !brandDomain) {
		throw new Error('Either brand or brandDomain must be provided');
	}

	const brandContext = buildBrandContext({
		brand,
		brandDomain,
		sector,
		market,
		briefing
	});

	const prompt = BRAND_PROMPT
		.replace('{brand_context}', brandContext)
		.replace('{language}', userLanguage ?? language);

	const brandInfo = await searchWithFormat({
		prompt,
		model,
		responseSchema: BrandSchema,
		countryISOCode: countryISOCode,
		contextSize: contextSize,
		reasoningEffort: reasoningEffort,
		useSearch
	});

	// Make sure this is a clean domain
	brandInfo.domain = extractDomain(brandInfo.domain);

	const enrichedBrand = await enrichBrandPortfolioWithKeywords(
		brandInfo as Brand,
		language,
		model,
		undefined,
		sector,
		market
	);

	return enrichedBrand;
}

export function concatBrands(
	ownBrands: Array<Brand>,
	competitors: Array<Brand>
): Array<FlaggedBrand> {
	const ownBrandsWithFlag = ownBrands.map((brand) => ({
		...brand,
		isCompetitor: false
	}));

	const competitorsWithFlag = competitors.map((brand) => ({
		...brand,
		isCompetitor: true
	}));

	return [...ownBrandsWithFlag, ...competitorsWithFlag];
}

/**
 * Normalizes a brand name for comparison.
 * - Converts to lowercase
 * - Normalizes & to " and " (with spaces to separate words)
 * - Removes accents/diacritics
 * - Expands CamelCase to spaces (e.g., "KidsAndUs" -> "kids and us")
 * - Expands embedded "and" (e.g., "benandjerrys" -> "ben and jerrys")
 * - Separates numbers from letters (e.g., "7eleven" -> "7 eleven")
 * - Converts hyphens to spaces (e.g., "Coca-Cola" -> "coca cola")
 * - Removes apostrophes (e.g., "Jerry's" -> "jerrys")
 * - Removes periods/dots (e.g., "Dr. Pepper" -> "dr pepper")
 */
export function normalizeBrandName(name: string): string {
	return name
		// Remove apostrophes before other processing (e.g., "Jerry's" -> "Jerrys")
		.replace(/'/g, '')
		// Remove periods/dots (e.g., "Dr. Pepper" -> "Dr Pepper")
		.replace(/\./g, '')
		// Normalize & to " and " BEFORE CamelCase expansion to ensure proper word separation
		.replace(/&/g, ' and ')
		// Expand CamelCase to spaces (insert space before uppercase letters)
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.toLowerCase()
		.trim()
		// Convert hyphens to spaces (e.g., "coca-cola" -> "coca cola")
		.replace(/-/g, ' ')
		// Expand embedded "and" (e.g., "benandjerrys" -> "ben and jerrys")
		.replace(/([a-z])and([a-z])/g, '$1 and $2')
		// Separate numbers from letters (e.g., "7eleven" -> "7 eleven")
		.replace(/([0-9])([a-z])/g, '$1 $2')
		.replace(/([a-z])([0-9])/g, '$1 $2')
		// Normalize accents/diacritics
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		// Normalize multiple spaces to single space
		.replace(/\s+/g, ' ');
}

/**
 * Creates an ultra-normalized key for brand matching (removes all spaces and non-alphanumerics).
 * Used to match brands like "Kids&Us" with entities like "kidsandus",
 * or "Ben & Jerry's" with "benandjerrys".
 */
export function createBrandMatchKey(brandName: string): string {
	return normalizeBrandName(brandName)
		.replace(/\s+/g, '')
		.replace(/[^a-z0-9]/g, ''); // drop any other non-alphanumerics
}

/**
 * Creates a regex pattern that matches various text representations of a brand name.
 * Handles: CamelCase, spaces, &/and variations, hyphens, apostrophes, accents.
 */
function createBrandMatchPattern(brandName: string): RegExp {
	// First normalize the brand name to get a canonical form
	const normalized = normalizeBrandName(brandName);

	// Split into words
	const words = normalized.split(' ').filter(w => w.length > 0);

	// Build pattern where each word can have flexible separators between them
	const wordPatterns = words.map(word => {
		if (word === 'and') {
			return '(?:&|and)?';
		}

		// For other words, escape special chars and allow accent variations
		const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		// Allow accented versions of vowels
		return escaped
			.replace(/a/g, '[aáàäâ]')
			.replace(/e/g, '[eéèëê]')
			.replace(/i/g, '[iíìïî]')
			.replace(/o/g, '[oóòöô]')
			.replace(/u/g, '[uúùüû]')
			.replace(/n/g, '[nñ]');
	});

	// Flexible separator: allows space, hyphen, apostrophe, ampersand, "and", or nothing (CamelCase)
	// The separator is optional to handle cases like "BenJerrys" matching "Ben Jerry's"
	const flexibleSeparator = "(?:[\\s\\-'&]|and)*";
	const pattern = wordPatterns.join(flexibleSeparator);

	// Word boundary handling:
	// - Start: beginning of string OR non-alphanumeric character
	// - End: end of string OR non-alphanumeric character
	// This allows matching "7-Eleven" in "I shop at 7-Eleven daily"
	return new RegExp(`(?:^|[^a-zA-Z0-9])${pattern}(?:$|[^a-zA-Z0-9])|^${pattern}$`, 'i');
}

/**
 * Creates a normalized version of text for matching purposes.
 * Expands CamelCase, separates numbers from letters, and expands common connectors.
 */
function normalizeTextForMatching(text: string): string {
	return text
		// Remove apostrophes
		.replace(/'/g, '')
		// Remove periods/dots (Dr. Pepper → Dr Pepper)
		.replace(/\./g, '')
		// Expand CamelCase (lowercase followed by uppercase)
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		// Convert hyphens to spaces (Coca-Cola → Coca Cola)
		.replace(/-/g, ' ')
		// Separate numbers from letters (7eleven → 7 eleven, eleven7 → eleven 7)
		.replace(/([0-9])([a-zA-Z])/g, '$1 $2')
		.replace(/([a-zA-Z])([0-9])/g, '$1 $2')
		// Expand "and" when embedded in words (benandjerrys → ben and jerrys)
		// This handles cases where "and" is glued to other words
		.replace(/([a-zA-Z])and([a-zA-Z])/gi, '$1 and $2')
		// Normalize & to " and "
		.replace(/&/g, ' and ')
		// Normalize accents
		.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
		// Normalize spaces
		.replace(/\s+/g, ' ');
}

/**
 * Creates an ultra-normalized version of text for key-based matching.
 * Removes all spaces and non-alphanumerics for exact key comparison.
 */
// function createTextMatchKey(text: string): string {
// 	return normalizeTextForMatching(text)
// 		.toLowerCase()
// 		.replace(/\s+/g, '')
// 		.replace(/[^a-z0-9]/g, '');
// }

/**
 * Checks which brands are mentioned in a text.
 * Returns shortNames(!) of brands in order they're mentioned.
 */
export function rankBrandsInText(
	text: string,
	brands: Array<FlaggedBrand>,
	entities?: Array<Entity>
): Array<string> {
	const mentionedBrands: Array<{ name: string; position: number }> = [];

	// Create a normalized version of text for pattern matching (expands CamelCase, etc.)
	const normalizedText = normalizeTextForMatching(text);

	const brandEntities = entities?.filter(entity => entity.type.toLowerCase() === 'brand') ?? [];

	// Build a map from ultra-normalized FlaggedBrand name to the entity text variation (if any)
	// Using createBrandMatchKey to handle cases like "kidsandus" matching "Kids&Us"
	const entityTextByNormalizedBrand = new Map<string, string>();
	for (const entity of brandEntities) {
		entityTextByNormalizedBrand.set(createBrandMatchKey(entity.name), entity.name);
	}

	// Set of ultra-normalized entity names that match a FlaggedBrand (to exclude from separate processing)
	const matchedEntityNames = new Set<string>();

	// Helper function to search in both original and normalized text
	const findPatternPosition = (pattern: RegExp): number => {
		const originalMatch = text.match(pattern);
		if (originalMatch != null) {
			return originalMatch.index!;
		}
		const normalizedMatch = normalizedText.match(pattern);
		if (normalizedMatch != null) {
			return normalizedMatch.index!;
		}
		return -1;
	};

	// Process FlaggedBrands, using entity text as an additional search variant when available
	for (const brand of brands) {
		let earliestPosition = Infinity;
		const normalizedShortName = createBrandMatchKey(brand.shortName);

		// Check if there's a matching entity for this brand (using ultra-normalized comparison)
		const entityText = entityTextByNormalizedBrand.get(normalizedShortName);
		if (entityText != null) {
			matchedEntityNames.add(createBrandMatchKey(entityText));
			// Use flexible pattern matching to find the entity in text (handles CamelCase, &/and, etc.)
			const entityPattern = createBrandMatchPattern(entityText);
			const position = findPatternPosition(entityPattern);
			if (position !== -1) {
				earliestPosition = Math.min(earliestPosition, position);
			}
		}

		// Check for shortName using flexible pattern matching
		if (brand.shortName != null && brand.shortName.trim() !== '') {
			const brandPattern = createBrandMatchPattern(brand.shortName);
			const position = findPatternPosition(brandPattern);
			if (position !== -1) {
				earliestPosition = Math.min(earliestPosition, position);
			}
		}

		// Check for domain occurrence
		if (brand.domain != null && brand.domain.trim() !== '') {
			const domainIndex = text.toLowerCase().indexOf(brand.domain.toLowerCase());
			if (domainIndex !== -1) {
				earliestPosition = Math.min(earliestPosition, domainIndex);
			}
		}

		if (earliestPosition !== Infinity) {
			mentionedBrands.push({
				name: brand.shortName,
				position: earliestPosition
			});
		}
	}

	// Process entity brands that don't match any FlaggedBrand
	for (const entity of brandEntities) {
		if (matchedEntityNames.has(createBrandMatchKey(entity.name))) {
			continue;
		}

		// Use flexible pattern matching for unmatched entities too
		const entityPattern = createBrandMatchPattern(entity.name);
		const position = findPatternPosition(entityPattern);
		if (position !== -1) {
			mentionedBrands.push({
				name: entity.name,
				position: position
			});
		}
	}

	return mentionedBrands
		.sort((a, b) => a.position - b.position)
		.map(item => item.name);
}

export async function rankBrandsInTexts(
	texts: Array<string>,
	brands: Array<FlaggedBrand>,
	entities?: Array<Array<Entity>>
): Promise<Array<Array<string>>> {
	return texts.map((text, index) => rankBrandsInText(text, brands, entities?.[index]));
}

export type * from './schemas/brand.schema.ts';
