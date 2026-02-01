/**
 * Tool abstraction for LLM-powered operations.
 *
 * Provides a base class for building tools with consistent
 * single-item and batch processing, usage tracking, and error handling.
 */

import type { z } from '@zod/zod';
import { askLLMSafe, type LLMResponse, type Message, type ProviderParams } from './llm.ts';
import { mapParallel } from './helpers/async.ts';
import { BatchResponse } from './response.ts';

/**
 * Configuration for LLM calls. Can be overridden per-invocation.
 */
export interface ModelConfig {
	/** The model to use */
	model: string;
	/** Provider-specific parameters */
	modelParams?: ProviderParams;
	/** Maximum retry attempts (default: 3) */
	maxRetries?: number;
	/** Max concurrent requests for batch (default: 100) */
	maxConcurrency?: number;
	/** Enable cost tracking for batch (default: false) */
	trackCost?: boolean;
}

const DEFAULTS = {
	maxRetries: 3,
	maxConcurrency: 100,
	trackCost: false,
} as const;

/**
 * Abstract base class for LLM-powered tools.
 */
export abstract class Tool<TInput, TOutput, TResult = TOutput> {
	protected readonly modelConfig: ModelConfig;

	constructor(modelConfig: ModelConfig) {
		this.modelConfig = modelConfig;
	}

	/**
	 * Define the Zod schema for LLM response validation.
	 * Override this to provide structured output validation.
	 *
	 * Returns null by default for raw text mode.
	 * When returning null, TOutput must be `string`.
	 *
	 * Make this as cheap as possible, as it's called on every invocation (row).
	 * E.g. by preparing it in the constructor if it doesn't depend on input.
	 */
	protected schema(): z.ZodType<TOutput> | null {
		return null;
	}

	/** Build the prompt from a single input
	 * Make this as cheap as possible, as it's called on every invocation (row).
	 * E.g. by preparing it in the constructor if it doesn't depend on input.
	*/
	protected abstract prompt(input: TInput): string | Message[];

	/** Extract final result from parsed output. Override to transform. */
	protected extractResult(parsed: TOutput): TResult {
		return parsed as unknown as TResult;
	}

	/** Check if input should be skipped (returns null without LLM call) */
	protected isEmpty(input: TInput): boolean {
		if (input == null) return true;
		if (typeof input === 'string' && input.trim() === '') return true;
		if (typeof input === 'object' && Object.keys(input).length === 0) return true;
		return false;
	}

	/** Process a single input */
	async invoke(input: TInput, options: Partial<ModelConfig> = {}): Promise<LLMResponse<TResult | null>> {
		if (this.isEmpty(input)) {
			return { parsed: null, text: null, usage: null, error: null };
		}

		const { model, modelParams, maxRetries } = { ...DEFAULTS, ...this.modelConfig, ...options };

		const response = await askLLMSafe({
			prompt: this.prompt(input),
			model,
			schema: this.schema(),
			params: modelParams,
			maxRetries,
			onError: 'return',
		});

		if (response.error != null || response.parsed == null) {
			return { parsed: null, text: response.text, usage: response.usage, error: response.error };
		}

		// Type assertion: when schema() returns null, askLLMSafe returns string,
		// which should match TOutput (caller's responsibility to set TOutput = string)
		const parsed = response.parsed as TOutput;

		return {
			parsed: this.extractResult(parsed),
			text: response.text,
			usage: response.usage,
			error: null,
		};
	}

	/** Process multiple inputs with usage tracking */
	async batch(inputs: TInput[], options: Partial<ModelConfig> = {}): Promise<BatchResponse<TResult | null>> {
		const { model, modelParams, maxRetries, maxConcurrency, trackCost } = {
			...DEFAULTS,
			...this.modelConfig,
			...options,
		};

		const responses = await mapParallel(inputs, maxConcurrency, (input) =>
			this.invoke(input, { model, modelParams, maxRetries })
		);

		return new BatchResponse(
			responses.map((r) => r.parsed),
			trackCost ? responses.map((r) => r.usage) : undefined,
			trackCost ? model : undefined
		);
	}
}
