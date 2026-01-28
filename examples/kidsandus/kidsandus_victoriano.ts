/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */

declare const Deno: {
	writeTextFile: (path: string, data: string, options?: { append?: boolean; create?: boolean; mode?: number }) => Promise<void>;
	readTextFile: (path: string) => Promise<string>;
	mkdir: (path: string, options?: { recursive?: boolean; mode?: number }) => Promise<void>;
	env: {
		get: (key: string) => string | undefined;
	};
};

// From: datocat/supabase/functions/_shared/cuery
// Run with: deno task run examples/kidsandus.ts

import { join, dirname, fromFileUrl } from "https://deno.land/std@0.208.0/path/mod.ts";
import { scrapeGPTBatch } from '../../src/apis/brightdata.ts';
import { askOpenAISafe } from '../../../openai.ts';
import { extractTopics, assignTopics, type TaxonomyType } from '../../src/topics.ts';
import {
	mergeSources,
	findSourcesForCompany,
	aggregateSourcesByTopic,
	getTopSourcesForTopic,
	type LinkableSource,
	type StatementWithSources,
	type InfluencingSource
} from '../../src/sourceLinker.ts';
import { buildLocationHints, DEFAULT_ALIAS_RULES, normalizeCompanyName, normalizeSources } from '../../src/normalizers.ts';

const startTime = Date.now();

interface ResultSource {
	url?: string;
	title?: string;
	domain?: string;
	cited?: boolean;
	positions?: Array<number>;
}

interface ResultSearchSource {
	url?: string;
	title?: string;
	domain?: string;
	rank?: number;
	datePublished?: string | null;
}

interface ResultEntry {
	answer: string;
	sources: Array<ResultSource>;
	searchQueries?: Array<string>;
	searchSources?: Array<ResultSearchSource>;
	place?: string;
	prompt?: string;
	prompt_metadata?: PromptConfig | null;
}

interface PromptConfig {
	type?: string;
	place: string;
	originalPlace?: string;
	originId?: string;
	prompt: string;
}

const PROMPTS_INPUT_FILE = join(dirname(fromFileUrl(import.meta.url)), 'prompts_inputs', 'generated_prompts.json');

const allPromptConfigs: Array<PromptConfig> = await loadPromptConfigs(PROMPTS_INPUT_FILE);
if (allPromptConfigs.length === 0) {
	throw new Error('No prompts found in prompts_inputs/generated_prompts.json');
}

const reuseResultsPath = Deno.env.get('REUSE_RESULTS_PATH') ?? null;
const reuseExistingResults = reuseResultsPath != null;

let promptConfigs: Array<PromptConfig> = reuseExistingResults
	? [...allPromptConfigs]
	: applyPromptSampling(allPromptConfigs);
let places: Array<string> = [];
let prompts: Array<string> = [];

const OUTPUT_DIRECTORY = '/Users/victoriano/Code/datocat/supabase/functions/_shared/cuery/examples/kidsandus/chatgpt_response_data';

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const resultsPath = `${OUTPUT_DIRECTORY}/kidsandus_results_${timestamp}.json`;

await ensureOutputDirectory();

let result: Array<ResultEntry> = [];
let structuredResults: Array<StructuredOutput | null> = [];

if (reuseExistingResults) {
	const saved = await loadSavedResults(reuseResultsPath!);
	if (Array.isArray(saved.prompt_inputs) && saved.prompt_inputs.length > 0) {
		promptConfigs = saved.prompt_inputs;
	}
	places = Array.isArray(saved.places) && saved.places.length > 0
		? saved.places
		: promptConfigs.map((config) => config.place);
	prompts = Array.isArray(saved.prompts) && saved.prompts.length > 0
		? saved.prompts
		: promptConfigs.map((config) => config.prompt);
	result = saved.results.map((item) => ({
		answer: item.answer ?? '',
		sources: Array.isArray(item.sources)
			? item.sources.map(s => ({
				url: s.url,
				title: (s as { title?: string }).title,
				domain: (s as { domain?: string }).domain,
				cited: (s as { cited?: boolean }).cited,
				positions: (s as { positions?: Array<number> }).positions
			}))
			: [],
		searchQueries: item.searchQueries ?? [],
		searchSources: Array.isArray(item.searchSources)
			? item.searchSources.map(s => {
				const src = s as { url?: string; title?: string; domain?: string; rank?: number; datePublished?: string | null };
				return {
					url: src.url,
					title: src.title,
					domain: src.domain,
					rank: src.rank,
					datePublished: src.datePublished ?? null
				};
			})
			: [],
		place: (item as { place?: string }).place ?? null,
		prompt: (item as { prompt?: string }).prompt ?? null,
		prompt_metadata: (item as { prompt_metadata?: PromptConfig | null }).prompt_metadata ?? null
	}));
	console.log(`\n✓ Reused results from ${reuseResultsPath}\n`);
}
else {
	places = promptConfigs.map((config) => config.place);
	prompts = promptConfigs.map((config) => config.prompt);
	result = await scrapeGPTBatch({
		prompts,
		useSearch: true,
		countryISOCode: 'ES'
	});
}

