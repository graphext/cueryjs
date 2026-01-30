import { z } from '@zod/zod';
import { mapParallel } from '../helpers/async.ts';
import { askLLMSafe, calculateCost, type LLMResponse } from '../llm.ts';
import { BatchResponse } from '../response.ts';
import { dedent } from '../helpers/utils.ts';

const PROMPT = dedent(`
# Instructions

Assign a {name} ({type} score between {min} and {max}) to the data record below.

Score description: {description}

Make sure to consider all the attributes of the data record, and assign the score
based on the content of the attributes.

# Data Record

{record}
`);

export type ScoreSchema = z.ZodObject<{ value: z.ZodNumber }>;

/**
 * Dynamically create a Zod schema for a score based on provided parameters.
 */
export function makeScoreSchema(
	type: 'integer' | 'number',
	min: number,
	max: number,
	description: string
): ScoreSchema {
	let schema: z.ZodNumber;
	if (type === 'integer') {
		schema = z.number().int().min(min).max(max).describe(description);
	} else {
		schema = z.number().min(min).max(max).describe(description);
	}

	return z.object({
		value: schema,
	});
}

/**
 * Parameters for score (low-level, uses pre-built prompt/schema).
 */
export interface ScoreParams {
	/** The data record to score */
	record: Record<string, unknown> | null;
	/** Pre-built prompt with {record} placeholder */
	prompt: string;
	/** Pre-built score schema */
	schema: ScoreSchema;
	/** Model to use (default: 'gpt-4.1-mini') */
	model?: string;
}

/**
 * Score a single record. Returns LLMResult with usage tracking.
 * Returns null if input is empty or parsing fails.
 */
export async function score({
	record,
	prompt,
	schema,
	model = 'gpt-4.1-mini',
}: ScoreParams): Promise<LLMResponse<number | null>> {
	if (record == null || Object.keys(record).length === 0) {
		return { parsed: null, text: null, usage: null, error: null };
	}

	const renderedPrompt = prompt.replace('{record}', JSON.stringify(record, null, 2));
	const response = await askLLMSafe({
		prompt: renderedPrompt,
		model,
		schema,
		maxRetries: 3,
		onError: 'return',
	});

	if (response.error != null || response.parsed == null) {
		return {
			parsed: null,
			text: response.text,
			usage: response.usage,
			error: response.error,
		};
	}

	return {
		parsed: response.parsed.value,
		text: response.text,
		usage: response.usage,
		error: null,
	};
}

/**
 * Parameters for scoreBatch.
 */
export interface ScoreBatchParams {
	/** Array of data records to score */
	records: Array<Record<string, unknown> | null>;
	/** Name of the score metric */
	name: string;
	/** Description of what the score measures */
	description: string;
	/** Score type: 'integer' or 'number' */
	type: 'integer' | 'number';
	/** Minimum score value */
	min: number;
	/** Maximum score value */
	max: number;
	/** Model to use (default: 'gpt-4.1-mini') */
	model?: string;
	/** Max concurrent requests (default: 100) */
	maxConcurrency?: number;
	/** Enable cost tracking (default: false) */
	trackCost?: boolean;
}

/**
 * Score multiple records concurrently with usage tracking.
 * Returns BatchResponse where individual items are null on failure.
 */
export async function scoreBatch({
	records,
	name,
	description,
	type,
	min,
	max,
	model = 'gpt-4.1-mini',
	maxConcurrency = 100,
	trackCost = false,
}: ScoreBatchParams): Promise<BatchResponse<number | null>> {
	const schema = makeScoreSchema(type, min, max, description);
	const prompt = PROMPT.replace('{name}', name)
		.replace('{type}', type)
		.replace('{min}', min.toString())
		.replace('{max}', max.toString())
		.replace('{description}', description);

	const responses = await mapParallel(records, maxConcurrency, (record) =>
		score({ record, prompt, schema, model })
	);

	return new BatchResponse(
		responses.map((r) => r.parsed),
		trackCost ? responses.map((r) => r.usage) : undefined,
		trackCost ? model : undefined,
		trackCost ? calculateCost : undefined
	);
}
