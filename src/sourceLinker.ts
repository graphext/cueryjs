/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */

/**
 * Source Linker - Links sources/citations to statements based on content matching
 *
 * This module provides utilities to associate ChatGPT sources with specific
 * statements/topics extracted from the response.
 *
 * PRIMARY METHOD (most accurate):
 * - Citation extraction: ChatGPT uses \[1\], \[2\], etc. which map to sources[N-1]
 *
 * FALLBACK HEURISTICS (when no inline citations):
 * - Domain matching (company name <-> source domain)
 * - Text similarity (statement <-> source snippet/title)
 * - Position-based matching (for links_attached with position info)
 */

import type { Source, SearchSource } from './schemas/sources.schema.ts';

// --- Types ---

export interface LinkableSource extends Source {
	positions?: Array<number>;  // Citation positions [N] in the text (from links_attached)
	snippet?: string;           // Search snippet (from search_sources)
	rank?: number;              // Search rank (from search_sources)
	datePublished?: string | null;
}

export interface StatementWithSources {
	text: string;
	inferred_topic: string;
	inferred_subtopic: string;
	supporting_sources: Array<LinkableSource>;
	source_match_scores: Array<{
		source_url: string;
		score: number;
		match_reasons: Array<string>;
	}>;
}

export interface SourceLinkingOptions {
	/** Minimum score (0-1) to consider a source as supporting a statement */
	minMatchScore?: number;
	/** Maximum number of sources to link per statement */
	maxSourcesPerStatement?: number;
	/** Weight for domain/company name matching (0-1) */
	domainMatchWeight?: number;
	/** Weight for text similarity matching (0-1) */
	textMatchWeight?: number;
	/** Weight for snippet content matching (0-1) */
	snippetMatchWeight?: number;
}

const DEFAULT_OPTIONS: Required<SourceLinkingOptions> = {
	minMatchScore: 0.3,
	maxSourcesPerStatement: 5,
	domainMatchWeight: 0.5,
	textMatchWeight: 0.3,
	snippetMatchWeight: 0.2
};

// --- Utility Functions ---

/**
 * Normalizes text for comparison: lowercase, remove punctuation, trim
 */
function normalizeText(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\w\sáéíóúñü]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Extracts potential company/brand names from a domain
 * e.g., "www.kidsandus.es" -> ["kidsandus", "kids and us"]
 */
function extractBrandFromDomain(domain: string): Array<string> {
	// Remove common prefixes/suffixes
	const cleaned = domain
		.replace(/^(www\.|m\.)/i, '')
		.replace(/\.(com|es|org|net|co|io|eu)(\.[a-z]{2})?$/i, '');

	const brands: Array<string> = [cleaned.toLowerCase()];

	// Try to split camelCase or compound words
	const withSpaces = cleaned
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/[-_]/g, ' ')
		.toLowerCase();

	if (withSpaces !== cleaned.toLowerCase()) {
		brands.push(withSpaces);
	}

	return brands;
}

/**
 * Calculates word overlap ratio between two texts
 */
function wordOverlapScore(text1: string, text2: string): number {
	const words1 = new Set(normalizeText(text1).split(' ').filter(w => w.length > 2));
	const words2 = new Set(normalizeText(text2).split(' ').filter(w => w.length > 2));

	if (words1.size === 0 || words2.size === 0) return 0;

	let matchCount = 0;
	for (const word of words1) {
		if (words2.has(word)) matchCount++;
	}

	// Jaccard similarity
	const union = new Set([...words1, ...words2]);
	return matchCount / union.size;
}

/**
 * Checks if a company name appears in the source domain or title
 */
function companyDomainMatch(companyName: string, source: LinkableSource): number {
	const normalizedCompany = normalizeText(companyName);
	const companyWords = normalizedCompany.split(' ').filter(w => w.length > 2);

	// Check domain
	const brandNames = extractBrandFromDomain(source.domain);
	for (const brand of brandNames) {
		// Exact match
		if (brand === normalizedCompany.replace(/\s+/g, '')) return 1.0;

		// Check if company words appear in brand
		const brandWords = brand.split(' ');
		const matchingWords = companyWords.filter(w => brandWords.some(bw => bw.includes(w) || w.includes(bw)));
		if (matchingWords.length > 0) {
			return matchingWords.length / Math.max(companyWords.length, brandWords.length);
		}
	}

	// Check title
	if (source.title) {
		const titleNorm = normalizeText(source.title);
		if (titleNorm.includes(normalizedCompany)) return 0.8;

		// Partial match in title
		const matchingWords = companyWords.filter(w => titleNorm.includes(w));
		if (matchingWords.length > 0) {
			return (matchingWords.length / companyWords.length) * 0.6;
		}
	}

	return 0;
}

