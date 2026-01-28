import { mapParallel } from '../async.ts';
import { askOpenAISafe, type AIParams, type AIOutput } from '../openai.ts';

import type { BatchSearchOptions, FormattedSearchOptions, SearchOptions, SearchResult } from '../schemas/search.schema.ts';
import type { Source } from '../schemas/sources.schema.ts';
import { extractDomain } from '../urls.ts';
import { dedent } from '../utils.ts';

export type { SearchResult } from '../schemas/search.schema.ts';

/**
 * Call OpenAI Responses API with Web Search enabled (async).
 *
 * API Docs:
 * - https://platform.openai.com/docs/guides/tools-web-search?api-mode=responses
 */
export async function searchOpenAI({
	prompt,
	model = 'gpt-4.1-mini',
	useSearch = true,
	countryISOCode = null,
	contextSize = 'low',
	reasoningEffort = 'low',
	searchTool = 'web_search'
}: SearchOptions): Promise<SearchResult> {
	const params: AIParams = {};

	if (model.includes('-5')) {
		params.reasoning = { effort: reasoningEffort };
	}

	if (useSearch) {
		params.tools = [{
			type: searchTool,
			search_context_size: contextSize,
			...(countryISOCode ? { user_location: { type: 'approximate', country: countryISOCode } } : {})
		}];
		params.tool_choice = 'required';
	}

	const { output } = await askOpenAISafe(prompt, model, undefined, params);
	if (!output) {
		throw new Error('No output from OpenAI');
	}
	return validateOpenAI(output);
}

/**
 * Convert a raw web search response into a SearchResult instance.
 */
function validateOpenAI(response: AIOutput): SearchResult {
	let answer = '';
	let sources: Array<Source> = [];

	// Filter out reasoning elements and find relevant elements
	const relevantElements = response.filter(item => item.type !== 'reasoning');
	const messageElement = relevantElements.find(item => item.type === 'message');
	const hasWebSearch = relevantElements.some(item => item.type === 'web_search_call');

	if (!messageElement) {
		throw new Error('No message element found in response');
	}

	if (messageElement.type !== 'message') {
		throw new Error('Message element must be of type "message"');
	}

	const content = messageElement.content?.[0];
	if (!content) {
		throw new Error('Message element has no content');
	}

	if (content.type !== 'output_text') {
		throw new Error(`Content must be of type "output_text", got "${content.type}"`);
	}

	answer = content.text;

	// Extract sources from annotations if web search was used
	if (hasWebSearch && content.annotations) {
		sources = content.annotations
			.filter(ann => ann.type === 'url_citation')
			.map(ann => ({
				title: ann.title,
				url: ann.url,
				domain: extractDomain(ann.url)
			}));
	}

	return {
		answer,
		sources
	};
}

const FORMATTED_SEARCH_PROMPT = dedent(`
Based on the following search results, please format the information according
to the requested structure:

# Search Query

{prompt}

# Search Results

{answer}

# Sources

{sources}

Please extract and format the relevant information from these search results as a JSON object.
`);

/**
 * Perform a web search using searchOpenAI and return structured response.
 * The OpenAI API doesn't currently allow both web search tool and response format in the same call.
 *
 * This function:
 * 1. Performs a web search using searchOpenAI
 * 2. Formats the search results using a template
 * 3. Sends the formatted results to OpenAI with a Zod schema to extract structured information
 */
export async function searchWithFormat<T>({
	prompt,
	model,
	responseSchema,
	useSearch = true,
	countryISOCode = null,
	contextSize = 'medium',
	reasoningEffort = 'low'
}: FormattedSearchOptions<T>): Promise<T> {

	const searchResult = await searchOpenAI({
		prompt,
		model,
		useSearch,
		countryISOCode,
		contextSize,
		reasoningEffort
	});

	const sources = searchResult.sources
		.map((source: { title: string; url: string }) => `- ${source.title}: ${source.url}`)
		.join('\n');

	const formattedPrompt = FORMATTED_SEARCH_PROMPT
		.replace('{prompt}', prompt)
		.replace('{answer}', searchResult.answer)
		.replace('{sources}', sources);

	const { parsed } = await askOpenAISafe(formattedPrompt, 'gpt-4.1-mini', responseSchema);
	if (!parsed) {
		throw new Error('Failed to parse structured response from OpenAI');
	}

	return parsed;
}

/**
 * Performs web search for multiple prompts concurrently while preserving order.
 */
export function searchBatch({
	prompts,
	model = 'gpt-4.1-mini',
	useSearch = true,
	countryISOCode = null,
	contextSize = 'medium',
	reasoningEffort = 'low',
	maxConcurrency = 100
}: BatchSearchOptions): Promise<Array<SearchResult>> {
	return mapParallel(
		prompts,
		maxConcurrency,
		prompt => searchOpenAI({
			prompt,
			model,
			useSearch,
			countryISOCode: countryISOCode,
			contextSize: contextSize,
			reasoningEffort: reasoningEffort
		})
	);
}
