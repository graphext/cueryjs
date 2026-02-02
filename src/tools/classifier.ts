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
// SpeechIntentClassifier (communicative intent classification)
// =============================================================================

/**
 * Predefined communicative intent labels based on the PIE+ framework.
 * These represent the core purposes of communication, writing, and rhetoric.
 */
export const SPEECH_INTENT_LABELS: Record<string, string> = {
	inform: 'Provides facts, data, and knowledge about a topic. Uses clear, objective language, numbers, dates, and evidence. Examples: news articles, encyclopedia entries, reports.',
	persuade: 'Aims to influence the audience\'s point of view, convince them of an idea, or move them to action. Uses emotional appeals (pathos), logical reasoning (logos), and expert credibility (ethos). Examples: speeches, advertisements, editorials.',
	entertain: 'Aims to amuse, provide enjoyment, or create a pleasant experience. Uses humor, suspense, vivid imagery, and engaging characters. Examples: novels, poems, stories, comics.',
	educate: 'Aims to teach the audience, instruct them on how to do something, or increase their understanding. Uses step-by-step instructions, clear explanations, and breaks down complex topics. Examples: textbooks, tutorials, how-to guides.',
	express_emotions: 'Shares personal feelings, evokes a specific mood, or connects emotionally with the reader. Uses vivid, emotive, or sensory language. Examples: diary entries, poetry, journals, personal essays.'
};

/**
 * Predefined instructions for speech intent classification.
 */
const SPEECH_INTENT_CLASSIFIER_INSTRUCTIONS = dedent(`
Focus on the author's PURPOSE, not the topic. A news article about entertainment is "inform", not "entertain".
Ask yourself: What is the author trying to achieve with this text?
If the text blends multiple purposes, identify the DOMINANT intent based on the overall structure and goal.
`);

/**
 * Configuration for the SpeechIntentClassifier tool.
 */
export interface SpeechIntentClassifierConfig {
	/** Additional instructions for the classifier */
	instructions?: string;
}

/**
 * A tool that classifies text into communicative/speech intents (inform, persuade, entertain, educate, express emotions).
 * Based on the PIE+ framework for understanding author's purpose.
 */
export class SpeechIntentClassifier extends Classifier {
	constructor(config: SpeechIntentClassifierConfig = {}, modelConfig: ModelConfig) {
		const { instructions = '' } = config;
		const combinedInstructions = instructions
			? `${SPEECH_INTENT_CLASSIFIER_INSTRUCTIONS}\n\n${instructions}`
			: SPEECH_INTENT_CLASSIFIER_INSTRUCTIONS;
		super({ labels: SPEECH_INTENT_LABELS, instructions: combinedInstructions }, modelConfig);
	}
}

// =============================================================================
// PlutchikEmotionClassifier (emotion classification)
// =============================================================================

/**
 * Predefined emotion labels based on Plutchik's wheel of emotions.
 * These represent the 8 primary emotions organized as 4 opposing pairs.
 */
export const PLUTCHIK_EMOTION_LABELS: Record<string, string> = {
	joy: 'A positive, high-energy state of pleasure, happiness, or contentment. Expressed through uplifting language, celebration, gratitude, or satisfaction.',
	sadness: 'A low-energy state associated with loss, grief, disappointment, or melancholy. Expressed through somber tone, themes of loss, or expressions of sorrow.',
	trust: 'A positive acceptance or affinity for others. Expressed through confidence, reliability, loyalty, or openness to connection.',
	disgust: 'A feeling of revulsion, rejection, or strong disapproval. Expressed through aversion, contempt, or moral judgment.',
	fear: 'An emotional response to danger, threat, or uncertainty. Expressed through anxiety, worry, caution, or alarm.',
	anger: 'A high-arousal response to frustration, injustice, or provocation. Expressed through criticism, outrage, hostility, or aggression.',
	surprise: 'A reaction to unexpected events or information. Expressed through astonishment, disbelief, or sudden realization.',
	anticipation: 'Looking forward to, or preparing for, future events. Expressed through expectation, excitement, hope, or vigilance.'
};

/**
 * Predefined instructions for emotion classification.
 */
const PLUTCHIK_EMOTION_CLASSIFIER_INSTRUCTIONS = dedent(`
Identify the DOMINANT emotion conveyed by the text, considering both explicit emotional language and implicit tone.
Focus on what the author/speaker is feeling or trying to evoke in the reader, not the topic being discussed.
If multiple emotions are present, choose the one that is most central to the text's emotional impact.
`);

/**
 * Configuration for the PlutchikEmotionClassifier tool.
 */
export interface PlutchikEmotionClassifierConfig {
	/** Additional instructions for the classifier */
	instructions?: string;
}

/**
 * A tool that classifies text into dominant emotions based on Plutchik's wheel of emotions.
 * The 8 primary emotions are organized as 4 opposing pairs: joy/sadness, trust/disgust, fear/anger, surprise/anticipation.
 */
export class PlutchikEmotionClassifier extends Classifier {
	constructor(config: PlutchikEmotionClassifierConfig = {}, modelConfig: ModelConfig) {
		const { instructions = '' } = config;
		const combinedInstructions = instructions
			? `${PLUTCHIK_EMOTION_CLASSIFIER_INSTRUCTIONS}\n\n${instructions}`
			: PLUTCHIK_EMOTION_CLASSIFIER_INSTRUCTIONS;
		super({ labels: PLUTCHIK_EMOTION_LABELS, instructions: combinedInstructions }, modelConfig);
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
