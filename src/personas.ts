import { askOpenAISafe } from './openai.ts';

import { buildBrandContext } from './brandContext.ts';
import type { PersonasOptions, PersonasResponse } from './schemas/persona.schema.ts';
import { PersonasResponseSchema } from './schemas/persona.schema.ts';
import { dedent } from './utils.ts';

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

export async function generatePersonas({
	sector,
	market,
	brand,
	brandDomain,
	language = 'english',
	userLanguage = null,
	count = 5,
	model = 'gpt-4.1',
	briefing,
	instructions,
	personas = null
}: PersonasOptions): Promise<PersonasResponse> {
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

	const currentData = personas && personas.length > 0 ? CURRENT_DATA_CLAUSE.replace(
		'{currentData}',
		JSON.stringify({ personas }, null, 2)
	) : null;

	const content = PROMPT
		.replace('{count}', count.toString())
		.replaceAll('{sector}', sector)
		.replaceAll('{market}', market)
		.replaceAll('{brand_context}', brandContext)
		.replaceAll('{brand_exclusion}', brandExclusion)
		.replaceAll('{language}', language)
		.replaceAll('{userLanguage}', userLanguage ?? language)
		.replaceAll('{instructions}', instructions || '')
		.replaceAll('{currentPersonasInfo}', currentData || '');

	const { parsed } = await askOpenAISafe(content, model, PersonasResponseSchema);
	if (!parsed) {
		throw new Error('Failed to parse response from OpenAI');
	}
	return parsed;
}
