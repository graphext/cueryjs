import { mapParallel } from '../helpers/async.ts';
import { createBrandMatchKey } from './brands.ts';
import type { FlaggedBrand } from '../schemas/brand.schema.ts';
import type { CategorizedSource, EnrichedSource, Source } from '../schemas/sources.schema.ts';
import { assignTopic, createLabelSchema, toTopics, type TopicLabel } from './topics.ts';
import type { ProviderParams } from '../llm.ts';
import type { Entity } from './entities.ts';

export type { Source, EnrichedSource, CategorizedSource } from '../schemas/sources.schema.ts';

/**
 * Checks if brand or competitor is mentioned in the source title or URL.
 */
export function enrichSource(
	source: Source,
	brands: Array<FlaggedBrand>,
	entities: Array<Entity> = []
): EnrichedSource {
	const mentionedBrandsMap = new Map<string, string>(); // norm -> display
	const mentionedCompetitorsMap = new Map<string, string>(); // norm -> display
	let linkedBrand: string | null = null;
	let linkedCompetitor: string | null = null;

	const title = source.title.toLowerCase();
	const url = source.url.toLowerCase();

	// Map de nombre normalizado -> nombre legible canonico (shortName) para favorecer la marca
	const brandDisplayByNorm = new Map<string, string>();
	for (const brand of brands) {
		const norm = createBrandMatchKey(brand.shortName);
		if (norm) {
			brandDisplayByNorm.set(norm, brand.shortName);
		}
	}

	for (const brand of brands) {
		const brandName = brand.shortName;
		const nameLower = brandName.toLowerCase();
		const isMentioned = title.includes(nameLower) || url.includes(nameLower);
		const isLinked = source.domain === brand.domain;
		const normName = createBrandMatchKey(brandName);

		if (!brand.isCompetitor) {
			if (isMentioned) {
				if (normName && !mentionedBrandsMap.has(normName)) {
					mentionedBrandsMap.set(normName, brandName);
				}
			}
			if (isLinked) {
				linkedBrand = brandName;
			}
		} else {
			if (isMentioned) {
				if (normName && !mentionedCompetitorsMap.has(normName)) {
					mentionedCompetitorsMap.set(normName, brandName);
				}
			}
			if (isLinked) {
				linkedCompetitor = brandName;
			}
		}
	}

	for (const entity of entities) {
		if (entity.type.toLowerCase() !== 'brand') continue;
		const entityNameLower = entity.name.toLowerCase();
		const isMentioned = title.includes(entityNameLower) || url.includes(entityNameLower);
		const normEntity = createBrandMatchKey(entity.name);
		const displayName = normEntity && brandDisplayByNorm.get(normEntity) ?
			brandDisplayByNorm.get(normEntity)! : entity.name;
		if (isMentioned) {
			if (normEntity && !mentionedCompetitorsMap.has(normEntity)) {
				// keep a readable display while deduping on normalized form
				mentionedCompetitorsMap.set(normEntity, displayName);
			}
		}
	}

	return {
		...source,
		mentionedBrands: Array.from(mentionedBrandsMap.values()),
		mentionedCompetitors: Array.from(mentionedCompetitorsMap.values()),
		linkedBrand,
		linkedCompetitor
	};
}

export async function enrichSources(
	sources: Array<Array<Source> | null>,
	brands: Array<FlaggedBrand>,
	entities: Array<Array<Entity>> = []
): Promise<Array<Array<EnrichedSource>>> {
	return sources.map((sourceList, index) =>
		sourceList == null ? [] : sourceList.map(source => enrichSource(source, brands, entities[index] ?? []))
	);
}

/**
 * Ranks brand mentions in an array of enriched sources.
 */
export function rankBrandsInSourceArray(
	sources: Array<EnrichedSource>
): { mentionedBrands: Array<string>; linkedBrands: Array<string> } {
	const rankedMentions: Array<{ name: string; position: number }> = [];
	const rankedLinks: Array<{ name: string; position: number }> = [];
	const seenMentions = new Set<string>();
	const seenLinks = new Set<string>();

	sources.forEach((source, sourceIndex) => {
		// Process mentioned brands (both brands and competitors)
		source.mentionedBrands.forEach(brandName => {
			const norm = createBrandMatchKey(brandName);
			if (norm && !seenMentions.has(norm)) {
				seenMentions.add(norm);
				rankedMentions.push({
					name: brandName,
					position: sourceIndex
				});
			}
		});

		source.mentionedCompetitors.forEach(competitorName => {
			const norm = createBrandMatchKey(competitorName);
			if (norm && !seenMentions.has(norm)) {
				seenMentions.add(norm);
				rankedMentions.push({
					name: competitorName,
					position: sourceIndex
				});
			}
		});

		// Process linked brands (singular - only one brand can be linked per source)
		if (source.linkedBrand != null) {
			const norm = createBrandMatchKey(source.linkedBrand);
			if (norm && !seenLinks.has(norm)) {
				seenLinks.add(norm);
				rankedLinks.push({
					name: source.linkedBrand,
					position: sourceIndex
				});
			}
		}

		if (source.linkedCompetitor != null) {
			const norm = createBrandMatchKey(source.linkedCompetitor);
			if (norm && !seenLinks.has(norm)) {
				seenLinks.add(norm);
				rankedLinks.push({
					name: source.linkedCompetitor,
					position: sourceIndex
				});
			}
		}
	});

	return {
		mentionedBrands: rankedMentions
			.sort((a, b) => a.position - b.position)
			.map(item => item.name),
		linkedBrands: rankedLinks
			.sort((a, b) => a.position - b.position)
			.map(item => item.name)
	};
}

