import mapParallel from './mapParallel.ts';
import { askOpenAISafe } from './openai.ts';

import type { FunnelOptions } from './schemas/funnel.schema.ts';
import { FunnelWithExplanationSchema, SeedsSchema, type Funnel, type FunnelStage, type FunnelCategory, type FunnelWithExplanation } from './schemas/funnel.schema.ts';
import { dedent } from './utils.ts';

export { FunnelWithExplanationSchema };

/**
 * Iterates over all categories in a funnel, yielding references to stage info and category objects.
 * This allows in-place modifications of categories within the funnel structure.
 *
 * @param funnel - The funnel to iterate over (can be a Funnel object or array of stages)
 * @yields A tuple of [stageName, stageGoal, categoryObject] where categoryObject can be modified in-place
 */
export function* iterateFunnelCategories(
	funnel: Funnel | FunnelStage[]
): Generator<[string, string, FunnelCategory]> {
	const stages = Array.isArray(funnel) ? funnel : funnel.stages;

	for (const stageData of stages) {
		for (const category of stageData.categories) {
			yield [stageData.stage, stageData.goal, category];
		}
	}
}

/**
 * Converts a Funnel into a topic taxonomy structure where stages are top-level topics
 * and categories are subtopics.
 *
 * @param funnel - The funnel to convert (can be a Funnel object or array of stages)
 * @returns An array of topic objects with stage names as topics and category names as subtopics
 */
export function funnelToTopics(
	funnel: Funnel | FunnelStage[]
): Array<{ topic: string; subtopics: Array<string> }> {
	const stages = Array.isArray(funnel) ? funnel : funnel.stages;

	return stages.map(stage => ({
		topic: stage.stage,
		subtopics: stage.categories.map(category => category.name)
	}));
}

