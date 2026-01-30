/**
 * Provider registry, model abstraction, and pricing.
 *
 * This module consolidates all provider-related functionality:
 * - Provider implementations (OpenAI, Google)
 * - Model abstraction with pricing and info lookup
 * - Cost calculation utilities
 */

import type { LLMProvider } from '../llm.ts';
import { OpenAIProvider } from './openai.ts';
import { GoogleProvider } from './google.ts';
import { _registerProviderFunctions } from './model.ts';

/**
 * Get a provider by name.
 * Creates a fresh provider instance each time to support different API keys.
 * @param name - Provider name ('openai', 'google')
 * @param apiKey - Optional API key. If not provided, uses environment variable.
 */
export function getProvider(name: string, apiKey?: string): LLMProvider {
	switch (name) {
		case 'google':
			return new GoogleProvider(apiKey);
		case 'openai':
		default:
			return new OpenAIProvider(apiKey);
	}
}

/**
 * Get the appropriate provider for a model ID.
 * Infers provider from model name prefix.
 * Creates a fresh provider instance each time to support different API keys.
 * @param modelId - Model identifier (e.g., 'gpt-4.1', 'gemini-2.0-flash')
 * @param apiKey - Optional API key. If not provided, uses environment variable.
 */
export function getProviderForModel(modelId: string, apiKey?: string): LLMProvider {
	const modelLower = modelId.toLowerCase();

	if (modelLower.startsWith('gemini')) {
		return new GoogleProvider(apiKey);
	}

	// Default to OpenAI for gpt-*, o1-*, o3-*, and unknown models
	return new OpenAIProvider(apiKey);
}

// Register provider functions with model.ts to avoid circular imports
_registerProviderFunctions(getProviderForModel, getProvider);

// Re-export provider implementations
export { OpenAIProvider } from './openai.ts';
export { GoogleProvider } from './google.ts';

// Re-export Model interface and factory
export { model, type Model } from './model.ts';

// Re-export pricing utilities
export {
	getModelPricing,
	getModelInfo,
	calculateCost,
	type ModelPricing,
	type ModelInfo,
} from './pricing.ts';
