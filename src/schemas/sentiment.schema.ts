import { z } from '@zod/zod';

export const ABSentimentSchema = z.object({
	aspect: z.string().describe('The specific entity or aspect mentioned in the text.'),
	sentiment: z.enum(['positive', 'negative']).describe('The sentiment expressed toward the aspect, either positive or negative.'),
	reason: z.string().describe('A brief explanation of why this sentiment was assigned to the aspect.'),
	quote: z.string().describe('The exact text fragment from the input containing both the aspect and the sentiment expressed about it.'),
	context: z.string().nullable().describe('Optional contextual information about the aspect, such as the brand or entity it relates to.')
});

export const ABSentimentsSchema = z.object({
	aspects: z.array(ABSentimentSchema).describe('A list of aspects with their associated sentiments, reasons, and quotes.')
});

export type ABSentiment = z.infer<typeof ABSentimentSchema>;
export type ABSentiments = z.infer<typeof ABSentimentsSchema>;