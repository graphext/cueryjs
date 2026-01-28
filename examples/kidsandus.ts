/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */

// From: datocat/supabase/functions/_shared/cuery
// Run with: deno task run examples/kidsandus.ts

import { scrapeGPTBatch } from '../src/apis/brightdata.ts';
import { extractEntitiesBatch } from '../src/entities.ts';

const startTime = Date.now();


// Read the /Users/crispamares/Development/repositories/services/kidsandus/data/generated_prompts.json
let input = JSON.parse(Deno.readTextFileSync('/Users/crispamares/Development/repositories/services/kidsandus/data/generated_prompts.json'))

input = Array(7).fill(input).flat();

const prompts = input.map((p: { prompt: string }) => p.prompt);

const result = await scrapeGPTBatch({
	prompts: prompts,
	useSearch: true,
	countryISOCode: 'ES'
});

const endTime = Date.now();
const duration = ((endTime - startTime) / 1000).toFixed(2);
console.log(`\n✓ Scraping completed in ${duration} seconds\n`);

const entityDefinitions = {
	brands: 'Any brand or companies mentioned',
	kidsandus: 'Any mentions of something like "Kids&Us", "Kids and Us" or "Tweens & Teens"'
};

const entityStartTime = Date.now();

const answers = result.map((response) => response.answer);
const entities = await extractEntitiesBatch(answers, entityDefinitions, 'gpt-4.1-mini');

const entityEndTime = Date.now();
const entityDuration = ((entityEndTime - entityStartTime) / 1000).toFixed(2);
console.log(`\n✓ Entity extraction completed in ${entityDuration} seconds\n`);

const finalResult = result.map((item, index) => ({
	...item,
	...input[index],
	entities: entities[index]
}));

await Deno.writeTextFile('/Users/crispamares/Development/repositories/services/kidsandus/data/gpt_results_neighborhood.json', JSON.stringify(finalResult, null, 2));

console.log(finalResult.flatMap((m) => m.place));
console.log(finalResult.flatMap((m) => m.entities));
