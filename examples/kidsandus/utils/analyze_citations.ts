/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */

/**
 * Analyze existing results to verify citation mapping hypothesis.
 * This script reads saved JSON results and checks if [1], [2], etc.
 * in the answer text map to the citations/sources array order.
 *
 * Run with: deno run --allow-read analyze_citations.ts
 */

import { join, dirname, fromFileUrl } from "https://deno.land/std@0.208.0/path/mod.ts";

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

interface ResultItem {
	answer: string;
	sources: Array<Source>;
	searchQueries?: Array<string>;
	searchSources?: Array<SearchSource>;
	prompt?: string;
	place?: string;
}

interface ResultsFile {
	generatedAt: string;
	model: string;
	places: Array<string>;
	prompts: Array<string>;
	results: Array<ResultItem>;
}

async function findLatestResultsFile(): Promise<string | null> {
	const dataDir = join(dirname(fromFileUrl(import.meta.url)), "chatgpt_response_data");
	let latestFile = "";
	let latestTime = 0;

	try {
		for await (const dirEntry of Deno.readDir(dataDir)) {
			if (dirEntry.isFile && dirEntry.name.startsWith("kidsandus_results_") && dirEntry.name.endsWith(".json")) {
				const filePath = join(dataDir, dirEntry.name);
				const stat = await Deno.stat(filePath);
				if (stat.mtime && stat.mtime.getTime() > latestTime) {
					latestTime = stat.mtime.getTime();
					latestFile = filePath;
				}
			}
		}
	} catch (e) {
		console.error("Error reading data directory:", e);
		return null;
	}

	return latestFile || null;
}

function analyzeCitations(result: ResultItem, index: number): void {
	console.log(`\n${'='.repeat(80)}`);
	console.log(`📝 Result #${index}: "${result.place || result.prompt?.slice(0, 50) || 'Unknown'}"`);
	console.log('='.repeat(80));

	if (!result.answer) {
		console.log('❌ No answer text');
		return;
	}

	// 1. Find all citation patterns in the answer
	// Pattern 1: [N] - bracketed numbers (both escaped \[N\] and unescaped [N])
	const bracketPattern = /\\?\[(\d+)\\?\]/g;
	const bracketMatches = [...result.answer.matchAll(bracketPattern)];

	// Pattern 2: [^N] - footnote style (both escaped and unescaped)
	const footnotePattern = /\\?\[\^(\d+)\\?\]/g;
	const footnoteMatches = [...result.answer.matchAll(footnotePattern)];

	// Pattern 3: [[N]](url) - markdown link with number
	const mdLinkPattern = /\\?\[\\?\[(\d+)\\?\]\\?\]\([^)]+\)/g;
	const mdLinkMatches = [...result.answer.matchAll(mdLinkPattern)];

	// Pattern 4: [text](url) - regular markdown links
	const regularMdLinkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
	const regularMdMatches = [...result.answer.matchAll(regularMdLinkPattern)];

	// Pattern 5: Superscript numbers (unicode)
	const superscriptPattern = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g;
	const superscriptMatches = [...result.answer.matchAll(superscriptPattern)];

	console.log(`\n📊 ANSWER ANALYSIS:`);
	console.log(`   - Answer length: ${result.answer.length} chars`);
	console.log(`   - Sources (citations) array: ${result.sources.length} items`);
	console.log(`   - Search sources array: ${result.searchSources?.length ?? 0} items`);

	console.log(`\n📌 CITATION PATTERNS FOUND IN TEXT:`);
	console.log(`   - [N] bracket refs: ${bracketMatches.length}`);
	console.log(`   - [^N] footnote refs: ${footnoteMatches.length}`);
	console.log(`   - [[N]](url) md link refs: ${mdLinkMatches.length}`);
	console.log(`   - [text](url) regular md links: ${regularMdMatches.length}`);
	console.log(`   - Superscript numbers: ${superscriptMatches.length}`);

	// Show bracket references if any
	if (bracketMatches.length > 0) {
		const uniqueRefs = [...new Set(bracketMatches.map(m => parseInt(m[1], 10)))].sort((a, b) => a - b);
		console.log(`\n   🔢 [N] references found: ${uniqueRefs.join(', ')}`);

		// Show context for first few
		for (const match of bracketMatches.slice(0, 3)) {
			const pos = match.index!;
			const start = Math.max(0, pos - 40);
			const end = Math.min(result.answer.length, pos + 40);
			const context = result.answer.slice(start, end).replace(/\n/g, ' ');
			console.log(`      ${match[0]} → "...${context}..."`);
		}

		// Verify mapping
		console.log(`\n   ✅ VERIFICATION: Do [N] refs map to sources[N-1]?`);
		for (const refNum of uniqueRefs) {
			const sourceIdx = refNum - 1;
			if (sourceIdx >= 0 && sourceIdx < result.sources.length) {
				const source = result.sources[sourceIdx];
				const citedMark = source.cited ? '✓ cited' : '○';
				console.log(`      [${refNum}] → sources[${sourceIdx}]: ${source.domain} (${citedMark})`);
			} else {
				console.log(`      [${refNum}] → OUT OF BOUNDS ✗`);
			}
		}
	}

	// Show regular markdown links if any
	if (regularMdMatches.length > 0) {
		console.log(`\n   🔗 Regular markdown links found:`);
		for (const match of regularMdMatches.slice(0, 5)) {
			const text = match[1].slice(0, 30);
			const url = match[2];
			// Check if this URL is in sources
			const sourceIdx = result.sources.findIndex(s => s.url === url || url.includes(s.domain || 'NOMATCH'));
			const inSources = sourceIdx >= 0 ? `→ sources[${sourceIdx}]` : '(not in sources)';
			console.log(`      [${text}...](${url.slice(0, 50)}...) ${inSources}`);
		}
	}

	// Show sources array
	if (result.sources.length > 0) {
		console.log(`\n📚 SOURCES ARRAY (citations):`);
		result.sources.forEach((source, idx) => {
			const citedMark = source.cited ? '✓ CITED' : '○ not cited';
			console.log(`   [${idx + 1}] ${citedMark} | ${source.domain || 'no domain'}`);
			console.log(`       Title: ${source.title?.slice(0, 60) || 'No title'}...`);
			console.log(`       URL: ${source.url?.slice(0, 80)}...`);
		});
	} else {
		console.log(`\n📚 No sources in citations array`);
	}

	// Show search sources if different
	if (result.searchSources && result.searchSources.length > 0) {
		console.log(`\n🔎 SEARCH SOURCES (for comparison):`);
		result.searchSources.slice(0, 5).forEach((source, idx) => {
			console.log(`   [rank ${source.rank ?? idx}] ${source.domain || 'no domain'} | ${source.title?.slice(0, 50) || 'No title'}...`);
		});
	}

	// Show raw answer snippet
	console.log(`\n📝 RAW ANSWER (first 800 chars):`);
	console.log('---');
	console.log(result.answer.slice(0, 800));
	console.log('---');
}