export function rankedBrandsInSources(
	sources: Array<Array<EnrichedSource>>
): { mentionedBrands: Array<Array<string>>, linkedBrands: Array<Array<string>> } {

	const allMentioned: Array<Array<string>> = [];
	const allLinked: Array<Array<string>> = [];
	for (const sourceList of sources) {
		const { mentionedBrands, linkedBrands } = rankBrandsInSourceArray(sourceList);
		allMentioned.push(mentionedBrands);
		allLinked.push(linkedBrands);
	}

	return {
		mentionedBrands: allMentioned,
		linkedBrands: allLinked
	};
}

/**
 * Collects unique URLs or domains from nested lists of Sources.
 */
export function collectURLs(
	sourceLists: Array<Array<Source>>,
	domains: boolean = false
): Array<string> {
	const collected = new Set<string>();

	for (const sources of sourceLists) {
		if (sources == null) continue;
		for (const source of sources) {
			const value = domains ? source.domain : source.url;
			if (value.length > 400) {
				console.warn(`Skipping overly long ${domains ? 'domain' : 'URL'}: ${value}`);
				continue;
			}
			collected.add(value);
		}
	}

	return Array.from(collected);
}


const WEB_TAXONOMY = {
	'Authority & Ownership': [
		'Brand / Corporate Site',
		'Product / Microsite',
		'Government / Public Sector',
		'Education / Academic',
		'Non-Profit / NGO',
		'Religious / Faith-Based'
	],
	'News & Media': [
		'Mainstream News Outlet',
		'Trade / Niche Publication',
		'Local / Regional News',
		'Press Release Distribution'
	],
	'Reference & Knowledge': [
		'Encyclopedic Reference',
		'Data / Statistics Portal',
		'Guides & Tutorials',
		'Educational Content Hub'
	],
	'Content & Community': [
		'Blog',
		'Forum / Message Board',
		'Social Network',
		'Aggregator / Q&A Platform',
		'User Review Site'
	],
	'Commercial': [
		'E-Commerce / Retailer',
		'Marketplace',
		'Affiliate / Comparison Site',
		'Classifieds / Listings',
		'Travel / Booking Platform',
		'Job Board / Recruitment'
	],
	'Professional & B2B': [
		'Consultancy / Agency',
		'Professional Services (Legal, Medical, Financial)',
		'SaaS Product Site',
		'B2B Marketplace / Vendor Directory',
		'Technology Documentation (APIs, GitHub, OSS)',
		'Online Tool / Calculator',
		'Tech Blog / Knowledge Hub'
	],
	'Lifestyle & Entertainment': [
		'Streaming Platform',
		'Sports Site / Gaming Site',
		'Lifestyle & Culture (Food, Fashion, Travel, Hobbies)',
		'Events & Ticketing'
	],
	'Low-Value / Edge Cases': [
		'Parked / Placeholder Domain',
		'Spam / Low-Quality SEO Site',
		'Personal / Portfolio Site'
	]
};

const WEB_LABEL_SCHEMA = createLabelSchema({ topics: toTopics(WEB_TAXONOMY) });

const WEB_TAXONOMY_SERIALIZED = JSON.stringify(WEB_TAXONOMY, null, 2);

/**
 * Classifies an array of URLs into categories based on WEB_TAXONOMY.
 */
export async function classifyURLs(
	urls: Array<string>,
	model: string = 'gpt-5.1',
	modelParams: ProviderParams = { reasoning: { effort: 'none' } },
	maxConcurrency: number = 100
): Promise<Record<string, TopicLabel | null>> {
	const results = await mapParallel(
		urls,
		maxConcurrency,
		url => assignTopic({ text: url, taxonomy: WEB_TAXONOMY_SERIALIZED, labelSchema: WEB_LABEL_SCHEMA, model, modelParams })
	);

	const urlToCategory: Record<string, TopicLabel | null> = {};
	urls.forEach((url, index) => {
		urlToCategory[url] = results[index].parsed;
	});

	return urlToCategory;
}

/**
 * Creates a category mapper for sources by collecting unique URLs/domains and classifying them.
 */
export async function makeCategoryMapper(
	sourceLists: Array<Array<Source>>,
	domains: boolean = false,
	model: string = 'gpt-5.1',
	modelParams: ProviderParams = { reasoning: { effort: 'none' } },
	maxConcurrency: number = 100
): Promise<Record<string, TopicLabel | null>> {
	const urls = collectURLs(sourceLists, domains);
	const categoryMapping = await classifyURLs(urls, model, modelParams, maxConcurrency);
	return categoryMapping;
}

/**
 * Categorizes sources by assigning topic and subtopic to each EnrichedSource in-place(!).
 */
export async function categorizeSources(
	sourceLists: Array<Array<EnrichedSource>>,
	domains: boolean = false,
	model: string = 'gpt-5.1',
	modelParams: ProviderParams = { reasoning: { effort: 'none' } },
	maxConcurrency: number = 100
): Promise<Array<Array<CategorizedSource>>> {
	const categoryMapper = await makeCategoryMapper(sourceLists, domains, model, modelParams, maxConcurrency);

	for (const sources of sourceLists) {
		if (sources == null) continue;
		for (const source of sources) {
			const key = domains ? source.domain : source.url;
			const label = categoryMapper[key];

			(source as CategorizedSource).category = label?.topic ?? null;
			(source as CategorizedSource).subcategory = label?.subtopic ?? null;
		}
	}

	const categorizedSources = sourceLists as Array<Array<CategorizedSource>>;

	return categorizedSources;
}