result = result.map(entry => normalizeResultEntry(entry));



const endTime = Date.now();
const duration = ((endTime - startTime) / 1000).toFixed(2);
console.log(`\n✓ Scraping completed in ${duration} seconds\n`);

// Extract structured data
console.log('\nStarting structured data extraction...\n');
const extractionStart = Date.now();

structuredResults = await Promise.all(result.map(async (item, index) => {
	const prompt = prompts[index];
	const metadata = {
		answer_id: `chatgpt_page_${index}`, // Placeholder ID
		query_intent: prompt,
		timestamp_utc: new Date().toISOString(),
		model_used: 'gpt-4.1', // Assuming this model
		scraper_name: 'Brightdata'
	};

	try {
		return await extractStructuredData(item.answer, prompt, metadata);
	} catch (error) {
		console.error(`Error extracting data for prompt "${prompt}":`, error);
		return null;
	}
}));

const extractionEnd = Date.now();
const extractionDuration = ((extractionEnd - extractionStart) / 1000).toFixed(2);
console.log(`\n✓ Structured data extraction completed in ${extractionDuration} seconds\n`);

structuredResults = structuredResults.map((structured, index) => structured
	? normalizeStructuredOutputForPlace(structured, places[index], promptConfigs[index] ?? null)
	: structured
);


const finalResult = result.map((item, index) => {
	const metadata = promptConfigs[index] ?? item.prompt_metadata ?? null;
	return {
		...item,
		prompt: metadata?.prompt ?? prompts[index],
		place: metadata?.place ?? places[index],
		prompt_metadata: metadata,
		structured_output: structuredResults[index]
	};
});

// --- Topic Enrichment ---
console.log('\nStarting topic enrichment...\n');

// 1. Collect all text statements
const allTexts: string[] = [];
finalResult.forEach(result => {
	if (result.structured_output) {
		result.structured_output.companies_mentioned?.forEach(company => {
			// At this point, arrays are still string[] (not yet enriched)
			allTexts.push(...(company.pros as string[]));
			allTexts.push(...(company.cons as string[]));
			allTexts.push(...(company.neutral_statements as string[]));
		});
		result.structured_output.summary_recommendation?.forEach(rec => {
			allTexts.push(rec.criterion);
			rec.recommendations.forEach(r => allTexts.push(r.reason));
		});
	}
});

