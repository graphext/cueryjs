/**
 * Model pricing lookup and cost calculation.
 *
 * Pricing data is bundled from models.dev at build time.
 * Run `deno task update-models` to refresh the data.
 */

import modelsData from '../assets/models.json' with { type: 'json' };
import type { TokenUsage, UsageCost } from '../response.ts';

/**
 * Pricing information for a model (USD per 1M tokens).
 */
export interface ModelPricing {
	input: number;
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
	reasoning?: number;
}

/**
 * Model information including pricing and limits.
 */
export interface ModelInfo {
	id: string;
	name: string;
	provider: string;
	pricing: ModelPricing | null;
	contextLimit: number | null;
	outputLimit: number | null;
	capabilities: {
		structuredOutput: boolean;
		toolCall: boolean;
		reasoning: boolean;
	};
}

// Types for the models.json structure
interface ModelEntry {
	id: string;
	name: string;
	cost?: {
		input?: number;
		output?: number;
		cache_read?: number;
		cache_write?: number;
		reasoning?: number;
	};
	limit?: {
		context?: number;
		output?: number;
	};
	structured_output?: boolean;
	tool_call?: boolean;
	reasoning?: boolean;
}

interface ProviderEntry {
	id: string;
	name: string;
	models: Record<string, ModelEntry>;
}

type ModelsData = Record<string, ProviderEntry>;

// Build flat index: model ID -> { provider, model }
const modelIndex = new Map<string, { provider: string; model: ModelEntry }>();

for (const [providerId, provider] of Object.entries(modelsData as ModelsData)) {
	if (!provider.models) continue;

	for (const [modelId, model] of Object.entries(provider.models)) {
		modelIndex.set(modelId, { provider: providerId, model });
	}
}

/**
 * Normalize a model ID by removing date suffixes and common variations.
 */
function normalizeModel(modelId: string): string {
	return modelId.replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

/**
 * Look up a model entry by ID (with normalization fallback).
 */
export function lookupModel(modelId: string): { provider: string; model: ModelEntry } | null {
	return modelIndex.get(modelId) ?? modelIndex.get(normalizeModel(modelId)) ?? null;
}

/**
 * Get pricing information for a model.
 */
export function getModelPricing(modelId: string): ModelPricing | null {
	const entry = lookupModel(modelId);

	if (!entry?.model.cost) {
		return null;
	}

	const cost = entry.model.cost;

	if (cost.input === 0 && cost.output === 0) {
		return null;
	}

	return {
		input: cost.input ?? 0,
		output: cost.output ?? 0,
		cacheRead: cost.cache_read,
		cacheWrite: cost.cache_write,
		reasoning: cost.reasoning,
	};
}

/**
 * Get full model information including pricing and capabilities.
 */
export function getModelInfo(modelId: string): ModelInfo | null {
	const entry = lookupModel(modelId);

	if (!entry) {
		return null;
	}

	const { provider, model: m } = entry;

	return {
		id: m.id,
		name: m.name,
		provider,
		pricing: getModelPricing(modelId),
		contextLimit: m.limit?.context ?? null,
		outputLimit: m.limit?.output ?? null,
		capabilities: {
			structuredOutput: m.structured_output ?? false,
			toolCall: m.tool_call ?? false,
			reasoning: m.reasoning ?? false,
		},
	};
}

/**
 * Calculate cost for token usage.
 */
export function calculateCost(modelId: string, usage: TokenUsage): UsageCost | null {
	const pricing = getModelPricing(modelId);

	if (!pricing) {
		return null;
	}

	const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
	const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;

	return {
		inputCost,
		outputCost,
		totalCost: inputCost + outputCost,
		currency: 'USD',
	};
}
