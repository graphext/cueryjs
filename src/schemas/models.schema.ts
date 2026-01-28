import type { SearchResult } from './search.schema.ts';

export type ModelIdentifier =
	| 'openai/chatgpt'
	| 'google/ai-overview'
	| 'google/ai-mode';

export type ModelResult = { prompt: string } & SearchResult;