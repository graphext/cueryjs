import { z } from '@zod/zod';

import { askOpenAISafe } from '../openai.ts';

import { dedent } from '../utils.ts';
import { type Brand, type FlaggedBrand } from '../schemas/brand.schema.ts';
import { type Source } from '../schemas/sources.schema.ts';
import { type SearchResult } from '../schemas/search.schema.ts';
import { type SerpResponse } from '../apis/hasdata/serp.ts';
import { type ScrapeResponse } from '../apis/hasdata/scrape.ts';
import { extractDomain } from '../urls.ts';
import { html as parseHtml, links as extractLinks } from './parseHtml.ts';


/**
 * Visibility information for a brand within a (single) search result.
 */
export type Visibility = {
	name: string; // shortName of brand
	inContent: boolean;  // whether brand is mentioned in answer content
	inSources: boolean;  // whether brand is cited in sources (i.e. source URLs are from brand's domain)
	indices: Array<number>; // indices in text where brand is mentioned
	citations: Array<string>; // URLs from brand domain that are cited (source.cited === true)
	references: Array<string>; // URLs from brand domain that are not cited (source.cited === false)
}

/**
 * Statistics about brand visibility across multiple search results.
 */
export type VisibilityStats = {
	name: string;
	answer: number;
	citations: number;
	uniqueCitations: number;
	references: number;
	uniqueReferences: number;
}

/**
 * Search result annotated with multiple brands' visibility information.
 */
export type AnnotatedSearchResult = SearchResult & {
	visibilities: Record<string, Visibility>;
}

/**
 * Generate topic keyword queries using OpenAI.
 */
export async function generateTopicQueries(
	prompt: string,
	n: number,
	language: string = 'English'
): Promise<string[]> {

	const instructions = dedent(`
		Return the results as a JSON array of ${n} strings in the language ${language}.
		Make sure the strings are short Google keyword-style phrases, each no longer than
		5 words.
	`);
	prompt = prompt + '\n\n' + instructions;

	const keywordsSchema = z.object({
		keywords: z.array(z.string()).describe(`List of ${n} keywords.`)
	});

	const { parsed } = await askOpenAISafe(
		prompt,
		'gpt-5.1',
		keywordsSchema,
		{ reasoning: { effort: 'none' } }
	);

	if (!parsed) {
		throw new Error('Failed to generate keywords for topic!');
	}

	return parsed.keywords;
};


/**
 * Extract organic results from SERP responses as SearchResult items.
 * We treat all URLs as cited in the context of organic result.
 */
export function extractOrganicResults(
	serps: Array<SerpResponse>
): Array<SearchResult> {
	const results: Array<SearchResult> = [];

	for (const serp of serps) {
		const organicResults = serp.organicResults ?? [];
		const sources: Array<Source> = [];
		for (const entry of organicResults) {
			const url = entry.link ?? entry.url ?? '';
			const source: Source = {
				title: entry.title || '',
				url: normalizeUrl(url, true),
				domain: extractDomain(url),
				cited: true
			};
			sources.push(source);
		}
		results.push({
			answer: '',
			sources
		});
	}
	return results;
}

/**
 * Extract AI Overview results from SERP responses as SearchResult items.
 * If no AI Overview is present, returns empty answer and sources.
 * We treat all AIO sources as cited.
 */
export function extractAIOResults(
	serps: Array<SerpResponse>
): Array<SearchResult> {
	const results: Array<SearchResult> = [];
	for (const serp of serps) {
		const aio = serp.aiOverview;
		if (aio) {
			results.push({
				answer: aio.answer,
				sources: aio.sources.map((source) => ({
					...source,
					url: normalizeUrl(source.url, true),
					cited: true
				}))
			});
		} else {
			results.push({
				answer: '',
				sources: []
			});
		}
	}
	return results;
}

/**
 * Convert a ScrapeResponse to a SearchResult for brand presence analysis.
 * Treats the page text content as the "answer" and extracted links as "sources".
 * Links are marked as uncited (references) since they're not direct citations.
 * Uses parseHtml to extract links from the HTML content.
 */
export function toSearchResult(
	scrape: ScrapeResponse,
	url: string
): SearchResult {
	const textContent = scrape.text ?? scrape.markdown ?? '';

	const sources: Array<Source> = [];

	if (scrape.html != null) {
		const $ = parseHtml(scrape.html, url);
		const pageLinks = extractLinks($, true);

		for (const link of pageLinks) {
			sources.push({
				title: link.text,
				url: normalizeUrl(link.href, true),
				domain: extractDomain(link.href),
				cited: true // Links from page content are citations, because they're explicitly in the text
			});
		}
	}

	return {
		answer: textContent,
		sources
	};
}

