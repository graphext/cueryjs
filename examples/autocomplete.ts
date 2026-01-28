/* eslint-disable no-console */
import { autocomplete, recurseAutocomplete } from '../src/autocomplete.ts';


async function exampleAutocompleteWithLanguage() {
	console.log('=== Autocomplete with Language Example ===\n');

	const query = 'coches electricos';
	const language = 'es';
	const countryCode = 'ES';

	console.log(`Query: "${query}"`);
	console.log(`Language: ${language}`);
	console.log(`Country: ${countryCode}\n`);

	const startTime = Date.now();
	const suggestions = await autocomplete({
		query,
		language,
		countryCode
	});
	const elapsedTime = Date.now() - startTime;

	console.log('Suggestions:');
	suggestions.forEach((suggestion, index) => {
		console.log(`  ${index + 1}. ${suggestion}`);
	});

	console.log(`\nCompleted in ${elapsedTime}ms`);
	console.log('\n' + '='.repeat(60) + '\n');
}

async function exampleRecursiveAutocomplete() {
	console.log('=== Recursive Autocomplete Example ===\n');

	const query = 'Social Media Management Platform';
	const maxDepth = 2;

	console.log(`Query: "${query}"`);
	console.log(`Max Depth: ${maxDepth}`);
	console.log('Delay Between Calls: 3000ms\n');

	const startTime = Date.now();
	const results = await recurseAutocomplete({
		query,
		maxDepth,
		delayBetweenCalls: 3000
	});
	const elapsedTime = Date.now() - startTime;

	console.log(`Total suggestions found: ${results.length}\n`);

	const byDepth = new Map<number, Array<typeof results[0]>>();
	for (const result of results) {
		const depthResults = byDepth.get(result.depth) || [];
		depthResults.push(result);
		byDepth.set(result.depth, depthResults);
	}

	for (const [depth, depthResults] of Array.from(byDepth.entries()).sort((a, b) => a[0] - b[0])) {
		console.log(`\nDepth ${depth} (${depthResults.length} suggestions):`);
		const grouped = new Map<string, Array<string>>();

		for (const item of depthResults) {
			const suggestions = grouped.get(item.sourceQuery) || [];
			suggestions.push(item.suggestion);
			grouped.set(item.sourceQuery, suggestions);
		}

		for (const [source, suggestions] of grouped.entries()) {
			console.log(`  From "${source}":`);
			suggestions.forEach(suggestion => {
				console.log(`    - ${suggestion}`);
			});
		}
	}

	console.log(`\nCompleted in ${elapsedTime}ms`);
	console.log('\n' + '='.repeat(60) + '\n');
}

async function main() {
	console.log('\n🔍 Google Autocomplete Examples\n');
	console.log('This demonstrates the autocomplete functionality for keyword research.\n');

	try {
		await exampleAutocompleteWithLanguage();
		await exampleRecursiveAutocomplete();

		console.log('✅ All examples completed successfully!');
	} catch (error) {
		console.error('❌ Error running examples:', error);
		throw error;
	}
}

main();
