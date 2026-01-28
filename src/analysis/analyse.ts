import { load } from 'cheerio';

import type { Form, HeadingStats, HeadingNode, Link, List, Table } from './parseHtml.ts';
import { forms, checkStructuredDataTypes, headingStats, headingStructure, links, lists, main, metadata, paragraphs, structuredData, tables } from './parseHtml.ts';

import { type ScrapeResponse } from '../apis/hasdata/scrape.ts';

export type StructuredContent = {
	schemas: Array<Record<string, unknown>>;
	meta: Record<string, string>;
	headings: Array<HeadingNode>;
	paragraphs: Array<string>;
	lists: Array<List>;
	tables: Array<Table>;
	links: Array<Link>;
	forms: Array<Form>;
	questions: Array<string>;
}

export type StructuredStats = {
	numSchemas: number;
	schemaStats: Record<string, unknown>;
	headingStats: HeadingStats;
	numParagraphs: number;
	avgParagraphLength: number;
	numLists: number;
	avgListLength: number;
	numTables: number;
	numLinks: number;
	numInternalLinks: number;
	numExternalLinks: number;
	numQuestions: number;
	numForms: number;
	numWords: number;
	numChars: number;
}

export type StructuredAnalysis = {
	url: string;
	brand: string;
	response: ScrapeResponse;
	content: StructuredContent;
	stats: StructuredStats;
}

export type AggregatedStats = {
	count: number;
	avgSchemas: number;
	schemaStats: Record<string, number>;
	headingStats: {
		avgHeadings: number;
		pctOneH1: number;
		avgMaxDepth: number;
		avgSubheadings: number;
		avgSkippedLevels: number;
		avgEmptyHeadings: number;
		avgDuplicateHeadings: number;
		avgHeadingCounts: Record<string, number>;
	};
	avgParagraphs: number;
	avgParagraphLength: number;
	avgLists: number;
	avgListLength: number;
	avgTables: number;
	avgLinks: number;
	avgInternalLinks: number;
	avgExternalLinks: number;
	avgQuestions: number;
	avgForms: number;
	avgWords: number;
	avgChars: number;
}

export function questions(response: ScrapeResponse): Array<string> {
	let text = response.text || response.markdown || '';
	text = text.replace(/https?:\/\/[^\s]+/g, '');
	const questions = text.match(/(?:^|(?<=\.\s)|(?<=[!?\n]))(?:[^.!?\n]|\.(?!\s))*\?/g) || [];
	const uniqueQuestions = Array.from(new Set(questions.map(q => q.trim())));
	return uniqueQuestions;
}

export function analyseContent(url: string, response: ScrapeResponse): StructuredContent {
	const html = response.html || '';
	let $ = load(html, { baseURI: url });

	// Get schemas from header before keeping the main content only
	const schemas = structuredData($);
	const meta = metadata($);
	$ = main($);

	return {
		schemas: schemas,
		meta: meta,
		headings: headingStructure($),
		paragraphs: paragraphs($),
		lists: lists($),
		tables: tables($),
		links: links($),
		forms: forms($),
		questions: questions(response)
	};
}

export function summarizeContent(
	content: StructuredContent,
	response: ScrapeResponse
): StructuredStats {

	const includedSchemas = checkStructuredDataTypes(content.schemas);

	let avgParaLength = content.paragraphs.reduce((sum, p) => sum + p.length, 0) / content.paragraphs.length;
	avgParaLength = Math.round(avgParaLength);

	let avgListLength = content.lists.reduce((sum, l) => sum + l.items.length, 0) / content.lists.length;
	avgListLength = Math.round(avgListLength);

	const text = response.text || '';
	const numWords = text.trim().split(/\s+/).length;
	const numChars = text.length;

	return {
		numSchemas: content.schemas.length,
		schemaStats: includedSchemas,
		headingStats: headingStats(content.headings),
		numParagraphs: content.paragraphs.length,
		avgParagraphLength: avgParaLength,
		numLists: content.lists.length,
		avgListLength: avgListLength,
		numTables: content.tables.length,
		numLinks: content.links.length,
		numInternalLinks: content.links.filter((l) => !l.isExternal).length,
		numExternalLinks: content.links.filter((l) => l.isExternal).length,
		numQuestions: content.questions.length,
		numForms: content.forms.length,
		numWords: numWords,
		numChars: numChars
	};
}

/**
 * Analyzes the content for each brand and their URLs.
 */
export function analyzeBrandContent(
	brandUrls: Record<string, Array<string>>,  // brand name to URLs mapping
	urlResponses: Record<string, ScrapeResponse>, // URL to ScrapeResponse mapping
	brands?: Array<string>
): Record<string, Array<StructuredAnalysis>> {
	if (!brands) {
		brands = Object.keys(brandUrls);
	}

	const analyses: Record<string, Array<StructuredAnalysis>> = {};
	for (const brandName of brands) {
		const urls = brandUrls[brandName];
		analyses[brandName] = [];
		for (const url of urls) {
			const response = urlResponses[url];
			const structContent = analyseContent(url, response);
			const structStats = summarizeContent(structContent, response);
			analyses[brandName].push({
				url: url,
				brand: brandName,
				response: response,
				content: structContent,
				stats: structStats
			});
		}
	}
	return analyses;
}

