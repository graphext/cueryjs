/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
import { mapParallel } from '../../helpers/async.ts';

import { type AIOParsed, HASDATA_CONCURRENCY } from './helpers.ts';
import { fetchSerp } from './serp.ts';

export async function fetchAIO(
	prompt: string,
	country: string | null = null,
	language: string | null = null,
): Promise<AIOParsed> {
	try {
		const serp = await fetchSerp(prompt, {
			country: country || undefined,
			language: language || undefined,
		});
		return serp.aiOverview || { answer: '', sources: [] };
	} catch (error) {
		console.error('HasData API error:', error);
		return { answer: '', sources: [] };
	}
}

export async function fetchAIOBatch(
	prompts: Array<string>,
	country: string | null = null,
	language: string | null = null,
	maxConcurrency: number = HASDATA_CONCURRENCY,
): Promise<Array<AIOParsed>> {
	return mapParallel(
		prompts,
		maxConcurrency,
		async (prompt) => fetchAIO(prompt, country, language),
	);
}
