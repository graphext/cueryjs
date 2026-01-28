/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
import { scrapeGPT } from '../src/apis/oxy.ts';

const startTime = Date.now();

const result = await scrapeGPT({
	prompt: 'What are the top 10 Social media scheduling platforms?',
	useSearch: true,
	countryISOCode: 'US'
});

const endTime = Date.now();
const duration = ((endTime - startTime) / 1000).toFixed(2);
console.log(`\n✓ Oxylabs ChatGPT scraping completed in ${duration} seconds\n`);

console.log(result.answer);
console.log(result.sources);
