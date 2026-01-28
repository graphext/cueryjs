import { z } from '@zod/zod';
import { mapParallel } from '../async.ts';
import { askOpenAISafe } from '../openai.ts';

import { dedent } from '../utils.ts';

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
		value: schema
	});
}

/**
 * Assumes only remaining placeholder in prompt is {record}
 */
export async function score(
	record: Record<string, unknown>,
	prompt: string,
	schema: ScoreSchema,
	model: string = 'gpt-4.1-mini'
): Promise<number> {
	const renderedPrompt = prompt.replace('record', JSON.stringify(record, null, 2));
	const response = await askOpenAISafe(
		renderedPrompt,
		model,
		schema
	);

	if (response.parsed == null) {
		throw new Error('Failed to parse score from OpenAI response');
	}

	return (response.parsed as { value: number }).value;
}

export async function scoreBatch(
	records: Array<Record<string, unknown>>,
	name: string,
	description: string,
	type: 'integer' | 'number',
	min: number,
	max: number,
	model: string = 'gpt-4.1-mini',
	maxConcurrency: number = 100
): Promise<Array<number>> {
	const schema = makeScoreSchema(type, min, max, description);
	const prompt = PROMPT
		.replace('{name}', name)
		.replace('{type}', type)
		.replace('{min}', min.toString())
		.replace('{max}', max.toString())
		.replace('{description}', description);

	return mapParallel(
		records,
		maxConcurrency,
		(record) => score(record, prompt, schema, model)
	);
}
