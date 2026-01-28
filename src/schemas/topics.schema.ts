import { z } from '@zod/zod';

/**
 * Topic schema - a topic with its subtopics.
 */
export const TopicSchema = z.object({
	topic: z.string(),
	subtopics: z.array(z.string())
});

/**
 * Taxonomy schema - contains all topics and their subtopics.
 */
export const TaxonomySchema = z.object({
	topics: z.array(TopicSchema)
});

/**
 * A topic with its subtopics.
 */
export type TopicType = z.infer<typeof TopicSchema>;

/**
 * Taxonomy structure containing all topics and their subtopics.
 */
export type TaxonomyType = z.infer<typeof TaxonomySchema>;

/**
 * Topic label assigned to a text (topic + subtopic pair).
 */
export interface TopicLabel {
	topic: string;
	subtopic: string;
}
