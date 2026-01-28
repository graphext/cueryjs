/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
/**
 * Brightdata GPT Scraper Provider.
 *
 * API Flow:
 * 1. Trigger: POST to /datasets/v3/trigger → returns snapshot_id
 * 2. Monitor: GET /datasets/v3/progress/{snapshot_id} until ready
 * 3. Download: GET /datasets/v3/snapshot/{snapshot_id}
 */

import type { RetryConfig } from '../../retry.ts';
import { withRetries } from '../../retry.ts';
import { sleep } from '../../sleep.ts';

import type { ModelResult } from '../../schemas/models.schema.ts';
import {
	type ProviderFunctions,
	getAbortSignal,
	cleanAnswer,
	buildSources,
	buildSearchSources
} from './scraper.ts';

// ============================================================================
// Types
// ============================================================================

interface BrightdataGPTResponse {
	prompt: string;
	answer_text?: string;
	answer_text_markdown?: string;
	links_attached?: Array<{
		url?: string;
		position?: number;
	}>;
	citations?: Array<{
		url: string;
		title?: string;
		description?: string;
		cited?: boolean;
	}>;
	search_sources?: Array<{
		url?: string;
		title?: string;
		snippet?: string;
		rank?: number;
		date_published?: string;
	}>;
	web_search_query?: Array<string>;
}

// ============================================================================
// Constants
// ============================================================================

const API_BASE = 'https://api.brightdata.com';
const DATASET_ID = 'gd_m7aof0k82r803d5bjm';
const OUTPUT_FIELDS = 'url|prompt|answer_text|answer_text_markdown|citations|links_attached|search_sources|country|model|web_search_triggered|web_search_query|index';

const TRIGGER_RETRY: RetryConfig = {
	maxRetries: 3,
	initialDelay: 0,
	statusCodes: [429, 500, 502, 503, 504]
};

const DOWNLOAD_RETRY: RetryConfig = {
	maxRetries: 5,
	initialDelay: 2000,
	statusCodes: [202, 500, 502, 503, 504]
};

const MONITOR_RETRY: RetryConfig = {
	maxRetries: 4,
	initialDelay: 1000,
	statusCodes: [408, 425, 429, 500, 502, 503, 504]
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

async function triggerJob(prompt: string, useSearch: boolean, countryISOCode: string | null): Promise<string | null> {
	const apiKey = getApiKey();
	const url = `${API_BASE}/datasets/v3/trigger?dataset_id=${DATASET_ID}&include_errors=true`;

	const body = {
		custom_output_fields: OUTPUT_FIELDS,
		input: [{
			url: 'http://chatgpt.com/',
			prompt,
			web_search: useSearch,
			country: countryISOCode || '',
			index: 0
		}]
	};

	try {
		const response = await withRetries(
			() => fetch(url, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(body),
				signal: getAbortSignal()
			}),
			TRIGGER_RETRY
		);

		if (!response.ok) {
			console.error(`[Brightdata] Trigger error: ${response.status}`);
			return null;
		}

		const data = await response.json();
		return data?.snapshot_id || null;
	} catch (error) {
		console.error('[Brightdata] Trigger failed:', error);
		return null;
	}
}

async function monitorJob(snapshotId: string): Promise<boolean> {
	const apiKey = getApiKey();
	const url = `${API_BASE}/datasets/v3/progress/${snapshotId}`;
	const startTime = Date.now();
	const abortSignal = getAbortSignal();

	while (Date.now() - startTime < MAX_WAIT_MS) {
		if (abortSignal?.aborted) return false;

		try {
			const response = await withRetries(
				() => fetch(url, {
					headers: { 'Authorization': `Bearer ${apiKey}` },
					signal: abortSignal
				}),
				MONITOR_RETRY
			);

			if (!response.ok) {
				if (!MONITOR_RETRIABLE.has(response.status)) return false;
			} else {
				const status = await response.json();
				if (status.status === 'ready' || status.status === 'complete') return true;
				if (status.status === 'failed' || status.status === 'error') return false;
			}
		} catch (error) {
			console.error('[Brightdata] Monitor error:', error);
		}

		await sleep(POLL_INTERVAL_MS, abortSignal);
	}

	console.error(`[Brightdata] Monitor timeout after ${MAX_WAIT_MS / 1000}s`);
	return false;
}

async function downloadJob(snapshotId: string): Promise<Array<BrightdataGPTResponse> | null> {
	const apiKey = getApiKey();
	const url = `${API_BASE}/datasets/v3/snapshot/${snapshotId}?format=json`;

	try {
		const response = await withRetries(
			() => fetch(url, {
				headers: { 'Authorization': `Bearer ${apiKey}` },
				signal: getAbortSignal()
			}),
			DOWNLOAD_RETRY
		);

		if (!response.ok) {
			console.error(`[Brightdata] Download error: ${response.status}`);
			return null;
		}

		const data = await response.json();
		return Array.isArray(data) ? data : null;
	} catch (error) {
		console.error('[Brightdata] Download failed:', error);
		return null;
	}
}

function transformResponse(raw: unknown): ModelResult | null {
	const responses = raw as Array<BrightdataGPTResponse> | null;
	if (!responses || responses.length === 0) return null;

	const response = responses[0];

	let answer = response.answer_text_markdown || response.answer_text || '';
	answer = cleanAnswer(answer);

	// Build link positions map
	const linkPositions: Record<string, Array<number>> = {};
	for (const link of response.links_attached ?? []) {
		if (link.url && link.position != null) {
			linkPositions[link.url] ??= [];
			linkPositions[link.url].push(link.position);
		}
	}

	return {
		prompt: response.prompt,
		answer,
		sources: buildSources(response.citations ?? [], linkPositions),
		searchQueries: response.web_search_query || [],
		searchSources: buildSearchSources(response.search_sources ?? [])
	};
}

// ============================================================================
// Export
// ============================================================================

export const brightdataProvider: ProviderFunctions = {
	name: 'Brightdata',
	maxConcurrency: 50,
	maxPromptsPerRequest: 1,
	triggerJob,
	monitorJob,
	downloadJob,
	transformResponse
};
