/**
 * Async utilities: sleep, retry with backoff, and parallel execution.
 */

// ============================================================================
// Sleep
// ============================================================================

/**
 * Sleeps for a specified duration. If an AbortSignal is provided and triggered,
 * the promise rejects with the abort reason and the timeout is cleared.
 */
export function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (abortSignal?.aborted) {
			return reject(abortSignal.reason ?? new DOMException('Aborted', 'AbortError'));
		}

		const timeoutId = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);

		function onAbort(): void {
			cleanup();
			reject(abortSignal?.reason ?? new DOMException('Aborted', 'AbortError'));
		}

		function cleanup(): void {
			if (abortSignal) {
				abortSignal.removeEventListener('abort', onAbort);
			}
			clearTimeout(timeoutId);
		}

		abortSignal?.addEventListener('abort', onAbort, { once: true });
	});
}

// ============================================================================
// Retry with Exponential Backoff
// ============================================================================

export interface RetryConfig {
	maxRetries?: number;
	initialDelay?: number; // in milliseconds
	maxDelay?: number; // in milliseconds
	backoffMultiplier?: number;
	statusCodes?: Array<number>;
}

export const RETRY_DEFAULTS = {
	maxRetries: 3,
	initialDelay: 1000,
	maxDelay: 30000,
	backoffMultiplier: 2,
	statusCodes: [429, 500]
};

/**
 * Executes a fetch operation with exponential backoff retry logic.
 * Only retries on network errors or specific HTTP status codes (default: 429, 500).
 */
export async function withRetries(
	fn: () => Promise<Response>,
	{
		maxRetries = RETRY_DEFAULTS.maxRetries,
		initialDelay = RETRY_DEFAULTS.initialDelay,
		maxDelay = RETRY_DEFAULTS.maxDelay,
		backoffMultiplier = RETRY_DEFAULTS.backoffMultiplier,
		statusCodes = RETRY_DEFAULTS.statusCodes
	}: RetryConfig = {}
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

// ============================================================================
// Parallel Execution
// ============================================================================

/**
 * Executes an async callback on each item in an iterable with limited concurrency.
 * Results are returned in the same order as the input.
 */
export async function mapParallel<T, U>(
	iterable: Array<T> | Set<T> | Iterator<T>,
	nWorkers: number,
	callback: (value: T, index: number) => Promise<U>
): Promise<Array<U>> {
	let size: number | null = null;

	if (Array.isArray(iterable)) {
		size = iterable.length;
	}

	if (!('next' in iterable)) {
		iterable = iterable[Symbol.iterator]();
	}

	nWorkers = Math.max(1, Math.min(nWorkers, size || Number.MAX_VALUE));

	const result: Array<U> = [];
	let myIndex = 0;
	const workerPromises = Array(nWorkers).fill(0).map(async () => {
		let iterResult: IteratorResult<T>;
		while (!(iterResult = iterable.next()).done) {
			const index = myIndex++;
			result[index] = await callback(iterResult.value, index);
		}
	});

	await Promise.all(workerPromises);

	return result;
}
