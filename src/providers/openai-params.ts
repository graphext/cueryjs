import type { ProviderParams } from './types.ts';

/** Normalize Responses options without rewriting model identifiers. */
export function normalizeOpenAIParams(model: string, params: ProviderParams = {}): ProviderParams {
	if (model !== 'gpt-6-luna' && model !== 'gpt-6.1-sol') return { ...params };
	const result = { ...params };
	const reasoning = params.reasoning != null && typeof params.reasoning === 'object'
		? { ...params.reasoning as Record<string, unknown> }
		: {};
	let effort = params.reasoning_effort ?? reasoning.effort ?? (model === 'gpt-6-luna' ? 'none' : 'medium');
	if (effort === 'minimal' || (model === 'gpt-6.1-sol' && effort === 'none')) effort = 'low';
	delete result.reasoning_effort;
	result.reasoning = { ...reasoning, effort };
	if (effort !== 'none') {
		delete result.temperature;
		delete result.top_p;
	}
	return result;
}