const GENERIC_FUNNEL = [
	{
		'stage': 'Awareness / Discovery',
		'goal': 'Problem recognition, education.',
		'categories': [
			{
				'name': 'Problem Identification',
				'description': 'User searches to understand or define their problem or need.',
				'keywordPatterns': ['questions', 'how-to', 'why', 'tips', 'guides'],
				'keywordSeeds': [
					'why does my back hurt when running',
					'how to organize customer data'
				],
				'intent': 'Informational'
			},
			{
				'name': 'Category Education',
				'description': 'Exploring broad product/service categories without specific brands.',
				'keywordPatterns': ['types of', 'what is', 'overview', 'guide to'],
				'keywordSeeds': ['types of running shoes', 'what is CRM software'],
				'intent': 'Informational'
			},
			{
				'name': 'Trends & Inspiration',
				'description': 'Looking for ideas, new trends, or general inspiration.',
				'keywordPatterns': [
					'trends',
					'ideas',
					'inspiration',
					'popular',
					'latest'
				],
				'keywordSeeds': [
					'latest running shoe trends 2025',
					'popular small business tools'
				],
				'intent': 'Informational'
			}
		]
	},
	{
		'stage': 'Consideration / Research',
		'goal': 'Compare options, evaluate solutions.',
		'categories': [
			{
				'name': 'Features & Specifications',
				'description': 'Interest in specific attributes or capabilities.',
				'keywordPatterns': [
					'feature',
					'specifications',
					'capabilities',
					'functions'
				],
				'keywordSeeds': [
					'running shoes with arch support',
					'CRM with email automation'
				],
				'intent': 'Commercial / Research'
			},
			{
				'name': 'Comparisons',
				'description': 'Directly comparing brands, products, or categories.',
				'keywordPatterns': ['vs', 'comparison', 'alternatives', 'best of'],
				'keywordSeeds': ['Nike vs Adidas', 'HubSpot vs Salesforce'],
				'intent': 'Commercial / Research'
			},
			{
				'name': 'Suitability & Use Cases',
				'description': 'Evaluating how well a solution fits specific needs or contexts.',
				'keywordPatterns': ['best for', 'ideal for', 'use case', 'fit for'],
				'keywordSeeds': ['best shoes for marathon training', 'CRM for freelancers'],
				'intent': 'Commercial / Research'
			},
			{
				'name': 'Social Proof & Reviews',
				'description': 'Looking for recommendations, opinions, ratings, testimonials. Often includes temporal modifiers like "2024".',
				'keywordPatterns': [
					'review',
					'rating',
					'top-rated',
					'best',
					'customer feedback'
				],
				'keywordSeeds': ['best CRM software', 'best rated running shoes 2025', 'HubSpot reviews'],
				'intent': 'Commercial / Research'
			}
		]
	},
	{
		'stage': 'Decision / Evaluation',
		'goal': 'Prospect is close to acting but still evaluating options.',
		'categories': [
			{
				'name': 'Pricing & Packages',
				'description': 'Researching cost, plans, discounts, promotions.',
				'keywordPatterns': [
					'price',
					'pricing',
					'cost',
					'plan',
					'tier',
					'discount'
				],
				'keywordSeeds': ['Nike Pegasus price', 'HubSpot CRM pricing tiers'],
				'intent': 'Commercial / Research'
			},
			{
				'name': 'Availability & Location',
				'description': 'Where or how to obtain the product/service.',
				'keywordPatterns': [
					'buy near me',
					'availability',
					'store',
					'online purchase'
				],
				'keywordSeeds': ['buy running shoes near me', 'best CRM free trial'],
				'intent': 'Commercial / Research'
			},
			{
				'name': 'Intent-to-Act Signals',
				'description': 'Keywords showing strong intent to act soon but still evaluating options.',
				'keywordPatterns': [
					'sign up trial',
					'get started demo',
					'order sample',
					'try now'
				],
				'keywordSeeds': ['sign up for HubSpot demo', 'get started with CRM trial'],
				'intent': 'Commercial / Research'
			}
		]
	},
	{
		'stage': 'Conversion / Action',
		'goal': 'Prospect decides to purchase or take desired action (checkout, demo, signup).',
		'categories': [
			{
				'name': 'Purchase / Signup',
				'description': 'Final action: completing a purchase, signing up, or starting a trial.',
				'keywordPatterns': ['buy', 'checkout', 'signup', 'register', 'demo'],
				'keywordSeeds': ['buy Nike Pegasus online', 'HubSpot CRM demo signup'],
				'intent': 'Transactional'
			},
			{
				'name': 'Immediate Offers & Promotions',
				'description': 'Using discounts, coupon codes, or limited-time deals to convert.',
				'keywordPatterns': [
					'discount',
					'promo code',
					'deal',
					'offer',
					'coupon'
				],
				'keywordSeeds': ['Nike Pegasus 20% off', 'HubSpot CRM free trial code'],
				'intent': 'Transactional'
			}
		]
	},
	{
		'stage': 'Post-Purchase / Retention & Advocacy',
		'goal': 'Support existing customers, encourage loyalty or advocacy.',
		'categories': [
			{
				'name': 'Usage & How-To',
				'description': 'Guides, tutorials, setup instructions.',
				'keywordPatterns': [
					'how to',
					'tutorial',
					'setup',
					'guide',
					'instructions'
				],
				'keywordSeeds': ['how to break in running shoes', 'HubSpot CRM tutorial'],
				'intent': 'Retention / Post-Purchase'
			},
			{
				'name': 'Troubleshooting & Support',
				'description': 'Fixing problems, maintenance, FAQs.',
				'keywordPatterns': ['help', 'troubleshoot', 'issue', 'problem', 'FAQ'],
				'keywordSeeds': ['Nike Pegasus sizing issues', 'HubSpot login help'],
				'intent': 'Retention / Post-Purchase'
			},
			{
				'name': 'Upgrades & Add-ons',
				'description': 'Expanding or enhancing existing purchase.',
				'keywordPatterns': [
					'upgrade',
					'add-on',
					'extension',
					'premium features'
				],
				'keywordSeeds': [
					'best insoles for running shoes',
					'HubSpot premium features'
				],
				'intent': 'Retention / Post-Purchase'
			},
			{
				'name': 'Community & Advocacy',
				'description': 'Engagement, referrals, sharing experiences.',
				'keywordPatterns': [
					'forum',
					'community',
					'refer',
					'share',
					'testimonial'
				],
				'keywordSeeds': [
					'running shoe user forum',
					'refer a friend HubSpot discount'
				],
				'intent': 'Retention / Post-Purchase'
			}
		]
	}
];


const CUSTOMIZE_PROMPT = dedent(`
Adapt this marketing funnel for sector '{sector}', market '{market}', language '{language}'.
{briefing}

RULES:
1. Keep the same funnel stages (translate names if needed) - only customize categories within stages
2. Adjust categories to fit the sector: modify names, descriptions, or replace irrelevant ones
3. "keywordPatterns": Abstract types/themes (e.g., "questions", "comparisons", "pricing")
4. "keywordSeeds": Real Google searches users actually type - NOT forced combinations of patterns
   - Think: What would someone naturally search at this stage?
   - Keep broad (1-3 words) to seed Google Keyword Planner for 100s-1000s of ideas
   - Generate 3-10 keywordSeeds per category
5. Patterns and keywordSeeds should align thematically but DON'T force pattern words into keywordSeeds. Focus on the category "description" to guide relevant keywordSeeds.

Example for running shoes:
- Category description: "Palabras clave que muestran alta intención de compra, aunque todavía evaluando la mejor opción",
- Keyword Patterns: ["probar", "reservar", "solicitar prueba", "más info"]
- GOOD keywordSeeds: ["elegir talla zapatilla", "analisis de pisada"]
  BAD: ["probar zapatillas", "reservar zapatillas"] (unnatural search)
- Pattern: ["comparativas"] → KeywordSeeds: ["nike vs adidas", "mejores zapatillas 2025"]

Return the customized funnel in language {userLanguage} except keywordSeeds, that should maintain the original language.

Also provide an "explanation" field with a brief summary (2-3 sentences) explaining the reasoning behind
the funnel customization: how the stages and categories were adapted for this sector and market,
and what customer journey they represent.

{instructions}

# Generic funnel structure

{funnel}
`);
/**
 * Customize a generic marketing funnel to a specific sector and market using an LLM.
 */