// --- Simple Source for Analytics ---

export interface InfluencingSource {
	url: string;
	domain: string;
	title?: string;
	/** The [N] citation numbers from positions field */
	positions?: Array<number>;
}

// --- Company Name Matching (Most Reliable for this use case) ---

/**
 * Normalize text for fuzzy matching: lowercase, remove accents, keep alphanumeric only
 */
function normalizeForMatching(text: string): string {
	return text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '') // Remove accents
		.replace(/[^a-z0-9]/g, ''); // Keep only alphanumeric
}

/**
 * Extract company name variations for matching
 * e.g., "British Council Castellón" -> ["britishcouncilcastellon", "british", "council"]
 */
function getCompanyNameVariations(companyName: string): Array<string> {
	const variations: Array<string> = [];
	const normalized = normalizeForMatching(companyName);
	variations.push(normalized);

	// Common stop words to filter out
	const stopWords = ['academia', 'centro', 'escuela', 'english', 'language', 'school', 'centre', 'center', 'de', 'en', 'para', 'the', 'and', 'y', 'la', 'el', 'los', 'las'];
	const words = companyName.toLowerCase().split(/\s+/)
		.filter(w => !stopWords.includes(normalizeForMatching(w)) && w.length > 2);

	for (const word of words) {
		variations.push(normalizeForMatching(word));
	}

	return [...new Set(variations)].filter(v => v.length >= 3);
}

/**
 * Find sources that match a company name by domain, title, or URL
 * This is the PRIMARY method when inline citations are not available.
 * Includes the positions field for citation numbers.
 */
export function findSourcesForCompany(
	companyName: string,
	sources: Array<LinkableSource>,
	maxSources: number = 3
): Array<InfluencingSource> {
	const variations = getCompanyNameVariations(companyName);
	const matched: Array<{ source: LinkableSource; match: boolean }> = [];
	const seenUrls = new Set<string>();

	for (const source of sources) {
		if (seenUrls.has(source.url)) continue;

		const domain = normalizeForMatching(source.domain || '');
		const title = normalizeForMatching(source.title || '');
		const url = normalizeForMatching(source.url || '');

		// Check if any variation matches domain, title, or URL
		for (const variation of variations) {
			if (variation.length < 3) continue;

			const matchesDomain = domain.includes(variation);
			const matchesTitle = title.includes(variation);
			const matchesUrl = url.includes(variation);

			if (matchesDomain || matchesTitle || matchesUrl) {
				matched.push({ source, match: true });
				seenUrls.add(source.url);
				break;
			}
		}
	}

	// Prioritize sources with positions (cited) over those without
	return matched
		.sort((a, b) => {
			// First by having positions
			const aHasPos = (a.source.positions?.length ?? 0) > 0 ? 1 : 0;
			const bHasPos = (b.source.positions?.length ?? 0) > 0 ? 1 : 0;
			if (bHasPos !== aHasPos) return bHasPos - aHasPos;

			// Then by cited flag
			const aCited = a.source.cited ? 1 : 0;
			const bCited = b.source.cited ? 1 : 0;
			return bCited - aCited;
		})
		.slice(0, maxSources)
		.map(({ source }) => ({
			url: source.url,
			domain: source.domain || '',
			title: source.title,
			positions: source.positions
		}));
}

// --- Citation Extraction (Primary Method) ---

/**
 * Pattern to match ChatGPT inline citations: \[1\], \[2\], [1], [2], etc.
 * ChatGPT often escapes brackets in markdown output.
 */
const CITATION_PATTERN = /\\?\[(\d+)\\?\]/g;

/**
 * Extracts inline citation references from a text.
 * Returns array of citation numbers found (1-indexed as ChatGPT uses them).
 */
export function extractInlineCitations(text: string): Array<number> {
	const matches = [...text.matchAll(CITATION_PATTERN)];
	const citations = matches.map(m => parseInt(m[1], 10));
	// Return unique, sorted citation numbers
	return [...new Set(citations)].sort((a, b) => a - b);
}

/**
 * Maps inline citation numbers to actual source objects.
 * Uses the `positions` field in each source to find which source has that citation number.
 * If `positions` is not available, falls back to array index mapping: [1] → sources[0]
 */
