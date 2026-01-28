/**
 * Scrapes Google Autocomplete suggestions for a given keyword.
 * APIs:
 *  - https://serpapi.com/blog/serpapis-google-autocomplete-api/
 *  - https://dataforseo.com/pricing/serp/google-autocomplete-serp-api
 *  - https://keywordtool.io/api
 *
 * Manual:
 *  - https://stackoverflow.com/questions/5102878/where-is-the-documentation-for-the-google-suggest-api
 *  - https://www.fullstackoptimization.com/a/google-autocomplete-google-suggest-unofficial-full-specification
 *  - E.g:
 *    - http://suggestqueries.google.com/complete/search?output=toolbar&q=coches+electricos
 *    - http://suggestqueries.google.com/complete/search?output=toolbar&hl=en&q=best+electric+cars
 *
*/
import { withRetries, type RetryConfig, DEFAULTS as RETRY_CONFIG } from './retry.ts';
import { sleep } from './sleep.ts';

interface AutocompleteOptions {
	query: string;
	language?: string;
	countryCode?: string;
	retryConfig?: RetryConfig;
}

/**
 * Fetches Google Autocomplete suggestions using the unofficial API.
 * Uses exponential backoff retry logic with default or provided config.
 */
export async function autocomplete({
	query,
	language,
	countryCode,
	retryConfig = RETRY_CONFIG
}: AutocompleteOptions): Promise<Array<string>> {

	const baseUrl = 'https://suggestqueries.google.com/complete/search';
	const params = new URLSearchParams({
		client: 'chrome',
		q: query.trim()
	});

	if (language) {
		params.append('hl', language);
	}

	if (countryCode) {
		params.append('gl', countryCode);
	}

	const url = `${baseUrl}?${params.toString()}`;

	try {
		const response = await withRetries(
			async () => fetch(url, {
				method: 'GET',
				headers: {
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
				},
				signal: (globalThis as Record<string, unknown>).abortSignal as AbortSignal | undefined
			}),
			retryConfig
		);

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const data = await response.json() as [string, Array<string>, ...unknown[]];
		if (!Array.isArray(data) || data.length < 2) {
			throw new Error('Unexpected response format from Google Autocomplete API');
		}

		const suggestions = data[1];
		if (!Array.isArray(suggestions)) {
			throw new Error('Suggestions array not found in response');
		}

		return suggestions;
	} catch (error) {
		if (error instanceof Error) {
			throw new Error(`Failed to fetch Google Autocomplete suggestions: ${error.message}`);
		}
		throw error;
	}
}

interface RecurseAutocompleteOptions {
	query: string;
	language?: string;
	countryCode?: string;
	retryConfig?: RetryConfig;
	delayBetweenCalls?: number; // in milliseconds
	maxDepth?: number;
}

interface AutocompleteRecord {
	sourceQuery: string;
	suggestion: string;
	depth: number;
}

/**
 * Recursively fetches Google Autocomplete suggestions.
 */
export async function recurseAutocomplete({
	query,
	language,
	countryCode,
	retryConfig,
	delayBetweenCalls = 3000,
	maxDepth = 1
}: RecurseAutocompleteOptions): Promise<Array<AutocompleteRecord>> {

	const results: Array<AutocompleteRecord> = [];
	const processedQueries = new Set<string>();

	const abortSignal = (globalThis as Record<string, unknown>).abortSignal as AbortSignal | undefined;
	if (abortSignal?.aborted) {
		throw new Error('Operation aborted');
	}

	async function fetchRecursive(
		currentQuery: string,
		currentDepth: number
	): Promise<void> {
		const normalizedQuery = currentQuery.trim().toLowerCase();

		if (processedQueries.has(normalizedQuery)) {
			return;
		}

		if (currentDepth >= maxDepth) {
			return;
		}

		processedQueries.add(normalizedQuery);

		try {
			const suggestions = await autocomplete({
				query: currentQuery,
				language,
				countryCode,
				retryConfig
			});

			for (const suggestion of suggestions) {
				results.push({
					sourceQuery: currentQuery,
					suggestion,
					depth: currentDepth
				});
			}

			for (let i = 0; i < suggestions.length; i++) {
				const suggestion = suggestions[i];
				const nextDepth = currentDepth + 1;

				if (nextDepth < maxDepth) {
					if (i > 0) {
						await sleep(delayBetweenCalls, abortSignal);
					}
					await fetchRecursive(suggestion, nextDepth);
				}
			}
		} catch {
			// Silently skip failed queries to allow the recursion to continue
		}
	}

	await fetchRecursive(query, 0);

	return results;
}
