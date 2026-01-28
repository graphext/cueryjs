/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
import { translate, translateBatch } from '../src/translate.ts';

// Test single translation
console.log('Testing single keyword translation...\n');

const singleKeyword = 'best running shoes';
const start1 = Date.now();
const result = await translate(singleKeyword);
const duration1 = ((Date.now() - start1) / 1000).toFixed(1);

console.log(`Keyword: "${singleKeyword}"`);
console.log(`Translated prompt: "${result}"`);
console.log(`Duration: ${duration1}s`);
console.log('\n---\n');

// Test batch translation
console.log('Testing batch keyword translation...\n');

const keywords = [
	'best running shoes',
	'how to train for marathon',
	'nike air max review',
	'weather new york',
	'cheap flights to paris',
	'python tutorial beginners',
	'healthy breakfast recipes',
	'tesla model 3 specs',
	'how to lose weight fast',
	'best coffee makers 2024'
];

console.log(`Translating ${keywords.length} keywords concurrently...\n`);

const start2 = Date.now();
const batchResults = await translateBatch(
	keywords,
	'gpt-4.1-mini',
	5 // Lower concurrency for testing
);
const duration2 = ((Date.now() - start2) / 1000).toFixed(1);

console.log(`Completed in ${duration2}s\n`);

keywords.forEach((keyword, i) => {
	console.log(`${i + 1}. Keyword: "${keyword}"`);
	console.log(`   Prompt:  "${batchResults[i]}"`);
	console.log();
});

console.log(`Total keywords: ${keywords.length}`);
console.log(`Total time: ${duration2}s`);
console.log(`Average time per keyword: ${(parseFloat(duration2) / keywords.length).toFixed(2)}s`);
