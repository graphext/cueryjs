/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */

/**
 * Process existing results and add influencing_sources to each statement.
 * This script reads the enriched JSON and adds source linking based on inline citations.
 *
 * Run with: deno run --allow-read --allow-write process_with_sources.ts
 */

import { join, dirname, fromFileUrl } from "https://deno.land/std@0.208.0/path/mod.ts";

// --- Types ---

interface Source {
	url: string;
	title?: string;
	domain?: string;
	cited?: boolean;
}

interface SearchSource {
	url?: string;
	title?: string;
	domain?: string;
	rank?: number;
	datePublished?: string | null;
}

interface InfluencingSource {
	url: string;
	domain: string;
	title?: string;
	citation_number?: number;
}

interface OriginalStatement {
	text: string;
	inferred_topic: string;
	inferred_subtopic: string;
}

interface EnrichedStatement extends OriginalStatement {
	influencing_sources: Array<InfluencingSource>;
}

interface Company {
	company_name: string;
	pros: Array<OriginalStatement>;
	cons: Array<OriginalStatement>;
	neutral_statements: Array<OriginalStatement>;
	[key: string]: unknown;
}

interface ResultItem {
	answer: string;
	sources: Array<Source>;
	searchSources?: Array<SearchSource>;
	place?: string;
	prompt?: string;
	structured_output?: {
		companies_mentioned?: Array<Company>;
		summary_recommendation?: Array<{
			criterion: string;
			recommendations: Array<{ reason: string; company_name?: string; [key: string]: unknown }>;
			[key: string]: unknown;
		}>;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

interface ResultsFile {
	generatedAt: string;
	model: string;
	places: Array<string>;
	prompts: Array<string>;
	results: Array<ResultItem>;
	[key: string]: unknown;
}

// --- Source Matching ---

function mergeSources(sources: Array<Source>, searchSources: Array<SearchSource>): Array<Source> {
	const merged: Array<Source> = [...sources];
	const seenUrls = new Set(sources.map(s => s.url));

	for (const ss of searchSources) {
		if (ss.url && !seenUrls.has(ss.url)) {
			merged.push({
				url: ss.url,
				title: ss.title,
				domain: ss.domain
			});
			seenUrls.add(ss.url);
		}
	}

	return merged;
}

/** Normalize text for fuzzy matching */
function normalize(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "") // Remove accents
		.replace(/[^a-z0-9]/g, ""); // Keep only alphanumeric
}

/** Extract company name variations for matching */
function getCompanyNameVariations(companyName: string): Array<string> {
	const variations: Array<string> = [];
	const normalized = normalize(companyName);
	variations.push(normalized);

	// Extract main keywords (remove common words)
	const stopWords = ["academia", "centro", "escuela", "english", "language", "school", "centre", "center", "de", "en", "para", "the"];
	const words = companyName.toLowerCase().split(/\s+/)
		.filter(w => !stopWords.includes(normalize(w)) && w.length > 2);

	for (const word of words) {
		variations.push(normalize(word));
	}

	return [...new Set(variations)];
}

/** Match sources to a company by domain/title similarity */
function findSourcesForCompany(companyName: string, sources: Array<Source>): Array<InfluencingSource> {
	const variations = getCompanyNameVariations(companyName);
	const matched: Array<InfluencingSource> = [];
	const seenUrls = new Set<string>();

	for (const source of sources) {
		if (seenUrls.has(source.url)) continue;

		const domain = normalize(source.domain || "");
		const title = normalize(source.title || "");
		const url = normalize(source.url || "");

		// Check if any variation matches domain, title, or URL
		for (const variation of variations) {
			if (variation.length < 3) continue;

			const matchesDomain = domain.includes(variation);
			const matchesTitle = title.includes(variation);
			const matchesUrl = url.includes(variation);

			if (matchesDomain || matchesTitle || matchesUrl) {
				matched.push({
					url: source.url,
					domain: source.domain || "",
					title: source.title,
					citation_number: undefined // No inline citation, matched by name
				});
				seenUrls.add(source.url);
				break;
			}
		}
	}

	// Prioritize cited sources
	return matched.sort((a, b) => {
		const aCited = sources.find(s => s.url === a.url)?.cited ? 1 : 0;
		const bCited = sources.find(s => s.url === b.url)?.cited ? 1 : 0;
		return bCited - aCited;
	}).slice(0, 3); // Max 3 sources per company
}

function enrichCompanyStatements(
	statements: Array<OriginalStatement>,
	companyName: string,
	sources: Array<Source>
): Array<EnrichedStatement> {
	// Find all sources relevant to this company
	const companySources = findSourcesForCompany(companyName, sources);

	// All statements from this company share the company's sources
	return statements.map(stmt => ({
		...stmt,
		influencing_sources: companySources
	}));
}

// --- Main ---

async function findLatestResultsFile(): Promise<string | null> {
	const dataDir = join(dirname(fromFileUrl(import.meta.url)), "chatgpt_response_data");
	let latestFile = "";
	let latestTime = 0;

	for await (const dirEntry of Deno.readDir(dataDir)) {
		if (dirEntry.isFile && dirEntry.name.endsWith("_enriched.json")) {
			const filePath = join(dataDir, dirEntry.name);
			const stat = await Deno.stat(filePath);
			if (stat.mtime && stat.mtime.getTime() > latestTime) {
				latestTime = stat.mtime.getTime();
				latestFile = filePath;
			}
		}
	}

	return latestFile || null;
}

async function main() {
	console.log('🔧 Processing existing results to add influencing_sources...\n');

	const filePath = await findLatestResultsFile();
	if (!filePath) {
		console.error('❌ No enriched results file found');
		Deno.exit(1);
	}

	console.log(`📂 Reading: ${filePath}\n`);

	const content = await Deno.readTextFile(filePath);
	const data: ResultsFile = JSON.parse(content);

	console.log(`📊 Processing ${data.results.length} results...\n`);

	let totalStatements = 0;
	let statementsWithSources = 0;

	let companiesWithSources = 0;
	let totalCompanies = 0;

	// Process each result
	for (const result of data.results) {
		if (!result.structured_output) continue;

		// Merge sources
		const mergedSources = mergeSources(
			result.sources || [],
			result.searchSources || []
		);

		// Process companies_mentioned
		if (result.structured_output.companies_mentioned) {
			for (const company of result.structured_output.companies_mentioned) {
				totalCompanies++;

				// Find sources for this company
				const companySources = findSourcesForCompany(company.company_name, mergedSources);
				if (companySources.length > 0) companiesWithSources++;

				// Attach sources to company level (more efficient for analytics)
				(company as unknown as { influencing_sources: Array<InfluencingSource> }).influencing_sources = companySources;

				// Process pros
				if (Array.isArray(company.pros)) {
					company.pros = company.pros.map((stmt: OriginalStatement) => {
						totalStatements++;
						if (companySources.length > 0) statementsWithSources++;
						return {
							...stmt,
							influencing_sources: companySources
						};
					});
				}

				// Process cons
				if (Array.isArray(company.cons)) {
					company.cons = company.cons.map((stmt: OriginalStatement) => {
						totalStatements++;
						if (companySources.length > 0) statementsWithSources++;
						return {
							...stmt,
							influencing_sources: companySources
						};
					});
				}

				// Process neutral_statements
				if (Array.isArray(company.neutral_statements)) {
					company.neutral_statements = company.neutral_statements.map((stmt: OriginalStatement) => {
						totalStatements++;
						if (companySources.length > 0) statementsWithSources++;
						return {
							...stmt,
							influencing_sources: companySources
						};
					});
				}
			}
		}

		// Process summary_recommendation
		if (result.structured_output.summary_recommendation) {
			for (const rec of result.structured_output.summary_recommendation) {
				if (rec.recommendations) {
					rec.recommendations = rec.recommendations.map((r: { reason: string; company_name?: string; [key: string]: unknown }) => {
						totalStatements++;
						// Try to find sources for the company mentioned in the recommendation
						const recSources = r.company_name
							? findSourcesForCompany(r.company_name, mergedSources)
							: [];
						if (recSources.length > 0) statementsWithSources++;
						return {
							...r,
							influencing_sources: recSources
						};
					});
				}
			}
		}
	}

	console.log(`📊 Empresas: ${totalCompanies} total, ${companiesWithSources} con sources (${((companiesWithSources/totalCompanies)*100).toFixed(1)}%)`)

	console.log(`✅ Processed ${totalStatements} statements`);
	console.log(`   ${statementsWithSources} have influencing_sources (${((statementsWithSources/totalStatements)*100).toFixed(1)}%)\n`);

	// Save to new file
	const outputPath = filePath.replace('_enriched.json', '_with_sources.json');
	await Deno.writeTextFile(outputPath, JSON.stringify(data, null, 2));
	console.log(`💾 Saved to: ${outputPath}\n`);

	// Show some examples
	console.log('═'.repeat(100));
	console.log('📋 EJEMPLOS DE STATEMENTS CON INFLUENCING_SOURCES');
	console.log('═'.repeat(100));

	let examplesShown = 0;
	for (const result of data.results) {
		if (examplesShown >= 8) break;
		if (!result.structured_output?.companies_mentioned) continue;

		for (const company of result.structured_output.companies_mentioned) {
			if (examplesShown >= 8) break;

			const allStatements = [
				...(company.pros || []),
				...(company.cons || []),
				...(company.neutral_statements || [])
			] as Array<EnrichedStatement>;

			for (const stmt of allStatements) {
				if (examplesShown >= 8) break;
				if (!stmt.influencing_sources || stmt.influencing_sources.length === 0) continue;

				console.log(`\n${'─'.repeat(100)}`);
				console.log(`\n🏙️  ${result.place} | 🏢 ${company.company_name}`);
				console.log(`📂 ${stmt.inferred_topic} → ${stmt.inferred_subtopic}`);
				console.log(`\n📝 Texto:`);
				console.log(`   "${stmt.text.slice(0, 150)}${stmt.text.length > 150 ? '...' : ''}"`);
				console.log(`\n🔗 Fuentes que influyen (${stmt.influencing_sources.length}):`);
				for (const src of stmt.influencing_sources) {
					console.log(`   [${src.citation_number}] ${src.domain}`);
					console.log(`       ${src.title?.slice(0, 60) || 'Sin título'}...`);
					console.log(`       ${src.url.slice(0, 70)}...`);
				}
				examplesShown++;
			}
		}
	}

	console.log(`\n\n${'═'.repeat(100)}`);
	console.log('✅ ESTRUCTURA JSON PARA ANALYTICS');
	console.log('═'.repeat(100));
	console.log(`
Cada statement ahora tiene esta estructura:

{
  "text": "El texto del statement con cita \\\\[1\\\\]",
  "inferred_topic": "Profesores y Personal",
  "inferred_subtopic": "Profesorado nativo",
  "influencing_sources": [
    {
      "url": "https://...",
      "domain": "academia.es",
      "title": "Título de la fuente",
      "citation_number": 1
    }
  ]
}

Puedes usar influencing_sources en tu componente de Analytics para mostrar
los links que influyeron en cada ficha.
`);
}

main().catch(console.error);

