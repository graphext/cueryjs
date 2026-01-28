/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
import { z } from '@zod/zod';
import { mapParallel } from '../async.ts';
import { askOpenAISafe, type AIConversation, type AIParams } from '../openai.ts';

import {
	TopicSchema,
	type TopicType,
	type TaxonomyType,
	type TopicLabel
} from '../schemas/topics.schema.ts';
import { dedent, formatRecordsAttrWise } from '../utils.ts';

// Re-export types from topics.schema.ts
export type { TopicType, TaxonomyType, TopicLabel };

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

const TOPICS_PROMPT = dedent(`
# Instructions

From the data records below, extract a two-level nested list of topics.
The output should be a JSON object with top-level topics as keys and lists of subtopics as values.
The top-level should not contain more than {n_topics} topics, and each top-level
should not contain more than {n_subtopics} subtopics.

Make sure top-level topics are generalizable and capture broad themes.
Subtopics should represent more specific categories within each theme.
Both topics and subtopics must be written in {language}.

{instructions}

# Data Records

{records}
`);

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
 * Assigns a topic and subtopic to a single text using an LLM call.
 */
export async function assignTopic(
	text: string | null,
	taxonomy: TaxonomyType | Array<TopicType> | string,
	labelSchema: z.ZodType<TopicLabel>,
	model: string = 'gpt-5.1',
	modelParams: AIParams = { reasoning: { effort: 'none' } }
): Promise<TopicLabel | null> {

	if (text == null || text.trim() === '') {
		return null;
	}

	const systemPrompt = LABEL_PROMPT_SYSTEM.replace(
		'{taxonomy}',
		typeof taxonomy === 'string' ? taxonomy : JSON.stringify(taxonomy, null, 2)
	);
	const userPrompt = LABEL_PROMPT_USER.replace('{text}', text);

	const prompts: AIConversation = [
		{ role: 'system', content: systemPrompt },
		{ role: 'user', content: userPrompt }
	];

	try {
		const { parsed, error } = await askOpenAISafe(prompts, model, labelSchema, modelParams);
		if (error != null || parsed == null) {
			return null;
		}
		return parsed;
	} catch (error) {
		console.warn(`Failed to assign topic for text "${text.substring(0, 50)}...":`, error);
		return null;
	}
}

/**
 * Assigns topics to multiple texts concurrently while preserving order.
 */
export function assignTopics(
	texts: Array<string | null>,
	taxonomy: TaxonomyType | Array<TopicType>,
	model: string = 'gpt-5.1',
	modelParams: AIParams = { reasoning: { effort: 'none' } },
	maxConcurrency: number = 100
): Promise<Array<TopicLabel | null>> {

	// Precompute normalized taxonomy and label schema once for whole batch
	const normalizedTaxonomy: TaxonomyType = Array.isArray(taxonomy)
		? { topics: taxonomy }
		: taxonomy;

	const labelSchema = createLabelSchema(normalizedTaxonomy);

	const serializedTaxonomy = JSON.stringify(normalizedTaxonomy, null, 2);

	return mapParallel(
		texts,
		maxConcurrency,
		text => assignTopic(text, serializedTaxonomy, labelSchema, model, modelParams)
	);
}

export interface TopicExtractionOptions {
	records: Array<Record<string, unknown>>;
	nTopics?: number;
	nSubtopics?: number;
	instructions?: string;
	maxSamples?: number;
	model?: string;
	modelParams?: AIParams;
	maxRetries?: number;
	language?: string;
}

/**
 * Extracts a topic hierarchy from an array of records using an LLM.
 */
export async function extractTopics({
	records,
	nTopics = 10,
	nSubtopics = 5,
	instructions = '',
	maxSamples = 500,
	model = 'gpt-4.1',
	modelParams = {},
	maxRetries = 8,
	language = 'The same language as the records'
}: TopicExtractionOptions): Promise<TaxonomyType> {
	if (!records || records.length === 0) {
		return { topics: [] };
	}

	const sampledRecords = records.length > maxSamples
		? records.slice(0, maxSamples)
		: records;

	const formattedRecords = formatRecordsAttrWise(sampledRecords);

	const prompt = TOPICS_PROMPT
		.replace('{n_topics}', String(nTopics))
		.replace('{n_subtopics}', String(nSubtopics))
		.replace('{instructions}', instructions)
		.replace('{records}', formattedRecords)
		.replace('{language}', language);

	const { parsed, output_text, error } = await askOpenAISafe(prompt, model, Taxonomy, modelParams, maxRetries, 'return');

	if (error != null) {
		if (output_text == null) {
			throw new Error('Failed to get response from OpenAI');
		}

		try {
			const taxonomy = JSON.parse(output_text);
			return TaxonomyBase.parse(taxonomy);
		} catch (parseError) {
			throw new Error(`Failed to parse response even without validation: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
		}
	}

	if (parsed == null) {
		throw new Error('Failed to parse response from OpenAI');
	}

	return parsed;
}

