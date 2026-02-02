/**
 * Unified LLM interface - provider-agnostic API for making LLM calls.
 */

import type { z } from '@zod/zod';
import { SchemaValidationError } from './providers/errors.ts';
import {
	getProviderForModel,
	type Message,
	type LLMResponse,
	type ProviderParams,
} from './providers/index.ts';

// Re-export core LLM types from providers
export type { Message, LLMResponse, LLMProvider, ProviderParams, LLMConversation } from './providers/index.ts';

// Re-export usage types and cost calculator from response/providers for convenience
export type { TokenUsage, UsageCost, AggregatedUsage } from './response.ts';
export { calculateCost } from './providers/index.ts';

/**
 * Parameters for askLLMSafe.
 */
export interface AskLLMParams<T = string> {
	/** The prompt (string or message array) */
	prompt: string | Message[];
	/** The model to use (e.g., 'gpt-4.1-mini', 'gemini-2.0-flash') */
	model: string;
	/** Optional Zod schema for structured output */
	schema?: z.ZodType<T> | null;
	/** Provider-specific parameters */
	params?: ProviderParams;
	/** Maximum retry attempts (default: 3) */
	maxRetries?: number;
	/** Error handling mode: 'throw' or 'return' (default: 'throw') */
	onError?: 'throw' | 'return';
}

/**
 * Normalize a prompt to a message array.
 */
function normalizePrompt(prompt: string | Message[]): Message[] {
	if (Array.isArray(prompt)) {
		return prompt;
	}
	return [{ role: 'user', content: prompt }];
}

/**
 * Make a single LLM call with retry logic.
 * Returns LLMResponse with raw TokenUsage (no cost calculation).
 */
export async function askLLMSafe<T = string>({
	prompt,
	model,
	schema,
	params,
	maxRetries = 3,
	onError = 'throw',
}: AskLLMParams<T>): Promise<LLMResponse<T>> {
	const provider = getProviderForModel(model);
	let messages = normalizePrompt(prompt);
	let lastResponse: LLMResponse<T> | null = null;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		const response = await provider.complete(messages, model, schema ?? null, params);

		if (response.error === null && response.parsed !== null) {
			return response;
		}

		lastResponse = {
			parsed: null,
			text: response.text,
			usage: response.usage,
			error: response.error ?? new Error('Unknown error'),
		};

		if (attempt < maxRetries && response.error) {
			let errorMessage: string;
			if (response.error instanceof SchemaValidationError) {
				errorMessage = `Previous attempt failed with Zod parsing error:\n${response.error.message}.`;
				messages = [
					...messages,
					{
						role: 'system',
						content: `${errorMessage}\nYour raw response was:\n${response.text}`,
					},
				];
			} else {
				errorMessage = `Previous attempt failed with error: ${response.error.message}`;
			}
			console.log(
				`askLLMSafe retrying! Attempt ${attempt + 1} failed with: ${errorMessage}`
			);
		}
	}

	if (onError === 'return') {
		return lastResponse!;
	}

	throw lastResponse!.error;
}

/**
 * Make a single LLM call without retry logic.
 */
export async function askLLM<T = string>(
	params: Omit<AskLLMParams<T>, 'maxRetries' | 'onError'>
): Promise<LLMResponse<T>> {
	return askLLMSafe({ ...params, maxRetries: 0, onError: 'throw' });
}
