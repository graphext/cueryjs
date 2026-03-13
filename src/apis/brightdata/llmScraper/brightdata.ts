/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
/**
 * Brightdata LLM Scraper Provider.
 *
 * API Flow:
 * 1. Trigger: POST to /datasets/v3/trigger → returns snapshot_id
 * 2. Monitor: GET /datasets/v3/progress/{snapshot_id} until ready
 * 3. Download: GET /datasets/v3/snapshot/{snapshot_id}
 */

import { type RetryConfig, sleep, withRetries } from '../../../helpers/async.ts';
import type { ModelResult } from '../../../schemas/models.schema.ts';
import { buildSources, cleanAnswer, getAbortSignal, type ProviderFunctions } from './scrape.ts';

// ============================================================================
// Types
// ============================================================================

interface BrightdataLLMResponse {
	prompt: string;
	answer_text?: string;
	answer_text_markdown?: string;
	links_attached?: Array<{
		url?: string;
		text?: string;
		position?: number;
	}>;
	citations?: Array<{
		url: string;
		title?: string;
		description?: string;
		cited?: boolean;
	}>;
	web_search_query?: Array<string>;
}

// ============================================================================
// Constants
// ============================================================================

interface BrightdataProviderConfig {
	apiBase: string;
	datasetId: string;
	outputFields: Array<string>;
	extraFields?: Array<string>;
	targetUrl: string;
	extraInputs?: (
		params: { prompt: string; useSearch: boolean; countryISOCode: string | null },
	) => Record<string, unknown>;
	providerName: string;
	maxConcurrency: number;
	maxPromptsPerRequest: number;
}

const DEFAULT_BRIGHTDATA_PROVIDER_CONFIG: BrightdataProviderConfig = {
	apiBase: 'https://api.brightdata.com',
	datasetId: 'gd_m7aof0k82r803d5bjm',
	outputFields: [
		'url',
		'prompt',
		'answer_text',
		'answer_text_markdown',
		'citations',
		'links_attached',
		'country',
		'index',
	],
	targetUrl: 'http://chatgpt.com/',
	providerName: 'Brightdata',
	maxConcurrency: 50,
	maxPromptsPerRequest: 1,
};

const TRIGGER_RETRY: RetryConfig = {
	maxRetries: 3,
	initialDelay: 0,
	statusCodes: [429, 500, 502, 503, 504],
};

const DOWNLOAD_RETRY: RetryConfig = {
	maxRetries: 5,
	initialDelay: 2000,
	statusCodes: [202, 500, 502, 503, 504],
};

const MONITOR_RETRY: RetryConfig = {
	maxRetries: 4,
	initialDelay: 1000,
	statusCodes: [408, 425, 429, 500, 502, 503, 504],
};

const MONITOR_RETRIABLE = new Set(MONITOR_RETRY.statusCodes ?? []);
const MAX_WAIT_MS = 600_000; // 10 minutes
const POLL_INTERVAL_MS = 5_000;

// ============================================================================
// API Key
// ============================================================================

function getApiKey(): string {
	const apiKey = Deno.env.get('BRIGHTDATA_API_KEY');
	if (!apiKey) {
		throw new Error('BRIGHTDATA_API_KEY environment variable is required');
	}
	return apiKey;
}

// ============================================================================
// Provider Functions
// ============================================================================