if (allTexts.length > 0) {
	console.log(`Collected ${allTexts.length} statements for topic analysis.`);

	// 2. Generate Taxonomy
	// Sample if too many to save tokens/time
	const sampleTexts = allTexts.length > 200 ? allTexts.slice(0, 200) : allTexts;

	let taxonomy: TaxonomyType;
	try {
		taxonomy = await extractTopics({
			records: sampleTexts.map(t => ({ text: t })),
			nTopics: 8,
			nSubtopics: 5,
			instructions: "Categorize these statements about English academies for children. Topics should cover aspects like Methodology, Teachers, Facilities, Exams, Price, etc."
		});
		console.log("Generated Taxonomy:", JSON.stringify(taxonomy, null, 2));

		// 3. Assign Topics
		console.log("Assigning topics to statements...");
		const uniqueTexts = [...new Set(allTexts)];
		const assignedLabels = await assignTopics(uniqueTexts, taxonomy);

		const textToLabel = new Map<string, { topic: string, subtopic: string }>();
		uniqueTexts.forEach((text, index) => {
			const label = assignedLabels[index];
			if (label) {
				textToLabel.set(text, label);
			} else {
				textToLabel.set(text, { topic: "Uncategorized", subtopic: "Other" });
			}
		});

		// 4. Enrich Data with Topics AND Link Sources
		finalResult.forEach(result => {
			if (result.structured_output) {
				const so = result.structured_output;

				// Merge all available sources for this result
				// Convert to proper Source format with required fields, including positions
				const sourcesWithDefaults = (result.sources ?? [])
					.filter(s => s.url != null)
					.map(s => ({
						url: s.url!,
						title: s.title ?? '',
						domain: s.domain ?? '',
						cited: s.cited,
						positions: (s as { positions?: Array<number> }).positions
					}));
				const searchSourcesWithDefaults = (result.searchSources ?? [])
					.filter(s => s.url != null)
					.map(s => ({
						url: s.url!,
						title: s.title ?? '',
						domain: s.domain ?? '',
						rank: s.rank ?? 0,
						datePublished: s.datePublished ?? null
					}));
				const mergedSources = mergeSources(
					sourcesWithDefaults,
					searchSourcesWithDefaults
				);

				if (so.companies_mentioned) {
					// @ts-ignore: transforming string[] to object[]
					so.companies_mentioned = so.companies_mentioned.map(company => {
						// Find sources for this company by name/domain matching
						const companySources = findSourcesForCompany(company.company_name, mergedSources, 3);

						const enrichStatement = (text: string): EnrichedStatement => {
							const label = textToLabel.get(text);
							return {
								text,
								inferred_topic: label?.topic || "Uncategorized",
								inferred_subtopic: label?.subtopic || "Other",
								// All statements from this company share the company's sources
								influencing_sources: companySources
							};
						};

						return {
							...company,
							// Add influencing_sources at company level for easy access in analytics
							influencing_sources: companySources,
							pros: (company.pros as string[]).map(enrichStatement),
							cons: (company.cons as string[]).map(enrichStatement),
							neutral_statements: (company.neutral_statements as string[]).map(enrichStatement)
						};
					});
				}

				if (so.summary_recommendation) {
					// @ts-ignore: transforming structure
					so.summary_recommendation = so.summary_recommendation.map(rec => {
						const criterionLabel = textToLabel.get(rec.criterion);

						return {
							...rec,
							inferred_topic: criterionLabel?.topic || "Uncategorized",
							inferred_subtopic: criterionLabel?.subtopic || "Other",
							recommendations: rec.recommendations.map(r => {
								const label = textToLabel.get(r.reason);
								// Find sources for the company in this recommendation
								const recSources = r.company_name
									? findSourcesForCompany(r.company_name, mergedSources, 3)
									: [];

								return {
									...r,
									inferred_topic: label?.topic || "Uncategorized",
									inferred_subtopic: label?.subtopic || "Other",
									influencing_sources: recSources
								};
							})
						};
					});
				}
			}
		});
		console.log("Topic enrichment with source linking completed.");
	} catch (e) {
		console.error("Topic enrichment failed:", e);
		// Continue without enrichment (or partial)
	}
}

// --- Generate Topic-Source Summary ---
console.log('\nGenerating topic-source influence summary...\n');

const allEnrichedStatements: Array<StatementWithSources> = [];
finalResult.forEach(result => {
	if (result.structured_output?.companies_mentioned) {
		for (const company of result.structured_output.companies_mentioned) {
			const processStatements = (statements: Array<EnrichedStatement>) => {
				for (const stmt of statements) {
					if (stmt.inferred_topic && stmt.influencing_sources != null) {
						// Convert InfluencingSource to LinkableSource for aggregation
						const linkableSources: Array<LinkableSource> = stmt.influencing_sources.map(s => ({
							url: s.url,
							domain: s.domain,
							title: s.title ?? ''
						}));
						allEnrichedStatements.push({
							text: stmt.text,
							inferred_topic: stmt.inferred_topic,
							inferred_subtopic: stmt.inferred_subtopic,
							supporting_sources: linkableSources,
							source_match_scores: []
						});
					}
				}
			};
			processStatements(company.pros as Array<EnrichedStatement>);
			processStatements(company.cons as Array<EnrichedStatement>);
			processStatements(company.neutral_statements as Array<EnrichedStatement>);
		}
	}
});

