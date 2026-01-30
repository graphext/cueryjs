/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
import { mapParallel } from '../../helpers/async.ts';

import type {
	AIOParsed
} from './helpers.ts';
import {
	fetchHasDataWithRetry,
	HASDATA_CONCURRENCY,
	parseAIM
} from './helpers.ts';

export async function fetchAIM(
	prompt: string,
	country: string | null = null,
	language: string | null = null,
	location: string | null = null
): Promise<AIOParsed> {
	const aimEndpoint = 'https://api.hasdata.com/scrape/google/ai-mode';

	const params: Record<string, string> = { q: prompt };
	if (location) {
		params.location = location;
	}
	if (country) {
		params.gl = country.toLowerCase();
	}
	if (language) {
		params.hl = language.toLowerCase();
	}

	const url = new URL(aimEndpoint);
	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, value);
	}

	try {
		const response = await fetchHasDataWithRetry(url.toString());
		const content = await response.json();
		return parseAIM(content);
	}
	catch (error) {
		console.error('HasData AI Mode API error:', error);
		return { answer: '', sources: [] };
	}
}

export async function fetchAIMBatch(
	prompts: Array<string>,
	country: string | null = null,
	language: string | null = null,
	location: string | null = null,
	maxConcurrency: number = HASDATA_CONCURRENCY
): Promise<Array<AIOParsed>> {
	return mapParallel(
		prompts,
		maxConcurrency,
		async (prompt) => fetchAIM(prompt, country, language, location)
	);
}
