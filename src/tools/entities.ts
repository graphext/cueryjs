import { Tool, type ModelConfig } from '../tool.ts';
import { EntitiesSchema, type Entity, type Entities } from '../schemas/entity.schema.ts';
import { dedent } from '../helpers/utils.ts';

const PROMPT = dedent(`
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

// =============================================================================
// EntityExtractor
// =============================================================================

/**
 * Configuration for the EntityExtractor tool.
 */
export interface EntityExtractorConfig {
	/** Entity type definitions (string or map of type to description) */
	entityDefinitions?: string | Record<string, string>;
	/** Additional instructions */
	instructions?: string;
}

/**
 * A tool that extracts entities from text.
 */
export class EntityExtractor extends Tool<string | null, Entities, Array<Entity>> {
	private readonly promptTemplate: string;

	constructor(config: EntityExtractorConfig = {}, modelConfig: ModelConfig) {
		super(modelConfig);
		const { entityDefinitions = '', instructions = '' } = config;

		const definitionsText =
			typeof entityDefinitions === 'string'
				? entityDefinitions
				: Object.entries(entityDefinitions)
						.map(([type, description]) => `- ${type}: ${description}`)
						.join('\n');

		this.promptTemplate = PROMPT
			.replace('{definitions}', definitionsText)
			.replace('{instructions}', instructions);
	}

	protected override schema() {
		return EntitiesSchema;
	}

	protected prompt(text: string | null) {
		return this.promptTemplate.replace('{text}', text ?? '');
	}

	protected override isEmpty(text: string | null): boolean {
		return text == null || text.trim() === '';
	}

	protected override extractResult(parsed: Entities): Array<Entity> {
		return parsed.entities;
	}
}

// Re-export schema and types
export type { Entity, Entities } from '../schemas/entity.schema.ts';
export { EntitySchema, EntitiesSchema } from '../schemas/entity.schema.ts';
