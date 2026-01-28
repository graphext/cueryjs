/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */

declare const Deno: {
	writeTextFile: (path: string, data: string, options?: { append?: boolean; create?: boolean; mode?: number }) => Promise<void>;
	readTextFile: (path: string) => Promise<string>;
	mkdir: (path: string, options?: { recursive?: boolean; mode?: number }) => Promise<void>;
	env: {
		get: (key: string) => string | undefined;
	};
};

import { scrapeGPTBatch } from '../../src/apis/brightdata.ts';
import { mergeSources, findSourcesForCompany, type LinkableSource, type InfluencingSource } from '../../src/sourceLinker.ts';

const OUTPUT_DIRECTORY = '/Users/victoriano/Code/datocat/supabase/functions/_shared/cuery/examples/kidsandus/chatgpt_response_data';

// Small test with 3 cities
const places = ['Alcúdia', 'Barcelona', 'Madrid'];
const prompts = places.map((place) => `mejor academia de inglés para niños en ${place}`);

console.log('Starting small test with 3 cities...\n');

const result = await scrapeGPTBatch({
	prompts,
	useSearch: true,
	countryISOCode: 'ES'
});

console.log(`\n✓ Got ${result.length} results\n`);

// Process and verify positions
const processedResults = result.map((item, index) => {
	const place = places[index];
	const prompt = prompts[index];
	
	// Check sources with positions
	const sourcesWithPositions = item.sources.filter(s => s.positions && s.positions.length > 0);
	console.log(`\n=== ${place} ===`);
	console.log(`Total sources: ${item.sources.length}`);
	console.log(`Sources with positions: ${sourcesWithPositions.length}`);
	
	if (sourcesWithPositions.length > 0) {
		console.log('\nSources with positions:');
		sourcesWithPositions.forEach(s => {
			console.log(`  positions=${JSON.stringify(s.positions).padEnd(12)} | ${s.title?.substring(0, 40)}`);
		});
	}
	
	// Merge sources and find for company
	const sourcesWithDefaults = (item.sources ?? [])
		.filter(s => s.url != null)
		.map(s => ({
			url: s.url!,
			title: s.title ?? '',
			domain: s.domain ?? '',
			cited: s.cited,
			positions: s.positions
		}));
	const searchSourcesWithDefaults = (item.searchSources ?? [])
		.filter(s => s.url != null)
		.map(s => ({
			url: s.url!,
			title: s.title ?? '',
			domain: s.domain ?? '',
			rank: s.rank ?? 0,
			datePublished: s.datePublished ?? null
		}));
	const mergedSources = mergeSources(sourcesWithDefaults, searchSourcesWithDefaults);
	
	// Test findSourcesForCompany
	const testCompany = "Kids&Us";
	const companySources = findSourcesForCompany(testCompany, mergedSources, 3);
	console.log(`\nInfluencing sources for "${testCompany}":`);
	companySources.forEach(s => {
		const posStr = s.positions && s.positions.length > 0 ? JSON.stringify(s.positions) : 'none';
		console.log(`  positions=${posStr.padEnd(12)} | ${s.domain} - ${s.title?.substring(0, 35)}`);
	});
	
	return {
		place,
		prompt,
		answer: item.answer,
		sources: item.sources,
		searchSources: item.searchSources,
		sources_count: item.sources.length,
		sources_with_positions: sourcesWithPositions.length
	};
});

// Save results
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputPath = `${OUTPUT_DIRECTORY}/kidsandus_small_test_${timestamp}.json`;

await Deno.writeTextFile(outputPath, JSON.stringify({
	timestamp,
	places,
	prompts,
	results: processedResults
}, null, 2));

console.log(`\n\n✓ Results saved to: ${outputPath}`);
console.log('\nTest completed!');
