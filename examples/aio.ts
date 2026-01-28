/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
import { load } from '@std/dotenv';

import { fetchAIO, fetchAIOBatch } from '../src/apis/hasdata/aio.ts';
import type { SearchResult } from '../src/search.ts';

await load({
	envPath: '../.env',
	export: true
});

const runBatch = true;

const testPrompts = [
	'What are the benefits of electric vehicles?',
	'How does renewable energy work?',
	'What is artificial intelligence?',
	'Best practices for web security',
	'Climate change impacts 2025',
	'Machine learning algorithms explained',
	'Sustainable agriculture methods',
	'Space exploration recent developments',
	'Quantum computing basics',
	'Blockchain technology applications'
];

console.log('Testing HasData AI Overview API\n');
console.log('='.repeat(80));
console.log('\n1. Single Query Test\n');

const start1 = Date.now();
const singleResult = await fetchAIO(testPrompts[0], 'US', 'en', true) as SearchResult;
const duration1 = ((Date.now() - start1) / 1000).toFixed(2);

console.log(`Query: "${testPrompts[0]}"`);
console.log(`Duration: ${duration1}s`);
console.log(`\nAnswer (first 200 chars):\n${singleResult.answer.substring(0, 200)}...`);
console.log(`\nSources found: ${singleResult.sources.length}`);
if (singleResult.sources.length > 0) {
	console.log('\nFirst 3 sources:');
	singleResult.sources.slice(0, 3).forEach((source: { title: string; url: string }, i: number) => {
		console.log(`  ${i + 1}. ${source.title}`);
		console.log(`     ${source.url}`);
	});
}

if (!runBatch) {
	process.exit(0);
}

console.log('\n' + '='.repeat(80));
console.log('\n2. Batch Query Test (10 queries with max 5 concurrent)\n');

const start2 = Date.now();
const batchResults = await fetchAIOBatch(testPrompts, 'US', 'en', 29) as Array<SearchResult>;
const duration2 = ((Date.now() - start2) / 1000).toFixed(2);

console.log(`✅ Completed ${testPrompts.length} queries in ${duration2}s`);
console.log(`   Average: ${(parseFloat(duration2) / testPrompts.length).toFixed(2)}s per query\n`);
console.log('Results Summary:\n');

batchResults.forEach((result: SearchResult, index: number) => {
	const answerPreview = result.answer.substring(0, 100).replace(/\n/g, ' ');
	console.log(`${index + 1}. ${testPrompts[index]}`);
	console.log(`   Answer: ${answerPreview}...`);
	console.log(`   Sources: ${result.sources.length}`);
	console.log();
});

const totalSources = batchResults.reduce((sum: number, r: SearchResult) => sum + r.sources.length, 0);
const avgSources = (totalSources / batchResults.length).toFixed(1);


console.log('='.repeat(80));
console.log('\nFinal Statistics:');
console.log(`  Total queries: ${testPrompts.length}`);
console.log(`  Total time: ${duration2}s`);
console.log(`  Avg time per query: ${(parseFloat(duration2) / testPrompts.length).toFixed(2)}s`);
console.log(`  Total sources: ${totalSources}`);
console.log(`  Avg sources per query: ${avgSources}`);

console.log();
