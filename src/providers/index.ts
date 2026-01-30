/**
 * Provider registry, model abstraction, and pricing.
 *
 * This module consolidates all provider-related functionality:
 * - Provider implementations (OpenAI, Gemini)
 * - Model abstraction with pricing and info lookup
 * - Cost calculation utilities
 */

import type { LLMProvider } from '../llm.ts';
import { OpenAIProvider } from './openai.ts';
import { GeminiProvider } from './gemini.ts';
import { _registerProviderFunctions } from './model.ts';

// Lazy initialization to avoid errors if API keys are not set
let openaiProvider: OpenAIProvider | null = null;
let geminiProvider: GeminiProvider | null = null;

function getOpenAIProvider(): OpenAIProvider {
	if (!openaiProvider) {
		openaiProvider = new OpenAIProvider();
	}
	return openaiProvider;
}

function getGeminiProvider(): GeminiProvider {
	if (!geminiProvider) {
		geminiProvider = new GeminiProvider();
	}
	return geminiProvider;
}

/**
 * Get a provider by name.
 */
export function getProvider(name: string): LLMProvider {
	switch (name) {
		case 'gemini':
		case 'google':
			return getGeminiProvider();
		case 'openai':
		default:
			return getOpenAIProvider();
	}
}

/**
 * Get the appropriate provider for a model ID.
 * Infers provider from model name prefix.
 */
export function getProviderForModel(modelId: string): LLMProvider {
	const modelLower = modelId.toLowerCase();

	if (modelLower.startsWith('gemini')) {
		return getGeminiProvider();
	}

	// Default to OpenAI for gpt-*, o1-*, o3-*, and unknown models
	return getOpenAIProvider();
}

// Register provider functions with model.ts to avoid circular imports
_registerProviderFunctions(getProviderForModel, getProvider);

// Re-export provider implementations
export { OpenAIProvider } from './openai.ts';
export { GeminiProvider } from './gemini.ts';

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