const topicSourceMap = aggregateSourcesByTopic(allEnrichedStatements);

// Build summary of top sources per topic
const topicSourceSummary: Record<string, {
	subtopics: Record<string, Array<{ url: string; domain: string; frequency: number }>>;
	top_sources: Array<{ url: string; domain: string; frequency: number }>;
}> = {};

for (const [topic, subtopicMap] of topicSourceMap) {
	const topicSummary: typeof topicSourceSummary[string] = {
		subtopics: {},
		top_sources: getTopSourcesForTopic(topicSourceMap, topic, undefined, 10)
			.map(({ source, frequency }) => ({
				url: source.url,
				domain: source.domain,
				frequency
			}))
	};

	for (const [subtopic] of subtopicMap) {
		topicSummary.subtopics[subtopic] = getTopSourcesForTopic(topicSourceMap, topic, subtopic, 5)
			.map(({ source, frequency }) => ({
				url: source.url,
				domain: source.domain,
				frequency
			}));
	}

	topicSourceSummary[topic] = topicSummary;
}

console.log('Topic-Source Summary:');
console.log(JSON.stringify(topicSourceSummary, null, 2));

await Deno.writeTextFile(resultsPath, JSON.stringify({
	generatedAt: new Date().toISOString(),
	model: 'gpt-4.1',
	places,
	prompts,
	prompt_inputs: promptConfigs,
	results: finalResult,
	topic_source_summary: topicSourceSummary
}, null, 2));

console.log(`✓ Results saved to ${resultsPath}`);


async function loadPromptConfigs(path: string): Promise<Array<PromptConfig>> {
	try {
		const content = await Deno.readTextFile(path);
		const parsed = JSON.parse(content);
		if (!Array.isArray(parsed)) {
			console.warn(`Prompt config file ${path} does not contain an array`);
			return [];
		}
		return parsed as Array<PromptConfig>;
	} catch (error) {
		console.error(`Failed to read prompt config file at ${path}`, error);
		return [];
	}
}

function applyPromptSampling(configs: Array<PromptConfig>): Array<PromptConfig> {
	const sampleSizeEnv = Deno.env.get('PROMPT_SAMPLE_SIZE');
	if (!sampleSizeEnv) {
		return configs;
	}

	const parsedSize = parseInt(sampleSizeEnv, 10);
	if (Number.isNaN(parsedSize) || parsedSize <= 0) {
		console.warn(`Invalid PROMPT_SAMPLE_SIZE value "${sampleSizeEnv}". Using full prompt list.`);
		return configs;
	}

	if (parsedSize >= configs.length) {
		console.log(`PROMPT_SAMPLE_SIZE (${parsedSize}) >= total prompts (${configs.length}). Using full prompt list.`);
		return configs;
	}

	const randomize = (Deno.env.get('PROMPT_SAMPLE_RANDOM') ?? 'false').toLowerCase() === 'true';
	const workingList = randomize ? shuffleArray(configs) : configs;
	const sampled = workingList.slice(0, parsedSize);
	console.log(`⚠️ Running sample of ${sampled.length}/${configs.length} prompts (${randomize ? 'random' : 'first N'})`);
	return sampled;
}

