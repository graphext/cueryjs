/**
 * Seed Keyword Functions
 *
 * Pure functions for collecting and grouping seed keywords.
 * No external dependencies - safe to import in both frontend and backend.
 */

// Re-export types from schema (canonical source)
export type { SeedKeyword, SeedKeywordSource } from '../schemas/seedKeyword.schema.ts';

// Import only what's used in function signatures
import type { SeedKeyword } from '../schemas/seedKeyword.schema.ts';

// ============================================================================
// Minimal Interfaces for Function Parameters
// These use structural typing to work with both frontend and backend types
// ============================================================================

interface PortfolioItemLike {
	name: string;
	keywordSeeds?: Array<string>;
}

interface PersonaLike {
	name: string;
	keywordSeeds?: Array<string>;
}

interface FunnelCategoryLike {
	name: string;
	keywordSeeds?: Array<string>;
}

interface FunnelStageLike {
	stage: string;
	categories?: Array<FunnelCategoryLike>;
}

interface CompetitorLike {
	name: string;
	portfolio?: Array<PortfolioItemLike>;
}

// ============================================================================
// Seed Keyword Collection
// ============================================================================

export interface CollectSeedKeywordsParams {
	brandPortfolio?: Array<PortfolioItemLike>;
	personas?: Array<PersonaLike>;
	funnelStages?: Array<FunnelStageLike>;
	competitors?: Array<CompetitorLike>;
	customKeywords?: Array<string>;
}

/**
 * Collects seed keywords from all sources and creates SeedKeyword objects
 * with proper metadata (id, source, sourceId, sourceName).
 */
export function collectSeedKeywords({
	brandPortfolio,
	personas,
	funnelStages,
	competitors,
	customKeywords
}: CollectSeedKeywordsParams): Array<SeedKeyword> {
	const keywords: Array<SeedKeyword> = [];

	// Brand portfolio keywords
	brandPortfolio?.forEach((portfolioItem) => {
		if (portfolioItem.keywordSeeds && portfolioItem.keywordSeeds.length > 0) {
			portfolioItem.keywordSeeds.forEach((keyword) => {
				keywords.push({
					id: `brand-portfolio-${portfolioItem.name}-${keyword}`,
					keyword,
					source: 'brand-portfolio',
					sourceId: portfolioItem.name,
					sourceName: portfolioItem.name
				});
			});
		}
	});

	// Persona keywords
	personas?.forEach((persona) => {
		if (persona.keywordSeeds && persona.keywordSeeds.length > 0) {
			persona.keywordSeeds.forEach((keyword) => {
				keywords.push({
					id: `persona-${persona.name}-${keyword}`,
					keyword,
					source: 'persona',
					sourceId: persona.name,
					sourceName: persona.name
				});
			});
		}
	});

	// Funnel category keywords
	funnelStages?.forEach((stage) => {
		stage.categories?.forEach((category) => {
			if (category.keywordSeeds && category.keywordSeeds.length > 0) {
				category.keywordSeeds.forEach((example) => {
					keywords.push({
						id: `funnel-${stage.stage}-${category.name}-${example}`,
						keyword: example,
						source: 'funnel',
						sourceId: `${stage.stage}::${category.name}`,
						sourceName: `${stage.stage} > ${category.name}`
					});
				});
			}
		});
	});

	// Competitor portfolio keywords
	competitors?.forEach((competitor) => {
		if (competitor.portfolio && competitor.portfolio.length > 0) {
			competitor.portfolio.forEach((portfolioItem) => {
				if (portfolioItem.keywordSeeds && portfolioItem.keywordSeeds.length > 0) {
					portfolioItem.keywordSeeds.forEach((keyword) => {
						keywords.push({
							id: `portfolio-${competitor.name}-${portfolioItem.name}-${keyword}`,
							keyword,
							source: 'portfolio',
							sourceId: portfolioItem.name,
							sourceName: `${competitor.name} > ${portfolioItem.name}`
						});
					});
				}
			});
		}
	});

	// Custom keywords
	customKeywords?.forEach((keyword, index) => {
		keywords.push({
			id: `custom-${index}-${keyword}`,
			keyword,
			source: 'custom'
		});
	});

	return keywords;
}

// ============================================================================
// Seed Keyword Grouping
// ============================================================================

interface GroupedKeywordBuckets {
	brandInfoKeywords: Array<Array<SeedKeyword>>;
	competitorKeywords: Array<Array<SeedKeyword>>;
	personasKeywords: Array<SeedKeyword>;
	funnelKeywords: Array<Array<SeedKeyword>>;
	customKeywords: Array<SeedKeyword>;
}

/**
 * Groups seed keywords by their source, maintaining order within each source.
 * Keywords from the same portfolio item, competitor product, or funnel category
 * are grouped together.
 *
 * @param seedKeywords - Flat array of seed keywords
 * @param generateIdeasFromSeeds - When true, returns grouped keywords for idea generation.
 *                                  When false, returns all keywords flattened into a single group.
 * @returns Array of grouped keywords (arrays for same-source groups, single items for personas/custom)
 */
