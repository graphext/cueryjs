import { generateCompetitorsInfo } from '../src/brands.ts';


let start = performance.now();
const simpleCompetitors = await generateCompetitorsInfo({
	brand: 'Tesla',                          // brand
	sector: 'Electric Vehicles',             // sector
	market: 'Global',                        // market
	strict: true,                            // strict mode - exclude same parent company
	instructions: 'Focus on direct competitors in the electric vehicle market', // instructions
	language: 'en',                          // language
	model: 'gpt-4.1',                        // model
	countryISOCode: 'US',                    // country
	contextSize: 'medium',                   // contextSize
	reasoningEffort: 'low'                   // reasoningEffort
});
let end = performance.now();
console.log(`✅ Simple competitor analysis completed in ${((end - start) / 1000).toFixed(2)}s`);
console.log(simpleCompetitors);

// Example 2: Detailed competitor analysis using detailed Brand schema
start = performance.now();
const detailedCompetitors = await generateCompetitorsInfo({
	brand: ['Apple', 'Google'],              // multiple brands
	sector: 'Technology',                    // sector
	market: 'Global',                        // market
	strict: false,                           // non-strict mode - include same parent company
	instructions: 'Include both direct product competitors and ecosystem competitors', // instructions
	language: 'en',                          // language
	model: 'gpt-4.1',                        // model
	countryISOCode: 'US',                    // country
	contextSize: 'high',                     // contextSize for more comprehensive search
	reasoningEffort: 'medium'                // reasoningEffort for better analysis
});

end = performance.now();
console.log(`✅ Detailed competitor analysis completed in ${((end - start) / 1000).toFixed(2)}s`);
console.log(detailedCompetitors);