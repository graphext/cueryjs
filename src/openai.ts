/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
import OpenAI from '@openai/openai';
import { z } from '@zod/zod';

export type AIConversation = Array<OpenAI.Responses.EasyInputMessage>;
export type AIParams = Omit<OpenAI.Responses.ResponseCreateParams, 'model' | 'input' | 'text'>;
export type AIOutput = Array<OpenAI.Responses.ResponseOutputItem>;

export type AIResult<T = string> = {
	parsed: T | null;
	output_text: string | null;
	output: AIOutput | null;
	error: Error | null;
};

/**
 * Makes a structured response call to OpenAI using a Zod schema.
 */
async function askOpenAI<T>(
	prompt: string | AIConversation,
	model: string,
	schema: z.ZodType<T>,
	extraParams?: AIParams,
	onError?: 'throw' | 'return'
): Promise<{
	parsed: T | Error | null,
	output_text: string | null,
	output: AIOutput | null,
}>;
async function askOpenAI(
	prompt: string | AIConversation,
	model: string,
	schema?: undefined | null,
	extraParams?: AIParams,
	onError?: 'throw' | 'return'
): Promise<{
	parsed: string | null,
	output_text: string | null,
	output: AIOutput | null,
}>;
async function askOpenAI<T = string>(
	prompt: string | AIConversation,
	model: string,
	schema?: z.ZodType<T> | null,
	extraParams?: AIParams,
	onError: 'throw' | 'return' = 'throw'
): Promise<{
	parsed: T | Error | null,
	output_text: string | null,
	output: AIOutput | null,
} | {
	parsed: string | null,
	output_text: string | null,
	output: AIOutput | null,
}> {
	const openAIClient = new OpenAI({
		apiKey: Deno.env.get('OPENAI_API_KEY'),
		fetchOptions: {
			signal: (globalThis as any).abortSignal // Pass through abort signal if available
		}
	});

	const { output_parsed, output_text, output } = await openAIClient.responses.parse({
		...extraParams as Record<string, unknown>,
		model,
		input: Array.isArray(prompt) ? prompt : [{
			role: 'user',
			content: prompt
		}],
		...(schema != null ? {
			text: {
				format: getCachedZodTextFormat(schema, 'response')
			}
		} : {})
	});

	if (schema == null) {
		return {
			parsed: output_text,
			output_text,
			output
		};
	}

	if (output_parsed instanceof Error && onError === 'throw') {
		throw output_parsed;
	}

	return {
		parsed: output_parsed as any,
		output_text,
		output
	};
}

class ZodValidationError extends Error { };

/**
 * Safely calls askOpenAI with retry logic.
 * On each retry, prefixes the prompt with context about the previous failure.
 */
export async function askOpenAISafe<T = string>(
	prompt: string | AIConversation,
	model: string,
	schema?: z.ZodType<T> | null,
	extraParams?: AIParams,
	maxRetries: number = 3,
	onError: 'throw' | 'return' = 'throw'
): Promise<AIResult<T>> {
	let lastResult: AIResult<T> | null = null;
	let currentPrompt: AIConversation = Array.isArray(prompt) ? prompt : [{
		role: 'user',
		content: prompt
	}];

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const result = await askOpenAI<T>(currentPrompt, model, schema as any, extraParams, 'return');

			if (result.parsed instanceof Error) {
				lastResult = {
					parsed: null,
					output_text: result.output_text,
					output: result.output,
					error: result.parsed
				};
			}
			else {
				return {
					parsed: result.parsed,
					output_text: result.output_text,
					output: result.output,
					error: null
				};
			}
		}
		catch (error) {
			lastResult = {
				parsed: null,
				output_text: null,
				output: null,
				error: error instanceof Error ? error : new Error(JSON.stringify(error))
			};
		}

		lastResult = lastResult!;

		if (attempt < maxRetries) {
			let errorMessage: string;
			if (lastResult.error instanceof ZodValidationError) {
				errorMessage = `Previous attempt failed with Zod parsing error:\n${lastResult.error.message}.\nYour raw response was:\n${lastResult.output_text}.`;
				currentPrompt = [
					...currentPrompt,
					{
						role: 'system',
						content: errorMessage
					}
				] as AIConversation;
			}
			else if (lastResult.error instanceof Error) {
				errorMessage = `Previous attempt failed with error: ${lastResult.error.message}`;
			}
			else {
				errorMessage = 'Previous attempt failed with an unknown error.';
			}
			console.log(`askOpenAISafe retrying! Previous attempt ${attempt + 1} failed with: ${errorMessage}`);
		}
	}

	if (onError === 'return') {
		return lastResult!;
	}

	throw lastResult!.error;
}

type AutoParseableTextFormat<ParsedT> = OpenAI.Responses.ResponseFormatTextJSONSchemaConfig & {
	__output: ParsedT; // type-level only
	$brand: 'auto-parseable-response-format';
	$parseRaw(content: string): ParsedT;
};

const zodTextFormatCache = new Map<z.ZodTypeAny, AutoParseableTextFormat<unknown>>();

function getCachedZodTextFormat<T>(
	zodObject: z.ZodType<T>,
	name: string
): AutoParseableTextFormat<T> {
	const cached = zodTextFormatCache.get(zodObject) as AutoParseableTextFormat<T> | undefined;

	if (cached && cached.name === name) {
		return cached;
	}

	const format = zodTextFormat(zodObject, name);
	zodTextFormatCache.set(zodObject, format);

	return format as AutoParseableTextFormat<T>;
}

function zodTextFormat(
	zodObject: z.ZodType,
	name: string
): AutoParseableTextFormat<z.infer<typeof zodObject>> {
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
		__output: undefined
	};
}
