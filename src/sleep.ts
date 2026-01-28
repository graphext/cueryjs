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
