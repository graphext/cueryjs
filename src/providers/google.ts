/**
 * Google provider implementation (for Gemini models).
 */

import { GoogleGenAI } from '@google/genai';
import { z } from '@zod/zod';
import type { TokenUsage } from '../response.ts';
import { SchemaValidationError } from './errors.ts';
import type { LLMProvider, LLMResponse, Message, ProviderParams } from './types.ts';

/**
 * Convert messages to Gemini content format.
 * Handles system prompts by prepending them as context.
 */
function convertMessages(messages: Message[]): string | Array<{ role: string; parts: Array<{ text: string }> }> {
	// For simple single message, return as string
	if (messages.length === 1 && messages[0].role === 'user') {
		return messages[0].content;
	}

	// Build system instruction and contents separately
	const systemParts: string[] = [];
	const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

	for (const msg of messages) {
		if (msg.role === 'system') {
			systemParts.push(msg.content);
		} else {
			contents.push({
				role: msg.role === 'assistant' ? 'model' : 'user',
				parts: [{ text: msg.content }],
			});
		}
	}

	// If we have system prompts, prepend to the first user message
	if (systemParts.length > 0 && contents.length > 0) {
		const systemContext = systemParts.join('\n\n');
		const firstContent = contents[0];
		if (firstContent.role === 'user' && firstContent.parts.length > 0) {
			firstContent.parts[0].text = `${systemContext}\n\n${firstContent.parts[0].text}`;
		}
	}

	return contents;
}

/**
 * Google LLM provider (for Gemini models).
 */
export class GoogleProvider implements LLMProvider {
	readonly name = 'google';
	private client: GoogleGenAI;

	constructor(apiKey?: string) {
		const resolvedKey = apiKey ?? Deno.env.get('GOOGLE_API_KEY') ?? Deno.env.get('GEMINI_API_KEY');

		if (!resolvedKey) {
			throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY environment variable is required');
		}

		this.client = new GoogleGenAI({ apiKey: resolvedKey });
	}

	async complete<T>(
		messages: Message[],
		model: string,
		schema: z.ZodType<T> | null,
		params?: ProviderParams
	): Promise<LLMResponse<T>> {
		try {
			const config: Record<string, unknown> = {
				...(params ?? {}),
			};

			if (schema != null) {
				config.responseMimeType = 'application/json';
				config.responseSchema = z.toJSONSchema(schema, { target: 'draft-7' });
			}

			const response = await this.client.models.generateContent({
				model,
				contents: convertMessages(messages),
				config,
			});

			const text = response.text ?? '';
			const usageMetadata = response.usageMetadata;

			const usage: TokenUsage | null = usageMetadata
				? {
						inputTokens: usageMetadata.promptTokenCount ?? 0,
						outputTokens: usageMetadata.candidatesTokenCount ?? 0,
						totalTokens: usageMetadata.totalTokenCount ?? 0,
					}
				: null;

			if (schema != null) {
				try {
					const parsed = schema.parse(JSON.parse(text));
					return {
						parsed,
						text,
						usage,
						error: null,
					};
				} catch (error) {
					return {
						parsed: null,
						text,
						usage,
						error: new SchemaValidationError(
							error instanceof Error ? error.message : String(error),
							error
						),
					};
				}
			}

			return {
				parsed: text as T,
				text,
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
