/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */

/**
 * Show concrete citation examples for manual verification.
 * Run with: deno run --allow-read show_citation_examples.ts
 */

import { join, dirname, fromFileUrl } from "https://deno.land/std@0.208.0/path/mod.ts";

interface Source {
	url: string;
	title?: string;
	domain?: string;
	cited?: boolean;
}

interface ResultItem {
	answer: string;
	sources: Array<Source>;
	place?: string;
}

interface ResultsFile {
	results: Array<ResultItem>;
}

async function findLatestResultsFile(): Promise<string | null> {
	const dataDir = join(dirname(fromFileUrl(import.meta.url)), "chatgpt_response_data");
	let latestFile = "";
	let latestTime = 0;

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

	return latestFile || null;
}

interface CitationExample {
	place: string;
	citationNumber: number;
	textContext: string;
	sourceUrl: string;
	sourceDomain: string;
	sourceTitle: string;
	isCited: boolean;
}

function extractExamples(result: ResultItem): Array<CitationExample> {
	const examples: Array<CitationExample> = [];
	const pattern = /\\?\[(\d+)\\?\]/g;

	let match;
	while ((match = pattern.exec(result.answer)) !== null) {
		const citNum = parseInt(match[1], 10);
		const sourceIdx = citNum - 1;

		if (sourceIdx >= 0 && sourceIdx < result.sources.length) {
			const source = result.sources[sourceIdx];
			const pos = match.index;

			// Get context: 80 chars before and after the citation
			const start = Math.max(0, pos - 80);
			const end = Math.min(result.answer.length, pos + match[0].length + 80);
			let context = result.answer.slice(start, end);

			// Clean up context
			context = context
				.replace(/\n/g, ' ')
				.replace(/\s+/g, ' ')
				.trim();

			if (start > 0) context = '...' + context;
			if (end < result.answer.length) context = context + '...';

			examples.push({
				place: result.place || 'Unknown',
				citationNumber: citNum,
				textContext: context,
				sourceUrl: source.url,
				sourceDomain: source.domain || 'unknown',
				sourceTitle: source.title || 'No title',
				isCited: source.cited ?? false
			});
		}
	}

	return examples;
}

async function main() {
	console.log('═'.repeat(100));
	console.log('📋 EJEMPLOS CONCRETOS DE CITAS PARA VERIFICACIÓN MANUAL');
	console.log('═'.repeat(100));
	console.log('\nCada ejemplo muestra:');
	console.log('  • El contexto del texto donde aparece la cita [N]');
	console.log('  • La URL del source correspondiente (sources[N-1])');
	console.log('  • Puedes abrir la URL para verificar que coincide con el contenido\n');

	const filePath = await findLatestResultsFile();
	if (!filePath) {
		console.error('❌ No results file found');
		Deno.exit(1);
	}

	const content = await Deno.readTextFile(filePath);
	const data: ResultsFile = JSON.parse(content);

	// Collect examples from results that have sources
	const allExamples: Array<CitationExample> = [];

	for (const result of data.results) {
		if (result.sources && result.sources.length > 0 && result.answer) {
			const examples = extractExamples(result);
			allExamples.push(...examples);
		}
	}

	console.log(`📊 Total de ejemplos encontrados: ${allExamples.length}\n`);

	// Show first 20 examples for manual verification
	const samplesToShow = allExamples.slice(0, 25);

	for (let i = 0; i < samplesToShow.length; i++) {
		const ex = samplesToShow[i];
		console.log('─'.repeat(100));
		console.log(`\n📍 EJEMPLO ${i + 1} - ${ex.place}`);
		console.log('─'.repeat(100));

		console.log(`\n📝 TEXTO (con cita [${ex.citationNumber}]):`);
		console.log(`   "${ex.textContext}"`);

		console.log(`\n🔗 SOURCE [${ex.citationNumber}] = sources[${ex.citationNumber - 1}]:`);
		console.log(`   Dominio: ${ex.sourceDomain}`);
		console.log(`   Título:  ${ex.sourceTitle}`);
		console.log(`   Cited:   ${ex.isCited ? '✓ Sí' : '○ No'}`);
		console.log(`   URL:     ${ex.sourceUrl}`);

		console.log(`\n   👆 Abre esta URL para verificar que el contenido coincide con el texto citado\n`);
	}

	// Group examples by domain to show patterns
	console.log('\n' + '═'.repeat(100));
	console.log('📊 RESUMEN: DOMINIOS MÁS CITADOS');
	console.log('═'.repeat(100) + '\n');

	const domainCounts = new Map<string, number>();
	for (const ex of allExamples) {
		const count = domainCounts.get(ex.sourceDomain) || 0;
		domainCounts.set(ex.sourceDomain, count + 1);
	}

	const sortedDomains = [...domainCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 15);

	for (const [domain, count] of sortedDomains) {
		const bar = '█'.repeat(Math.min(count, 40));
		console.log(`   ${domain.padEnd(35)} ${String(count).padStart(3)} ${bar}`);
	}

	// Show some specific interesting examples
	console.log('\n\n' + '═'.repeat(100));
	console.log('🔍 EJEMPLOS ESPECÍFICOS POR CIUDAD');
	console.log('═'.repeat(100));

	const citiesSeen = new Set<string>();
	const cityExamples: Array<CitationExample> = [];

	for (const ex of allExamples) {
		if (!citiesSeen.has(ex.place) && ex.citationNumber <= 3) {
			citiesSeen.add(ex.place);
			cityExamples.push(ex);
			if (cityExamples.length >= 8) break;
		}
	}

	for (const ex of cityExamples) {
		console.log(`\n📍 ${ex.place} - Cita [${ex.citationNumber}]`);
		console.log(`   Texto: "${ex.textContext.slice(0, 100)}..."`);
		console.log(`   Source: ${ex.sourceDomain} → ${ex.sourceUrl.slice(0, 80)}...`);
	}

	console.log('\n\n' + '═'.repeat(100));
	console.log('✅ Para verificar manualmente:');
	console.log('   1. Copia cualquier URL de arriba');
	console.log('   2. Ábrela en el navegador');
	console.log('   3. Comprueba que el contenido de la web coincide con lo que dice el texto citado');
	console.log('═'.repeat(100) + '\n');
}

main().catch(console.error);

