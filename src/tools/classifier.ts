import { z } from '@zod/zod';
import { mapParallel } from '../helpers/async.ts';
import { askLLMSafe, calculateCost, type ProviderParams, type LLMResponse } from '../llm.ts';
import { BatchResponse } from '../response.ts';
import { dedent, formatRecordsAttrWise } from '../helpers/utils.ts';

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
 * Parameters for classify.
 */
export interface ClassifyParams {
	/** The data record to classify */
	record: Record<string, unknown> | null;
	/** Map of label names to descriptions */
	labels: Record<string, string>;
	/** Additional instructions for the classifier */
	instructions?: string;
	/** Model to use (default: 'gpt-4.1-mini') */
	model?: string;
}

/**
 * Classifies a single data record into one of the provided categories using an LLM call.
 * Returns both the result and usage information.
 */
export async function classify({
	record,
	labels,
	instructions = '',
	model = 'gpt-4.1-mini',
}: ClassifyParams): Promise<LLMResponse<string | null>> {
	if (record == null || Object.keys(record).length === 0) {
		return { parsed: null, text: null, usage: null, error: null };
	}

	const categorySchema = createLabelSchema(labels);
	const prompt = PROMPT_TEMPLATE
		.replace('{labels}', formatLabels(labels))
		.replace('{instructions}', instructions)
		.replace('{record}', formatRecord(record));

	const response = await askLLMSafe({ prompt, model, schema: categorySchema });
	if (!response.parsed) {
		throw new Error('Failed to parse response from LLM');
	}

	return { parsed: response.parsed.label, text: response.text, usage: response.usage, error: null };
}

/**
 * Parameters for classifyBatch.
 */
export interface ClassifyBatchParams {
	/** Array of data records to classify */
	records: Array<Record<string, unknown> | null>;
	/** Map of label names to descriptions */
	labels: Record<string, string>;
	/** Additional instructions for the classifier */
	instructions?: string;
	/** Model to use (default: 'gpt-4.1-mini') */
	model?: string;
	/** Max concurrent requests (default: 100) */
	maxConcurrency?: number;
	/** Enable cost tracking (default: false) */
	trackCost?: boolean;
}

/**
 * Classifies multiple data records concurrently while preserving order.
 * Returns a BatchResponse with optional usage tracking.
 */
export async function classifyBatch({
	records,
	labels,
	instructions = '',
	model = 'gpt-4.1-mini',
	maxConcurrency = 100,
	trackCost = false,
}: ClassifyBatchParams): Promise<BatchResponse<string | null>> {
	const responses = await mapParallel(records, maxConcurrency, (record) =>
		classify({ record, labels, instructions, model })
	);

	return new BatchResponse(
		responses.map(r => r.parsed),
		trackCost ? responses.map(r => r.usage) : undefined,
		trackCost ? model : undefined,
		trackCost ? calculateCost : undefined
	);
}

/**
 * Parameters for label (same as ClassifyParams).
 */
export type LabelParams = ClassifyParams;

/**
 * Assigns one or more labels to a single data record using an LLM call.
 * Returns both the result and usage information.
 */
export async function label({
	record,
	labels,
	instructions = '',
	model = 'gpt-4.1-mini',
}: LabelParams): Promise<LLMResponse<Array<string> | null>> {
	if (record == null || Object.keys(record).length === 0) {
		return { parsed: null, text: null, usage: null, error: null };
	}

	const multiLabelSchema = createMultiLabelSchema(labels);
	const prompt = MULTI_LABEL_PROMPT_TEMPLATE
		.replace('{labels}', formatLabels(labels))
		.replace('{instructions}', instructions)
		.replace('{record}', formatRecord(record));

	const response = await askLLMSafe({ prompt, model, schema: multiLabelSchema });
	if (!response.parsed) {
		throw new Error('Failed to parse response from LLM');
	}

	return { parsed: response.parsed.labels, text: response.text, usage: response.usage, error: null };
}

/**
 * Parameters for labelBatch (same as ClassifyBatchParams).
 */
