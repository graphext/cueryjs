import { z } from '@zod/zod';

export const SummarySchema = z.object({
	summary: z.string().describe('The summarized text, condensed to approximately the target word count while preserving key information.')
});

export type Summary = z.infer<typeof SummarySchema>;
