import { mapParallel } from '../async.ts';
import { askOpenAISafe } from '../openai.ts';

import { buildBrandContext } from './brands.ts';
import type { KeywordsOptions } from '../schemas/keyword.schema.ts';
import { KeywordsResponseSchema, type KeywordsResponse } from '../schemas/keyword.schema.ts';
import { dedent } from '../utils.ts';
import { keywords as getGoogleAdsKeywords, type KeywordRecord } from '../apis/googleAds/keywordPlanner.ts';

export interface ExpandKeywordsParams {
	seedKeywords: Array<string | Array<string>>;
	url?: string;
	urlAsExpandRelevanceContext?: string;
	language?: string;
	countryISOCode?: string | null;
	generateIdeasFromSeeds?: boolean;
	/** When true, adds deduplicatedKeywords column with all keywords sharing the same metrics */
	includeDeduplicatedKeywords?: boolean;
	/** When true, includes seedKeywords column in output records. Defaults to false. */
	includeSeedKeywords?: boolean;
	/** When true, generates a separate dataset with all keywords (dedup by keyword only). Defaults to false. */
	includeAllKeywordsDataset?: boolean;
}

export async function expandKeywords({
	seedKeywords,
	url,
	urlAsExpandRelevanceContext,
	language = 'EN',
	countryISOCode,
	generateIdeasFromSeeds = false,
	includeSeedKeywords = false
}: ExpandKeywordsParams): Promise<Array<Array<KeywordRecord>>> {
	url = url?.trim();
	language = language?.trim();
	countryISOCode = countryISOCode?.trim();

	const expandedKeywords: Array<Array<KeywordRecord>> = [];

	const keywordIdeasPromise = mapParallel(
		seedKeywords,
		2,
		async (keyword) => {
			const keywordData = await getGoogleAdsKeywords({
				keywords: Array.isArray(keyword) ? keyword : [keyword],
				ideas: generateIdeasFromSeeds, // Configurable: get data for seed keywords OR generate ideas
				language,
				countryISOCode,
				url: generateIdeasFromSeeds != null ? urlAsExpandRelevanceContext : undefined,
				includeSeedKeywords
			});
			expandedKeywords.push(keywordData);
		}
	);

	const urlIdeasPromise = url
		? getGoogleAdsKeywords({
			url,
			wholeSite: true,
			ideas: true, // Generate keyword ideas from URL
			maxIdeas: 10000,
			language,
			countryISOCode,
			includeSeedKeywords
		}).then(ideas => expandedKeywords.push(ideas))
		: Promise.resolve([]);

	await Promise.all([keywordIdeasPromise, urlIdeasPromise]);

	return expandedKeywords;
}

const GENERATE_KEYWORDS_PROMPT = dedent(`
You're a keyword research expert helping a brand in the {sector} sector targeting the {market} market.

For context, the brand being analyzed is{brand_context}. Use this brand as context to better understand
the specific niche, positioning, and target audience within the {sector} sector.

{brandsInfo}

{personasInfo}

{funnelInfo}

# Your Task

You must follow the user's instructions below. The instructions will tell you EXACTLY what to do with keywords.

**CRITICAL**: Only generate new keywords if the instructions EXPLICITLY ask you to generate, add, create,
or suggest keywords. If the instructions ask for something else (like analysis, filtering, removing, or
any other operation), do NOT generate new keywords - instead, perform only what is requested.

If you are asked to generate keywords, they should be:
- Broad enough (1-3 words typically) for Google Keyword Planner seed expansion
- Natural search queries that real users would type
- Mix of informational and transactional intent
- Focused on the sector and market context
- Consider the customer personas and their search behaviors if provided
- Cover different funnel stages if funnel information is provided
- Do NOT include brand names{brand_exclusion}

IMPORTANT: Any "keywordSeeds" fields you see in the brands, personas, or funnel data above are for REFERENCE ONLY
to help you understand the context - they are managed separately and you should NOT include them in your output.

Return keywords as a list of strings in language {language}.

Make sure your answer is in the language "{userLanguage}" except the keywords themselves, which should
maintain the original language {language}.

Also provide an "explanation" field with a brief summary (2-3 sentences) explaining what you did
based on the instructions.

# User Instructions

{instructions}

{currentKeywordsInfo}
`);