export type LabelBatchParams = ClassifyBatchParams;

/**
 * Assigns labels to multiple data records concurrently while preserving order.
 * Returns a BatchResponse with optional usage tracking.
 */
export async function labelBatch({
	records,
	labels,
	instructions = '',
	model = 'gpt-4.1-mini',
	maxConcurrency = 100,
	trackCost = false,
}: LabelBatchParams): Promise<BatchResponse<Array<string> | null>> {
	const responses = await mapParallel(records, maxConcurrency, (record) =>
		label({ record, labels, instructions, model })
	);

	return new BatchResponse(
		responses.map(r => r.parsed),
		trackCost ? responses.map(r => r.usage) : undefined,
		trackCost ? model : undefined,
		trackCost ? calculateCost : undefined
	);
}

// =============================================================================
// Label Extraction
// =============================================================================

const EXTRACT_LABELS_PROMPT = dedent(`
# Instructions

From the data records below, extract a flat list of classification labels.
The output should be a JSON object with a "labels" array, where each item has a "name" and "description".
The list should not contain more than {n_labels} labels.

Make sure labels are generalizable and capture broad themes.
Each label should have a clear, concise description explaining what it represents.
Labels and descriptions must be written in {language}.

The labels should follow the MECE framework (Mutually Exclusive, Collectively Exhaustive):
- Mutually Exclusive: Labels should not overlap; each record should fit clearly into one category.
- Collectively Exhaustive: Labels should cover all the data; every record should have a fitting category.
- If needed, include an "Other" category for records that don't fit well into the main labels.

If the records contain mainly textual content (e.g., articles, posts, comments, descriptions),
the labels should represent the main topics or subject areas covered by the text,
unless the user provides different instructions below.

{instructions}

# Data Records

{records}
`);

/**
 * Schema for extracted labels - an array of label objects.
 * Uses array format instead of record because OpenAI doesn't support propertyNames in JSON schema.
 */
const ExtractedLabelsSchema = z.object({
	labels: z.array(z.object({
		name: z.string(),
		description: z.string()
	}))
});

export interface LabelExtractionOptions {
	records: Array<Record<string, unknown>>;
	nLabels?: number;
	instructions?: string;
	maxSamples?: number;
	model?: string;
	modelParams?: ProviderParams;
	maxRetries?: number;
	language?: string;
}

/**
 * Extracts a set of classification labels from an array of records using an LLM.
 * Returns a Record<string, string> mapping label names to descriptions,
 * which can be used directly with classify() and classifyBatch().
 */
export async function extractLabels({
	records,
	nLabels = 10,
	instructions = '',
	maxSamples = 500,
	model = 'gpt-4.1',
	modelParams = {},
	maxRetries = 8,
	language = 'The same language as the records'
}: LabelExtractionOptions): Promise<Record<string, string>> {
	if (!records || records.length === 0) {
		return {};
	}

	const sampledRecords = records.length > maxSamples
		? records.slice(0, maxSamples)
		: records;

	const formattedRecords = formatRecordsAttrWise(sampledRecords);

	const prompt = EXTRACT_LABELS_PROMPT
		.replace('{n_labels}', String(nLabels))
		.replace('{instructions}', instructions)
		.replace('{records}', formattedRecords)
		.replace('{language}', language);

	const { parsed, text, error } = await askLLMSafe({
		prompt,
		model,
		schema: ExtractedLabelsSchema,
		params: modelParams,
		maxRetries,
		onError: 'return',
	});

	if (error != null) {
		if (text == null) {
			throw new Error('Failed to get response from LLM');
		}

		try {
			const extracted = JSON.parse(text);
			const { labels } = ExtractedLabelsSchema.parse(extracted);
			return Object.fromEntries(labels.map((l: { name: string; description: string }) => [l.name, l.description]));
		} catch (parseError) {
			throw new Error(`Failed to parse response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
		}
	}

	if (parsed == null) {
		throw new Error('Failed to parse response from OpenAI');
	}

	return Object.fromEntries(parsed.labels.map(l => [l.name, l.description]));
}
