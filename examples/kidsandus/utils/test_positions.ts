// Test script to verify the new 'positions' field in sources
import { scrapeGPTBatch } from '../../src/apis/brightdata.ts';

console.log('Testing scrapeGPTBatch with positions field...\n');

const results = await scrapeGPTBatch({
    prompts: ['mejor academia de inglés para niños en Alcúdia'],
    useSearch: true,
    countryISOCode: 'ES'
});

const result = results[0];

console.log('=== SOURCES with positions ===');
for (const source of result.sources.slice(0, 10)) {
    console.log(`positions: ${JSON.stringify(source.positions || [])} | ${source.title?.substring(0, 50)}`);
    console.log(`   URL: ${source.url?.substring(0, 70)}`);
}

console.log('\n=== ANSWER excerpt (looking for [N] citations) ===');
const answer = result.answer;
// Find lines with citations
const lines = answer.split('\n');
for (const line of lines) {
    if (line.includes('[') && line.includes(']')) {
        // Check if it has [N] pattern
        const match = line.match(/\\\[(\d+)\\\]/g);
        if (match) {
            console.log(`${match.join(', ')}: ${line.substring(0, 100)}`);
        }
    }
}

console.log('\n=== VERIFICATION ===');
// Create a map of position -> source
const positionMap = new Map<number, string>();
for (const source of result.sources) {
    if (source.positions && source.positions.length > 0) {
        for (const pos of source.positions) {
            positionMap.set(pos, source.title || source.url || 'Unknown');
        }
    }
}

console.log('Position -> Source mapping:');
const sortedPositions = [...positionMap.entries()].sort((a, b) => a[0] - b[0]);
for (const [pos, title] of sortedPositions) {
    console.log(`[${pos}] -> ${title.substring(0, 60)}`);
}
