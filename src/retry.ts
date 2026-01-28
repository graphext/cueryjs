import { sleep } from './sleep.ts';

export interface RetryConfig {
	maxRetries?: number;
	initialDelay?: number; // in milliseconds
	maxDelay?: number; // in milliseconds
	backoffMultiplier?: number;
	statusCodes?: Array<number>;
}

export const DEFAULTS = {
	maxRetries: 3,
	initialDelay: 1000,
	maxDelay: 30000,
	backoffMultiplier: 2,
	statusCodes: [429, 500]
};

/**
 * Executes a fetch operation with exponential backoff retry logic.
 * Only retries on network errors or specific HTTP status codes (default: 429, 500, 502, 503, 504).
 */
export async function withRetries(
	fn: () => Promise<Response>,
	{
		maxRetries = DEFAULTS.maxRetries,
		initialDelay = DEFAULTS.initialDelay,
		maxDelay = DEFAULTS.maxDelay,
		backoffMultiplier = DEFAULTS.backoffMultiplier,
		statusCodes = DEFAULTS.statusCodes
	}: RetryConfig
): Promise<Response> {
	let lastError: Error | undefined;
	let lastResponse: Response | undefined;
	let delay = initialDelay;

	const abortSignal = (globalThis as Record<string, unknown>).abortSignal as AbortSignal | undefined;
	if (abortSignal?.aborted) {
		throw new Error('Operation aborted');
	}

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const response = await fn();

			// Return immediately if successful and not in retry status codes
			if (response.ok && !statusCodes.includes(response.status)) {
				return response;
			}

			// Return on last attempt regardless of status
			if (attempt === maxRetries) {
				return response;
			}

			lastResponse = response;

			await sleep(delay, abortSignal);
			delay = Math.min(delay * backoffMultiplier, maxDelay);
		} catch (error) {
			lastError = error as Error;

			if (attempt === maxRetries) {
				break;
			}

			await sleep(delay, abortSignal);
			delay = Math.min(delay * backoffMultiplier, maxDelay);
		}
	}

	if (lastResponse != null) {
		return lastResponse;
	}

	throw new Error(
		`Network request failed after ${maxRetries + 1} attempts: ${lastError?.message || 'Unknown error'}`
	);
}
