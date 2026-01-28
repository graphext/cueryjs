/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
import { searchOpenAI } from '../src/search.ts';

const startTime = Date.now();

const result = await searchOpenAI({
	prompt: 'What are the top 10 Social media scheduling platforms?',
	model: 'gpt-4.1-mini',
	countryISOCode: 'US',
	contextSize: 'low',
	reasoningEffort: 'low'
});

const endTime = Date.now();
const duration = ((endTime - startTime) / 1000).toFixed(2);
console.log(`\n✓ Search completed in ${duration} seconds\n`);

console.log(result.answer);
console.log(result.sources);
