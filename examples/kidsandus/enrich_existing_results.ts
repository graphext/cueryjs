// Script to enrich existing JSON results with structured_output + real topics
// Uses OpenAI to extract structured data from the raw answers

import { join, dirname, fromFileUrl } from "https://deno.land/std@0.208.0/path/mod.ts";
import { buildLocationHints, DEFAULT_ALIAS_RULES, normalizeCompanyName, normalizeSources } from '../../src/normalizers.ts';

declare const Deno: {
	writeTextFile: (path: string, data: string) => Promise<void>;
	readTextFile: (path: string) => Promise<string>;
	env: {
		get: (key: string) => string | undefined;
	};
};

const DATA_DIR = join(dirname(fromFileUrl(import.meta.url)), 'chatgpt_response_data');
const PROMPTS_INPUT_FILE = join(dirname(fromFileUrl(import.meta.url)), 'prompts_inputs', 'generated_prompts.json');

async function findLatestRawFile(): Promise<string | null> {
	let latestFile: string | null = null;
	let latestTime = 0;

	try {
		for await (const entry of Deno.readDir(DATA_DIR)) {
			if (!entry.isFile) continue;
			if (!entry.name.endsWith('.json') || entry.name.endsWith('_enriched.json')) continue;
			const filePath = join(DATA_DIR, entry.name);
			const stat = await Deno.stat(filePath);
			const mtime = stat.mtime?.getTime() ?? 0;
			if (mtime > latestTime) {
				latestTime = mtime;
				latestFile = filePath;
			}
		}
	} catch (error) {
		console.error('Error scanning data directory:', error);
		return null;
	}

	return latestFile;
}

const envInput = Deno.env.get('INPUT_FILE');
const detectedInput = envInput ?? await findLatestRawFile();
if (!detectedInput) {
	throw new Error('No input file found. Set INPUT_FILE env var or place a raw kidsandus_results_*.json file in chatgpt_response_data.');
}

const INPUT_FILE = detectedInput;
const envOutput = Deno.env.get('OUTPUT_FILE');
const OUTPUT_FILE = envOutput ?? `${INPUT_FILE.replace(/\.json$/, '_enriched.json')}`;

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;
const promptInputs = await loadPromptInputs(PROMPTS_INPUT_FILE);
const promptMetadataLookup = buildPromptMetadataLookup(promptInputs);

// Taxonomy for English academies
interface Taxonomy {
	topics: Array<{ topic: string; subtopics: string[] }>;
}

interface Source {
	url: string;
	title: string;
	domain: string;
	cited?: boolean;
	positions?: number[];
}

interface InfluencingSource {
	url: string;
	domain: string;
	title?: string;
	positions?: number[];
}

interface CompanyMention {
	company_name: string;
	pros: Array<string | EnrichedStatement>;
	cons: Array<string | EnrichedStatement>;
	neutral_statements: Array<string | EnrichedStatement>;
	influencing_sources?: InfluencingSource[];
}

interface EnrichedStatement {
	text: string;
	inferred_topic: string;
	inferred_subtopic: string;
	influencing_sources?: InfluencingSource[];
}

interface StructuredOutput {
	answer_id: string;
	query_intent: string;
	timestamp_utc: string;
	model_used: string;
	scraper_name: string;
	companies_mentioned?: CompanyMention[];
	summary_recommendation?: Array<{
		criterion: string;
		recommendations: Array<{ company_name: string; reason: string }>;
	}>;
}

interface PromptMetadata {
	type?: string;
	place: string;
	originalPlace?: string;
	originId?: string;
	prompt: string;
}

interface ResultItem {
	answer: string;
	place?: string;
	prompt?: string;
	prompt_metadata?: PromptMetadata | null;
	sources?: Array<Source>;
	searchSources?: Array<SearchSource>;
	searchQueries?: Array<string>;
	structured_output?: StructuredOutput | null;
	[key: string]: unknown;
}

interface ResultsFile {
	results: Array<ResultItem>;
	[key: string]: unknown;
}

interface PromptMetadataLookup {
	byPlace: Map<string, PromptMetadata>;
	byPrompt: Map<string, PromptMetadata>;
}

