/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
import { z } from '@zod/zod';
import { Tool, type ModelConfig } from '../tool.ts';
import type { Message } from '../llm.ts';

import {
	TopicSchema,
	type TopicType,
	type TaxonomyType,
	type TopicLabel
} from '../schemas/topics.schema.ts';
import { dedent, formatRecordsAttrWise } from '../helpers/utils.ts';

// Re-export types from topics.schema.ts
export type { TopicType, TaxonomyType, TopicLabel };

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Levenshtein distance implementation for string similarity validation
 */
function levenshteinDistance(a: string, b: string): number {
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	const matrix = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(0));

	for (let i = 0; i <= a.length; i++) {
		matrix[i][0] = i;
	}

	for (let j = 0; j <= b.length; j++) {
		matrix[0][j] = j;
	}

	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			matrix[i][j] = Math.min(
				matrix[i - 1][j] + 1,        // deletion
				matrix[i][j - 1] + 1,        // insertion
				matrix[i - 1][j - 1] + cost  // substitution
			);
		}
	}

	return matrix[a.length][b.length];
}

/**
 * Validates that subtopics are sufficiently distinct from each other and from the parent topic.
 */
function validateSubtopics(topic: string, subtopics: Array<string>): Array<string> {
	const MIN_LDIST = 2;
	const subtopicsLower = subtopics.map((st: string) => st.toLowerCase());
	const errors: Array<string> = [];

	for (let i = 0; i < subtopicsLower.length; i++) {
		const st = subtopicsLower[i];

		// Subtopics should not be too similar to their parent topic
		if (levenshteinDistance(st, topic.toLowerCase()) < MIN_LDIST) {
			errors.push(`Subtopic '${st}' too similar to parent topic '${topic}'.`);
		}

		// Subtopics should not be too similar to each other
		for (let j = i + 1; j < subtopicsLower.length; j++) {
			const other = subtopicsLower[j];

			// Check Levenshtein distance for similarity
			if (levenshteinDistance(st.replace(/ /g, ''), other.replace(/ /g, '')) < MIN_LDIST) {
				errors.push(`Subtopic '${st}' too similar to other subtopic '${other}'.`);
			}

			// Check for permutations of words
			const stWords = new Set(st.split(' '));
			const otherWords = new Set(other.split(' '));
			if (stWords.size === otherWords.size &&
				[...stWords].every(word => otherWords.has(word))) {
				errors.push(`Subtopic '${st}' is a duplicate (permutation) of subtopic '${other}'.`);
			}
		}
	}

	return errors;
}

// =============================================================================
// Schemas
// =============================================================================

/**
 * Topic schema with subtopic validation
 * Validates that subtopics are sufficiently distinct from each other and from the parent topic.
 */
export const Topic = TopicSchema.superRefine(({ topic, subtopics }, ctx) => {
	const errors = validateSubtopics(topic, subtopics);
	for (const error of errors) {
		ctx.addIssue({
			code: 'custom',
			message: error,
			path: ['subtopics']
		});
	}
});

/**
 * Taxonomy schema WITHOUT validation for fallback parsing
 */
export const TaxonomyBase = z.object({
	topics: z.array(TopicSchema)
});

/**
 * Taxonomy schema with topic validation
 */
export const Taxonomy = z.object({
	topics: z.array(Topic)
});

/**
 * Converts a taxonomy in the format Record<string, Array<string>> to an array
 * of topic objects compatible with the Topic schema.
 */
export function toTopics(taxonomy: Record<string, Array<string>>): Array<{ topic: string; subtopics: Array<string> }> {
	return Object.entries(taxonomy).map(([topic, subtopics]) => ({
		topic,
		subtopics
	}));
}

/**
 * Creates a dynamic TopicLabel schema based on a topic hierarchy
 * Validates that subtopic belongs to the correct topic
 */
export function createLabelSchema(taxonomy: TaxonomyType) {
	const topicNames = taxonomy.topics.map(t => t.topic);
	const allSubtopics = taxonomy.topics.flatMap(t => t.subtopics);

	return z.object({
		topic: z.enum(topicNames as [string, ...Array<string>]),
		subtopic: z.enum(allSubtopics as [string, ...Array<string>])
	}).superRefine((data, ctx) => {
		const topicEntry = taxonomy.topics.find(t => t.topic === data.topic);
		const allowedSubtopics = topicEntry?.subtopics || [];
		if (!allowedSubtopics.includes(data.subtopic)) {
			ctx.addIssue({
				code: 'custom',
				message: `Subtopic '${data.subtopic}' is not a valid subtopic for topic '${data.topic}'. ` +
					`Allowed subtopics are: ${allowedSubtopics.join(', ')}.`,
				path: ['subtopic']
			});
		}
	});
}

