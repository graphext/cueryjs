/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
import type { KeywordRecord } from './apis/googleAds/keywordPlanner.ts';

import {
	type ModelResponse,
	type EnrichedModelResponse,
	assignFunnelStages,
	classifyIntoPersonas,
	classifyBrandedNonBranded,
	classifyIntent,
	extractAndAssignTopics,
	extractEntities,
	scorePurchaseProbability,
	queryModel
} from './api.ts';
import { concatBrands, generateBrandInfo, generateCompetitorsInfo, rankBrandsInTexts } from './brands.ts';
import { generateFunnel, iterateFunnelCategories } from './funnel.ts';
import { expandKeywords } from './keywords.ts';
import { ModelId } from './models.ts';
import { generatePersonas } from './personas.ts';
import { type Brand, type FlaggedBrand, BrandSchema } from './schemas/brand.schema.ts';
import { type Funnel, FunnelSchema } from './schemas/funnel.schema.ts';
import { type Persona, PersonaSchema } from './schemas/persona.schema.ts';
import { extractABSForBrandBatch } from './sentiment.ts';
import { categorizeSources, enrichSources, rankedBrandsInSources, type EnrichedSource } from './sources.ts';
import { translateBatch } from './translate.ts';
import { sampleArray } from './utils.ts';


export interface ContextConfig {
	brand: string;
	sector: string;
	languageCode: string;
	models: Array<string>;
	numPersonas: number;
	personaModel: string;
	funnelModel: string;
	countryCode: string | null;
	generateIdeasFromSeeds?: boolean;
};

export interface Context {
	brands: Array<FlaggedBrand>;
	personas: Array<Persona>;
	funnel: Funnel;
	customKeywords?: Array<string>;
	seedKeywords?: Array<Array<string> | string>;
}

/**
 * Imports a context from the wizard export format and converts it to the native audit format.
 */
export async function importContext(fp: string) {

	const imported = JSON.parse(await Deno.readTextFile(fp));

	const ownBrand: FlaggedBrand = {
		...BrandSchema.parse(imported['brandInfo']),
		isCompetitor: false
	};

	const competitors: Array<FlaggedBrand> = imported['competitors']['items'].map((competitor: unknown) => ({
		...BrandSchema.parse(competitor),
		isCompetitor: true
	}));

	const personas: Array<Persona> = imported['personas']['items'].map((persona: unknown) =>
		PersonaSchema.parse(persona)
	);

	const funnelData = imported['funnel'] as { stages: Array<Record<string, unknown>> };
	const funnel: Funnel = FunnelSchema.parse({
		stages: funnelData.stages.map(stage => ({
			...stage,
			stage: stage.name || stage.stage
		}))
	});

	return {
		brands: [ownBrand, ...competitors],
		personas,
		funnel,
		customKeywords: imported['customKeywords']?.customKeywords || [],
		seedKeywords: imported['seedKeywords'] || []
	};
}

export async function generateContext(
	config: ContextConfig
): Promise<Context> {

	let start: number;
	let duration: string;

	// Brand info
	start = Date.now();
	const brand = await generateBrandInfo({
		brand: config.brand,
		language: config.languageCode,
		model: 'gpt-4.1',
		useSearch: true,
		contextSize: 'high',
		sector: config.sector,
		market: config.countryCode
	});

	duration = ((Date.now() - start) / 1000).toFixed(1);
	console.log(`Generated brand in ${duration}s`);

	// Competitors
	start = Date.now();
	const competitors = await generateCompetitorsInfo({
		brand: config.brand,
		sector: config.sector,
		market: config.countryCode,
		strict: true,
		language: config.languageCode,
		model: 'gpt-4.1',
		useSearch: true,
		contextSize: 'high'
	});

	duration = ((Date.now() - start) / 1000).toFixed(1);
	console.log(`Generated competitors in ${duration}s`);

	// Personas
	start = Date.now();
	const personas = await generatePersonas({
		sector: config.sector,
		market: config.countryCode || 'global',
		brand: config.brand,
		language: 'spanish',
		count: config.numPersonas
	});
	duration = ((Date.now() - start) / 1000).toFixed(1);
	console.log(`Generated personas in ${duration}s`);

	// Funnel
	start = Date.now();
	const funnel = await generateFunnel({
		sector: config.sector,
		language: config.languageCode,
		country: config.countryCode || 'global'
	});
	duration = ((Date.now() - start) / 1000).toFixed(1);
	console.log(`Customized and seeded funnel in ${duration}s!\n`);

	return {
		brands: concatBrands([brand], competitors),
		personas: personas,
		funnel: funnel,
		customKeywords: []
	};
}