export function createBrightdataProvider(
	overrides: Partial<BrightdataProviderConfig> = {},
): ProviderFunctions {
	const config = { ...DEFAULT_BRIGHTDATA_PROVIDER_CONFIG, ...overrides };
	const customOutputFields = [...new Set([...(config.outputFields ?? []), ...(config.extraFields ?? [])])].join('|');

	async function triggerJob(
		prompt: string,
		useSearch: boolean,
		countryISOCode: string | null,
	): Promise<string | null> {
		const apiKey = getApiKey();
		const url = `${config.apiBase}/datasets/v3/trigger?dataset_id=${config.datasetId}&include_errors=true`;

		const input: Record<string, unknown> = {
			url: config.targetUrl,
			prompt,
			country: countryISOCode || '',
			index: 0,
		};
		Object.assign(input, config.extraInputs?.({ prompt, useSearch, countryISOCode }) ?? {});

		const body = {
			custom_output_fields: customOutputFields,
			input: [input],
		};

		try {
			const response = await withRetries(
				() =>
					fetch(url, {
						method: 'POST',
						headers: {
							'Authorization': `Bearer ${apiKey}`,
							'Content-Type': 'application/json',
						},
						body: JSON.stringify(body),
						signal: getAbortSignal(),
					}),
				TRIGGER_RETRY,
			);

			if (!response.ok) {
				console.error(`[${config.providerName}] Trigger error: ${response.status}`);
				return null;
			}

			const data = await response.json();
			return data?.snapshot_id || null;
		} catch (error) {
			console.error(`[${config.providerName}] Trigger failed:`, error);
			return null;
		}
	}

	async function monitorJob(snapshotId: string): Promise<boolean> {
		const apiKey = getApiKey();
		const url = `${config.apiBase}/datasets/v3/progress/${snapshotId}`;
		const startTime = Date.now();
		const abortSignal = getAbortSignal();

		while (Date.now() - startTime < MAX_WAIT_MS) {
			if (abortSignal?.aborted) return false;

			try {
				const response = await withRetries(
					() =>
						fetch(url, {
							headers: { 'Authorization': `Bearer ${apiKey}` },
							signal: abortSignal,
						}),
					MONITOR_RETRY,
				);

				if (!response.ok) {
					if (!MONITOR_RETRIABLE.has(response.status)) return false;
				} else {
					const status = await response.json();
					if (status.status === 'ready' || status.status === 'complete') return true;
					if (status.status === 'failed' || status.status === 'error') return false;
				}
			} catch (error) {
				console.error(`[${config.providerName}] Monitor error:`, error);
			}

			await sleep(POLL_INTERVAL_MS, abortSignal);
		}

		console.error(`[${config.providerName}] Monitor timeout after ${MAX_WAIT_MS / 1000}s`);
		return false;
	}

	async function downloadJob(snapshotId: string): Promise<Array<BrightdataLLMResponse> | null> {
		const apiKey = getApiKey();
		const url = `${config.apiBase}/datasets/v3/snapshot/${snapshotId}?format=json`;

		try {
			const response = await withRetries(
				() =>
					fetch(url, {
						headers: { 'Authorization': `Bearer ${apiKey}` },
						signal: getAbortSignal(),
					}),
				DOWNLOAD_RETRY,
			);

			if (!response.ok) {
				console.error(`[${config.providerName}] Download error: ${response.status}`);
				return null;
			}

			const data = await response.json();
			return Array.isArray(data) ? data : null;
		} catch (error) {
			console.error(`[${config.providerName}] Download failed:`, error);
			return null;
		}
	}

	function transformResponse(raw: unknown): ModelResult | null {
		const responses = raw as Array<BrightdataLLMResponse> | null;
		if (!responses || responses.length === 0) return null;

		const response = responses[0];

		const answerText = cleanAnswer(response.answer_text || '');
		const answerTextMarkdown = cleanAnswer(response.answer_text_markdown || '');

		return {
			prompt: response.prompt,
			answer: answerText,
			answer_text_markdown: answerTextMarkdown,
			sources: buildSources(response.citations ?? [], response.links_attached ?? []),
			searchQueries: response.web_search_query || [],
		};
	}

	return {
		name: config.providerName,
		maxConcurrency: config.maxConcurrency,
		maxPromptsPerRequest: config.maxPromptsPerRequest,
		triggerJob,
		monitorJob,
		downloadJob,
		transformResponse,
	};
}

// ============================================================================
// Export
// ============================================================================

export const brightdataProvider: ProviderFunctions = createBrightdataProvider();