/**
 * Detect brand presence of supplied brands in a set of search results.
 * Returns the search results annotated with visibility information for each brand.
 */
export function annotateBrandVisibility(
	results: Array<SearchResult>,
	brands: Array<FlaggedBrand>
): Array<AnnotatedSearchResult> {

	// For faster lookup, create a map of domain to brand shortName
	const domainToName: Record<string, string> = {};
	for (const brand of brands) {
		domainToName[brand.domain.toLowerCase()] = brand.shortName;
	}

	const taggedResults: Array<AnnotatedSearchResult> = [];

	for (const result of results) {
		const presences: Record<string, Visibility> = {};

		// Initialize presence records
		for (const brand of brands) {
			presences[brand.shortName] = {
				name: brand.shortName,
				inContent: false,
				inSources: false,
				indices: [],
				citations: [],
				references: []
			};
		}

		// Detect brand mentions in answer content using name regex (same as visibility/gptPresence)
		for (const brand of brands) {
			const escapedName = brand.shortName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const pattern = new RegExp(`\\b${escapedName}\\b`, 'gi');
			let match: RegExpExecArray | null;
			while ((match = pattern.exec(result.answer)) !== null) {
				presences[brand.shortName].indices.push(match.index);
			}
			if (presences[brand.shortName].indices.length > 0) {
				presences[brand.shortName].inContent = true;
			}
		}

		// Detect brand presence in sources via domain matching (same as visibility/gptPresence)
		for (const source of result.sources) {
			const domain = (source.domain || extractDomain(source.url)).toLowerCase();
			const brandName = domainToName[domain];
			if (brandName) {
				presences[brandName].inSources = true;
				const normUrl = normalizeUrl(source.url, true);
				if (source.cited) {
					presences[brandName].citations.push(normUrl);
				} else {
					presences[brandName].references.push(normUrl);
				}
			}
		}

		taggedResults.push({
			...result,
			visibilities: presences
		});
	}

	return taggedResults;
}

/**
 * Analyze brand presence across multiple scraped pages.
 * Converts ScrapeResponse to SearchResult format for unified analysis.
 * Returns a record mapping each URL to its TaggedSearchResult.
 */
export function annotateBrandVisibilityInScrapedPages(
	scrapedPages: Record<string, ScrapeResponse>,
	brands: Array<FlaggedBrand>
): Record<string, AnnotatedSearchResult> {
	const urls = Object.keys(scrapedPages);
	const results = urls.map((url) => toSearchResult(scrapedPages[url], url));
	const taggedResults = annotateBrandVisibility(results, brands);

	const resultsByUrl: Record<string, AnnotatedSearchResult> = {};
	for (let i = 0; i < urls.length; i++) {
		resultsByUrl[urls[i]] = taggedResults[i];
	}

	return resultsByUrl;
}

/**
 * Normalize a URL by removing fragments and text snippets.
 * This ensures URLs pointing to the same page are treated as duplicates.
 */
export function normalizeUrl(url: string, removeParams: boolean = true): string {
	try {
		const parsed = new URL(url);
		parsed.hash = '';
		if (removeParams) {
			for (const param of Array.from(parsed.searchParams.keys())) {
				parsed.searchParams.delete(param);
			}
		}
		return parsed.toString();
	} catch {
		return url;
	}
}

/**
 * Aggregate brand visibility statistics across multiple annotated search results.
 */
export function aggregateBrandVisibility(
	taggedResults: Array<AnnotatedSearchResult>,
	brands: Array<FlaggedBrand>
): Array<VisibilityStats> {
	const counts: Record<string, VisibilityStats> = {};
	const citedUrlsSeen: Record<string, Set<string>> = {};
	const refUrlsSeen: Record<string, Set<string>> = {};

	// Initialize counts and seen URL sets
	for (const brand of brands) {
		citedUrlsSeen[brand.shortName] = new Set();
		refUrlsSeen[brand.shortName] = new Set();
		counts[brand.shortName] = {
			name: brand.shortName,
			answer: 0,
			citations: 0,
			uniqueCitations: 0,
			references: 0,
			uniqueReferences: 0
		};
	}

	for (const result of taggedResults) {
		for (const brand of brands) {
			const presence = result.visibilities[brand.shortName];
			if (!presence) {
				continue;
			}

			// Count answer mentions (one per result where brand appears in content)
			if (presence.inContent) {
				counts[brand.shortName].answer += 1;
			}

			for (const url of presence.citations) {
				const normalizedUrl = normalizeUrl(url, true).toLowerCase();
				counts[brand.shortName].citations += 1;
				if (!citedUrlsSeen[brand.shortName].has(normalizedUrl)) {
					citedUrlsSeen[brand.shortName].add(normalizedUrl);
					counts[brand.shortName].uniqueCitations += 1;
				}
				counts[brand.shortName].references += 1;
				if (!refUrlsSeen[brand.shortName].has(normalizedUrl)) {
					refUrlsSeen[brand.shortName].add(normalizedUrl);
					counts[brand.shortName].uniqueReferences += 1;
				}
			}

			for (const url of presence.references) {
				const normalizedUrl = normalizeUrl(url, true).toLowerCase();
				counts[brand.shortName].references += 1;
				if (!refUrlsSeen[brand.shortName].has(normalizedUrl)) {
					refUrlsSeen[brand.shortName].add(normalizedUrl);
					counts[brand.shortName].uniqueReferences += 1;
				}
			}
		}
	}

	return Object.values(counts).sort((a, b) => b.answer - a.answer);
}