export function groupSeedKeywords(
	seedKeywords: Array<SeedKeyword>,
	generateIdeasFromSeeds: boolean = true
): Array<Array<SeedKeyword> | SeedKeyword> {
	let group: string | undefined;
	const keywords = seedKeywords.reduce<GroupedKeywordBuckets>((acc, item) => {
		if (item.source === 'brand-portfolio') {
			if (item.sourceName === group) {
				acc.brandInfoKeywords[acc.brandInfoKeywords.length - 1]!.push(item);
				return acc;
			} else {
				group = item.sourceName;
				acc.brandInfoKeywords.push([item]);
			}
		} else if (item.source === 'portfolio') {
			if (item.sourceName === group) {
				acc.competitorKeywords[acc.competitorKeywords.length - 1]!.push(item);
				return acc;
			} else {
				group = item.sourceName;
				acc.competitorKeywords.push([item]);
			}
		} else if (item.source === 'persona') {
			group = undefined;
			acc.personasKeywords.push(item);
		} else if (item.source === 'funnel') {
			if (item.sourceName === group) {
				acc.funnelKeywords[acc.funnelKeywords.length - 1]!.push(item);
				return acc;
			} else {
				group = item.sourceName;
				acc.funnelKeywords.push([item]);
			}
		} else if (item.source === 'custom') {
			group = undefined;
			acc.customKeywords.push(item);
		}
		return acc;
	}, {
		brandInfoKeywords: [],
		competitorKeywords: [],
		personasKeywords: [],
		funnelKeywords: [],
		customKeywords: []
	});

	const groupedKeywords: Array<SeedKeyword | Array<SeedKeyword>> = [
		...keywords.brandInfoKeywords,
		...keywords.competitorKeywords,
		...keywords.personasKeywords,
		...keywords.funnelKeywords,
		...keywords.customKeywords
	];

	if (!generateIdeasFromSeeds) {
		return [[...new Set(groupedKeywords.flat())]].filter(g => g.length > 0);
	}

	const normalizeKeyword = (keyword: SeedKeyword): SeedKeyword => ({
		...keyword,
		keyword: keyword.keyword.trim().toLowerCase()
	});

	const dedupeKeywordArray = (kws: Array<SeedKeyword>): Array<SeedKeyword> => {
		const seen = new Set<string>();
		return kws.filter(kw => {
			const normalized = normalizeKeyword(kw);
			if (seen.has(normalized.keyword)) {
				return false;
			}
			seen.add(normalized.keyword);
			return true;
		});
	};

	const uniqueKeywordsSet = new Set<string>();
	type GroupedResult = Array<SeedKeyword | Array<SeedKeyword>>;
	const deduplicatedGroupedKeywords = groupedKeywords.reduce<GroupedResult>((acc, item) => {
		if (Array.isArray(item)) {
			const deduped = dedupeKeywordArray(item);
			if (deduped.length > 0) {
				acc.push(deduped);
			}
			return acc;
		}

		const normalized = normalizeKeyword(item);
		if (uniqueKeywordsSet.has(normalized.keyword)) {
			return acc;
		}

		uniqueKeywordsSet.add(normalized.keyword);
		acc.push(item);
		return acc;
	}, []);

	return deduplicatedGroupedKeywords;
}

/**
 * Groups seed keywords and extracts just the keyword strings.
 * Convenience wrapper around groupSeedKeywords for cases where
 * only the keyword text is needed (not the full metadata).
 */
export function groupKeywordStrings(
	seedKeywords: Array<SeedKeyword>,
	generateIdeasFromSeeds: boolean = true
): Array<Array<string> | string> {
	const groupedSeedKeywords = groupSeedKeywords(seedKeywords, generateIdeasFromSeeds);

	return groupedSeedKeywords.map(g => {
		if (Array.isArray(g)) {
			return g.map(kw => kw.keyword);
		}
		return g.keyword;
	});
}

/**
 * Collects and groups seed keywords in one step, returning only keyword strings.
 * This is a convenience function for pipelines that need grouped keyword strings
 * without the full SeedKeyword metadata.
 *
 * @param params - Same parameters as collectSeedKeywords
 * @param generateIdeasFromSeeds - When true, returns grouped keywords. When false, returns flat.
 * @returns Grouped keyword strings (arrays for same-source groups, single strings otherwise)
 */
export function collectAndGroupKeywordStrings(
	params: CollectSeedKeywordsParams,
	generateIdeasFromSeeds: boolean = true
): Array<Array<string> | string> {
	const seedKeywords = collectSeedKeywords(params);
	return groupKeywordStrings(seedKeywords, generateIdeasFromSeeds);
}
