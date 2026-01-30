/**
 * Tool abstraction for LLM-powered operations.
 *
 * Provides a consistent interface for single-item and batch processing
 * with automatic usage tracking and error handling.
 */

import { z } from '@zod/zod';
import { askLLMSafe, calculateCost, type LLMResponse, type Message, type ProviderParams } from './llm.ts';
import { mapParallel } from './helpers/async.ts';
import { BatchResponse } from './response.ts';

/**
 * Configuration for creating an LLM tool.
 */
export interface ToolConfig<TInput, TOutput, TResult = TOutput> {
	/** Zod schema for validating LLM responses. Can be static or dynamic (function of input). */
	schema: z.ZodType<TOutput> | ((input: TInput) => z.ZodType<TOutput>);

	/** Generate the prompt from input. */
	buildPrompt: (input: TInput) => string | Message[];

	/** Extract the final result from the parsed response. Defaults to identity. */
	extractResult?: (parsed: TOutput) => TResult;

	/** Default model to use. Defaults to 'gpt-4.1-mini'. */
	defaultModel?: string;

	/** Default model parameters. */
	defaultParams?: ProviderParams;

	/** Default max retries. Defaults to 3. */
	defaultMaxRetries?: number;

	/** Whether to track usage. Defaults to true. */
	trackUsage?: boolean;
}

/**
 * Options for a single tool invocation.
 */
export interface ToolInvokeOptions {
	model?: string;
	modelParams?: ProviderParams;
	maxRetries?: number;
	trackUsage?: boolean;
}

/**
 * Options for batch tool invocation.
 */
export interface ToolBatchOptions extends ToolInvokeOptions {
	maxConcurrency?: number;
	trackCost?: boolean;
}

/**
 * An LLM-powered tool that processes inputs.
 */
export interface Tool<TInput, TOutput, TResult = TOutput> {
	/** Process a single input. */
	invoke(input: TInput, options?: ToolInvokeOptions): Promise<LLMResponse<TResult | null>>;

	/** Process multiple inputs with usage tracking. */
	batch(inputs: Array<TInput>, options?: ToolBatchOptions): Promise<BatchResponse<TResult | null>>;
}

/**
 * Check if an input is considered empty/null and should return null without LLM call.
 */
function isEmptyInput(input: unknown): boolean {
	if (input == null) return true;
	if (typeof input === 'string' && input.trim() === '') return true;
	if (typeof input === 'object' && Object.keys(input).length === 0) return true;
	return false;
}

/**
 * Create an LLM tool from a configuration object.
 */
export function createTool<TInput, TOutput, TResult = TOutput>(
	config: ToolConfig<TInput, TOutput, TResult>
): Tool<TInput, TOutput, TResult> {
	const {
		schema,
		buildPrompt,
		extractResult,
		defaultModel = 'gpt-4.1-mini',
		defaultParams = {},
		defaultMaxRetries = 3,
		trackUsage: configTrackUsage = true,
	} = config;

	async function invoke(
		input: TInput,
		options: ToolInvokeOptions = {}
	): Promise<LLMResponse<TResult | null>> {
		const {
			model = defaultModel,
			modelParams = defaultParams,
			maxRetries = defaultMaxRetries,
			trackUsage = configTrackUsage,
		} = options;

		// Handle null/empty input
		if (isEmptyInput(input)) {
			return { parsed: null, text: null, usage: null, error: null };
		}

		const prompt = buildPrompt(input);
		const resolvedSchema = typeof schema === 'function' ? schema(input) : schema;

		const response = await askLLMSafe({
			prompt,
			model,
			schema: resolvedSchema,
			params: modelParams,
			maxRetries,
			onError: 'return',
		});

		// Handle errors or failed parsing
		if (response.error != null || response.parsed == null) {
			return {
				parsed: null,
				text: response.text,
				usage: trackUsage ? response.usage : null,
				error: response.error,
			};
		}

		// Extract and return result
		const result = extractResult
			? extractResult(response.parsed)
			: (response.parsed as unknown as TResult);

		return {
			parsed: result,
			text: response.text,
			usage: trackUsage ? response.usage : null,
			error: null,
		};
	}

	async function batch(
		inputs: Array<TInput>,
		options: ToolBatchOptions = {}
	): Promise<BatchResponse<TResult | null>> {
		const { maxConcurrency = 100, model = defaultModel, trackCost = false, ...invokeOptions } = options;

		const responses = await mapParallel(inputs, maxConcurrency, (input) =>
			invoke(input, { model, ...invokeOptions })
		);

		return new BatchResponse(
			responses.map((r) => r.parsed),
			trackCost ? responses.map((r) => r.usage) : undefined,
			trackCost ? model : undefined,
			trackCost ? calculateCost : undefined
		);
	}

	return { invoke, batch };
}
