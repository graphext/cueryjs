/**
 * Core LLM types - provider-agnostic interfaces.
 *
 * This module is the foundation of the provider system.
 * It has no dependencies on other modules to avoid circular imports.
 */

import type { z } from '@zod/zod';
import type { TokenUsage } from '../response.ts';

/**
 * A message in an LLM conversation.
 */
export interface Message {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

/**
 * Response from an LLM provider.
 */
export interface LLMResponse<T> {
	parsed: T | null;
	text: string | null;
	usage: TokenUsage | null;
	error: Error | null;
}

/**
 * Provider-specific parameters passed through to the underlying API.
 */
export type ProviderParams = Record<string, unknown>;

/**
 * Interface for LLM providers.
 */
export interface LLMProvider {
	/** Provider name (e.g., 'openai', 'gemini') */
	readonly name: string;

	/**
	 * Make a completion request to the LLM.
	 *
	 * @param messages - The conversation messages
	 * @param model - The model identifier
	 * @param schema - Optional Zod schema for structured output
	 * @param params - Provider-specific parameters
	 */
	complete<T>(
		messages: Message[],
		model: string,
		schema: z.ZodType<T> | null,
		params?: ProviderParams
	): Promise<LLMResponse<T>>;
}

/**
 * Conversation type (array of messages).
 */
export type LLMConversation = Message[];