function shuffleArray<T>(items: Array<T>): Array<T> {
	const arr = [...items];
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

function normalizeResultEntry(entry: ResultEntry): ResultEntry {
	const normalizedSources = normalizeSources(entry.sources);
	const normalizedSearchSources = normalizeSources(entry.searchSources);

	return {
		...entry,
		sources: normalizedSources,
		searchSources: normalizedSearchSources
	};
}

function normalizeStructuredOutputForPlace(structured: StructuredOutput, place?: string, promptMetadata?: PromptConfig | null): StructuredOutput {
	const locationHints = Array.from(new Set([
		...buildLocationHints(place),
		...buildLocationHints(promptMetadata?.originalPlace)
	])).filter(hint => hint.length > 0);

	const normalizationOptions = {
		locationHints,
		aliasRules: DEFAULT_ALIAS_RULES
	};

	const normalizedCompanies = structured.companies_mentioned?.map(company => ({
		...company,
		company_name: typeof company.company_name === 'string'
			? normalizeCompanyName(company.company_name, normalizationOptions)
			: company.company_name
	}));

	const normalizedSummary = structured.summary_recommendation?.map(rec => ({
		...rec,
		recommendations: rec.recommendations.map(item => ({
			...item,
			company_name: typeof item.company_name === 'string'
				? normalizeCompanyName(item.company_name, normalizationOptions)
				: item.company_name
		}))
	}));

	return {
		...structured,
		companies_mentioned: normalizedCompanies ?? structured.companies_mentioned,
		summary_recommendation: normalizedSummary ?? structured.summary_recommendation
	};
}


// --- Interfaces ---

interface EnrichedStatement {
	text: string;
	inferred_topic: string;
	inferred_subtopic: string;
	/** Sources that influenced this statement (matched by company name/domain) */
	influencing_sources: Array<InfluencingSource>;
}

interface CompanyMention {
	company_name: string;
	mention_rank_position: number;
	summary_recommendation_rank_position: number | null;
	pros: EnrichedStatement[] | string[]; // Allow string[] for initial extraction, EnrichedStatement[] for final
	cons: EnrichedStatement[] | string[];
	neutral_statements: EnrichedStatement[] | string[];
	links: string[];
}

interface RecommendationItem {
	company_name: string | null;
	summary_recommendation_rank_position: number | null;
	reason: string;
	links: string[];
	inferred_topic?: string;
	inferred_subtopic?: string;
}

interface CriterionRecommendation {
	criterion: string;
	criterion_position: number;
	recommendations: RecommendationItem[];
	inferred_topic?: string;
	inferred_subtopic?: string;
}

interface StructuredOutput {
	answer_id: string;
	query_intent: string;
	timestamp_utc: string;
	model_used: string;
	scraper_name: string;
	mentions_companies: boolean;
	companies_mentioned: CompanyMention[];
	summary_recommendation: CriterionRecommendation[];
}

// --- Functions ---

async function ensureOutputDirectory(): Promise<void> {
	try {
		await Deno.mkdir(OUTPUT_DIRECTORY, { recursive: true });
	} catch (error) {
		if (!isAlreadyExistsError(error)) {
			throw error;
		}
	}
}



function isAlreadyExistsError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AlreadyExists';
}

type SavedResultsFile = {
	places?: Array<string>;
	prompts?: Array<string>;
	prompt_inputs?: Array<PromptConfig>;
	results: Array<{
		answer?: string;
		sources?: Array<{ url?: string }>;
		searchQueries?: Array<string>;
		searchSources?: Array<unknown>;
		structured_output?: StructuredOutput;
	}>;
};

async function loadSavedResults(path: string): Promise<SavedResultsFile> {
	const content = await Deno.readTextFile(path);
	const parsed = JSON.parse(content);
	if (parsed == null || !Array.isArray(parsed.results)) {
		throw new Error('Invalid saved results file: expected a results array');
	}
	return parsed as SavedResultsFile;
}