export function mapCitationsToSources(
	citationNumbers: Array<number>,
	sources: Array<LinkableSource>
): Array<LinkableSource> {
	const result: Array<LinkableSource> = [];
	const seenUrls = new Set<string>();

	for (const num of citationNumbers) {
		// First, try to find a source with this position in its positions array
		const sourceWithPosition = sources.find(s =>
			s.positions != null && s.positions.includes(num)
		);

		if (sourceWithPosition != null && !seenUrls.has(sourceWithPosition.url)) {
			result.push(sourceWithPosition);
			seenUrls.add(sourceWithPosition.url);
			continue;
		}

		// Fallback: use array index if no positions field available
		const idx = num - 1;
		if (idx >= 0 && idx < sources.length) {
			const source = sources[idx];
			if (!seenUrls.has(source.url)) {
				result.push(source);
				seenUrls.add(source.url);
			}
		}
	}

	return result;
}

/**
 * Extracts citations from text and returns the corresponding sources.
 * This is the PRIMARY method for linking sources to statements.
 */
export function extractSourcesFromText(
	text: string,
	sources: Array<LinkableSource>
): Array<LinkableSource> {
	const citationNumbers = extractInlineCitations(text);
	return mapCitationsToSources(citationNumbers, sources);
}

/**
 * Enriches a statement with its inline citations resolved to actual sources.
 */
export function enrichStatementWithCitations(
	statementText: string,
	sources: Array<LinkableSource>
): {
	text: string;
	citation_numbers: Array<number>;
	sources_from_citations: Array<LinkableSource>;
} {
	const citationNumbers = extractInlineCitations(statementText);
	const resolvedSources = mapCitationsToSources(citationNumbers, sources);

	return {
		text: statementText,
		citation_numbers: citationNumbers,
		sources_from_citations: resolvedSources
	};
}

// --- Heuristic Matching (Fallback Method) ---

/**
 * Calculates a match score between a statement and a source
 */
export function calculateMatchScore(
	statementText: string,
	companyName: string | null,
	source: LinkableSource,
	options: SourceLinkingOptions = {}
): { score: number; reasons: Array<string> } {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const reasons: Array<string> = [];
	let totalScore = 0;

	// 1. Domain/Company matching
	if (companyName != null) {
		const domainScore = companyDomainMatch(companyName, source);
		if (domainScore > 0) {
			totalScore += domainScore * opts.domainMatchWeight;
			reasons.push(`company-domain match: ${(domainScore * 100).toFixed(0)}%`);
		}
	}

	// 2. Statement text vs source title matching
	if (source.title) {
		const titleScore = wordOverlapScore(statementText, source.title);
		if (titleScore > 0.1) {
			totalScore += titleScore * opts.textMatchWeight;
			reasons.push(`title overlap: ${(titleScore * 100).toFixed(0)}%`);
		}
	}

	// 3. Statement text vs source snippet matching
	if (source.snippet) {
		const snippetScore = wordOverlapScore(statementText, source.snippet);
		if (snippetScore > 0.1) {
			totalScore += snippetScore * opts.snippetMatchWeight;
			reasons.push(`snippet overlap: ${(snippetScore * 100).toFixed(0)}%`);
		}
	}

	// Normalize score to 0-1 range
	const maxPossibleScore = opts.domainMatchWeight + opts.textMatchWeight + opts.snippetMatchWeight;
	const normalizedScore = totalScore / maxPossibleScore;

	return { score: normalizedScore, reasons };
}

/**
 * Links sources to a single statement.
 *
 * Uses two methods in order of preference:
 * 1. PRIMARY: Extract inline citations \[N\] and map using source.positions field
 * 2. FALLBACK: Heuristic matching if no inline citations found
 */