// Generate taxonomy from sample texts
async function generateTaxonomy(texts: string[]): Promise<Taxonomy> {
	const sampleTexts = texts.slice(0, 100).map(t => `- ${t}`).join('\n');

	const response = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${OPENAI_API_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: 'gpt-4o-mini',
			messages: [{
				role: 'user',
				content: `From these statements about English academies for children, extract 8 main topics with up to 5 subtopics each.
Topics should cover aspects like: Methodology, Teachers, Facilities, Exams, Price, Schedule, Location, Results.

Return JSON: { "topics": [{ "topic": "TopicName", "subtopics": ["Sub1", "Sub2"] }] }

Statements:
${sampleTexts}`
			}],
			response_format: { type: 'json_object' },
			temperature: 0.2
		})
	});

	const data = await response.json();
	const content = data.choices?.[0]?.message?.content;
	return content ? JSON.parse(content) : { topics: [] };
}

// Assign topic to a text
async function assignTopic(text: string, taxonomy: Taxonomy): Promise<{ topic: string; subtopic: string }> {
	const response = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${OPENAI_API_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: 'gpt-4o-mini',
			messages: [
				{
					role: 'system',
					content: `Assign the correct topic and subtopic from this taxonomy:
${JSON.stringify(taxonomy, null, 2)}`
				},
				{
					role: 'user',
					content: `Assign topic/subtopic to: "${text}"\n\nReturn JSON: { "topic": "...", "subtopic": "..." }`
				}
			],
			response_format: { type: 'json_object' },
			temperature: 0
		})
	});

	const data = await response.json();
	const content = data.choices?.[0]?.message?.content;

	if (content) {
		const parsed = JSON.parse(content);
		return { topic: parsed.topic || 'General', subtopic: parsed.subtopic || 'Other' };
	}
	return { topic: 'General', subtopic: 'Other' };
}

// Simple function to extract structured data using OpenAI
async function extractStructuredData(answer: string, prompt: string, index: number): Promise<StructuredOutput | null> {
	const basePrompt = `You are a data extraction assistant. Extract structured information from the given text about English academies for children.

Return a JSON object with this structure:
{
  "companies_mentioned": [
    {
      "company_name": "Name of the academy",
      "pros": ["positive statement 1", "positive statement 2"],
      "cons": ["negative statement 1"],
      "neutral_statements": ["neutral info"]
    }
  ],
  "summary_recommendation": [
    {
      "criterion": "Best for...",
      "recommendations": [
        { "company_name": "Academy Name", "reason": "Why it's recommended" }
      ]
    }
  ]
}

Only include companies that are explicitly mentioned. Extract actual statements from the text.`;
	const locationNote = `\nWhen a company name contains a location descriptor (city, neighborhood, street, district, etc.), remove that part and keep only the brand. Examples: "Kids&Us Madrid Aluche" -> "Kids&Us"; "British Council Madrid" -> "British Council". Only keep the location if it is part of the legal brand name (e.g., "Academia Murcia").`;
	const systemPrompt = basePrompt + locationNote;

	try {
		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${OPENAI_API_KEY}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: `Query: ${prompt}\n\nText to analyze:\n${answer}` }
				],
				response_format: { type: 'json_object' },
				temperature: 0.1
			})
		});

		if (!response.ok) {
			console.error(`OpenAI API error: ${response.status}`);
			return null;
		}

		const data = await response.json();
		const content = data.choices?.[0]?.message?.content;

		if (!content) return null;

		const parsed = JSON.parse(content);

		return {
			answer_id: `chatgpt_page_${index}`,
			query_intent: prompt,
			timestamp_utc: new Date().toISOString(),
			model_used: 'gpt-4o-mini',
			scraper_name: 'Brightdata',
			companies_mentioned: parsed.companies_mentioned || [],
			summary_recommendation: parsed.summary_recommendation || []
		};
	} catch (error) {
		console.error(`Error extracting data:`, error);
		return null;
	}
}

