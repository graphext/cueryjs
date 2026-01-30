/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
import { fetchAIMBatch } from './apis/hasdata/aim.ts';
import { fetchAIOBatch } from './apis/hasdata/aio.ts';
import { downloadGPTSnapshots, scrapeGPTBatch, type JobId } from './apis/chatgptScraper/index.ts';
import { classifyBatch, labelBatch } from './tools/classifier.ts';
import { extractEntitiesBatch } from './tools/entities.ts';
import { funnelToTopics } from './tools/funnel.ts';
import { type Entity } from './schemas/entity.schema.ts';
import { type Funnel } from './schemas/funnel.schema.ts';
import type { ModelIdentifier } from './schemas/models.schema.ts';
import { cleanColumnName } from './helpers/utils.ts';
import { type Persona } from './schemas/persona.schema.ts';
import { type BrandContext } from './schemas/brand.schema.ts';
import { type SearchResult } from './schemas/search.schema.ts';
import { type Source, type EnrichedSource, type SearchSource } from './schemas/sources.schema.ts';
import { scoreBatch } from './tools/scorer.ts';
import { extractTopics, assignTopics } from './tools/topics.ts';
import { dedent } from './helpers/utils.ts';

export type ModelResponse = {
	prompt: string;
	model: string;
	answer: string;
	sources: Array<Source>;
	searchQueries: Array<string>;
	searchSources: Array<SearchSource>;
};

export type EnrichedModelResponse = {
	prompt: string;
	model: string;
	answer: string;
	sources: Array<EnrichedSource>;
	fanout?: Array<string>;
	rankedBrandsInAnswer: Array<string>;
	rankedBrandsInSourceTitles: Array<string>;
	rankedBrandsInSourceDomains: Array<string>;
};

export async function queryModel(
	prompts: Array<string | JobId>,
	model: ModelIdentifier,
	searchCountry: string | null = null
): Promise<Array<ModelResponse>> {
	let searchResults: Array<SearchResult & { prompt?: string }>;

	if (model === 'google/ai-overview') {
		searchResults = await fetchAIOBatch(
			prompts as Array<string>,
			searchCountry,
			null
		);
	}
	else if (model === 'google/ai-mode') {
		searchResults = await fetchAIMBatch(
			prompts as Array<string>,
			searchCountry,
			null
		);
	}
	else if (model.startsWith('openai/') || model.includes('chatgpt')) {
		// JobIds are alphanumeric strings without spaces
		// (e.g., "7420410504197219329" for Oxylabs, "s_xxxxx" for Brightdata)
		// Prompts are natural language text with spaces
		const firstPrompt = prompts[0];
		const isJobIdArray = prompts.length === 0 || firstPrompt == null || !firstPrompt.includes(' ');
		if (isJobIdArray) {
			searchResults = await downloadGPTSnapshots(prompts as Array<JobId>);
		}
		else {
			searchResults = await scrapeGPTBatch({
				prompts: prompts as Array<string>,
				countryISOCode: searchCountry
			});
		}
	}
	else {
		throw new Error(`Unsupported model: ${model}`);
	}

	// Convert model identifier to column name (e.g., "google/ai-overview" -> "ai_overview")
	const modelColumnName = cleanColumnName(model.split('/').pop() ?? model);

	const responses: Array<ModelResponse> = searchResults.map((sr, i) => ({
		answer: sr.answer,
		sources: sr.sources,
		prompt: sr.prompt ?? (typeof prompts[i] === 'string' ? prompts[i] : ''),
		model: modelColumnName,
		searchQueries: sr.searchQueries ?? [],
		searchSources: sr.searchSources ?? []
	}));

	return responses;
}

const intentLabels: Record<string, string> = {
	'informational': 'The user is seeking information or answers to questions about a topic.',
	'navigational': 'The user is trying to find a specific website or page.',
	'transactional': 'The user intends to complete a transaction, such as making a purchase or signing up for a service.'
};

export async function classifyIntent(
	texts: Array<string>
): Promise<Array<string | null>> {
	console.log('Classifying prompt intents...');

	const textRecords = texts.map(text => ({ text }));
	const intents = await classifyBatch({
		records: textRecords,
		labels: intentLabels,
		instructions: 'Classify the search query into one of the following intents: informational, navigational, transactional.',
		model: 'gpt-4.1-mini'
	});

	return intents.toArray();
}

export async function extractAndAssignTopics(
	texts: Array<string>
): Promise<Array<{ topic: string | null; subtopic: string | null }>> {
	console.log('Identifying topics...');
	const textRecords = texts.map(text => ({ text }));

	const taxonomy = await extractTopics({
		records: textRecords,
		maxSamples: 500
	});

	console.log('Assigning topics...');
	const topicLabels = await assignTopics({ texts, taxonomy });

	return topicLabels.toArray().map(label => ({
		topic: label?.topic ?? null,
		subtopic: label?.subtopic ?? null
	}));
}

