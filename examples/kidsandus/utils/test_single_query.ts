// Test single query to verify positions field
import { scrapeGPTBatch } from '../../src/apis/brightdata.ts';

console.log('Testing with single query...\n');

const results = await scrapeGPTBatch({
    prompts: ['mejor academia de inglés para niños en Alcúdia'],
    useSearch: true,
    countryISOCode: 'ES'
});

const result = results[0];

console.log('=== ANSWER (first 800 chars) ===');
console.log(result.answer.substring(0, 800));

console.log('\n=== SOURCES with positions ===');
for (let i = 0; i < Math.min(result.sources.length, 10); i++) {
    const source = result.sources[i];
    const posStr = source.positions ? JSON.stringify(source.positions) : '[]';
    console.log(`[${i}] positions: ${posStr.padEnd(10)} cited: ${source.cited} | ${source.title?.substring(0, 50)}`);
}

// Verify mapping
console.log('\n=== VERIFICATION ===');
// Find citation numbers in the answer
const citationMatches = result.answer.match(/\\\[(\d+)\\\]/g) || [];
const citationNumbers = citationMatches.map(m => parseInt(m.replace(/\\\[|\\\]/g, '')));
console.log('Citation numbers found in text:', [...new Set(citationNumbers)].sort((a, b) => a - b));

// Build position -> source map
const positionToSource: Record<number, string> = {};
for (const source of result.sources) {
    if (source.positions) {
        for (const pos of source.positions) {
            positionToSource[pos] = source.title || source.url;
        }
    }
}

console.log('\nPosition -> Source mapping:');
for (const pos of [...new Set(citationNumbers)].sort((a, b) => a - b)) {
    const sourceTitle = positionToSource[pos] || 'NOT FOUND';
    console.log(`[${pos}] -> ${sourceTitle.substring(0, 60)}`);
}
