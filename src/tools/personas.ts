import { Tool, type ModelConfig } from '../tool.ts';
import { buildBrandContext } from './brands.ts';
import type { Persona, PersonasResponse } from '../schemas/persona.schema.ts';
import { PersonasResponseSchema } from '../schemas/persona.schema.ts';
import { dedent } from '../helpers/utils.ts';

const PROMPT = dedent(`
You're a marketing expert identifying typical profiles/personas of people searching
for brands, products or services. Generate {count} detailed customer personas for a brand
in the {sector} sector targeting the {market} market.

For context, the brand being analyzed is{brand_context}. Use this brand as context to better understand
the specific niche, positioning, and target audience within the {sector} sector. However, you MUST NOT
mention the brand name{brand_exclusion} anywhere in the persona names or descriptions. The personas should be
generic profiles that could apply to similar brands in the same space.

Each persona should include:
- name: A short and catchy name, such as "Tech-Savvy Creative Director", "Gaming Industry Veteran",
  "Eco-Conscious Millennial", "Budget-Conscious Family Planner", or "Luxury Lifestyle Enthusiast".
- description: A brief description of the persona's characteristics, needs, and behaviors.
- keywordSeeds: A list of 5-10 keyword seed phrases in language {language} that this persona would typically search for
  when looking for products/services in this space. These should be realistic search queries that
  reflect the persona's language ({language}), intent, and level of expertise. Include a mix of informational
  and transactional queries. Keywords should be broad (1-3 words) suitable for Google Keyword Planner
  seed expansion. Do NOT include the brand name {brand_exclusion} in these keywords.

Make sure you're answer is in the language "{userLanguage} except keywordSeeds, that should maintain the original language {language}".

Return the personas as a list of JSON objects.

Also provide an "explanation" field with a brief summary (2-3 sentences) explaining the reasoning behind
the personas you generated: why these profiles are relevant for this sector and market, and what key
customer segments they represent.

{instructions}

{currentPersonasInfo}
`);

const CURRENT_DATA_CLAUSE = dedent(`
# Current Personas Information

The following is the current information the user has about personas for the brand(s).

{currentData}

IMPORTANT: Unless the instructions explicitly specify to modify, replace, add, or remove competitors
from this list, you MUST return at least all the same competitors that are already present in the
current data. If no modification instructions are provided, maintain the existing list and only add
new competitors if they are relevant.
`);

// =============================================================================
// PersonaGenerator
// =============================================================================

/**
 * Configuration for the PersonaGenerator tool.
 */
export interface PersonaGeneratorConfig {
	/** Industry sector the brand operates in */
	sector: string;
	/** Geographical market or region */
	market: string;
	/** Brand name */
	brand?: string;
	/** Brand domain */
	brandDomain?: string;
	/** Language for keyword seeds (default: 'english') */
	language?: string;
	/** Language for persona descriptions (default: same as language) */
	userLanguage?: string | null;
	/** Number of personas to generate (default: 5) */
	count?: number;
	/** Brand briefing context */
	briefing?: string;
	/** Additional instructions */
	instructions?: string | null;
}

/**
 * A tool that generates customer personas for a brand.
 */
export class PersonaGenerator extends Tool<Array<Persona> | null, PersonasResponse, PersonasResponse> {
	private readonly promptTemplate: string;

	constructor(config: PersonaGeneratorConfig, modelConfig: ModelConfig) {
		super(modelConfig);
		const {
			sector,
			market,
			brand,
			brandDomain,
			language = 'english',
			userLanguage = null,
			count = 5,
			briefing,
			instructions
		} = config;

		if (!brand && !brandDomain) {
			throw new Error('Either brand or brandDomain must be provided');
		}

		const brandContext = buildBrandContext({
			brand,
			brandDomain,
			sector,
			market,
			briefing
		});

		let brandExclusion: string;
		if (brandDomain) {
			if (brand) {
				brandExclusion = ` "${brand}" or the domain`;
			} else {
				brandExclusion = ' or domain';
			}
		} else {
			brandExclusion = ` "${brand}"`;
		}

		this.promptTemplate = PROMPT
			.replace('{count}', count.toString())
			.replaceAll('{sector}', sector)
			.replaceAll('{market}', market)
			.replaceAll('{brand_context}', brandContext)
			.replaceAll('{brand_exclusion}', brandExclusion)
			.replaceAll('{language}', language)
			.replaceAll('{userLanguage}', userLanguage ?? language)
			.replaceAll('{instructions}', instructions || '');
	}

	protected override schema() {
		return PersonasResponseSchema;
	}

	protected prompt(existingPersonas: Array<Persona> | null): string {
		const currentData = existingPersonas && existingPersonas.length > 0
			? CURRENT_DATA_CLAUSE.replace(
					'{currentData}',
					JSON.stringify({ personas: existingPersonas }, null, 2)
				)
			: '';

		return this.promptTemplate.replace('{currentPersonasInfo}', currentData);
	}

	protected override isEmpty(_input: Array<Persona> | null): boolean {
		// Never skip - null means generate fresh personas
		return false;
	}

	/**
	 * Not supported. PersonaGenerator is configured for a specific brand context
	 * and generates personas in a single call. Use invoke() instead.
	 */
	override batch(): never {
		throw new Error(
			'PersonaGenerator.batch() is not supported. ' +
			'This tool generates personas for a specific brand context. ' +
			'Use invoke() instead.'
		);
	}
}

// Re-export types
export type { Persona, PersonasResponse, PersonasOptions } from '../schemas/persona.schema.ts';
export { PersonaSchema, PersonasResponseSchema } from '../schemas/persona.schema.ts';
