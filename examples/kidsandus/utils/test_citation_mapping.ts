/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */

/**
 * Test script to verify if ChatGPT citation references [1], [2], etc.
 * map to the order of the citations array in the scraper response.
 *
 * Run with: deno run --allow-net --allow-env test_citation_mapping.ts
 */

declare const Deno: {
	writeTextFile: (path: string, data: string) => Promise<void>;
	env: {
		get: (key: string) => string | undefined;
	};
};

import { scrapeGPT } from '../../src/apis/brightdata.ts';

const testPrompts = [
	'mejor academia de inglés para niños en Valencia',
	'mejores restaurantes japoneses en Madrid'
];

console.log('🔍 Testing citation mapping hypothesis...\n');
console.log('Hypothesis: [1], [2], etc. in response text map to citations array order\n');

async function testCitationMapping() {
	for (const prompt of testPrompts) {
		console.log(`\n${'='.repeat(80)}`);
		console.log(`📝 Prompt: "${prompt}"`);
		console.log('='.repeat(80));

		try {
			const results = await scrapeGPT({
				prompts: [prompt],
				useSearch: true,
				countryISOCode: 'ES'
			});

			const result = results[0];

			if (!result || !result.answer) {
				console.log('❌ No result received');
				continue;
			}

			// 1. Find all citation references [N] in the answer text
			const citationPattern = /\[(\d+)\]/g;
			const matches = [...result.answer.matchAll(citationPattern)];
			const citationRefs = matches.map(m => ({
				fullMatch: m[0],
				number: parseInt(m[1], 10),
				position: m.index
			}));

			console.log(`\n📊 ANALYSIS:`);
			console.log(`   - Answer length: ${result.answer.length} chars`);
			console.log(`   - Citation references found in text: ${citationRefs.length}`);
			console.log(`   - Citations array length: ${result.sources.length}`);
			console.log(`   - Search sources array length: ${result.searchSources?.length ?? 0}`);

			// 2. Show citation references found
			if (citationRefs.length > 0) {
				console.log(`\n📌 CITATION REFERENCES IN TEXT:`);
				const uniqueRefs = [...new Set(citationRefs.map(r => r.number))].sort((a, b) => a - b);
				console.log(`   Unique refs: ${uniqueRefs.join(', ')}`);

				// Show context around each citation
				for (const ref of citationRefs.slice(0, 5)) { // Limit to first 5
					const start = Math.max(0, ref.position! - 50);
					const end = Math.min(result.answer.length, ref.position! + 50);
					const context = result.answer.slice(start, end).replace(/\n/g, ' ');
					console.log(`   ${ref.fullMatch} at pos ${ref.position}: "...${context}..."`);
				}
				if (citationRefs.length > 5) {
					console.log(`   ... and ${citationRefs.length - 5} more`);
				}
			}

			// 3. Show citations array (sources)
			console.log(`\n📚 CITATIONS ARRAY (sources):`);
			result.sources.forEach((source, index) => {
				const citedMark = source.cited ? '✓ CITED' : '○ not cited';
				console.log(`   [${index + 1}] ${citedMark} | ${source.domain} | ${source.title?.slice(0, 50) ?? 'No title'}...`);
				console.log(`       URL: ${source.url}`);
			});

			// 4. Show search sources for comparison
			if (result.searchSources && result.searchSources.length > 0) {
				console.log(`\n🔎 SEARCH SOURCES (for reference):`);
				result.searchSources.slice(0, 5).forEach((source, index) => {
					console.log(`   [rank ${source.rank ?? index}] ${source.domain} | ${source.title?.slice(0, 50) ?? 'No title'}...`);
				});
			}

			// 5. Verify hypothesis: Do citation refs [N] match sources[N-1]?
			console.log(`\n✅ HYPOTHESIS VERIFICATION:`);
			let matchCount = 0;
			let mismatchCount = 0;

			for (const ref of citationRefs) {
				const sourceIndex = ref.number - 1; // [1] -> index 0
				if (sourceIndex >= 0 && sourceIndex < result.sources.length) {
					const source = result.sources[sourceIndex];
					console.log(`   ${ref.fullMatch} -> sources[${sourceIndex}]: ${source.domain} ✓`);
					matchCount++;
				} else {
					console.log(`   ${ref.fullMatch} -> OUT OF BOUNDS (sources has ${result.sources.length} items) ✗`);
					mismatchCount++;
				}
			}

			if (citationRefs.length > 0) {
				console.log(`\n📈 RESULT: ${matchCount}/${citationRefs.length} references map to valid sources`);
				if (mismatchCount === 0 && matchCount > 0) {
					console.log('   🎉 HYPOTHESIS CONFIRMED: Citation refs match sources array order!');
				} else if (mismatchCount > 0) {
					console.log('   ⚠️ Some references are out of bounds - need more investigation');
				}
			} else {
				console.log('   ℹ️ No [N] citation references found in this response');
				console.log('   This might mean the response uses a different citation format');
			}

			// 6. Show raw answer snippet for manual inspection
			console.log(`\n📝 RAW ANSWER (first 1500 chars):`);
			console.log('---');
			console.log(result.answer.slice(0, 1500));
			console.log('---');

		} catch (error) {
			console.error(`❌ Error processing prompt: ${error}`);
		}
	}
}

testCitationMapping().then(() => {
	console.log('\n\n✅ Test completed');
}).catch(error => {
	console.error('Test failed:', error);
});

