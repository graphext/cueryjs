/**
 * OpenAI provider implementation.
 */

import OpenAI from '@openai/openai';
import { z } from '@zod/zod';
import type { LLMProvider, LLMResponse, Message, ProviderParams, TokenUsage } from '../llm.ts';

type AutoParseableTextFormat<ParsedT> = OpenAI.Responses.ResponseFormatTextJSONSchemaConfig & {
	__output: ParsedT;
	$brand: 'auto-parseable-response-format';
	$parseRaw(content: string): ParsedT;
};

const zodTextFormatCache = new Map<z.ZodTypeAny, AutoParseableTextFormat<unknown>>();

class ZodValidationError extends Error {}

function getCachedZodTextFormat<T>(zodObject: z.ZodType<T>, name: string): AutoParseableTextFormat<T> {
	const cached = zodTextFormatCache.get(zodObject) as AutoParseableTextFormat<T> | undefined;

	if (cached && cached.name === name) {
		return cached;
	}

	const format = zodTextFormat(zodObject, name);
	zodTextFormatCache.set(zodObject, format);

	return format as AutoParseableTextFormat<T>;
}

function zodTextFormat(zodObject: z.ZodType, name: string): AutoParseableTextFormat<z.infer<typeof zodObject>> {
	return {
		type: 'json_schema',
		name,
		strict: true,
		schema: z.toJSONSchema(zodObject, { target: 'draft-7' }),
		$brand: 'auto-parseable-response-format',
		$parseRaw: (content) => {
			try {
				return zodObject.parse(JSON.parse(content));
			} catch (error) {
				return new ZodValidationError(error instanceof Error ? error.message : String(error));
			}
		},
		__output: undefined,
	};
}

/**
 * OpenAI LLM provider.
 */
export class OpenAIProvider implements LLMProvider {
	readonly name = 'openai';
	private client: OpenAI;

	constructor() {
		const fetchOptions: Record<string, unknown> = {};
		const abortSignal = (globalThis as Record<string, unknown>).abortSignal;
		if (abortSignal) {
			fetchOptions.signal = abortSignal;
		}

		this.client = new OpenAI({
			apiKey: Deno.env.get('OPENAI_API_KEY'),
			fetchOptions,
		});
	}

	async complete<T>(
		messages: Message[],
		model: string,
		schema: z.ZodType<T> | null,
		params?: ProviderParams
	): Promise<LLMResponse<T>> {
		try {
			const response = await this.client.responses.parse({
				...(params as Record<string, unknown>),
				model,
				input: messages.map((m) => ({
					role: m.role,
					content: m.content,
				})),
				...(schema != null
					? {
							text: {
								format: getCachedZodTextFormat(schema, 'response'),
							},
						}
					: {}),
			});

			const usage: TokenUsage | null = response.usage
				? {
						inputTokens: response.usage.input_tokens,
						outputTokens: response.usage.output_tokens,
						totalTokens: response.usage.total_tokens,
					}
				: null;

			if (response.output_parsed instanceof Error) {
				return {
					parsed: null,
					text: response.output_text,
					usage,
					error: response.output_parsed,
				};
			}

			return {
				parsed: schema != null ? (response.output_parsed as T) : (response.output_text as T),
				text: response.output_text,
				usage,
				error: null,
			};
		} catch (error) {
			return {
				parsed: null,
				text: null,
				usage: null,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}
}
