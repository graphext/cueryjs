/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
/**
 * LLM Scraper - Public API
 *
 * Selects between Brightdata and Oxylabs based on LLM_SCRAPER_PROVIDER env var.
 * Falls back to CHATGPT_SCRAPER_PROVIDER for backward compatibility.
 * Exposes ChatGPT and AIM variants while preserving the legacy GPT method names.
 * Default: oxylabs
 */

import type { ModelResult } from '../../../schemas/models.schema.ts';
import { type BatchOptions, createLLMScraper, type LLMScraper } from './scrape.ts';
import { createBrightdataProvider } from './brightdata.ts';
import { createOxylabsProvider } from './oxy.ts';

// Re-export types
export type { BatchOptions };
export type JobId = string | null;
export type ScraperTarget = 'chatgpt' | 'aim' | 'generic';

// ============================================================================
// Scraper Instance (lazy singleton)
// ============================================================================

const scrapers = new Map<ScraperTarget, LLMScraper>();

const CHATGPT_BRIGHTDATA_OPTIONS = {
	datasetId: 'gd_m7aof0k82r803d5bjm',
	extraFields: ['web_search_triggered', 'web_search_query'],
	extraInputs: ({ useSearch }: { useSearch: boolean }) => ({
		web_search: useSearch,
	}),
	targetUrl: 'http://chatgpt.com/',
};

const CHATGPT_OXYLABS_OPTIONS = {
	source: 'chatgpt',
};

const AIM_BRIGHTDATA_OPTIONS = {
	datasetId: 'gd_mcswdt6z2elth3zqr2',
	targetUrl: 'https://google.com/aimode',
};

const AIM_OXYLABS_OPTIONS = {
	source: 'google_ai_mode',
	inputKey: 'query' as const,
	render: 'html' as const,
	search: undefined,
};

function getProviderName(): string | undefined {
	return Deno.env.get('LLM_SCRAPER_PROVIDER')?.toLowerCase() ??
		Deno.env.get('CHATGPT_SCRAPER_PROVIDER')?.toLowerCase();
}

function getTargetOptions(target: ScraperTarget) {
	return target === 'aim'
		? {
			brightdata: AIM_BRIGHTDATA_OPTIONS,
			oxylabs: AIM_OXYLABS_OPTIONS,
		}
		: {
			brightdata: CHATGPT_BRIGHTDATA_OPTIONS,
			oxylabs: CHATGPT_OXYLABS_OPTIONS,
		};
}

function getLLMScraper(target: ScraperTarget = 'chatgpt'): LLMScraper {
	const existingScraper = scrapers.get(target);
	if (existingScraper) {
		return existingScraper;
	}

	const providerName = getProviderName();

	let provider;
	if (target === 'generic') {
		// Generic instance: only used for download/monitor, no target-specific config needed
		provider = providerName === 'brightdata'
			? createBrightdataProvider()
			: createOxylabsProvider();
	} else {
		const targetOptions = getTargetOptions(target);
		provider = providerName === 'brightdata'
			? createBrightdataProvider(targetOptions.brightdata)
			: createOxylabsProvider(targetOptions.oxylabs);
	}

	const scraper = createLLMScraper(provider);
	scrapers.set(target, scraper);
	return scraper;
}

// ============================================================================
// Public API
// ============================================================================

// Shared scraper metadata
export function getMaxConcurrency(target: ScraperTarget = 'chatgpt'): number {
	return getLLMScraper(target).maxConcurrency;
}

export function getMaxPromptsPerRequest(target: ScraperTarget = 'chatgpt'): number {
	return getLLMScraper(target).maxPromptsPerRequest;
}

// ChatGPT scraper methods
export async function scrapeGPTBatch(options: BatchOptions): Promise<Array<ModelResult>> {
	return getLLMScraper('chatgpt').scrapeLLMBatch(options);
}

export async function triggerGPTBatch(options: BatchOptions): Promise<Array<string | null>> {
	return getLLMScraper('chatgpt').triggerLLMBatch(options);
}

export async function downloadGPTSnapshots(jobIds: Array<string | null>): Promise<Array<ModelResult>> {
	return downloadSnapshots(jobIds);
}

// AIM scraper methods
export async function scrapeAIMBatch(options: BatchOptions): Promise<Array<ModelResult>> {
	return getLLMScraper('aim').scrapeLLMBatch(options);
}

export async function triggerAIMBatch(options: BatchOptions): Promise<Array<string | null>> {
	return getLLMScraper('aim').triggerLLMBatch(options);
}

export async function downloadAIMSnapshots(jobIds: Array<string | null>): Promise<Array<ModelResult>> {
	return downloadSnapshots(jobIds);
}

// Generic download — target-agnostic, works with any job IDs
export async function downloadSnapshots(jobIds: Array<string | null>): Promise<Array<ModelResult>> {
	return getLLMScraper('generic').downloadLLMSnapshots(jobIds);
}