/**
 * Aggregates multiple StructuredStats objects into a single AggregatedStats.
 * Computes averages and percentages across all stats.
 */
export function aggregateStats(statsList: Array<StructuredStats>): AggregatedStats {
	if (statsList.length === 0) {
		throw new Error('No stats to aggregate');
	}

	const count = statsList.length;

	// defaultdict-like object that returns 0 for missing keys
	const defaultZero = <T extends Record<string, number>>(): T =>
		new Proxy({} as T, {
			get: (target, prop: string) => target[prop] ?? 0
		});

	const sums = defaultZero<Record<string, number>>();
	const sumHeadingCounts = defaultZero<Record<string, number>>();
	const schemaStats = defaultZero<Record<string, number>>();

	for (const stats of statsList) {
		sums.schemas += stats.numSchemas;
		sums.paragraphs += stats.numParagraphs;
		sums.lists += stats.numLists;
		sums.tables += stats.numTables;
		sums.links += stats.numLinks;
		sums.internalLinks += stats.numInternalLinks;
		sums.externalLinks += stats.numExternalLinks;
		sums.questions += stats.numQuestions;
		sums.forms += stats.numForms;
		sums.words += stats.numWords;
		sums.chars += stats.numChars;

		// Weighted average contributions
		sums.paraLength += stats.avgParagraphLength * stats.numParagraphs;
		sums.paragraphCount += stats.numParagraphs;
		sums.listLength += stats.avgListLength * stats.numLists;
		sums.listCount += stats.numLists;

		// Heading stats
		const hs = stats.headingStats;
		sums.headings += hs.totalHeadings;
		sums.oneH1 += hs.oneH1 ? 1 : 0;
		sums.maxDepth += hs.maxDepth;
		sums.avgSubheadings += hs.avgSubheadings;
		sums.skippedLevels += hs.skippedLevels;
		sums.emptyHeadings += hs.emptyHeadings;
		sums.duplicateHeadings += hs.duplicateHeadings;

		for (const [tag, tagCount] of Object.entries(hs.headingCounts)) {
			sumHeadingCounts[tag] += tagCount;
		}

		// Schema stats - count pages containing each schema type
		for (const [schemaType, value] of Object.entries(stats.schemaStats)) {
			if (value === true) {
				schemaStats[schemaType] += 1;
			}
		}
	}

	// Helper to round to 1 decimal place
	const round1 = (n: number) => Math.round(n * 10) / 10;
	const avg = (key: string) => round1(sums[key] / count);

	// Compute weighted averages
	const avgParagraphLength = sums.paragraphCount > 0
		? round1(sums.paraLength / sums.paragraphCount)
		: 0;
	const avgListLength = sums.listCount > 0
		? round1(sums.listLength / sums.listCount)
		: 0;

	// Compute average heading counts
	const avgHeadingCounts: Record<string, number> = {};
	for (const [tag, sum] of Object.entries(sumHeadingCounts)) {
		avgHeadingCounts[tag] = round1(sum / count);
	}

	return {
		count,
		avgSchemas: avg('schemas'),
		schemaStats: { ...schemaStats },
		headingStats: {
			avgHeadings: avg('headings'),
			pctOneH1: round1((sums.oneH1 / count) * 100),
			avgMaxDepth: avg('maxDepth'),
			avgSubheadings: avg('avgSubheadings'),
			avgSkippedLevels: avg('skippedLevels'),
			avgEmptyHeadings: avg('emptyHeadings'),
			avgDuplicateHeadings: avg('duplicateHeadings'),
			avgHeadingCounts
		},
		avgParagraphs: avg('paragraphs'),
		avgParagraphLength,
		avgLists: avg('lists'),
		avgListLength,
		avgTables: avg('tables'),
		avgLinks: avg('links'),
		avgInternalLinks: avg('internalLinks'),
		avgExternalLinks: avg('externalLinks'),
		avgQuestions: avg('questions'),
		avgForms: avg('forms'),
		avgWords: avg('words'),
		avgChars: avg('chars')
	};
}

/**
 * Aggregates stats from StructuredAnalysis results for a single brand or all brands.
 */
export function aggregateBrandStats(
	analyses: Record<string, Array<StructuredAnalysis>>,
	brand?: string
): AggregatedStats {
	const statsList: Array<StructuredStats> = [];

	if (brand != null) {
		const brandAnalyses = analyses[brand];
		if (brandAnalyses != null) {
			for (const analysis of brandAnalyses) {
				statsList.push(analysis.stats);
			}
		}
	} else {
		for (const brandAnalyses of Object.values(analyses)) {
			for (const analysis of brandAnalyses) {
				statsList.push(analysis.stats);
			}
		}
	}

	return aggregateStats(statsList);
}