// Find sources for a company
function findSourcesForCompany(companyName: string, sources: Source[]): InfluencingSource[] {
	const normalizedName = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
	const matched: InfluencingSource[] = [];

	for (const source of sources) {
		const domain = source.domain.toLowerCase().replace(/[^a-z0-9]/g, '');
		const title = (source.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');

		// Check for name match
		const nameWords = normalizedName.split(/\s+/).filter(w => w.length > 2);
		const matchesDomain = nameWords.some(w => domain.includes(w));
		const matchesTitle = nameWords.some(w => title.includes(w));

		if (matchesDomain || matchesTitle) {
			matched.push({
				url: source.url,
				domain: source.domain,
				title: source.title,
				positions: source.positions
			});
		}
	}

	// Prioritize sources with positions
	return matched
		.sort((a, b) => {
			const aHasPos = (a.positions?.length ?? 0) > 0 ? 1 : 0;
			const bHasPos = (b.positions?.length ?? 0) > 0 ? 1 : 0;
			return bHasPos - aHasPos;
		})
		.slice(0, 3);
}

// Main
console.log('Loading input file...');
const inputData: ResultsFile = JSON.parse(await Deno.readTextFile(INPUT_FILE));
inputData.results = inputData.results.map(result => normalizeResultItem(result, promptMetadataLookup));
console.log(`Loaded ${inputData.results.length} results`);

// STEP 1: Extract structured data for all results
console.log('\n--- Step 1: Extracting structured data ---');
const tempResults = [];
let processedCount = 0;

for (const result of inputData.results) {
	console.log(`[${processedCount + 1}/${inputData.results.length}] Extracting ${result.place}...`);

	const structuredOutput = await extractStructuredData(result.answer, result.prompt, processedCount);
	const normalizedStructuredOutput = structuredOutput
		? normalizeStructuredOutputForPlace(structuredOutput, result.place, result.prompt_metadata ?? null)
		: structuredOutput;
	tempResults.push({ ...result, structured_output: normalizedStructuredOutput });
	processedCount++;

	await new Promise(r => setTimeout(r, 300));
}

// STEP 2: Collect all texts and generate taxonomy
console.log('\n--- Step 2: Generating taxonomy ---');
const allTexts: string[] = [];

for (const result of tempResults) {
	const so = result.structured_output;
	if (!so) continue;

	for (const company of (so.companies_mentioned || [])) {
		for (const p of company.pros) allTexts.push(typeof p === 'string' ? p : p.text);
		for (const c of company.cons) allTexts.push(typeof c === 'string' ? c : c.text);
		for (const n of company.neutral_statements) allTexts.push(typeof n === 'string' ? n : n.text);
	}
	for (const rec of (so.summary_recommendation || [])) {
		allTexts.push(rec.criterion);
		for (const r of rec.recommendations) allTexts.push(r.reason);
	}
}

console.log(`Collected ${allTexts.length} statements`);
const taxonomy = await generateTaxonomy(allTexts);
console.log('Generated taxonomy:', JSON.stringify(taxonomy.topics.map(t => t.topic), null, 2));

// STEP 3: Assign topics to unique texts
console.log('\n--- Step 3: Assigning topics ---');
const uniqueTexts = [...new Set(allTexts)];
const textToLabel = new Map<string, { topic: string; subtopic: string }>();

let assignedCount = 0;
for (const text of uniqueTexts) {
	const label = await assignTopic(text, taxonomy);
	textToLabel.set(text, label);
	assignedCount++;

	if (assignedCount % 20 === 0) {
		console.log(`  Assigned ${assignedCount}/${uniqueTexts.length} topics...`);
	}

	// Small delay
	await new Promise(r => setTimeout(r, 100));
}
console.log(`  Assigned ${assignedCount}/${uniqueTexts.length} topics`);

// STEP 4: Enrich results with topics and sources
console.log('\n--- Step 4: Enriching with sources ---');
const enrichedResults = tempResults.map(result => {
	const so = result.structured_output;
	if (!so || !so.companies_mentioned) return result;

	so.companies_mentioned = so.companies_mentioned.map((company: CompanyMention) => {
		const companySources = findSourcesForCompany(company.company_name, result.sources || []);

		const enrichStatement = (text: string): EnrichedStatement => {
			const label = textToLabel.get(text) || { topic: 'General', subtopic: 'Other' };
			return {
				text,
				inferred_topic: label.topic,
				inferred_subtopic: label.subtopic,
				influencing_sources: companySources
			};
		};

		return {
			...company,
			influencing_sources: companySources,
			pros: company.pros.map(p => typeof p === 'string' ? enrichStatement(p) : p),
			cons: company.cons.map(c => typeof c === 'string' ? enrichStatement(c) : c),
			neutral_statements: company.neutral_statements.map(n => typeof n === 'string' ? enrichStatement(n) : n)
		};
	});

	// Also enrich summary recommendations
	if (so.summary_recommendation) {
		so.summary_recommendation = so.summary_recommendation.map((rec: { criterion: string; recommendations: Array<{ company_name: string; reason: string }> }) => {
			const criterionLabel = textToLabel.get(rec.criterion) || { topic: 'General', subtopic: 'Other' };
			return {
				...rec,
				inferred_topic: criterionLabel.topic,
				inferred_subtopic: criterionLabel.subtopic,
				recommendations: rec.recommendations.map(r => {
					const label = textToLabel.get(r.reason) || { topic: 'General', subtopic: 'Other' };
					return {
						...r,
						inferred_topic: label.topic,
						inferred_subtopic: label.subtopic
					};
				})
			};
		});
	}

	return result;
});

// Save output
console.log('\n--- Saving ---');
await Deno.writeTextFile(OUTPUT_FILE, JSON.stringify({
	...inputData,
	prompt_inputs: promptInputs,
	results: enrichedResults
}, null, 2));

console.log(`✓ Saved to: ${OUTPUT_FILE}`);
console.log('Done!');

function normalizeResultItem(result: ResultItem, metadataLookup: PromptMetadataLookup): ResultItem {
	const normalizedSources = normalizeSources(result.sources);
	const normalizedSearchSources = normalizeSources(result.searchSources);
	const normalizedStructured = result.structured_output
		? normalizeStructuredOutputForPlace(result.structured_output, result.place, result.prompt_metadata ?? null)
		: result.structured_output;
	const promptMetadata = pickPromptMetadata(result, metadataLookup);

	return {
		...result,
		sources: normalizedSources,
		searchSources: normalizedSearchSources,
		structured_output: normalizedStructured,
		prompt_metadata: promptMetadata ?? null
	};
}

function normalizeStructuredOutputForPlace(structured: ResultItem['structured_output'], place?: string, promptMetadata?: PromptMetadata | null): ResultItem['structured_output'] {
	if (!structured) {
		return structured;
	}

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

async function loadPromptInputs(path: string): Promise<Array<PromptMetadata>> {
	try {
		const content = await Deno.readTextFile(path);
		const parsed = JSON.parse(content);
		if (!Array.isArray(parsed)) {
			console.warn(`Prompt input file ${path} does not contain an array`);
			return [];
		}
		return parsed as Array<PromptMetadata>;
	} catch (error) {
		console.warn(`Unable to read prompt input file at ${path}`, error);
		return [];
	}
}

function buildPromptMetadataLookup(inputs: Array<PromptMetadata>): PromptMetadataLookup {
	const byPlace = new Map<string, PromptMetadata>();
	const byPrompt = new Map<string, PromptMetadata>();

	for (const input of inputs) {
		if (input.place) {
			byPlace.set(input.place.toLowerCase(), input);
		}
		if (input.prompt) {
			byPrompt.set(input.prompt.toLowerCase(), input);
		}
	}

	return { byPlace, byPrompt };
}

function pickPromptMetadata(result: ResultItem, lookup: PromptMetadataLookup): PromptMetadata | null {
	if (result.prompt_metadata) {
		return result.prompt_metadata;
	}

	if (result.place) {
		const meta = lookup.byPlace.get(result.place.toLowerCase());
		if (meta) {
			return meta;
		}
	}

	if (result.prompt) {
		const meta = lookup.byPrompt.get(result.prompt.toLowerCase());
		if (meta) {
			return meta;
		}
	}

	return null;
}
