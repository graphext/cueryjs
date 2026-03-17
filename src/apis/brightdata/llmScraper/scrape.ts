/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
/**
 * LLM Scraper - Core types and orchestration logic.
 *
 * Uses composition: providers supply functions, this module orchestrates them.
 */

import { mapParallel } from '../../../helpers/async.ts';

import type { ModelResult } from '../../../schemas/models.schema.ts';
import type { Source } from '../../../schemas/sources.schema.ts';
import { extractDomain } from '../../../helpers/urls.ts';

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

export interface LLMScraper {
	maxConcurrency: number;
	maxPromptsPerRequest: number;
	scrapeLLMBatch: (options: BatchOptions) => Promise<Array<ModelResult>>;
	triggerLLMBatch: (options: BatchOptions) => Promise<Array<string | null>>;
	downloadLLMSnapshots: (jobIds: Array<string | null>) => Promise<Array<ModelResult>>;
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

/**
 * Derive a merge key from a URL: origin + pathname, stripping query and fragment.
 * Falls back to the raw URL if parsing fails.
 */
function urlMergeKey(url: string): string {
	try {
		const parsed = new URL(url);
		return parsed.origin + parsed.pathname;
	} catch {
		return url;
	}
}

/**
 * Returns true when `candidate` carries extra info (hash or search params)
 * that `current` does not.
 */
function hasExtraUrlInfo(current: string, candidate: string): boolean {
	try {
		const cur = new URL(current);
		const cand = new URL(candidate);
		const hasNewHash = cand.hash !== '' && cur.hash === '';
		const hasNewParams = cand.search !== '' && cur.search === '';
		return hasNewHash || hasNewParams;
	} catch {
		return false;
	}
}

export function parseSources(
	citations: Array<{ url: string; title?: string; description?: string; cited?: boolean }>,
	linksAttached: Array<{ url?: string; text?: string; position?: number }> = [],
): Array<Source> {
	const sources: Array<Source> = [];
	const sourcesByKey = new Map<string, Source>();

	const upsertSource = (url: string, initialTitle: string, cited: boolean): Source => {
		const key = urlMergeKey(url);
		const existing = sourcesByKey.get(key);
		if (existing) {
			if (!existing.title && initialTitle) {
				existing.title = initialTitle;
			}
			existing.cited = existing.cited || cited;
			// Keep the most informative URL (with fragment/params)
			if (hasExtraUrlInfo(existing.url, url)) {
				existing.url = url;
			}
			return existing;
		}

		const source: Source = {
			title: initialTitle,
			url,
			domain: extractDomain(url),
			cited,
		};

		sources.push(source);
		sourcesByKey.set(key, source);
		return source;
	};

	const sortedLinks = [...linksAttached].sort((a, b) => {
		const aPos = a.position ?? Number.MAX_SAFE_INTEGER;
		const bPos = b.position ?? Number.MAX_SAFE_INTEGER;
		return aPos - bPos;
	});

	for (const link of sortedLinks) {
		if (!link.url) continue;

		const source = upsertSource(link.url, link.text ?? '', true);

		if (link.position != null) {
			source.positions ??= [];
			if (!source.positions.includes(link.position)) {
				source.positions.push(link.position);
			}
		}
	}

	for (const citation of citations) {
		if (!citation.url) continue;

		const key = urlMergeKey(citation.url);
		const existing = sourcesByKey.get(key);
		const title = citation.title ?? '';
		const snippet = citation.description;

		if (existing) {
			if (title) {
				existing.title = title;
			}
			if (snippet) {
				existing.snippet = snippet;
			}
			existing.cited = existing.cited || citation.cited;
			// Append extra fragment/params from citation
			if (hasExtraUrlInfo(existing.url, citation.url)) {
				existing.url = citation.url;
			}
			continue;
		}

		const source: Source = {
			title,
			snippet,
			url: citation.url,
			domain: extractDomain(citation.url),
			cited: citation.cited,
		};
		sources.push(source);
		sourcesByKey.set(key, source);
	}

	for (const source of sources) {
		source.positions?.sort((a, b) => a - b);
	}

	return sources;
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
		answerMarkdown: '',
		sources: [],
	};
}

// ============================================================================
// Scraper Factory
// ============================================================================

export function createLLMScraper(provider: ProviderFunctions): LLMScraper {
	const {
		name,
		maxConcurrency,
		maxPromptsPerRequest,
		triggerJob,
		monitorJob,
		downloadJob,
		transformResponse,
	} = provider;

	async function triggerLLMBatch({
		prompts,
		useSearch = false,
		countryISOCode = null,
	}: BatchOptions): Promise<Array<string | null>> {
		const jobIds = await mapParallel(
			prompts,
			maxConcurrency,
			(prompt) => triggerJob(prompt, useSearch, countryISOCode),
		);

		console.log(`[${name}] Triggered ${jobIds.length} jobs for ${prompts.length} prompts`);
		return jobIds;
	}

	async function downloadLLMSnapshots(jobIds: Array<string | null>): Promise<Array<ModelResult>> {
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

	async function scrapeLLMBatch(options: BatchOptions): Promise<Array<ModelResult>> {
		const jobIds = await triggerLLMBatch(options);
		return downloadLLMSnapshots(jobIds);
	}

	return {
		maxConcurrency,
		maxPromptsPerRequest,
		scrapeLLMBatch,
		triggerLLMBatch,
		downloadLLMSnapshots,
	};
}
