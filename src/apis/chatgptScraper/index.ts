/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
/**
 * GPT Scraper - Public API
 *
 * Selects between Brightdata and Oxylabs based on CHATGPT_SCRAPER_PROVIDER env var.
 * Default: oxylabs
 */

import type { ModelResult } from '../../schemas/models.schema.ts';
import { type BatchOptions, type GPTScraper, createScraper } from './scraper.ts';
import { brightdataProvider } from './brightdata.ts';
import { oxylabsProvider } from './oxy.ts';

// Re-export types
export type { BatchOptions };
export type JobId = string | null;

// ============================================================================
// Scraper Instance (lazy singleton)
// ============================================================================

let scraper: GPTScraper | null = null;

function getScraper(): GPTScraper {
	if (!scraper) {
		const providerName = Deno.env.get('CHATGPT_SCRAPER_PROVIDER')?.toLowerCase();
		const provider = providerName === 'brightdata' ? brightdataProvider : oxylabsProvider;
		scraper = createScraper(provider);
	}
	return scraper;
}

// ============================================================================
// Public API
// ============================================================================

export function getMaxConcurrency(): number {
	return getScraper().maxConcurrency;
}

export function getMaxPromptsPerRequest(): number {
	return getScraper().maxPromptsPerRequest;
}

export async function scrapeGPTBatch(options: BatchOptions): Promise<Array<ModelResult>> {
	return getScraper().scrapeGPTBatch(options);
}

export async function triggerGPTBatch(options: BatchOptions): Promise<Array<string | null>> {
	return getScraper().triggerGPTBatch(options);
}

export async function downloadGPTSnapshots(jobIds: Array<string | null>): Promise<Array<ModelResult>> {
	return getScraper().downloadGPTSnapshots(jobIds);
}