export function linkSourcesToStatement(
	statementText: string,
	companyName: string | null,
	sources: Array<LinkableSource>,
	options: SourceLinkingOptions = {}
): StatementWithSources {
	const opts = { ...DEFAULT_OPTIONS, ...options };

	// PRIMARY METHOD: Try to extract inline citations first
	const citationNumbers = extractInlineCitations(statementText);

	if (citationNumbers.length > 0) {
		// We found inline citations - use them directly
		const citedSources = mapCitationsToSources(citationNumbers, sources);

		return {
			text: statementText,
			inferred_topic: '',
			inferred_subtopic: '',
			supporting_sources: citedSources,
			source_match_scores: citedSources.map(s => {
				// Find which citation number(s) this source corresponds to
				const matchingCitations = citationNumbers.filter(n =>
					s.positions?.includes(n) || sources[n - 1]?.url === s.url
				);
				return {
					source_url: s.url,
					score: 1.0, // Perfect match - direct citation
					match_reasons: matchingCitations.map(n => `inline citation [${n}]`)
				};
			})
		};
	}

	// FALLBACK: Use heuristic matching
	const scoredSources = sources.map(source => {
		const { score, reasons } = calculateMatchScore(statementText, companyName, source, options);
		return {
			source,
			score,
			reasons
		};
	});

	// Sort by score descending
	scoredSources.sort((a, b) => b.score - a.score);

	// Filter by minimum score and take top N
	const matchingSources = scoredSources
		.filter(s => s.score >= opts.minMatchScore)
		.slice(0, opts.maxSourcesPerStatement);

	return {
		text: statementText,
		inferred_topic: '', // To be filled by caller
		inferred_subtopic: '', // To be filled by caller
		supporting_sources: matchingSources.map(s => s.source),
		source_match_scores: matchingSources.map(s => ({
			source_url: s.source.url,
			score: s.score,
			match_reasons: s.reasons
		}))
	};
}

/**
 * Converts raw scraper response sources to LinkableSource format
 * Citations now include `positions` field directly from Brightdata API
 */
export function mergeSources(
	citations: Array<Source>,
	searchSources: Array<SearchSource>
): Array<LinkableSource> {
	const merged: Array<LinkableSource> = [];
	const seenUrls = new Set<string>();

	// Add citations first (these include positions from links_attached mapping)
	for (const cite of citations) {
		if (!seenUrls.has(cite.url)) {
			merged.push({
				...cite,
				positions: cite.positions,
				cited: cite.cited ?? false
			});
			seenUrls.add(cite.url);
		}
	}

	// Add search sources with their additional metadata
	for (const src of searchSources) {
		if (src.url && !seenUrls.has(src.url)) {
			merged.push({
				title: src.title,
				url: src.url,
				domain: src.domain,
				rank: src.rank,
				datePublished: src.datePublished
			});
			seenUrls.add(src.url);
		}
	}

	return merged;
}

/**
 * Extracts domain from a URL
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function extractDomainFromUrl(url: string): string {
	try {
		const parsed = new URL(url);
		return parsed.hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

/**
 * Aggregates sources by topic/subtopic for summary statistics
 */
export function aggregateSourcesByTopic(
	statementsWithSources: Array<StatementWithSources>
): Map<string, Map<string, Array<LinkableSource>>> {
	const topicMap = new Map<string, Map<string, Array<LinkableSource>>>();

	for (const statement of statementsWithSources) {
		const { inferred_topic, inferred_subtopic, supporting_sources } = statement;

		if (!topicMap.has(inferred_topic)) {
			topicMap.set(inferred_topic, new Map());
		}

		const subtopicMap = topicMap.get(inferred_topic)!;
		if (!subtopicMap.has(inferred_subtopic)) {
			subtopicMap.set(inferred_subtopic, []);
		}

		const sources = subtopicMap.get(inferred_subtopic)!;
		sources.push(...supporting_sources);
	}

	return topicMap;
}

/**
 * Gets the most influential sources for a topic (by frequency)
 */
export function getTopSourcesForTopic(
	topicMap: Map<string, Map<string, Array<LinkableSource>>>,
	topic: string,
	subtopic?: string,
	limit: number = 5
): Array<{ source: LinkableSource; frequency: number }> {
	const urlCounts = new Map<string, { source: LinkableSource; count: number }>();

	const subtopicMap = topicMap.get(topic);
	if (subtopicMap == null) return [];

	const subtopicsToProcess = subtopic != null
		? [subtopicMap.get(subtopic)].filter((s): s is Array<LinkableSource> => s != null)
		: [...subtopicMap.values()];

	for (const sources of subtopicsToProcess) {
		for (const source of sources) {
			const existing = urlCounts.get(source.url);
			if (existing != null) {
				existing.count++;
			} else {
				urlCounts.set(source.url, { source, count: 1 });
			}
		}
	}

	return [...urlCounts.values()]
		.sort((a, b) => b.count - a.count)
		.slice(0, limit)
		.map(({ source, count }) => ({ source, frequency: count }));
}

