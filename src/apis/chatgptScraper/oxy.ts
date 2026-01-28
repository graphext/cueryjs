/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
/**
 * Oxylabs GPT Scraper Provider.
 *
 * API Flow (Async Push-Pull):
 * 1. Trigger: POST to /v1/queries → returns job id
 * 2. Monitor: GET /v1/queries/{id} until status is 'done'
 * 3. Download: GET /v1/queries/{id}/results
 */

import type { RetryConfig } from '../../retry.ts';
import { withRetries } from '../../retry.ts';
import { sleep } from '../../sleep.ts';

import type { ModelResult } from '../../schemas/models.schema.ts';
import {
	type ProviderFunctions,
	getAbortSignal,
	cleanAnswer,
	buildSources
} from './scraper.ts';

// ============================================================================
// Types
// ============================================================================

interface OxylabsGPTResponse {
	results: Array<{
		content: {
			prompt?: string;
			markdown_text?: string;
			response_text?: string;
			citations?: Array<{
				url: string;
				text?: string;
				title?: string;
				description?: string;
				section?: 'citations' | 'more';
			}>;
		};
	}>;
}

// ============================================================================
// Constants
// ============================================================================

const API_BASE = 'https://data.oxylabs.io/v1';

const RETRY_CONFIG: RetryConfig = {
	maxRetries: 3,
	initialDelay: 1000,
	statusCodes: [429, 500, 502, 503, 504, 524, 612, 613]
};

const MAX_WAIT_MS = 600_000; // 10 minutes
const POLL_INTERVAL_MS = 5_000;

// ============================================================================
// Auth
// ============================================================================

function getAuthHeader(): string {
	const username = Deno.env.get('OXYLABS_USERNAME');
	const password = Deno.env.get('OXYLABS_PASSWORD');

	if (!username || !password) {
		throw new Error('OXYLABS_USERNAME and OXYLABS_PASSWORD environment variables are required');
	}

	return `Basic ${btoa(`${username}:${password}`)}`;
}

// ============================================================================
// Provider Functions
// ============================================================================

async function triggerJob(prompt: string, useSearch: boolean, countryISOCode: string | null): Promise<string | null> {
	const authHeader = getAuthHeader();
	const url = `${API_BASE}/queries`;

	const body: Record<string, unknown> = {
		source: 'chatgpt',
		prompt,
		parse: true,
		search: true // Oxylabs requires search: true (cannot be false or blank)
	};

	if (countryISOCode) {
		body.geo_location = countryISOCode;
	}

	try {
		const response = await withRetries(
			() => fetch(url, {
				method: 'POST',
				headers: {
					'Authorization': authHeader,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(body),
				signal: getAbortSignal()
			}),
			RETRY_CONFIG
		);

		if (!response.ok) {
			console.error(`[Oxylabs] Trigger error: ${response.status}`);
			return null;
		}

		const data = await response.json();
		return data?.id || null;
	} catch (error) {
		console.error('[Oxylabs] Trigger failed:', error);
		return null;
	}
}

async function monitorJob(jobId: string): Promise<boolean> {
	const authHeader = getAuthHeader();
	const url = `${API_BASE}/queries/${jobId}`;
	const startTime = Date.now();
	const abortSignal = getAbortSignal();

	while (Date.now() - startTime < MAX_WAIT_MS) {
		if (abortSignal?.aborted) return false;

		try {
			const response = await fetch(url, {
				headers: { 'Authorization': authHeader },
				signal: abortSignal
			});

			// 204 = job not completed yet, continue polling
			if (response.status === 204) {
				await sleep(POLL_INTERVAL_MS, abortSignal);
				continue;
			}

			if (response.ok) {
				const status = await response.json();
				if (status.status === 'done') return true;
				if (status.status === 'faulted' || status.status === 'failed') return false;
			}
		} catch (error) {
			console.error('[Oxylabs] Monitor error:', error);
		}

		await sleep(POLL_INTERVAL_MS, abortSignal);
	}

	console.error(`[Oxylabs] Monitor timeout after ${MAX_WAIT_MS / 1000}s`);
	return false;
}

async function downloadJob(jobId: string): Promise<OxylabsGPTResponse | null> {
	const authHeader = getAuthHeader();
	const url = `${API_BASE}/queries/${jobId}/results`;

	try {
		const response = await withRetries(
			() => fetch(url, {
				headers: { 'Authorization': authHeader },
				signal: getAbortSignal()
			}),
			RETRY_CONFIG
		);

		if (!response.ok) {
			console.error(`[Oxylabs] Download error: ${response.status}`);
			return null;
		}

		return await response.json();
	} catch (error) {
		console.error('[Oxylabs] Download failed:', error);
		return null;
	}
}

function transformResponse(raw: unknown): ModelResult | null {
	const response = raw as OxylabsGPTResponse | null;
	const content = response?.results?.[0]?.content;

	if (!content) return null;

	let answer = content.markdown_text || content.response_text || '';
	answer = cleanAnswer(answer);

	// Map section='citations' to cited=true (like Brightdata's cited field)
	const citations = (content.citations ?? []).map(c => ({
		...c,
		cited: c.section === 'citations'
	}));

	return {
		prompt: content.prompt || '',
		answer,
		sources: buildSources(citations),
		searchQueries: [],
		searchSources: []
	};
}

// ============================================================================
// Export
// ============================================================================

export const oxylabsProvider: ProviderFunctions = {
	name: 'Oxylabs',
	maxConcurrency: 10,
	maxPromptsPerRequest: 1,
	triggerJob,
	monitorJob,
	downloadJob,
	transformResponse
};
