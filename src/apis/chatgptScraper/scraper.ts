/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
/**
 * GPT Scraper - Core types and orchestration logic.
 *
 * Uses composition: providers supply functions, this module orchestrates them.
 */

import { mapParallel } from '../../helpers/async.ts';

import type { ModelResult } from '../../schemas/models.schema.ts';
import type { Source, SearchSource } from '../../schemas/sources.schema.ts';
import { extractDomain } from '../../helpers/urls.ts';

// ============================================================================
// Types
// ============================================================================

export interface BatchOptions {
	prompts: Array<string>;
	useSearch?: boolean;
	countryISOCode?: string | null;
}

export interface ProviderFunctions {
	name: string;
	maxConcurrency: number;
	maxPromptsPerRequest: number;
	triggerJob: (prompt: string, useSearch: boolean, countryISOCode: string | null) => Promise<string | null>;
	monitorJob: (jobId: string) => Promise<boolean>;
	downloadJob: (jobId: string) => Promise<unknown>;
	transformResponse: (raw: unknown) => ModelResult | null;
}

export interface GPTScraper {
	maxConcurrency: number;
	maxPromptsPerRequest: number;
	scrapeGPTBatch: (options: BatchOptions) => Promise<Array<ModelResult>>;
	triggerGPTBatch: (options: BatchOptions) => Promise<Array<string | null>>;
	downloadGPTSnapshots: (jobIds: Array<string | null>) => Promise<Array<ModelResult>>;
}

// ============================================================================
// Shared Utilities
// ============================================================================

export function getAbortSignal(): AbortSignal | undefined {
	return (globalThis as Record<string, unknown>).abortSignal as AbortSignal | undefined;
}

export function cleanAnswer(answer: string): string {
	return answer
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
		.replace(/\n\s*Image\s*\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export function buildSources(
	citations: Array<{ url: string; title?: string; description?: string; text?: string; cited?: boolean }>,
	linkPositions?: Record<string, Array<number>>
): Array<Source> {
	return citations.map(c => ({
		title: c.title || c.description || c.text || '',
		url: c.url,
		domain: extractDomain(c.url),
		cited: c.cited,
		positions: linkPositions?.[c.url]
	}));
}

export function buildSearchSources(
	sources: Array<{ url?: string; title?: string; snippet?: string; rank?: number; date_published?: string }>
): Array<SearchSource> {
	return sources.map(s => ({
		title: s.title || s.snippet || '',
		url: s.url || '',
		domain: s.url ? extractDomain(s.url) : '',
		rank: s.rank || 0,
		datePublished: s.date_published || null
	}));
}

/**
 * Creates an empty model result for failed jobs.
 * This ensures we always return the same number of rows as input.
 */
export function emptyModelResult(providerName: string, errorMessage?: string, context?: unknown): ModelResult {
	if (errorMessage) {
		console.error(`[${providerName}] ${errorMessage}`, context ?? '');
	}
	return {
		prompt: '',
		answer: '',
		sources: []
	};
}

// ============================================================================
// Scraper Factory
// ============================================================================

export function createScraper(provider: ProviderFunctions): GPTScraper {
	const {
		name,
		maxConcurrency,
		maxPromptsPerRequest,
		triggerJob,
		monitorJob,
		downloadJob,
		transformResponse
	} = provider;

	async function triggerGPTBatch({
		prompts,
		useSearch = false,
		countryISOCode = null
	}: BatchOptions): Promise<Array<string | null>> {
		const jobIds = await mapParallel(
			prompts,
			maxConcurrency,
			(prompt) => triggerJob(prompt, useSearch, countryISOCode)
		);

		console.log(`[${name}] Triggered ${jobIds.length} jobs for ${prompts.length} prompts`);
		return jobIds;
	}

	async function downloadGPTSnapshots(jobIds: Array<string | null>): Promise<Array<ModelResult>> {
		const results: Array<ModelResult> = [];

		for (const jobId of jobIds) {
			if (!jobId) {
				results.push(emptyModelResult(name, 'No job ID provided'));
				continue;
			}

			const isReady = await monitorJob(jobId);
			if (!isReady) {
				results.push(emptyModelResult(name, 'Job not ready or failed', jobId));
				continue;
			}

			const raw = await downloadJob(jobId);
			if (!raw) {
				results.push(emptyModelResult(name, 'Failed to download job', jobId));
				continue;
			}

			const result = transformResponse(raw);
			results.push(result ?? emptyModelResult(name, 'Failed to transform response', jobId));
		}

		return results;
	}

	async function scrapeGPTBatch(options: BatchOptions): Promise<Array<ModelResult>> {
		const jobIds = await triggerGPTBatch(options);
		return downloadGPTSnapshots(jobIds);
	}

	return {
		maxConcurrency,
		maxPromptsPerRequest,
		scrapeGPTBatch,
		triggerGPTBatch,
		downloadGPTSnapshots
	};
}