const CURRENT_KEYWORDS_CLAUSE = dedent(`
# Current Custom Keywords

The following is the current list of custom keywords the user has.

{currentData}

**CRITICAL**: Unless the instructions EXPLICITLY ask you to generate, add, create, or suggest NEW keywords,
you MUST return EXACTLY the same keywords that are in the current data (possibly modified per instructions
like filtering or removing). Do NOT automatically generate new keywords - only do so if explicitly requested.
`);

const BRANDS_CLAUSE = dedent(`
# Brands Information (Reference Only)

The following brands (including competitors) are relevant to this analysis:

{brandsData}

Use this information to understand the competitive landscape and generate custom keywords that could help
the brand compete effectively. Consider the products, services, and market positions of these brands.
NOTE: Any "keywordSeeds" in the portfolio items are for reference only - do not include them directly in your output.
`);

const PERSONAS_CLAUSE = dedent(`
# Customer Personas (Reference Only)

The following customer personas represent the target audience:

{personasData}

Generate custom keywords that these personas would naturally search for based on their characteristics,
needs, and behaviors. Consider their language, expertise level, and search intent.
NOTE: Any "keywordSeeds" in the personas are for reference only - do not include them directly in your output.
`);

const FUNNEL_CLAUSE = dedent(`
# Marketing Funnel (Reference Only)

The following marketing funnel defines the customer journey stages:

{funnelData}

Generate custom keywords that cover different stages of this funnel, from awareness to conversion.
Consider the goals and categories at each stage to ensure comprehensive keyword coverage.
NOTE: Any "keywordSeeds" in the funnel categories are for reference only - do not include them directly in your output.
`);

export async function generateKeywords({
	sector,
	market,
	brand,
	brandDomain,
	language = 'english',
	userLanguage = null,
	model = 'gpt-4.1',
	briefing,
	instructions,
	keywords = null,
	brands = null,
	personas = null,
	funnel = null
}: KeywordsOptions): Promise<KeywordsResponse> {
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

	const currentData = keywords && keywords.length > 0 ? CURRENT_KEYWORDS_CLAUSE.replace(
		'{currentData}',
		JSON.stringify({ keywords }, null, 2)
	) : null;

	const brandsInfo = brands && brands.length > 0 ? BRANDS_CLAUSE.replace(
		'{brandsData}',
		JSON.stringify(brands, null, 2)
	) : null;

	const personasInfo = personas && personas.length > 0 ? PERSONAS_CLAUSE.replace(
		'{personasData}',
		JSON.stringify(personas, null, 2)
	) : null;

	const funnelInfo = funnel != null ? FUNNEL_CLAUSE.replace(
		'{funnelData}',
		JSON.stringify(funnel, null, 2)
	) : null;

	const content = GENERATE_KEYWORDS_PROMPT
		.replaceAll('{sector}', sector)
		.replaceAll('{market}', market)
		.replaceAll('{brand_context}', brandContext)
		.replaceAll('{brand_exclusion}', brandExclusion)
		.replaceAll('{language}', language)
		.replaceAll('{userLanguage}', userLanguage ?? language)
		.replaceAll('{instructions}', instructions || '')
		.replaceAll('{currentKeywordsInfo}', currentData || '')
		.replaceAll('{brandsInfo}', brandsInfo || '')
		.replaceAll('{personasInfo}', personasInfo || '')
		.replaceAll('{funnelInfo}', funnelInfo || '');

	const { parsed } = await askOpenAISafe(content, model, KeywordsResponseSchema);
	if (!parsed) {
		throw new Error('Failed to parse response from OpenAI');
	}
	return parsed;
}

export * from '../schemas/keyword.schema.ts';