const dedupColumns = [
	'avgMonthlySearches', 'competition', 'competitionIndex', 'averageCpc',
	'lowTopOfPageBid', 'highTopOfPageBid', 'searchVolumeGrowthYoy'
] as const;

interface ExpandedKeywords {
	keywordSetDedup: Set<string>;
	columnKeySetDedup: Set<string>;
	keywords: Array<KeywordRecord>;
}

const noDedupKey = dedupColumns.map(() => 'null').join('|');

function mergeKeywords(keywords: Array<KeywordRecord>, expandedKeywords: ExpandedKeywords) {
	for (const keyword of keywords) {
		if (expandedKeywords.keywordSetDedup.has(keyword.keyword)) {
			continue;
		}
		else {
			expandedKeywords.keywordSetDedup.add(keyword.keyword);
		}

		const dedupKey = dedupColumns.map(col => keyword[col] ?? 'null').join('|');
		if (dedupKey !== noDedupKey) {
			if (expandedKeywords.columnKeySetDedup.has(dedupKey)) {
				continue;
			}
			else {
				expandedKeywords.columnKeySetDedup.add(dedupKey);
			}
		}

		expandedKeywords.keywords.push(keyword);
	}
}

export async function generateKeywords(
	config: ContextConfig,
	personas: Array<Persona>,
	funnel: Funnel,
	brands: Array<FlaggedBrand>,
	customKeywords?: Array<string>,
	seedKeywords?: Array<Array<string> | string>
): Promise<Array<KeywordRecord>> {
	const start = Date.now();
	const allSeeds: Array<string | Array<string>> = [];

	if (seedKeywords != null && seedKeywords.length > 0) {
		allSeeds.push(...seedKeywords);
	} else {
		const ownBrandSeeds = brands
			.filter(brand => !brand.isCompetitor)
			.flatMap(brand => brand.portfolio.map(item => item.keywordSeeds ?? []))
			.filter(seeds => seeds.length > 0);
		const competitorBrandSeeds = brands
			.filter(brand => brand.isCompetitor)
			.flatMap(brand => brand.portfolio.map(item => item.keywordSeeds ?? []))
			.filter(seeds => seeds.length > 0);
		const personaSeeds = personas.flatMap(p => p.keywordSeeds);
		const funnelSeeds = iterateFunnelCategories(funnel)
			.map(([_stage, _goal, category]) => category.examples)
			.toArray();

		allSeeds.push(...[
			...ownBrandSeeds,
			...personaSeeds,
			...funnelSeeds,
			...competitorBrandSeeds,
			...customKeywords || []
		]);
	}

	console.log(`Expanding ${allSeeds.length} seed keywords...`, allSeeds);

	const keywordGroups = await expandKeywords({
		seedKeywords: allSeeds,
		url: config.brand,
		language: config.languageCode || 'EN',
		countryISOCode: config.countryCode,
		generateIdeasFromSeeds: config.generateIdeasFromSeeds
	});

	const expandedKeywords: ExpandedKeywords = {
		keywordSetDedup: new Set(),
		columnKeySetDedup: new Set(),
		keywords: []
	};

	keywordGroups.forEach(group => {
		mergeKeywords(group, expandedKeywords);
	});

	const keywords = expandedKeywords.keywords;

	const duration = ((Date.now() - start) / 1000).toFixed(1);
	console.log(`Generated ${keywords.length} unique keywords in ${duration}s\n`);

	return keywords;
}

export async function enrichKeywords(
	keywordRecords: Array<KeywordRecord>,
	personas: Array<Persona>,
	funnel: Funnel
): Promise<Array<Record<string, unknown>>> {

	const start = Date.now();
	const keywords = keywordRecords.map(record => record.keyword as string);

	const topicsResult = await extractAndAssignTopics(keywords);
	const intentClassifications = await classifyIntent(keywords);
	const brandedClassifications = await classifyBrandedNonBranded(keywords);
	const funnelResult = await assignFunnelStages(keywords, funnel);
	const assignedPersonas = await classifyIntoPersonas(keywords, personas);

	// Type guard checks to ensure we got arrays (not parquet results)
	if (!Array.isArray(topicsResult) || !Array.isArray(intentClassifications) ||
		!Array.isArray(brandedClassifications) || !Array.isArray(funnelResult) ||
		!Array.isArray(assignedPersonas)) {
		throw new Error('Unexpected result format: expected arrays from enrichment functions');
	}

	const [topics, subtopics] = topicsResult;
	const [stages, categories] = funnelResult;

	const enrichedKeywords: Array<Record<string, unknown>> = keywordRecords.map((record, i) => ({
		...record,
		topic: topics[i],
		subtopic: subtopics[i],
		intent: intentClassifications[i],
		brandedClassification: brandedClassifications[i],
		funnelStage: stages[i],
		funnelCategory: categories[i],
		persona: assignedPersonas[i]
	}));

	const duration = ((Date.now() - start) / 1000).toFixed(1);
	console.log(`Enriched keywords in ${duration}s\n`);

	return enrichedKeywords;
}

