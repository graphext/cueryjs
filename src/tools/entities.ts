import { mapParallel } from '../async.ts';
import { askOpenAISafe, type AIParams } from '../openai.ts';

import { EntitiesSchema, type Entity } from '../schemas/entity.schema.ts';
import { dedent } from '../utils.ts';

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
 *
 * Extracts free-form entities from the given text (without enforced entity types).
 */
export async function extractAnyEntities(
	body: string,
	instructions: string = '',
	model: string,
	modelParams: AIParams = {}
): Promise<Array<Entity>> {
	const prompt = PROMPT
		.replace('{definitions}', '')
		.replace('{text}', body)
		.replace('{instructions}', instructions);

	const { parsed } = await askOpenAISafe(prompt, model, EntitiesSchema, modelParams);
	if (!parsed) {
		throw new Error('Failed to parse response from OpenAI');
	}

	return parsed.entities;
}

/**
 * Extracts entities in pre-specified categories from a single text.
 */
export async function extractEntitiesFromText(
	text: string | null,
	entityDefinitions: string | Record<string, string>,
	instructions: string = '',
	model: string = 'gpt-4.1-mini',
	modelParams: AIParams = {}
): Promise<Array<Entity>> {
	if (text === null) {
		return [];
	}

	const definitionsText = typeof entityDefinitions === 'string'
		? entityDefinitions
		: Object.entries(entityDefinitions)
			.map(([type, description]) => `- ${type}: ${description}`)
			.join('\n');

	const prompt = PROMPT
		.replace('{definitions}', definitionsText)
		.replace('{text}', text)
		.replace('{instructions}', instructions);

	const { parsed } = await askOpenAISafe(prompt, model, EntitiesSchema, modelParams);
	if (!parsed) {
		throw new Error('Failed to parse response from OpenAI');
	}

	return parsed.entities;
}


/**
 * Extracts entities from a batch of texts.
 */
export async function extractEntitiesBatch(
	texts: Array<string | null>,
	entityDefinitions: Record<string, string> | string,
	instructions: string = '',
	model: string = 'gpt-4.1-mini',
	maxConcurrency: number = 100,
	modelParams: AIParams = {}
): Promise<Array<Array<Entity>>> {

	// Do this once outside the loop
	const definitions = typeof entityDefinitions === 'string'
		? entityDefinitions
		: Object.entries(entityDefinitions)
			.map(([type, description]) => `- ${type}: ${description}`)
			.join('\n');

	return mapParallel(
		texts,
		maxConcurrency,
		(text: string | null) => extractEntitiesFromText(text, definitions, instructions, model, modelParams)
	);
}

export type { Entity, Entities } from '../schemas/entity.schema.ts';
export { EntitySchema, EntitiesSchema } from '../schemas/entity.schema.ts';