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
import {
	cleanAnswer,
	getAbortSignal,
	LLMSnapshotError,
	type LLMTriggerOutcome,
	parseSources,
	type ProviderFunctions,
} from './scrape.ts';

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
	class ConfigurationError extends Error {}

	async function triggerJobOutcome(
		prompt: string,
		_useSearch: boolean,
		countryISOCode: string | null,
		signal = getAbortSignal(),
	): Promise<LLMTriggerOutcome> {
		signal?.throwIfAborted();
		const authHeader = getAuthHeader();
		const body = {
			source: config.source,
			parse: config.parse,
			[config.inputKey]: prompt,
			...(config.search != null ? { search: config.search } : {}),
			...(config.render != null ? { render: config.render } : {}),
			...(countryISOCode != null ? { geo_location: countryISOCode } : {}),
		};
		let response: Response;
		try {
			let backoff = 1000;
			while (true) {
				signal?.throwIfAborted();
				response = await fetch(`${config.apiBase}/queries`, {
					method: 'POST',
					headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
					signal,
				});
				if (response.status !== 429) {
					break;
				}
				const retryAfter = response.headers.get('Retry-After')?.trim();
				const seconds = retryAfter != null && /^\d+$/.test(retryAfter) ? Number(retryAfter) : NaN;
				const date = retryAfter != null &&
						/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(retryAfter)
					? Date.parse(retryAfter)
					: NaN;
				let delay = Number.isSafeInteger(seconds * 1000)
					? seconds * 1000
					: Number.isFinite(date)
					? Math.max(0, date - Date.now())
					: backoff;
				await response.body?.cancel();
				while (delay > 2147483647) {
					await sleep(2147483647, signal);
					delay -= 2147483647;
				}
				await sleep(delay, signal);
				backoff = Math.min(backoff * 2, 30000);
			}
		} catch {
			signal?.throwIfAborted();
			return { jobId: null, failure: { provider: config.providerName, kind: 'trigger_uncertain' } };
		}
		signal?.throwIfAborted();
		if (response.status >= 400 && response.status < 500 && ![408, 425].includes(response.status)) {
			await response.body?.cancel();
			throw new ConfigurationError(`${config.providerName} trigger configuration rejected (${response.status})`);
		}
		let data: unknown;
		try {
			data = await response.json();
		} catch {
			signal?.throwIfAborted();
		}
		signal?.throwIfAborted();
		if (
			response.ok && data != null && typeof data === 'object' && 'id' in data && typeof data.id === 'string' &&
			/^\d+$/.test(data.id)
		) {
			return { jobId: data.id, failure: null };
		}
		return {
			jobId: null,
			failure: { provider: config.providerName, kind: 'trigger_uncertain', status: response.status },
		};
	}

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

	async function monitorJob(jobId: string, abortSignal = getAbortSignal()): Promise<boolean> {
		abortSignal?.throwIfAborted();
		const authHeader = getAuthHeader();
		const url = `${config.apiBase}/queries/${jobId}`;
		const startTime = Date.now();

		while (Date.now() - startTime < MAX_WAIT_MS) {
			abortSignal?.throwIfAborted();

			try {
				const response = await fetch(url, {
					headers: { 'Authorization': authHeader },
					signal: abortSignal,
				});
				abortSignal?.throwIfAborted();
				if ([400, 401, 402, 403, 422].includes(response.status)) {
					await response.body?.cancel();
					throw new ConfigurationError(
						`${config.providerName} monitor configuration rejected (${response.status})`,
					);
				}
				if (response.status === 404) {
					await response.body?.cancel();
					return false;
				}

				// 204 = job not completed yet, continue polling
				if (response.status === 204) {
					await sleep(POLL_INTERVAL_MS, abortSignal);
					continue;
				}

				if (response.ok) {
					const status = await response.json();
					abortSignal?.throwIfAborted();
					if (status.status === 'done') return true;
					if (status.status === 'faulted' || status.status === 'failed') return false;
				}
			} catch (error) {
				abortSignal?.throwIfAborted();
				if (error instanceof ConfigurationError) {
					throw error;
				}
				console.error(`[${config.providerName}] Monitor error:`, error);
			}

			await sleep(POLL_INTERVAL_MS, abortSignal);
		}

		console.error(`[${config.providerName}] Monitor timeout after ${MAX_WAIT_MS / 1000}s`);
		return false;
	}

	async function downloadJob(jobId: string, signal = getAbortSignal()): Promise<OxylabsLLMResponse | null> {
		signal?.throwIfAborted();
		const authHeader = getAuthHeader();
		const url = `${config.apiBase}/queries/${jobId}/results`;

		try {
			const response = await withRetries(
				() =>
					fetch(url, {
						headers: { 'Authorization': authHeader },
						signal,
					}),
				{ ...RETRY_CONFIG, signal },
			);

			signal?.throwIfAborted();
			if ([400, 401, 402, 403, 422].includes(response.status)) {
				await response.body?.cancel();
				throw new ConfigurationError(
					`${config.providerName} download configuration rejected (${response.status})`,
				);
			}
			if (!response.ok) {
				console.error(`[${config.providerName}] Download error: ${response.status}`);
				return null;
			}

			const result = await response.json();
			signal?.throwIfAborted();
			return result;
		} catch (error) {
			signal?.throwIfAborted();
			if (error instanceof ConfigurationError) {
				throw error;
			}
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
			answerMarkdown: answerTextMarkdown,
			sources: parseSources(citations),
			searchQueries: [],
		};
	}

	function transformBatchResponse(raw: unknown, inputCount: number): Array<ModelResult | LLMSnapshotError> {
		if (inputCount !== 1) {
			throw new Error('Oxylabs snapshots require exactly one input');
		}
		const malformed = () => [new LLMSnapshotError(config.providerName, 'malformed')];
		if (
			raw == null || typeof raw !== 'object' || !('results' in raw) || !Array.isArray(raw.results) ||
			raw.results.length !== 1
		) {
			return malformed();
		}
		const result = raw.results[0];
		if (result == null || typeof result !== 'object') {
			return malformed();
		}
		const content = result.content;
		if (content == null || typeof content !== 'object' || Array.isArray(content)) {
			return malformed();
		}
		if (content.error != null || content.error_code != null || result.error != null || result.error_code != null) {
			return [new LLMSnapshotError(config.providerName, 'snapshot_error')];
		}
		if (
			(result.status_code != null && result.status_code !== 200) ||
			(content.parse_status_code != null && content.parse_status_code !== 12000)
		) {
			return [new LLMSnapshotError(config.providerName, 'snapshot_error')];
		}
		if (
			(typeof content.response_text !== 'string' && typeof content.markdown_text !== 'string') ||
			(content.response_text != null && typeof content.response_text !== 'string') ||
			(content.markdown_text != null && typeof content.markdown_text !== 'string') ||
			(content.prompt != null && typeof content.prompt !== 'string') ||
			(content.citations != null &&
				(!Array.isArray(content.citations) ||
					content.citations.some((citation: unknown) =>
						citation == null || typeof citation !== 'object' || !('url' in citation) ||
						typeof citation.url !== 'string' ||
						('title' in citation && citation.title != null && typeof citation.title !== 'string') ||
						('description' in citation && citation.description != null &&
							typeof citation.description !== 'string')
					)))
		) {
			return malformed();
		}
		const transformed = transformResponse(raw);
		return transformed == null ? malformed() : [transformed];
	}

	return {
		name: config.providerName,
		maxConcurrency: config.maxConcurrency,
		maxPromptsPerRequest: config.maxPromptsPerRequest,
		triggerJob,
		triggerJobOutcome,
		monitorJob,
		downloadJob,
		transformResponse,
		transformBatchResponse,
	};
}

// ============================================================================
// Export
// ============================================================================

export const oxylabsProvider: ProviderFunctions = createOxylabsProvider();
