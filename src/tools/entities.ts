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

// =============================================================================
// CommonEntityExtractor
// =============================================================================

/**
 * Predefined common entity types for general-purpose extraction.
 */
export const COMMON_ENTITY_DEFINITIONS: Record<string, string> = {
	person: 'Names of people, individuals, celebrities, public figures',
	organization: 'Companies, institutions, agencies, teams, corporations',
	location: 'Places, cities, countries, regions, addresses, landmarks',
	product: 'Products, services, software, apps, models',
	brand: 'Brand names, trademarks',
	date: 'Dates, time periods, years, seasons',
	money: 'Monetary values, prices, currencies, financial amounts',
	event: 'Events, conferences, meetings, holidays, incidents'
};

/**
 * Configuration for the CommonEntityExtractor tool.
 */
export interface CommonEntityExtractorConfig {
	/** Additional entity definitions to merge with common ones */
	additionalDefinitions?: Record<string, string>;
	/** Entity types to exclude from common definitions */
	excludeTypes?: Array<string>;
	/** Additional instructions */
	instructions?: string;
}

/**
 * A tool that extracts common entity types (person, organization, location, etc.) from text.
 * Extends EntityExtractor with predefined entity definitions.
 */
export class CommonEntityExtractor extends EntityExtractor {
	constructor(config: CommonEntityExtractorConfig = {}, modelConfig: ModelConfig) {
		const { additionalDefinitions = {}, excludeTypes = [], instructions = '' } = config;

		// Filter out excluded types and merge with additional definitions
		const filteredDefinitions = Object.fromEntries(
			Object.entries(COMMON_ENTITY_DEFINITIONS).filter(([type]) => !excludeTypes.includes(type))
		);

		const mergedDefinitions = {
			...filteredDefinitions,
			...additionalDefinitions
		};

		super({ entityDefinitions: mergedDefinitions, instructions }, modelConfig);
	}
}

// Re-export schema and types
export type { Entity, Entities } from '../schemas/entity.schema.ts';
export { EntitySchema, EntitiesSchema } from '../schemas/entity.schema.ts';