export interface AuditConfig {
	prompts: Array<string>;
	models: Array<ModelId | string>;
	brands: Array<FlaggedBrand>;
	useSearch?: boolean;
	searchCountry?: string | null;
}

/**
 * Queries LLMs and analyzes brand presence (without further LLM calls)
 */
export async function auditPrompts({
	prompts,
	models,
	brands,
	useSearch = true,
	searchCountry = null
}: AuditConfig): Promise<Array<EnrichedModelResponse>> {

	const modelIds = models.map(m => (typeof m === 'string' ? new ModelId(m) : m));

	const responses: Array<ModelResponse> = [];
	for (const modelId of modelIds) {
		const modelResponses = await queryModel(
			prompts,
			modelId,
			useSearch,
			searchCountry
		);
		if (Array.isArray(modelResponses)) {
			responses.push(...modelResponses);
		}
	}

	const enrichedSources = await enrichSources(
		responses.map(r => r.sources),
		brands
	);

	const brandsInAnswers = await rankBrandsInTexts(
		responses.map(r => r.answer as string),
		brands
	);

	if (!Array.isArray(enrichedSources) || !Array.isArray(brandsInAnswers)) {
		throw new Error('enrichSources and rankBrandsInTexts must not use writeToParquet in audit flow');
	}

	const { mentionedBrands, linkedBrands } = rankedBrandsInSources(enrichedSources);


	return responses.map((response, i) => ({
		...response,
		sources: enrichedSources[i],
		rankedBrandsInAnswer: brandsInAnswers[i],
		rankedBrandsInSourceTitles: mentionedBrands[i],
		rankedBrandsInSourceDomains: linkedBrands[i]
	}));
}

/**
 * Enriches audit results with topics, funnel stages, personas, and branded classification.
 */
export async function enrichAudit(
	auditResults: Array<Record<string, unknown>>,
	brand: Brand
): Promise<Array<Record<string, unknown>>> {

	// Note: categorizeSources in reality modifies in-place, but we keep the return value
	// here for clarity, as an example for the final audit orchestration.
	const sourceLists = auditResults.map(result => result.sources as Array<EnrichedSource>);
	const categorizedSources = await categorizeSources(sourceLists);

	const answers = auditResults.map(result => result.answer as string);
	const aspectSentiments = await extractABSForBrandBatch(answers, brand);
	const entities = await extractEntities(answers);
	const purchaseProbs = await scorePurchaseProbability(answers);

	if (!Array.isArray(categorizedSources) || !Array.isArray(aspectSentiments) ||
		!Array.isArray(entities) || !Array.isArray(purchaseProbs)) {
		throw new Error('Functions must not use writeToParquet in enrichAudit flow');
	}

	const enrichedResponses = auditResults.map((result, i) => ({
		...result,
		sources: (categorizedSources as Array<Array<unknown>>)[i],
		sentiments: (aspectSentiments as Array<Array<unknown>>)[i],
		entities: (entities as Array<Array<unknown>>)[i],
		purchaseProbability: (purchaseProbs as Array<number>)[i]
	}));

	return enrichedResponses;
}

/**
 * Runs a complete audit workflow: generates context (brands, personas, funnel),
 * expands keywords, enriches them, queries LLMs, and enriches the results.
 *
 * @param config - Configuration for the audit including brand, sector, language, and models
 * @param sampleSize - Number of keywords to sample for the audit (default: 400)
 * @param cacheFp - Optional path to a cache file for persisting intermediate results
 * @param wizardExportFp - Optional path to a wizard export JSON to import context from
 *
 * @returns Array of enriched audit results combining keyword data with LLM responses
 *
 * Cache behavior:
 * - If cacheFp is provided, the function will save and restore intermediate results
 * - Each major step (context, keywords, enrichedKeywords, audit, enrichedAudit) is cached separately
 * - On subsequent runs, cached steps are loaded instead of regenerated
 * - This allows resuming long-running audits or re-running analysis with different parameters
 * - The cache file is updated after each step completes successfully
 *
 * Wizard export:
 * - If wizardExportFp is provided, context (brands, personas, funnel) is imported from the file
 * - This bypasses context generation and uses pre-configured data from the brand wizard
 * - The imported context is saved to cache if cacheFp is also provided
 * - Useful for running audits with manually curated brand configurations
 */