export async function customizeFunnel(
	sector: string,
	language: string,
	userLanguage: string | null = null,
	country: string = 'global',
	briefing: string | null = null,
	instructions: string | null = null,
	model: string = 'gpt-4.1',
	funnel: Funnel | FunnelStage[] = { stages: GENERIC_FUNNEL }
): Promise<FunnelWithExplanation> {
	const funnelData = Array.isArray(funnel) ? funnel : funnel.stages;

	const prompt = CUSTOMIZE_PROMPT
		.replace('{sector}', sector)
		.replace('{briefing}', briefing || '')
		.replace('{instructions}', instructions || '')
		.replace('{market}', country)
		.replace('{language}', language)
		.replace('{userLanguage}', userLanguage ?? language)
		.replace('{funnel}', JSON.stringify(funnelData, null, 2));

	const { parsed } = await askOpenAISafe(prompt, model, FunnelWithExplanationSchema);
	if (!parsed) {
		throw new Error('Failed to parse response from OpenAI');
	}

	return parsed;
}

const GENERATE_SEEDS_PROMPT = dedent(`
Generate 3-10 Google search keywords that real users type when researching {sector} at this funnel stage.

Stage: {stage} ({goal})
Category: {category} - {description}
Intent: {intent}
Theme indicators: {patterns}

CRITICAL: Generate what people ACTUALLY search, NOT literal combinations of theme words.

Example for running shoes / "Señales de Intención" / themes ["probar", "reservar"]:
✅ GOOD: "elegir talla zapatilla", "analisis de pisada"
❌ BAD: "probar zapatillas", "reservar zapatillas" (unnatural, nobody searches this)

Requirements:
- Broad queries (1-3 words) suitable for Google Keyword Planner seed expansion
- Natural language people actually type in search bars
- Match the stage intent and category purpose
- Output {language} for {market} market
- 5-10 keywords (more is better)

What would someone in {market} naturally search when {description}?
`);

/**
 * Generate example seed keywords for a specific funnel category using an LLM.
 */
export async function generateSeedKeywords(
	stage: string,
	goal: string,
	category: FunnelCategory,
	sector: string,
	language: string,
	country: string = 'global',
	model: string = 'gpt-4.1'
): Promise<Array<string>> {
	const prompt = GENERATE_SEEDS_PROMPT
		.replace('{stage}', stage)
		.replace('{goal}', goal)
		.replace('{category}', category.name)
		.replace('{description}', category.description)
		.replace('{intent}', category.intent)
		.replace('{patterns}', category.keywordPatterns.join(', '))
		.replace('{sector}', sector)
		.replace('{market}', country)
		.replace('{language}', language);

	const { parsed } = await askOpenAISafe(prompt, model, SeedsSchema);
	if (!parsed) {
		throw new Error('Failed to parse seed keywords from OpenAI');
	}

	return parsed.seeds;
}

/**
 * Regenerates seed keywords for all categories in a funnel concurrently,
 * updating the keywordSeeds field in-place for each category.
 */
export async function reseedFunnel(
	funnel: FunnelWithExplanation | FunnelStage[],
	sector: string,
	language: string,
	country: string = 'global',
	model: string = 'gpt-4.1',
	maxConcurrency: number = 100
): Promise<FunnelWithExplanation> {
	const categories: Array<[string, string, FunnelCategory]> = [];
	for (const categoryTuple of iterateFunnelCategories(funnel)) {
		categories.push(categoryTuple);
	}

	await mapParallel(categories, maxConcurrency, async ([stage, goal, category]) => {
		const seeds = await generateSeedKeywords(
			stage,
			goal,
			category,
			sector,
			language,
			country,
			model
		);
		category.keywordSeeds = seeds;
	});

	if (Array.isArray(funnel)) {
		return { stages: funnel, explanation: '' };
	}
	return funnel;
}

/**
 * Generate a complete customized marketing funnel with seed keywords.
 * This is a convenience wrapper that combines customizeFunnel and reseedFunnel.
 */
export async function generateFunnel({
	sector,
	language,
	userLanguage,
	country,
	model,
	funnel,
	briefing,
	maxConcurrency,
	instructions
}: FunnelOptions): Promise<FunnelWithExplanation> {
	const customized = await customizeFunnel(sector, language, userLanguage, country || 'global', briefing, instructions, model || 'gpt-4.1', funnel || { stages: GENERIC_FUNNEL });
	const reseeded = await reseedFunnel(customized, sector, language, country || 'global', model || 'gpt-4.1', maxConcurrency ?? 100);
	return reseeded;
}
