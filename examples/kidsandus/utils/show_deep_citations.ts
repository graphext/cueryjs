/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */

/**
 * Show citation examples with higher source indices ([5]+) and more context.
 * Run with: deno run --allow-read show_deep_citations.ts
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

function extractDeepExamples(result: ResultItem, minCitationNumber: number = 5): Array<CitationExample> {
	const examples: Array<CitationExample> = [];
	const pattern = /\\?\[(\d+)\\?\]/g;

	let match;
	while ((match = pattern.exec(result.answer)) !== null) {
		const citNum = parseInt(match[1], 10);

		// Only get citations >= minCitationNumber
		if (citNum < minCitationNumber) continue;

		const sourceIdx = citNum - 1;

		if (sourceIdx >= 0 && sourceIdx < result.sources.length) {
			const source = result.sources[sourceIdx];
			const pos = match.index;

			// Get MORE context: 150 chars before and after the citation
			const start = Math.max(0, pos - 150);
			const end = Math.min(result.answer.length, pos + match[0].length + 150);
			let context = result.answer.slice(start, end);

			// Clean up context but preserve structure
			context = context
				.replace(/\n\s*\n/g, '\n')
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
	console.log('═'.repeat(120));
	console.log('📋 EJEMPLOS DE CITAS [5]+ CON CONTEXTO EXTENDIDO');
	console.log('═'.repeat(120));
	console.log('\nMostrando citas con índice >= 5 y ~300 caracteres de contexto\n');

	const filePath = await findLatestResultsFile();
	if (!filePath) {
		console.error('❌ No results file found');
		Deno.exit(1);
	}

	const content = await Deno.readTextFile(filePath);
	const data: ResultsFile = JSON.parse(content);

	// Collect deep examples
	const allExamples: Array<CitationExample> = [];

	for (const result of data.results) {
		if (result.sources && result.sources.length > 5 && result.answer) {
			const examples = extractDeepExamples(result, 5);
			allExamples.push(...examples);
		}
	}

	console.log(`📊 Ejemplos con citas [5]+ encontrados: ${allExamples.length}\n`);

	// Group by citation number to show variety
	const byCitNum = new Map<number, Array<CitationExample>>();
	for (const ex of allExamples) {
		if (!byCitNum.has(ex.citationNumber)) {
			byCitNum.set(ex.citationNumber, []);
		}
		byCitNum.get(ex.citationNumber)!.push(ex);
	}

	// Show examples for citation numbers 5, 6, 7, 8, 9
	const citNums = [5, 6, 7, 8, 9];

	for (const citNum of citNums) {
		const examples = byCitNum.get(citNum) || [];
		if (examples.length === 0) continue;

		console.log('\n' + '═'.repeat(120));
		console.log(`📌 EJEMPLOS DE CITA [${citNum}] = sources[${citNum - 1}]`);
		console.log('═'.repeat(120));

		// Show 2-3 examples per citation number
		const samplesToShow = examples.slice(0, 3);

		for (let i = 0; i < samplesToShow.length; i++) {
			const ex = samplesToShow[i];

			console.log(`\n${'─'.repeat(120)}`);
			console.log(`\n🏙️  CIUDAD: ${ex.place}`);
			console.log(`📝 CITA: [${ex.citationNumber}] → sources[${ex.citationNumber - 1}]`);

			console.log(`\n┌${'─'.repeat(118)}┐`);
			console.log(`│ TEXTO CON CONTEXTO:`);
			console.log(`├${'─'.repeat(118)}┤`);

			// Split context into lines of ~100 chars
			const words = ex.textContext.split(' ');
			let line = '│ ';
			for (const word of words) {
				if (line.length + word.length > 115) {
					console.log(line.padEnd(119) + '│');
					line = '│ ';
				}
				line += word + ' ';
			}
			if (line.trim() !== '│') {
				console.log(line.padEnd(119) + '│');
			}
			console.log(`└${'─'.repeat(118)}┘`);

			console.log(`\n🔗 SOURCE CORRESPONDIENTE:`);
			console.log(`   Dominio:  ${ex.sourceDomain}`);
			console.log(`   Título:   ${ex.sourceTitle.slice(0, 80)}${ex.sourceTitle.length > 80 ? '...' : ''}`);
			console.log(`   Citado:   ${ex.isCited ? '✓ Sí (cited: true)' : '○ No (cited: false)'}`);
			console.log(`   URL:      ${ex.sourceUrl}`);
		}
	}

	// Show a few high-number examples (10+)
	console.log('\n\n' + '═'.repeat(120));
	console.log('📌 EJEMPLOS DE CITAS ALTAS [10]+');
	console.log('═'.repeat(120));

	const highExamples = allExamples.filter(ex => ex.citationNumber >= 10).slice(0, 5);

	for (const ex of highExamples) {
		console.log(`\n${'─'.repeat(120)}`);
		console.log(`\n🏙️  ${ex.place} - Cita [${ex.citationNumber}]`);

		console.log(`\n┌${'─'.repeat(118)}┐`);
		const words = ex.textContext.split(' ');
		let line = '│ ';
		for (const word of words) {
			if (line.length + word.length > 115) {
				console.log(line.padEnd(119) + '│');
				line = '│ ';
			}
			line += word + ' ';
		}
		if (line.trim() !== '│') {
			console.log(line.padEnd(119) + '│');
		}
		console.log(`└${'─'.repeat(118)}┘`);

		console.log(`\n   🔗 sources[${ex.citationNumber - 1}]: ${ex.sourceDomain}`);
		console.log(`   📄 ${ex.sourceTitle.slice(0, 60)}...`);
		console.log(`   🌐 ${ex.sourceUrl}`);
	}

	console.log('\n\n' + '═'.repeat(120));
	console.log('✅ INSTRUCCIONES PARA VERIFICAR:');
	console.log('═'.repeat(120));
	console.log(`
   1. Copia una URL de arriba
   2. Ábrela en el navegador  
   3. Busca en la página el texto que aparece en el CONTEXTO
   4. Si el contenido coincide → ¡La hipótesis es correcta!

   Ejemplo de verificación:
   - Si el texto dice "Método de inmersión: en clase sólo se habla en inglés" con [5]
   - Y la URL de sources[4] es de una academia
   - Abre la URL y busca si mencionan "inmersión" o "solo inglés en clase"
`);
	console.log('═'.repeat(120) + '\n');
}

main().catch(console.error);

