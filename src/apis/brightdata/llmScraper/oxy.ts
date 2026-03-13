/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
/**
 * Oxylabs LLM Scraper Provider.
 *
 * API Flow (Async Push-Pull):
 * 1. Trigger: POST to /v1/queries → returns job id
 * 2. Monitor: GET /v1/queries/{id} until status is 'done'
 * 3. Download: GET /v1/queries/{id}/results
 */

import { type RetryConfig, sleep, withRetries } from '../../../helpers/async.ts';

import type { ModelResult } from '../../../schemas/models.schema.ts';
import { buildSources, cleanAnswer, getAbortSignal, type ProviderFunctions } from './scrape.ts';

// ============================================================================
// Types
// ============================================================================

interface OxylabsLLMResponse {
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

interface OxylabsProviderConfig {
	apiBase: string;
	source: string;
	inputKey: 'prompt' | 'query';
	parse: boolean;
	search?: boolean;
	render?: 'html';
	providerName: string;
	maxConcurrency: number;
	maxPromptsPerRequest: number;
}

const DEFAULT_OXYLABS_PROVIDER_CONFIG: OxylabsProviderConfig = {
	apiBase: 'https://data.oxylabs.io/v1',
	source: 'chatgpt',
	inputKey: 'prompt',
	parse: true,
	search: true,
	providerName: 'Oxylabs',
	maxConcurrency: 10,
	maxPromptsPerRequest: 1,
};

const RETRY_CONFIG: RetryConfig = {
	maxRetries: 3,
	initialDelay: 1000,
	statusCodes: [429, 500, 502, 503, 504, 524, 612, 613],
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

export function createOxylabsProvider(overrides: Partial<OxylabsProviderConfig> = {}): ProviderFunctions {
	const config = { ...DEFAULT_OXYLABS_PROVIDER_CONFIG, ...overrides };

	async function triggerJob(
		prompt: string,
		_useSearch: boolean,
		countryISOCode: string | null,
	): Promise<string | null> {
		const authHeader = getAuthHeader();
		const url = `${config.apiBase}/queries`;

		const body: Record<string, unknown> = {
			source: config.source,
			parse: config.parse,
			[config.inputKey]: prompt,
		};

		if (config.search != null) {
			body.search = config.search;
		}

		if (config.render != null) {
			body.render = config.render;
		}

		if (countryISOCode) {
			body.geo_location = countryISOCode;
		}

		try {
			const response = await withRetries(
				() =>
					fetch(url, {
						method: 'POST',
						headers: {
							'Authorization': authHeader,
							'Content-Type': 'application/json',
						},
						body: JSON.stringify(body),
						signal: getAbortSignal(),
					}),
				RETRY_CONFIG,
			);

			if (!response.ok) {
				console.error(`[${config.providerName}] Trigger error: ${response.status}`);
				return null;
			}

			const data = await response.json();
			return data?.id || null;
		} catch (error) {
			console.error(`[${config.providerName}] Trigger failed:`, error);
			return null;
		}
	}

	async function monitorJob(jobId: string): Promise<boolean> {
		const authHeader = getAuthHeader();
		const url = `${config.apiBase}/queries/${jobId}`;
		const startTime = Date.now();
		const abortSignal = getAbortSignal();

		while (Date.now() - startTime < MAX_WAIT_MS) {
			if (abortSignal?.aborted) return false;

			try {
				const response = await fetch(url, {
					headers: { 'Authorization': authHeader },
					signal: abortSignal,
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
				console.error(`[${config.providerName}] Monitor error:`, error);
			}

			await sleep(POLL_INTERVAL_MS, abortSignal);
		}

		console.error(`[${config.providerName}] Monitor timeout after ${MAX_WAIT_MS / 1000}s`);
		return false;
	}

	async function downloadJob(jobId: string): Promise<OxylabsLLMResponse | null> {
		const authHeader = getAuthHeader();
		const url = `${config.apiBase}/queries/${jobId}/results`;

		try {
			const response = await withRetries(
				() =>
					fetch(url, {
						headers: { 'Authorization': authHeader },
						signal: getAbortSignal(),
					}),
				RETRY_CONFIG,
			);

			if (!response.ok) {
				console.error(`[${config.providerName}] Download error: ${response.status}`);
				return null;
			}

			return await response.json();
		} catch (error) {
			console.error(`[${config.providerName}] Download failed:`, error);
			return null;
		}
	}

	function transformResponse(raw: unknown): ModelResult | null {
		const response = raw as OxylabsLLMResponse | null;
		const content = response?.results?.[0]?.content;

		if (!content) return null;

		const answerText = cleanAnswer(content.response_text || '');
		const answerTextMarkdown = cleanAnswer(content.markdown_text || '');

		// Map section='citations' to cited=true (like Brightdata's cited field)
		const citations = (content.citations ?? []).map((c) => ({
			...c,
			cited: c.section === 'citations',
		}));

		return {
			prompt: content.prompt || '',
			answer: answerText,
			answer_text_markdown: answerTextMarkdown,
			sources: buildSources(citations),
			searchQueries: [],
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

export const oxylabsProvider: ProviderFunctions = createOxylabsProvider();
