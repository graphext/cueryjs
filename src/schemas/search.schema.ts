import type { z } from '@zod/zod';

import type { Source, SearchSource } from './sources.schema.ts';
export type ContextSize = 'low' | 'medium' | 'high';
export type ReasoningEffort = 'low' | 'medium' | 'high';


export interface SearchResult {
	answer: string;
	sources: Array<Source>;
	searchQueries?: Array<string>;
	searchSources?: Array<SearchSource>;
}

export type SearchOptions = {
	prompt: string,
	model?: string,
	useSearch?: boolean,
	/** To refine search results based on geography, you can specify an approximate user location
	 * using countryISOCode. The country field is a two-letter ISO country code, like US. */
	countryISOCode?: string | null,
	contextSize?: ContextSize,
	reasoningEffort?: ReasoningEffort,
	searchTool?: 'web_search' | 'web_search_preview'
};

export type FormattedSearchOptions<T> = SearchOptions & {
	responseSchema: z.ZodType<T>;
};

export type BatchSearchOptions = Omit<SearchOptions, 'prompt'> & {
	prompts: Array<string>,
	maxConcurrency?: number
}