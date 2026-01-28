import { z } from '@zod/zod';

import { askOpenAISafe, type AIParams } from '../openai.ts';

import { type ScrapeResponse } from '../apis/hasdata/scrape.ts';
import { type TopicLabel, createLabelSchema } from '../topics.ts';
import { type StructuredAnalysis, type StructuredContent, type StructuredStats } from './analyse.ts';
import { flattenHeadingStructure } from './parseHtml.ts';
import { Defuddle } from 'npm:defuddle/node';
import TurndownService from 'npm:turndown';

const CONTEXT_TEMPLATE = `
The below 3 subsections contain information extracted from a web page, specifically:

    - statistics about the content (number of words, headings, links, images, etc.),
    - structured elements (JSON) from the page (headings, paragraphs, lists, tables, etc.),
    - a cleaned markdown version of the page content.

Use this information to answer questions about the content of the web page.

## Structured Web Page Content Statistics

{stats}

## Structured Web Page Content Elements

{elements}

## Web Page Content Markdown

{markdown}
`.trim();

/**
 * Configuration for which elements to include in the context.
 */
export interface ElementsOptions {
	includeHeadings?: boolean;
	/** Flatten heading tree to a simple list. Reduces tokens while preserving order. Default: false */
	flattenHeadings?: boolean;
	includeLists?: boolean;
	maxListItems?: number;
	includeTables?: boolean;
	tableHeadersOnly?: boolean;
	includeParagraphs?: boolean;
	maxParagraphs?: number;
	includeLinks?: boolean;
	maxLinks?: number;
	includeForms?: boolean;
	includeQuestions?: boolean;
	maxQuestions?: number;
	includeSchemas?: boolean;
	includeMeta?: boolean;
}

/**
 * Configuration for context generation.
 */
export interface ContextOptions {
	markdown: {
		useDefault: boolean;
		maxLength?: number;
	};
	elements?: ElementsOptions;
	includeStats?: boolean;
}

const DEFAULT_ELEMENTS_OPTIONS: Required<ElementsOptions> = {
	includeHeadings: true,
	flattenHeadings: false,
	includeLists: true,
	maxListItems: 5,
	includeTables: true,
	tableHeadersOnly: true,
	includeParagraphs: false,
	maxParagraphs: 3,
	includeLinks: false,
	maxLinks: 10,
	includeForms: false,
	includeQuestions: true,
	maxQuestions: 10,
	includeSchemas: true,
	includeMeta: true
};

/**
 * Filter structured content based on element options.
 */
function filterElements(
	content: StructuredContent,
	options: ElementsOptions
): Partial<StructuredContent> {
	const opts = { ...DEFAULT_ELEMENTS_OPTIONS, ...options };
	const filtered: Partial<StructuredContent> = {};

	if (opts.includeSchemas && content.schemas.length > 0) {
		filtered.schemas = content.schemas;
	}

	if (opts.includeMeta && Object.keys(content.meta).length > 0) {
		filtered.meta = content.meta;
	}

	if (opts.includeHeadings && content.headings.length > 0) {
		filtered.headings = opts.flattenHeadings
			? flattenHeadingStructure(content.headings) as StructuredContent['headings']
			: content.headings;
	}

	if (opts.includeParagraphs && content.paragraphs.length > 0) {
		filtered.paragraphs = opts.maxParagraphs > 0
			? content.paragraphs.slice(0, opts.maxParagraphs)
			: content.paragraphs;
	}

	if (opts.includeLists && content.lists.length > 0) {
		filtered.lists = content.lists.map(list => {
			if (opts.maxListItems > 0 && list.items.length > opts.maxListItems) {
				return {
					...list,
					items: list.items.slice(0, opts.maxListItems),
					_truncated: true,
					_totalItems: list.items.length
				};
			}
			return list;
		});
	}

	if (opts.includeTables && content.tables.length > 0) {
		if (opts.tableHeadersOnly) {
			filtered.tables = content.tables.map(table => ({
				table: table.table.length > 0 ? [table.table[0]] : [],
				contextHeading: table.contextHeading,
				_rowCount: Math.max(0, table.table.length - 1),
				_headerOnly: true
			})) as StructuredContent['tables'];
		} else {
			filtered.tables = content.tables;
		}
	}

	if (opts.includeLinks && content.links.length > 0) {
		filtered.links = opts.maxLinks > 0
			? content.links.slice(0, opts.maxLinks)
			: content.links;
	}

	if (opts.includeForms && content.forms.length > 0) {
		filtered.forms = content.forms;
	}

	if (opts.includeQuestions && content.questions.length > 0) {
		filtered.questions = opts.maxQuestions > 0
			? content.questions.slice(0, opts.maxQuestions)
			: content.questions;
	}

	return filtered;
}