async function extractStructuredData(answer: string, query: string, metadata: any): Promise<StructuredOutput> {
	const trimmedAnswer = answer.trim();
	if (trimmedAnswer.length === 0) {
		return {
			...metadata,
			mentions_companies: false,
			companies_mentioned: [],
			summary_recommendation: []
		};
	}

	const systemPrompt = `Eres un extractor de información muy estricto.

Tu tarea es leer una respuesta generada por ChatGPT sobre academias/empresas y producir UN ÚNICO objeto JSON que cumpla exactamente el esquema que te proporciono.

Reglas generales:

1. No inventes información. Usa únicamente texto explícito que aparezca en la respuesta.
2. No parafrasees ni reformules los motivos:
   - El campo "reason" de cada recomendación debe ser texto literal de la respuesta original.
   - Puedes recortar o unir varias frases, pero siempre copiadas tal cual, sin cambiar palabras ni el orden.
3. En los campos "pros", "cons" y "neutral_statements":
   - Usa frases literales de la respuesta.
   - Clasifícalas según tono: positivo (pros), negativo (cons), descriptivo/neutro (neutral_statements).
4. Sobre "companies_mentioned":
   - Detecta las empresas/academias mencionadas (por ejemplo, encabezados de listas, nombres en negrita, etc.).
   - Si el nombre incluye una ubicación (ciudad, barrio, calle, distrito, etc.), elimina esa parte y deja solo la marca. Ejemplos: "Kids&Us Madrid Aluche" → "Kids&Us"; "British Council Madrid" → "British Council". Solo conserva la ubicación si forma parte del nombre oficial (p.ej. "Academia Murcia").
   - "mention_rank_position" es el orden de aparición de la empresa en la respuesta (1 = la primera que aparece, 2 = la segunda, etc.).
   - "summary_recommendation_rank_position" debe ser:
     - Un número entero si la respuesta establece explícitamente un orden o preferencia clara dentro de alguna recomendación global o por criterio.
     - null si no se menciona ningún ranking o prioridad explícita para esa empresa.
   - "links" debe contener solo URLs que aparezcan en la respuesta y que estén asociadas a esa empresa (por ejemplo, en sus viñetas o referencias).
5. Sobre "summary_recommendation":
   - Cada elemento representa un criterio de decisión (por ejemplo "Método de enseñanza", "Presupuesto", "Comunidad", etc.).
   - El nombre del criterio puede ser interpretado a partir del texto (no hace falta que sea literal), pero:
     - El campo "reason" de cada recomendación dentro del criterio debe ser texto literal de la respuesta.
   - Para cada "recommendation":
     - "company_name" debe ser el nombre de la empresa si aparece explícitamente en la MISMA frase, viñeta o párrafo que el texto usado en "reason".
     - Si el consejo es general y no menciona ninguna empresa en ese mismo fragmento de texto, pon "company_name": null.
     - "summary_recommendation_rank_position" es la posición relativa de esa empresa dentro de ese criterio (1, 2, 3…) si hay un orden claro en el texto. Si no hay orden explícito, pon null.
     - "links" debe contener únicamente URLs que aparezcan en el MISMO párrafo/viñeta de la respuesta que has usado para "reason". Si no hay ningún enlace en ese fragmento, usa un array vacío [].
6. No añadas campos extra fuera del esquema.
7. Si algún campo no puede rellenarse con información explícita de la respuesta:
   - Usa null (cuando el schema lo permite).
   - O un array vacío [] (cuando sea una lista).
8. Devuelve únicamente el JSON final, sin explicaciones, sin comentarios y sin texto adicional.

Schema:
{
  "answer_id": "string",
  "query_intent": "string",
  "timestamp_utc": "string",
  "model_used": "string",
  "scraper_name": "string",
  "mentions_companies": boolean,
  "companies_mentioned": [
    {
      "company_name": "string",
      "mention_rank_position": number,
      "summary_recommendation_rank_position": number | null,
      "pros": ["string"],
      "cons": ["string"],
      "neutral_statements": ["string"],
      "links": ["string"]
    }
  ],
  "summary_recommendation": [
    {
      "criterion": "string",
      "criterion_position": number,
      "recommendations": [
        {
          "company_name": "string | null",
          "summary_recommendation_rank_position": number | null,
          "reason": "string",
          "links": ["string"]
        }
      ]
    }
  ]
}`;

	const userContent = `Entrada:
- Query original: ${query}
- Metadatos: ${JSON.stringify(metadata)}
- Texto de la respuesta:
${trimmedAnswer}`;

	const conversation = [
		{
			role: 'system',
			content: systemPrompt
		},
		{
			role: 'user',
			content: userContent
		}
	];

	const { parsed, output_text, error } = await askOpenAISafe(conversation, 'gpt-4.1', null, undefined, 2, 'return');

	if (error != null) {
		throw new Error(`Extraction failed: ${error.message}`);
	}

	const rawText = parsed ?? output_text ?? '{}';

	try {
		// Try to parse the JSON if it's a string
		const json = typeof rawText === 'string' ? JSON.parse(rawText) : rawText;
		return json as StructuredOutput;
	} catch (e) {
		console.warn('Failed to parse JSON from LLM response, trying to fix...', e);
		// Basic fallback if the model returns markdown code blocks
		const match = typeof rawText === 'string' ? rawText.match(/```json\n([\s\S]*?)\n```/) : null;
		if (match) {
			return JSON.parse(match[1]) as StructuredOutput;
		}
		throw new Error('Invalid JSON response from LLM');
	}
}