/**
 * Statistics about cited URLs across multiple search results.
 * Includes total citation count and per-engine breakdown.
 */
export type UrlStats = {
	total: number;
	engines: Record<string, number>;
}

/**
 * Extract and count all normalized URLs cited in SERP AI Overviews and GPT results.
 * Aggregates citation counts across both sources into a single record.
 * Optionally excludes URLs from specified brand domains.
 */
export function extractCitedUrls(
	engineResults: Array<Array<SearchResult>>,
	includeUncited: boolean = true,
	excludeBrands?: Array<Brand>,
	engineLabels?: Array<string>
): Record<string, UrlStats> {
	if (engineLabels) {
		if (engineLabels.length !== engineResults.length) {
			throw new Error('Engine labels length must match engineResults length!');
		}
	} else {
		engineLabels = engineResults.map((_, i) => `set_${i}`);
	}

	const urlCounts: Record<string, UrlStats> = {};
	const excludedDomains = new Set(
		(excludeBrands ?? []).map((brand) => brand.domain.toLowerCase())
	);

	for (let i = 0; i < engineResults.length; i++) {
		const resultSet = engineResults[i];
		const label = engineLabels[i];

		for (const result of resultSet) {
			for (const source of result.sources) {
				if (source.cited || includeUncited) {
					const domain = (source.domain || extractDomain(source.url)).toLowerCase();
					if (excludedDomains.has(domain)) {
						continue;
					}
					const normalizedUrl = normalizeUrl(source.url, true).toLowerCase();

					if (urlCounts[normalizedUrl] == null) {
						const engineCounts = Object.fromEntries(
							engineLabels.map((lbl) => [lbl, 0])
						);
						urlCounts[normalizedUrl] = { total: 0, engines: engineCounts };
					}
					urlCounts[normalizedUrl].total += 1;
					urlCounts[normalizedUrl].engines[label] = (urlCounts[normalizedUrl].engines[label] ?? 0) + 1;
				}
			}
		}
	}

	return urlCounts;
}

/**
 * Aggregate cited URL statistics by domain.
 * Sums total citations and per-engine counts for all URLs under the same domain.
 */
export type DomainStats = {
	total: number;
	engines: Record<string, number>;
	urls: Set<string>;
}

/**
 * Aggregate cited URL statistics by domain.
 */
export function aggregateCitedDomains(urls: Record<string, UrlStats>): Record<string, DomainStats> {
	const result: Record<string, DomainStats> = {};

	for (const [url, stats] of Object.entries(urls)) {
		const domain = extractDomain(url);
		if (!domain) {
			continue;
		}

		if (!result[domain]) {
			const engineCounts = Object.fromEntries(
				Object.keys(stats.engines).map((engine) => [engine, 0])
			);
			result[domain] = { total: 0, engines: engineCounts, urls: new Set<string>() };
		}

		if (!result[domain].urls.has(url)) {
			result[domain].total += stats.total;
			for (const [engine, count] of Object.entries(stats.engines)) {
				result[domain].engines[engine] = (result[domain].engines[engine] ?? 0) + count;
			}
			result[domain].urls.add(url);
		}
	}

	return result;
}

/**
 * Filter ScrapeResponses to only those cited by a specific search engine.
 */
export function filterByEngine<T>(
	urls: Record<string, T>,
	urlStats: Record<string, UrlStats>,
	engine: string
): Record<string, T> {
	return Object.fromEntries(
		Object.entries(urls)
			.filter(([url, _]) => urlStats[normalizeUrl(url, true)]?.engines[engine] > 0)
	);
}