/**
 * Create a slim stats object with only the most relevant metrics.
 */
function filterStats(stats: StructuredStats): Partial<StructuredStats> {
	return {
		numSchemas: stats.numSchemas,
		schemaStats: stats.schemaStats,
		headingStats: stats.headingStats,
		numParagraphs: stats.numParagraphs,
		numLists: stats.numLists,
		numTables: stats.numTables,
		numInternalLinks: stats.numInternalLinks,
		numExternalLinks: stats.numExternalLinks,
		numQuestions: stats.numQuestions,
		numForms: stats.numForms,
		numWords: stats.numWords
	};
}


/**
 * Convert a ScrapeResponse to cleaned markdown.
 */
async function responseToMd(
	response: ScrapeResponse,
	useDefault: boolean = false
): Promise<string> {
	if (useDefault) {
		return response.markdown || '';
	}

	const defuddled = await Defuddle(response.html);
	const turndownService = new TurndownService();
	const cleanMarkdown = turndownService.turndown(defuddled.content);
	return cleanMarkdown;
}

/**
 * Convert a ScrapeResponse and its StructuredAnalysis to a context string used as part of an LLM prompt.
 *
 * @param response - The scraped web page response
 * @param structuredAnalysis - The structured analysis of the page
 * @param options - Configuration options for context generation
 * @returns A formatted context string for LLM prompts
 */
export async function responseToContext(
	response: ScrapeResponse,
	structuredAnalysis: StructuredAnalysis,
	options: ContextOptions
): Promise<string> {
	let markdown = await responseToMd(response, options.markdown.useDefault);
	if (options.markdown.maxLength && markdown.length > options.markdown.maxLength) {
		markdown = markdown.slice(0, options.markdown.maxLength) + '\n\n...[truncated]';
	}

	const includeStats = options.includeStats ?? true;
	const statsSection = includeStats
		? JSON.stringify(filterStats(structuredAnalysis.stats), null, 2)
		: '(stats omitted)';

	const elementsOptions = options.elements ?? {};
	const filteredElements = filterElements(structuredAnalysis.content, elementsOptions);
	const elementsSection = JSON.stringify(filteredElements, null, 2);

	const context = CONTEXT_TEMPLATE
		.replace('{stats}', statsSection)
		.replace('{elements}', elementsSection)
		.replace('{markdown}', markdown || '');

	return context;
}

/**
 * Preset configuration for page classification tasks.
 * Optimized for minimal token usage while preserving classification signals.
 */
export const CLASSIFICATION_PRESET: ContextOptions = {
	markdown: {
		useDefault: false,
		maxLength: 4000
	},
	elements: {
		includeHeadings: true,
		flattenHeadings: true,
		includeLists: true,
		maxListItems: 3,
		includeTables: true,
		tableHeadersOnly: true,
		includeParagraphs: false,
		includeLinks: false,
		includeForms: false,
		includeQuestions: true,
		maxQuestions: 5,
		includeSchemas: true,
		includeMeta: true
	},
	includeStats: true
};

/**
 * Preset configuration for detailed SEO analysis.
 * Includes more content for comprehensive analysis.
 */
export const SEO_ANALYSIS_PRESET: ContextOptions = {
	markdown: {
		useDefault: false,
		maxLength: 8000
	},
	elements: {
		includeHeadings: true,
		includeLists: true,
		maxListItems: 10,
		includeTables: true,
		tableHeadersOnly: false,
		includeParagraphs: true,
		maxParagraphs: 5,
		includeLinks: true,
		maxLinks: 20,
		includeForms: true,
		includeQuestions: true,
		maxQuestions: 15,
		includeSchemas: true,
		includeMeta: true
	},
	includeStats: true
};




