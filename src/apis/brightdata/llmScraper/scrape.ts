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
	signal?: AbortSignal;
}

export interface LLMTriggerFailure {
	provider: string;
	kind: 'trigger_rejected' | 'trigger_uncertain';
	status?: number;
	providerCode?: string;
}

export type LLMTriggerOutcome = { jobId: string; failure: null } | { jobId: null; failure: LLMTriggerFailure };

export type LLMTriggerInputOutcome = LLMTriggerOutcome & { inputIndex: number; inputCount: number };

export interface ProviderFunctions {
	name: string;
	strictSnapshots?: boolean;
	maxConcurrency: number;
	maxPromptsPerRequest: number;
	triggerJob: (prompt: string, useSearch: boolean, countryISOCode: string | null) => Promise<string | null>;
	triggerJobOutcome?: (
		prompt: string,
		useSearch: boolean,
		countryISOCode: string | null,
		signal?: AbortSignal,
	) => Promise<LLMTriggerOutcome>;
	triggerBatchOutcome?: (
		prompts: Array<string>,
		useSearch: boolean,
		countryISOCode: string | null,
		signal?: AbortSignal,
	) => Promise<LLMTriggerOutcome>;
	monitorJob: (jobId: string, signal?: AbortSignal) => Promise<boolean>;
	downloadJob: (jobId: string, signal?: AbortSignal) => Promise<unknown>;
	transformResponse: (raw: unknown) => ModelResult | null;
	transformBatchResponse?: (raw: unknown, inputCount: number) => Array<ModelResult | LLMSnapshotError>;
}

export interface LLMScraper {
	maxConcurrency: number;
	maxPromptsPerRequest: number;
	scrapeLLMBatch: (options: BatchOptions) => Promise<Array<ModelResult>>;
	triggerLLMBatch: (options: BatchOptions) => Promise<Array<string | null>>;
	triggerLLMBatchOutcomes: (options: BatchOptions) => Promise<Array<LLMTriggerInputOutcome>>;
	downloadSnapshotOutcomes: (
		jobId: string,
		inputCount: number,
		signal?: AbortSignal,
	) => Promise<Array<ModelResult | LLMSnapshotError>>;
	downloadLLMSnapshots: (jobIds: Array<string | null>) => Promise<Array<ModelResult>>;
}

export type LLMSnapshotErrorKind = 'missing_job' | 'not_ready' | 'download' | 'malformed' | 'snapshot_error';

export class LLMSnapshotError extends Error {
	constructor(
		readonly provider: string,
		readonly kind: LLMSnapshotErrorKind,
		readonly jobId?: string,
		readonly providerCode?: string,
	) {
		super(`${provider} snapshot ${kind}${jobId ? ` (${jobId})` : ''}${providerCode ? ` [${providerCode}]` : ''}`);
		this.name = 'LLMSnapshotError';
	}
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

		const source = upsertSource(link.url, '', true);

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
		strictSnapshots = false,
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
			getAbortSignal()?.throwIfAborted();
			if (!jobId) {
				if (strictSnapshots) throw new LLMSnapshotError(name, 'missing_job');
				results.push(emptyModelResult(name, 'No job ID provided'));
				continue;
			}

			const isReady = await monitorJob(jobId);
			getAbortSignal()?.throwIfAborted();
			if (!isReady) {
				if (strictSnapshots) throw new LLMSnapshotError(name, 'not_ready', jobId);
				results.push(emptyModelResult(name, 'Job not ready or failed', jobId));
				continue;
			}

			const raw = await downloadJob(jobId);
			getAbortSignal()?.throwIfAborted();
			if (!raw) {
				if (strictSnapshots) throw new LLMSnapshotError(name, 'download', jobId);
				results.push(emptyModelResult(name, 'Failed to download job', jobId));
				continue;
			}

			try {
				const result = transformResponse(raw);
				getAbortSignal()?.throwIfAborted();
				if (result == null) {
					if (strictSnapshots) throw new LLMSnapshotError(name, 'malformed', jobId);
					results.push(emptyModelResult(name, 'Failed to transform response', jobId));
					continue;
				}
				results.push(result);
			} catch (error) {
				if (error instanceof LLMSnapshotError && error.jobId == null) {
					throw new LLMSnapshotError(error.provider, error.kind, jobId, error.providerCode);
				}
				throw error;
			}
		}

		return results;
	}

	async function triggerLLMBatchOutcomes(
		{ prompts, useSearch = false, countryISOCode = null, signal = getAbortSignal() }: BatchOptions,
	): Promise<Array<LLMTriggerInputOutcome>> {
		const trigger = provider.triggerJobOutcome;
		const triggerBatch = provider.triggerBatchOutcome;
		if (trigger == null && triggerBatch == null) {
			throw new Error(`${name} does not support explicit trigger outcomes`);
		}
		const batchSize = triggerBatch == null ? 1 : maxPromptsPerRequest;
		if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('Invalid scraper batch size');
		const batches: Array<Array<string>> = [];
		for (let index = 0; index < prompts.length; index += batchSize) {
			batches.push(prompts.slice(index, index + batchSize));
		}
		const outcomes = await mapParallel(batches, maxConcurrency, async (batch) => {
			signal?.throwIfAborted();
			const outcome = triggerBatch != null
				? await triggerBatch(batch, useSearch, countryISOCode, signal)
				: await trigger!(batch[0], useSearch, countryISOCode, signal);
			signal?.throwIfAborted();
			return batch.map((_, inputIndex) => ({ ...outcome, inputIndex, inputCount: batch.length }));
		});
		return outcomes.flat();
	}

	async function downloadSnapshotOutcomes(
		jobId: string,
		inputCount: number,
		signal = getAbortSignal(),
	): Promise<Array<ModelResult | LLMSnapshotError>> {
		if (!Number.isInteger(inputCount) || inputCount < 1 || inputCount > maxPromptsPerRequest) {
			throw new Error('Invalid scraper input count');
		}
		signal?.throwIfAborted();
		if (!jobId) throw new LLMSnapshotError(name, 'missing_job');
		const ready = await monitorJob(jobId, signal);
		signal?.throwIfAborted();
		if (!ready) throw new LLMSnapshotError(name, 'not_ready', jobId);
		const raw = await downloadJob(jobId, signal);
		signal?.throwIfAborted();
		if (raw == null) throw new LLMSnapshotError(name, 'download', jobId);
		let outcomes: Array<ModelResult | LLMSnapshotError>;
		try {
			if (provider.transformBatchResponse != null) {
				outcomes = provider.transformBatchResponse(raw, inputCount);
			} else {
				if (inputCount !== 1) throw new LLMSnapshotError(name, 'malformed', jobId);
				outcomes = [transformResponse(raw) ?? new LLMSnapshotError(name, 'malformed', jobId)];
			}
		} catch (error) {
			if (!(error instanceof LLMSnapshotError)) throw error;
			outcomes = Array.from({ length: inputCount }, () => error);
		}
		signal?.throwIfAborted();
		if (outcomes.length !== inputCount) throw new LLMSnapshotError(name, 'malformed', jobId);
		return outcomes.map((outcome) =>
			outcome instanceof LLMSnapshotError && outcome.jobId == null
				? new LLMSnapshotError(outcome.provider, outcome.kind, jobId, outcome.providerCode)
				: outcome
		);
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
		triggerLLMBatchOutcomes,
		downloadSnapshotOutcomes,
		downloadLLMSnapshots,
	};
}
