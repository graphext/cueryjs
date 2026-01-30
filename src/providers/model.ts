/**
 * Model interface and factory for LLM models.
 *
 * Provides a unified abstraction for model identification, pricing lookup,
 * and provider access.
 */

import type { TokenUsage, UsageCost } from '../response.ts';
import { getModelPricing, getModelInfo, calculateCost, lookupModel, type ModelPricing, type ModelInfo } from './pricing.ts';

// Forward declaration - will be set by providers/index.ts to avoid circular import
let _getProviderForModel: ((model: string) => unknown) | null = null;
let _getProvider: ((name: string) => unknown) | null = null;

/**
 * Register provider functions. Called by providers/index.ts.
 * @internal
 */
export function _registerProviderFunctions(
	getProviderForModel: (model: string) => unknown,
	getProvider: (name: string) => unknown
): void {
	_getProviderForModel = getProviderForModel;
	_getProvider = getProvider;
}

/**
 * LLM provider interface (mirrors llm.ts to avoid circular import).
 */
interface LLMProviderLike {
	readonly name: string;
	complete<T>(
		messages: Array<{ role: string; content: string }>,
		model: string,
		schema: unknown,
		params?: Record<string, unknown>
	): Promise<unknown>;
}

/**
 * Represents an LLM model with access to pricing, info, and provider.
 */
export interface Model {
	/** The model name/ID (e.g., 'gpt-4.1', 'gemini-2.0-flash') */
	readonly name: string;

	/** The provider name if explicitly specified (e.g., 'openai' from 'openai/gpt-4.1') */
	readonly providerName: string | null;

	/** Get pricing information for this model */
	pricing(): ModelPricing | null;

	/** Get full model information including capabilities */
	info(): ModelInfo | null;

	/** Calculate cost for given token usage */
	cost(usage: TokenUsage): UsageCost | null;

	/** Get the LLM provider instance for this model */
	provider(): LLMProviderLike;

	/** String representation */
	toString(): string;
}

/**
 * Create a Model instance from a model identifier string.
 *
 * @param id - Model identifier, e.g., 'gpt-4.1' or 'openai/gpt-4.1'
 * @returns A Model object with pricing, info, and provider access
 *
 * @example
 * ```typescript
 * const m = model('gpt-4.1');
 * m.pricing();           // { input: 2.0, output: 8.0, ... }
 * m.info();              // { contextLimit: 1000000, ... }
 * m.cost({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });
 * m.provider();          // OpenAIProvider instance
 * ```
 */
export function model(id: string): Model {
	// Parse provider/model format
	let name: string;
	let explicitProvider: string | null;

	if (id.includes('/')) {
		const parts = id.split('/', 2);
		explicitProvider = parts[0];
		name = parts[1];
	} else {
		explicitProvider = null;
		name = id;
	}

	// Try to get provider name from models.json if not specified
	const resolvedProviderName = explicitProvider ?? lookupModel(name)?.provider ?? null;

	return {
		name,
		providerName: resolvedProviderName,

		pricing() {
			return getModelPricing(name);
		},

		info() {
			return getModelInfo(name);
		},

		cost(usage: TokenUsage) {
			return calculateCost(name, usage);
		},

		provider() {
			if (!_getProviderForModel || !_getProvider) {
				throw new Error('Provider functions not registered. Import from providers/index.ts first.');
			}

			// If provider was explicitly specified, use it
			if (explicitProvider) {
				return _getProvider(explicitProvider) as LLMProviderLike;
			}

			return _getProviderForModel(name) as LLMProviderLike;
		},

		toString() {
			if (resolvedProviderName) {
				return `${resolvedProviderName}/${name}`;
			}
			return name;
		},
	};
}

// Re-export pricing types
export type { ModelPricing, ModelInfo } from './pricing.ts';