async function main() {
	console.log('🔍 Analyzing existing results to verify citation mapping hypothesis...\n');
	console.log('Hypothesis: [1], [2], etc. in response text map to sources array order\n');

	const filePath = await findLatestResultsFile();
	if (!filePath) {
		console.error('❌ No results file found');
		Deno.exit(1);
	}

	console.log(`📂 Analyzing file: ${filePath}\n`);

	const content = await Deno.readTextFile(filePath);
	const data: ResultsFile = JSON.parse(content);

	console.log(`📊 File contains ${data.results.length} results`);
	console.log(`   Generated: ${data.generatedAt}`);
	console.log(`   Model: ${data.model}`);

	// Find results that have sources
	const resultsWithSources = data.results.filter(r => r.sources && r.sources.length > 0);
	console.log(`   Results with sources: ${resultsWithSources.length}`);

	// Analyze first few results with sources
	const samplesToAnalyze = resultsWithSources.slice(0, 5);
	if (samplesToAnalyze.length === 0) {
		// Try results without sources but with content
		const resultsWithContent = data.results.filter(r => r.answer && r.answer.length > 100);
		console.log(`   Results with content (no sources): ${resultsWithContent.length}`);
		resultsWithContent.slice(0, 3).forEach((r, i) => analyzeCitations(r, i));
	} else {
		samplesToAnalyze.forEach((r, i) => analyzeCitations(r, i));
	}

	// Summary statistics
	console.log(`\n${'='.repeat(80)}`);
	console.log('📈 SUMMARY STATISTICS');
	console.log('='.repeat(80));

	let totalBracketRefs = 0;
	let totalSources = 0;
	let resultsWithBracketRefs = 0;

	for (const result of data.results) {
		if (result.answer) {
			// Match both escaped \[N\] and unescaped [N]
			const bracketMatches = [...result.answer.matchAll(/\\?\[(\d+)\\?\]/g)];
			if (bracketMatches.length > 0) {
				resultsWithBracketRefs++;
				totalBracketRefs += bracketMatches.length;
			}
		}
		totalSources += result.sources?.length ?? 0;
	}

	console.log(`   Total results: ${data.results.length}`);
	console.log(`   Results with [N] bracket refs: ${resultsWithBracketRefs}`);
	console.log(`   Total [N] refs found: ${totalBracketRefs}`);
	console.log(`   Total sources across all results: ${totalSources}`);
	console.log(`   Results with sources array: ${resultsWithSources.length}`);

	if (resultsWithBracketRefs === 0) {
		console.log(`\n⚠️  No [N] bracket references found in any response.`);
		console.log(`   ChatGPT might be using a different citation format (markdown links, etc.)`);
	}
}

main().catch(console.error);