// =============================================================================
// TopicExtractor
// =============================================================================

const TOPICS_PROMPT = dedent(`
# Instructions

From the data records below, extract a two-level nested list of topics.
The output should be a JSON object with top-level topics as keys and lists of subtopics as values.
The top-level should not contain more than {n_topics} topics, and each top-level
should not contain more than {n_subtopics} subtopics. Fewer topics are acceptable, and appropriate if
the data does not support that many or if there are too few records.

Make sure top-level topics are generalizable and capture broad themes.
Subtopics should represent more specific categories within each theme.
Both topics and subtopics must be written in {language}.

The taxonomy should follow the MECE framework (Mutually Exclusive, Collectively Exhaustive):
- Mutually Exclusive: Topics and subtopics should not overlap; each record should fit clearly into one category.
- Collectively Exhaustive: The taxonomy should cover all the data; every record should have a fitting topic and subtopic.
- If needed, include an "Other" topic or subtopic for records that don't fit well into the main categories.

{instructions}

# Data Records

{records}
`);

export interface TopicExtractorConfig {
	/** Maximum number of top-level topics (default: 10) */
	nTopics?: number;
	/** Maximum number of subtopics per topic (default: 5) */
	nSubtopics?: number;
	/** Additional instructions */
	instructions?: string;
	/** Maximum number of records to sample (default: 500) */
	maxSamples?: number;
	/** Language for topics (default: same as records) */
	language?: string;
}

/**
 * A tool that extracts a topic taxonomy from a set of records.
 */
export class TopicExtractor extends Tool<
	Array<Record<string, unknown>>,
	TaxonomyType,
	TaxonomyType
> {
	private readonly maxSamples: number;
	private readonly promptTemplate: string;

	constructor(config: TopicExtractorConfig = {}, modelConfig: ModelConfig) {
		super(modelConfig);
		const {
			nTopics = 10,
			nSubtopics = 5,
			instructions = '',
			maxSamples = 500,
			language = 'The same language as the records'
		} = config;

		this.maxSamples = maxSamples;
		this.promptTemplate = TOPICS_PROMPT
			.replace('{n_topics}', String(nTopics))
			.replace('{n_subtopics}', String(nSubtopics))
			.replace('{instructions}', instructions)
			.replace('{language}', language);
	}

	protected override schema() {
		return Taxonomy;
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

	/**
	 * Not supported. TopicExtractor is an aggregation operation that extracts
	 * a single taxonomy from many records. Use invoke() instead.
	 */
	override batch(): never {
		throw new Error(
			'TopicExtractor.batch() is not supported. ' +
			'This tool extracts a single taxonomy from many records (aggregation). ' +
			'Use invoke() with all records instead.'
		);
	}
}

// =============================================================================
// TopicAssigner
// =============================================================================

const LABEL_PROMPT_SYSTEM = dedent(`
You're task is to use the following hierarchy of topics and subtopics (in json format),
to assign the correct topic and subtopic to each text in the input.
You cannot invent new topics or subtopics.
You cannot assign a subtopic that does not belong to the assigned topic.

# Topics

{taxonomy}
`);

const LABEL_PROMPT_USER = dedent(`
Assign the correct topic and subtopic to the following text.

# Text

{text}
`);

/**
 * Configuration for the TopicAssigner tool.
 */
export interface TopicAssignerConfig {
	taxonomy: TaxonomyType | Array<TopicType>;
}

/**
 * A tool that assigns topic and subtopic labels to text based on a taxonomy.
 */
export class TopicAssigner extends Tool<string | null, TopicLabel, TopicLabel> {
	private readonly labelSchema: z.ZodType<TopicLabel>;
	private readonly systemPrompt: string;

	constructor(config: TopicAssignerConfig, modelConfig: ModelConfig) {
		super(modelConfig);
		const { taxonomy } = config;

		// Normalize taxonomy to TaxonomyType
		const normalizedTaxonomy: TaxonomyType = Array.isArray(taxonomy)
			? { topics: taxonomy }
			: taxonomy;

		// Build schema and system prompt once in constructor
		this.labelSchema = createLabelSchema(normalizedTaxonomy);
		this.systemPrompt = LABEL_PROMPT_SYSTEM.replace(
			'{taxonomy}',
			JSON.stringify(normalizedTaxonomy, null, 2)
		);
	}

	protected override schema() {
		return this.labelSchema;
	}

	protected prompt(text: string | null): Message[] {
		const userPrompt = LABEL_PROMPT_USER.replace('{text}', text ?? '');
		return [
			{ role: 'system', content: this.systemPrompt },
			{ role: 'user', content: userPrompt }
		];
	}

	protected override isEmpty(text: string | null): boolean {
		return text == null || text.trim() === '';
	}
}
