/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
import { mapParallel } from '../../async.ts';

import {
	fetchHasDataWithRetry,
	HASDATA_CONCURRENCY,
	parseAIO,
	type AIOParsed,
	type AIOverview
} from './helpers.ts';

function aioRequestUrl(aio: AIOverview): string | null {
	if (aio.pageToken && aio.hasdataLink) {
		return aio.hasdataLink;
	}
	return null;
}

export async function fetchAIO(
	prompt: string,
	country: string | null = null,
	language: string | null = null
): Promise<AIOParsed> {
	const serpEndpoint = 'https://api.hasdata.com/scrape/google/serp';

	const params: Record<string, string> = { q: prompt };
	if (country) {
		params.gl = country.toLowerCase();
	}
	if (language) {
		params.hl = language.toLowerCase();
	}

	const url = new URL(serpEndpoint);
	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, value);
	}

	try {
		let response = await fetchHasDataWithRetry(url.toString());
		let content = await response.json();
		let aio: AIOverview = content.aiOverview || {};
		const aioUrlString = aioRequestUrl(aio);
		if (aioUrlString) {
			response = await fetchHasDataWithRetry(aioUrlString);
			content = await response.json();
			aio = content.aiOverview || {};
		}

		return parseAIO(aio);
	}
	catch (error) {
		console.error('HasData API error:', error);
		return { answer: '', sources: [] };
	}
}

export async function fetchAIOBatch(
	prompts: Array<string>,
	country: string | null = null,
	language: string | null = null,
	maxConcurrency: number = HASDATA_CONCURRENCY
): Promise<Array<AIOParsed>> {
	return mapParallel(
		prompts,
		maxConcurrency,
		async (prompt) => fetchAIO(prompt, country, language)
	);
}
