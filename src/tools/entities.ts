import { mapParallel } from '../helpers/async.ts';
import { askLLMSafe, calculateCost, type LLMResponse, type ProviderParams } from '../llm.ts';
import { BatchResponse } from '../response.ts';
import { EntitiesSchema, type Entity } from '../schemas/entity.schema.ts';
import { dedent } from '../helpers/utils.ts';

export const PROMPT = dedent(`
# Instructions

From the Data Record section below extract entities in the following categories:

{definitions}

For each entity, provide the entity name/text as it appears, and the type/category of entity.
Ensure to report the names of entities always in lowercase and singular form, even if
they appear in plural or uppercase in the source titles, to avoid inconsistencies in the output.

Expected output format:

[{"name": "<entity name>", "type": "<entity type>"}, ...]

For example, if the data record contains "Apple iPhone 15 Pro Max Review", and entity
definitions include a "brand" category and a "product" category, the expected output would be:

[{"name": "apple", "type": "brand"}, {"name": "iphone 15", "type": "product"}]

{instructions}

# Data Record

{text}
`);

/**
 * Parameters for extractAnyEntities.
 */
export interface ExtractAnyEntitiesParams {
	/** Text to extract entities from */
	body: string | null;
	/** Additional instructions */
	instructions?: string;
	/** Model to use (default: 'gpt-4.1-mini') */
	model?: string;
	/** Provider-specific parameters */
	modelParams?: ProviderParams;
}

/**
 * Extracts free-form entities from the given text (without enforced entity types).
 * Returns LLMResult with usage tracking.
 */
export async function extractAnyEntities({
	body,
	instructions = '',
	model = 'gpt-4.1-mini',
	modelParams = {},
}: ExtractAnyEntitiesParams): Promise<LLMResponse<Array<Entity> | null>> {
	if (body == null || body.trim() === '') {
		return { parsed: null, text: null, usage: null, error: null };
	}

	const prompt = PROMPT.replace('{definitions}', '')
		.replace('{text}', body)
		.replace('{instructions}', instructions);

	const response = await askLLMSafe({
		prompt,
		model,
		schema: EntitiesSchema,
		params: modelParams,
		maxRetries: 3,
		onError: 'return',
	});

	if (response.error != null || response.parsed == null) {
		return {
			parsed: null,
			text: response.text,
			usage: response.usage,
			error: response.error,
		};
	}

	return {
		parsed: response.parsed.entities,
		text: response.text,
		usage: response.usage,
		error: null,
	};
}

/**
 * Parameters for extractEntitiesFromText.
 */
export interface ExtractEntitiesParams {
	/** Text to extract entities from */
	text: string | null;
	/** Entity type definitions (string or map of type to description) */
	entityDefinitions: string | Record<string, string>;
	/** Additional instructions */
	instructions?: string;
	/** Model to use (default: 'gpt-4.1-mini') */
	model?: string;
	/** Provider-specific parameters */
	modelParams?: ProviderParams;
}

/**
 * Extracts entities in pre-specified categories from a single text.
 * Returns LLMResult with usage tracking.
 */
export async function extractEntitiesFromText({
	text,
	entityDefinitions,
	instructions = '',
	model = 'gpt-4.1-mini',
	modelParams = {},
}: ExtractEntitiesParams): Promise<LLMResponse<Array<Entity> | null>> {
	if (text == null || text.trim() === '') {
		return { parsed: null, text: null, usage: null, error: null };
	}

	const definitionsText =
		typeof entityDefinitions === 'string'
			? entityDefinitions
			: Object.entries(entityDefinitions)
					.map(([type, description]) => `- ${type}: ${description}`)
					.join('\n');

	const prompt = PROMPT.replace('{definitions}', definitionsText)
		.replace('{text}', text)
		.replace('{instructions}', instructions);

	const response = await askLLMSafe({
		prompt,
		model,
		schema: EntitiesSchema,
		params: modelParams,
		maxRetries: 3,
		onError: 'return',
	});

	if (response.error != null || response.parsed == null) {
		return {
			parsed: null,
			text: response.text,
			usage: response.usage,
			error: response.error,
		};
	}

	return {
		parsed: response.parsed.entities,
		text: response.text,
		usage: response.usage,
		error: null,
	};
}

/**
 * Parameters for extractEntitiesBatch.
 */
export interface ExtractEntitiesBatchParams {
	/** Array of texts to extract entities from */
	texts: Array<string | null>;
	/** Entity type definitions (string or map of type to description) */
	entityDefinitions: Record<string, string> | string;
	/** Additional instructions */
	instructions?: string;
	/** Model to use (default: 'gpt-4.1-mini') */
	model?: string;
	/** Max concurrent requests (default: 100) */
	maxConcurrency?: number;
	/** Provider-specific parameters */
	modelParams?: ProviderParams;
	/** Enable cost tracking (default: false) */
	trackCost?: boolean;
}

/**
 * Extracts entities from a batch of texts with usage tracking.
 * Returns BatchResponse where individual items are null on failure.
 */
export async function extractEntitiesBatch({
	texts,
	entityDefinitions,
	instructions = '',
	model = 'gpt-4.1-mini',
	maxConcurrency = 100,
	modelParams = {},
	trackCost = false,
}: ExtractEntitiesBatchParams): Promise<BatchResponse<Array<Entity> | null>> {
	// Format definitions once outside the loop
	const definitions =
		typeof entityDefinitions === 'string'
			? entityDefinitions
			: Object.entries(entityDefinitions)
					.map(([type, description]) => `- ${type}: ${description}`)
					.join('\n');

	const responses = await mapParallel(texts, maxConcurrency, (text) =>
		extractEntitiesFromText({ text, entityDefinitions: definitions, instructions, model, modelParams })
	);

	return new BatchResponse(
		responses.map((r) => r.parsed),
		trackCost ? responses.map((r) => r.usage) : undefined,
		trackCost ? model : undefined,
		trackCost ? calculateCost : undefined
	);
}

export type { Entity, Entities } from '../schemas/entity.schema.ts';
export { EntitySchema, EntitiesSchema } from '../schemas/entity.schema.ts';