export async function assignFunnelStages(
	texts: Array<string>,
	funnel: Funnel
): Promise<Array<{ funnelStage: string | null; funnelCategory: string | null }>> {
	console.log('Assigning funnel stages...');
	const funnelTopics = funnelToTopics(funnel);
	const funnelLabels = await assignTopics({ texts, taxonomy: funnelTopics });

	return funnelLabels.toArray().map(label => ({
		funnelStage: label?.topic ?? null,
		funnelCategory: label?.subtopic ?? null
	}));
}

export async function classifyIntoPersonas(
	texts: Array<string>,
	personas: Array<Persona>
): Promise<Array<Array<string> | null>> {
	console.log('Classifying prompts into personas...');
	const personaLabels: Record<string, string> = {};
	personas.forEach(persona => {
		personaLabels[persona.name] = persona.description;
	});

	const textRecords = texts.map(text => ({ text }));
	const personaAssignments = await labelBatch({
		records: textRecords,
		labels: personaLabels,
		instructions: 'Classify the search query into one or more customer personas based on the language, intent, and context.',
		model: 'gpt-4.1-mini'
	});

	return personaAssignments.toArray();
}

export async function classifyBrandedNonBranded(
	texts: Array<string>
): Promise<Array<string | null>> {
	console.log('Classifying prompts into branded/non-branded...');
	const brandedLabels: Record<string, string> = {
		'branded': 'The query explicitly mentions a specific brand name, company name, product name, or trademark. It shows clear brand awareness and intent to find information about that particular brand.',
		'non-branded': 'The query is generic and does not mention any specific brand names. It focuses on product categories, features, problems, or general information without brand specificity.'
	};

	const textRecords = texts.map(text => ({ text }));
	const brandedClassifications = await classifyBatch({
		records: textRecords,
		labels: brandedLabels,
		instructions: 'Classify whether the search query mentions specific brands or is generic/category-based.',
		model: 'gpt-4.1-mini'
	});

	return brandedClassifications.toArray();
}

export async function extractEntities(
	texts: Array<string>
): Promise<Array<Array<Entity>>> {
	const entityDefinitions = `
		- brands: Any brand or companies mentioned
		- products: Any products or services mentioned
		- features: Specific features or attributes of products/services
		- issues: Problems or issues mentioned
	`;

	const result = await extractEntitiesBatch({
		texts,
		entityDefinitions,
		model: 'gpt-4.1-mini'
	});

	return result.toArray().map(entities => entities ?? []);
}

export async function scorePurchaseProbability(
	texts: Array<string>,
	numDays: number = 30
): Promise<Array<number>> {
	console.log('Scoring purchase probability...');
	const records = texts.map(text => ({ text }));
	const description = dedent(`
		A score from 0 to 100 indicating the likelihood that the user intends to make a purchase
		in the next ${numDays} days. The input record is a text query representing a search
		that a user may perform using a traditional search engine or LLM chat.
	`);

	const scores = await scoreBatch({
		records,
		name: 'Purchase Probability',
		description,
		type: 'integer',
		min: 0,
		max: 100,
		model: 'gpt-4.1-mini'
	});

	return scores.toArray().map(score => score ?? 0);
}

export async function scoreRelevance(
	prompts: Array<string>,
	context: BrandContext
): Promise<Array<number>> {
	console.log('Scoring prompt relevance...');

	const contextParts: Array<string> = [];
	if (context.shortName) {
		contextParts.push(`Brand: ${context.shortName}`);
	}
	if (context.sector) {
		contextParts.push(`Sector: ${context.sector}`);
	}
	if (context.country) {
		contextParts.push(`Market: ${context.country}`);
	}
	if (context.briefing) {
		contextParts.push(`Brief: ${context.briefing}`);
	}

	const contextDescription = contextParts.length > 0
		? `Analysis context:\n${contextParts.join('\n')}`
		: '';

	const records = prompts.map(prompt => ({ prompt }));
	const description = dedent(`
		A score from 0.0 to 1.0 measuring how relevant this search keyword/prompt is
		for the specified SEO analysis context. Consider whether it is specific enough
		for the following brand, sector, market and research brief.

		${contextDescription}

		A score of 0.0 means the keyword/prompt is completely irrelevant to the context,
		e.g. "cheap shoes" for a brand selling enterprise software. A low score can mean
		the keyword/prompt is too generic, not related to the sector/market, or targets
		a different audience. E.g. "data analysis" might be too broad in the context of
		a social network scheduler tool. A medium or high score means the keyword is relevant,
		e.g. "social media data analysis" for the same brand and analysis brief. A score of
		1.0 means the keyword/prompt is highly relevant and specific to the context, e.g.
		"best CRM software for small business" for a brand selling CRM software.
	`);

	const scores = await scoreBatch({
		records,
		name: 'Prompt Relevance',
		description,
		type: 'number',
		min: 0.0,
		max: 1.0,
		model: 'gpt-4.1-mini'
	});

	return scores.toArray().map(score => score ?? 0);
}
