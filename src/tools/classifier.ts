import { z } from '@zod/zod';
import { Tool, type ModelConfig } from '../tool.ts';
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

	const literals = entries.map(([label, description]) =>
		z.literal(label).describe(description)
	) as [z.ZodLiteral<string>, z.ZodLiteral<string>, ...Array<z.ZodLiteral<string>>];

	return z.object({
		label: z.union(literals)
	});
}

/**
 * Creates a dynamic multi-label schema based on provided labels.
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

// =============================================================================
// Classifier (single-label classification)
// =============================================================================

interface ClassifierConfig {
	/** Map of label names to descriptions */
	labels: Record<string, string>;
	/** Additional instructions for the classifier */
	instructions?: string;
}

/**
 * A tool that classifies records into one of the provided categories.
 */
export class Classifier extends Tool<Record<string, unknown> | null, { label: string }, string> {
	private readonly labelSchema: ReturnType<typeof createLabelSchema>;
	private readonly promptTemplate: string;

	constructor(config: ClassifierConfig, modelConfig: ModelConfig) {
		super(modelConfig);
		const { labels, instructions = '' } = config;
		this.labelSchema = createLabelSchema(labels);
		this.promptTemplate = PROMPT_TEMPLATE
			.replace('{labels}', formatLabels(labels))
			.replace('{instructions}', instructions);
	}

	protected override schema() {
		return this.labelSchema;
	}

	protected prompt(record: Record<string, unknown> | null) {
		return this.promptTemplate.replace('{record}', formatRecord(record!));
	}

	protected override extractResult(parsed: { label: string }) {
		return parsed.label;
	}
}

// =============================================================================
// Labeler (multi-label classification)
// =============================================================================

/**
 * Configuration for the Labeler tool.
 */
export interface LabelerConfig {
	/** Map of label names to descriptions */
	labels: Record<string, string>;
	/** Additional instructions for the labeler */
	instructions?: string;
}

/**
 * A tool that assigns one or more labels to records from provided options.
 */
export class Labeler extends Tool<Record<string, unknown> | null, { labels: Array<string> }, Array<string>> {
	private readonly multiLabelSchema: ReturnType<typeof createMultiLabelSchema>;
	private readonly promptTemplate: string;

	constructor(config: LabelerConfig, modelConfig: ModelConfig) {
		super(modelConfig);
		const { labels, instructions = '' } = config;
		this.multiLabelSchema = createMultiLabelSchema(labels);
		this.promptTemplate = MULTI_LABEL_PROMPT_TEMPLATE
			.replace('{labels}', formatLabels(labels))
			.replace('{instructions}', instructions);
	}

	protected override schema() {
		return this.multiLabelSchema;
	}

	protected prompt(record: Record<string, unknown> | null) {
		return this.promptTemplate.replace('{record}', formatRecord(record!));
	}

	protected override extractResult(parsed: { labels: Array<string> }) {
		return parsed.labels;
	}
}

// =============================================================================
// LabelExtractor (extract classification labels from records)
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

const ExtractedLabelsSchema = z.object({
	labels: z.array(z.object({
		name: z.string(),
		description: z.string()
	}))
});

/**
 * Configuration for the LabelExtractor tool.
 */
export interface LabelExtractorConfig {
	/** Maximum number of labels to extract (default: 10) */
	nLabels?: number;
	/** Additional instructions for label extraction */
	instructions?: string;
	/** Maximum number of records to sample (default: 500) */
	maxSamples?: number;
	/** Language for labels and descriptions (default: same as records) */
	language?: string;
}

/**
 * A tool that extracts classification labels from a set of records.
 * Returns a Record<string, string> mapping label names to descriptions,
 * which can be used directly with Classifier and Labeler.
 */
export class LabelExtractor extends Tool<
	Array<Record<string, unknown>>,
	{ labels: Array<{ name: string; description: string }> },
	Record<string, string>
> {
	private readonly maxSamples: number;
	private readonly promptTemplate: string;

	constructor(config: LabelExtractorConfig = {}, modelConfig: ModelConfig) {
		super(modelConfig);
		const {
			nLabels = 10,
			instructions = '',
			maxSamples = 500,
			language = 'The same language as the records'
		} = config;

		this.maxSamples = maxSamples;
		this.promptTemplate = EXTRACT_LABELS_PROMPT
			.replace('{n_labels}', String(nLabels))
			.replace('{instructions}', instructions)
			.replace('{language}', language);
	}

	protected override schema() {
		return ExtractedLabelsSchema;
	}

	protected prompt(records: Array<Record<string, unknown>>) {
		const sampledRecords = records.length > this.maxSamples
			? records.slice(0, this.maxSamples)
			: records;
		const formattedRecords = formatRecordsAttrWise(sampledRecords);
		return this.promptTemplate.replace('{records}', formattedRecords);
	}

	protected override isEmpty(records: Array<Record<string, unknown>>): boolean {
		return !records || records.length === 0;
	}

	protected override extractResult(
		parsed: { labels: Array<{ name: string; description: string }> }
	): Record<string, string> {
		return Object.fromEntries(parsed.labels.map(l => [l.name, l.description]));
	}
}