const PAGE_TAXONOMY = [
	{
		'topic': 'Content',
		'subtopics': ['Article', 'Blog Post', 'News', 'Guide', 'Thought Leadership']
	},
	{
		'topic': 'Instructional',
		'subtopics': ['How-to', 'Tutorial', 'Setup Guide', 'Recipe']
	},
	{
		'topic': 'List / Comparison',
		'subtopics': ['Listicle', 'Ranking', 'Best X', 'Comparison', 'Alternatives']
	},
	{
		'topic': 'Commercial',
		'subtopics': ['Product Page', 'Feature Page', 'Solution Page', 'Pricing Page', 'Service Page', 'Category Page']
	},
	{
		'topic': 'Interactive',
		'subtopics': ['Calculator', 'Quiz', 'Assessment', 'Configurator', 'Tool']
	},
	{
		'topic': 'Hub / Aggregator',
		'subtopics': ['Topic Hub', 'Resource Page', 'Documentation Index', 'Help Center']
	},
	{
		'topic': 'Community / UGC',
		'subtopics': ['Forum Thread', 'Q&A Page', 'Reviews', 'Comments']
	},
	{
		'topic': 'Corporate / Trust',
		'subtopics': ['About Page', 'Contact Page', 'Careers Page', 'Legal / Policy Page', 'Company Info']
	}
];

const LABEL_PROMPT = `
You are an expert SEO content analyst. Based on the provided web page context below, categorize the page
using the following two-level taxonomy:

{taxonomy}

# Web Page Context

{context}
`.trim();

export async function classifyPage(
	pageContext: string,
	model: string = 'gpt-5.1',
	modelParams: AIParams = { reasoning: { effort: 'none' } }
): Promise<TopicLabel | null> {

	if (pageContext == null || pageContext.trim() === '') {
		return null;
	}

	const prompt = LABEL_PROMPT
		.replace('{taxonomy}', JSON.stringify(PAGE_TAXONOMY, null, 2))
		.replace('{context}', pageContext);

	const taxonomy = Array.isArray(PAGE_TAXONOMY) ? { topics: PAGE_TAXONOMY } : PAGE_TAXONOMY;
	const labelSchema = createLabelSchema(taxonomy);
	const schema = labelSchema.safeExtend({
		summary: z.string().describe('A brief summary of the page\'s content.'),
		reasoning: z.string().describe('The model reasoning for the assigned labels.')
	});

	try {
		const { parsed, error } = await askOpenAISafe(prompt, model, schema, modelParams);
		if (error != null || parsed == null) {
			return null;
		}
		return parsed;
	} catch (error) {
		console.warn(`Failed to assign topic for text "${pageContext.substring(0, 50)}...":`, error);
		return null;
	}
}

const PAGE_PROMPT = `
You are an expert content analyst. Based on the provided web page context, answer the following question in detail:

- what is the main type of the article (e.g., blog post, news article, product page, informational page, listicle, etc.)?
- what is the main topic of the article? Just a short label here
- what are the subtopics covered in the article? Just a list of short labels here
- summarize the article in 3-5 sentences.

# Web Page Context
{context}
`;

const AISummarySchema = z.object({
	type: z.string().describe('The main type of the article (e.g., blog post, news article, product page, informational page, listicle, etc.)'),
	topic: z.string().describe('The main topic of the article as a short label'),
	subtopics: z.array(z.string()).describe('A list of short labels for the subtopics covered in the article'),
	summary: z.string().describe('A summary of the article in 3-5 sentences')
});

type AIPageSummary = z.infer<typeof AISummarySchema>;

export async function classifyPageFreestyle(
	context: string,
	model: string = 'gpt-4.1'
): Promise<AIPageSummary | null> {
	const prompt = PAGE_PROMPT.replace('{context}', context);
	const answer = await askOpenAISafe(prompt, model, AISummarySchema);
	return answer.parsed;
}