export async function audit(
	config: ContextConfig,
	sampleSize: number = 400,
	cacheFp?: string,
	wizardExportFp?: string
): Promise<Array<Record<string, unknown>>> {

	let cache: Record<string, unknown> = {};
	const useCache = cacheFp != null;

	async function loadCache(): Promise<Record<string, unknown>> {
		if (!useCache || cacheFp == null) {
			return {};
		}

		try {
			const raw = await Deno.readTextFile(cacheFp);
			const data = JSON.parse(raw);
			if (data != null && typeof data === 'object' && !Array.isArray(data)) {
				return data as Record<string, unknown>;
			}
			throw new Error(`Invalid cache format in ${cacheFp}`);
		} catch (error) {
			if (error instanceof Deno.errors.NotFound) {
				return {};
			}
			throw error;
		}
	}

	if (wizardExportFp != null) {
		console.log('Importing wizard context...');
		const context = await importContext(wizardExportFp);
		if (useCache) {
			cache = await loadCache();
			cache['context'] = context;
			await Deno.writeTextFile(cacheFp, JSON.stringify(cache, null, 2));
		}
	}
	else if (useCache) {
		cache = await loadCache();
	}

	let context: Context;
	if (cache['context']) {
		console.log('Using cached context...');
		context = cache['context'] as Context;
	} else {
		console.log('Generating context...');
		context = await generateContext(config);
		if (useCache) {
			cache['context'] = context;
			await Deno.writeTextFile(cacheFp, JSON.stringify(cache, null, 2));
		}
	}

	let keywordRecords: Array<KeywordRecord>;
	if (cache['keywordRecords']) {
		console.log('Using cached keywords...');
		keywordRecords = cache['keywordRecords'] as Array<KeywordRecord>;
	} else {
		console.log('Generating keywords...');
		keywordRecords = await generateKeywords(
			config,
			context.personas,
			context.funnel,
			context.brands,
			context.customKeywords,
			context.seedKeywords
		);

		if (sampleSize < keywordRecords.length) {
			console.log(`Sampling to ${sampleSize} keywords for audit...\n`);
			keywordRecords = sampleArray(keywordRecords, sampleSize);
		}

		if (useCache) {
			cache['keywordRecords'] = keywordRecords;
			await Deno.writeTextFile(cacheFp, JSON.stringify(cache, null, 2));
		}
	}

	let enrichedKeywords: Array<Record<string, unknown>>;
	if (cache['enrichedKeywords']) {
		console.log('Using cached enriched keywords...');
		enrichedKeywords = cache['enrichedKeywords'] as Array<Record<string, unknown>>;
	} else {
		console.log('Enriching keywords...');
		enrichedKeywords = await enrichKeywords(
			keywordRecords,
			context.personas,
			context.funnel
		);
		if (useCache) {
			cache['enrichedKeywords'] = enrichedKeywords;
			await Deno.writeTextFile(cacheFp, JSON.stringify(cache, null, 2));
		}
	}

	let audit: Array<EnrichedModelResponse>;
	if (cache['audit']) {
		console.log('Using cached audit...');
		audit = cache['audit'] as Array<EnrichedModelResponse>;
	} else {
		console.log('Translating keywords into prompts...');
		const keywords = enrichedKeywords.map(record => record.keyword as string);
		const promptsResult = await translateBatch({
			keywords,
			language: config.languageCode,
			model: 'gpt-4.1-mini'
		});

		if (!Array.isArray(promptsResult)) {
			throw new Error('Unexpected result format: expected array from translateBatch');
		}

		const safePrompts: Array<string> = promptsResult.map(p => p || '');

		console.log('Auditing prompts...');
		audit = await auditPrompts({
			prompts: safePrompts,
			models: config.models,
			brands: context.brands,
			useSearch: true,
			searchCountry: config.countryCode
		});
		if (useCache) {
			cache['audit'] = audit;
			await Deno.writeTextFile(cacheFp, JSON.stringify(cache, null, 2));
		}
	}

	let enrichedAudit: Array<Record<string, unknown>>;
	if (cache['enrichedAudit']) {
		console.log('Using cached enriched audit...');
		enrichedAudit = cache['enrichedAudit'] as Array<Record<string, unknown>>;
	} else {
		console.log('Enriching prompt audit...');
		const ownBrand = context.brands.find(b => !b.isCompetitor);
		enrichedAudit = await enrichAudit(audit, ownBrand!);
		if (useCache) {
			cache['enrichedAudit'] = enrichedAudit;
			await Deno.writeTextFile(cacheFp, JSON.stringify(cache, null, 2));
		}
	}

	const result = enrichedKeywords.map((keywordRecord, i) => ({
		...keywordRecord,
		...enrichedAudit[i]
	}));

	return result;
}