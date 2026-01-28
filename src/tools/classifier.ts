import { z } from '@zod/zod';
import { mapParallel } from '../async.ts';
import { askOpenAISafe } from '../openai.ts';

import { dedent } from '../utils.ts';

const PROMPT_TEMPLATE = dedent(`
# Instructions

You're task is to classify the data record below into one of the following categories:

{labels}

Make sure to consider all the attributes of the data record, and assign the class
based on the content of the attributes.

{instructions}

# Data Record

{record}
`);

const MULTI_LABEL_PROMPT_TEMPLATE = dedent(`
# Instructions

You're task is to assign one or more labels to the data record below from the following options:

{labels}

Make sure to consider all the attributes of the data record. A record can have multiple labels
if it matches multiple categories. Assign all relevant labels that apply to the record.

{instructions}

# Data Record

{record}
`);

/**
 * Formats a record object into a human-readable text representation.
 * Similar to the record_to_text.jinja template in Python.
 */
function formatRecord(record: Record<string, unknown>): string {
	return Object.entries(record)
		.map(([key, value]) => `${key}: ${JSON.stringify(value, null, 2)}`)
		.join('\n\n');
}

/**
 * Generates the labels definition section for the classification prompt.
 */
function formatLabels(labels: Record<string, string>): string {
	return Object.entries(labels)
		.map(([label, description]) => `- "${label}": ${description}`)
		.join('\n');
}

/**
 * Creates a dynamic Category schema based on provided labels.
 * Each category literal includes its description, which helps the LLM understand the classification.
 */
function createLabelSchema(labels: Record<string, string>) {
	const entries = Object.entries(labels);

	if (entries.length === 0) {
		throw new Error('At least one category must be provided');
	}

	if (entries.length === 1) {
		const [label, description] = entries[0];
		return z.object({
			label: z.literal(label).describe(description)
		});
	}

	// TypeScript now knows entries.length >= 2
	const literals = entries.map(([label, description]) =>
		z.literal(label).describe(description)
	) as [z.ZodLiteral<string>, z.ZodLiteral<string>, ...Array<z.ZodLiteral<string>>];

	return z.object({
		label: z.union(literals)
	});
}

/**
 * Creates a dynamic multi-label schema based on provided labels.
 * Returns a schema that accepts an array of labels, reusing the single label schema.
 */
function createMultiLabelSchema(labels: Record<string, string>) {
	const singleLabelSchema = createLabelSchema(labels);
	const labelType = singleLabelSchema.shape.label;

	return z.object({
		labels: z.array(labelType)
			.min(0)
			.describe('Array of assigned labels')
	});
}

/**
 * Classifies a single data record into one of the provided categories using an LLM call.
 */
export async function classify(
	record: Record<string, unknown> | null,
	labels: Record<string, string>,
	instructions: string = '',
	model: string = 'gpt-4.1-mini'
): Promise<string | null> {
	if (record == null || Object.keys(record).length === 0) {
		return null;
	}

	const categorySchema = createLabelSchema(labels);
	const prompt = PROMPT_TEMPLATE
		.replace('{labels}', formatLabels(labels))
		.replace('{instructions}', instructions)
		.replace('{record}', formatRecord(record));

	const { parsed } = await askOpenAISafe(prompt, model, categorySchema);
	if (!parsed) {
		throw new Error('Failed to parse response from OpenAI');
	}

	return parsed.label;
}

/**
 * Classifies multiple data records concurrently while preserving order.
 */
export function classifyBatch(
	records: Array<Record<string, unknown> | null>,
	labels: Record<string, string>,
	instructions: string = '',
	model: string = 'gpt-4.1-mini',
	maxConcurrency: number = 100
): Promise<Array<string | null>> {
	return mapParallel(
		records,
		maxConcurrency,
		record => classify(record, labels, instructions, model)
	);
}

/**
 * Assigns one or more labels to a single data record using an LLM call.
 */
export async function label(
	record: Record<string, unknown> | null,
	labels: Record<string, string>,
	instructions: string = '',
	model: string = 'gpt-4.1-mini'
): Promise<Array<string> | null> {
	if (record == null || Object.keys(record).length === 0) {
		return null;
	}

	const multiLabelSchema = createMultiLabelSchema(labels);
	const prompt = MULTI_LABEL_PROMPT_TEMPLATE
		.replace('{labels}', formatLabels(labels))
		.replace('{instructions}', instructions)
		.replace('{record}', formatRecord(record));

	const { parsed } = await askOpenAISafe(prompt, model, multiLabelSchema);
	if (!parsed) {
		throw new Error('Failed to parse response from OpenAI');
	}

	return parsed.labels;
}

/**
 * Assigns labels to multiple data records concurrently while preserving order.
 */
export function labelBatch(
	records: Array<Record<string, unknown> | null>,
	labels: Record<string, string>,
	instructions: string = '',
	model: string = 'gpt-4.1-mini',
	maxConcurrency: number = 100
): Promise<Array<Array<string> | null>> {
	return mapParallel(
		records,
		maxConcurrency,
		record => label(record, labels, instructions, model)
	);
}
