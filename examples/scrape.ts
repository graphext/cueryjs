/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
import { load } from '@std/dotenv';

import { scrapeWebBatch } from '../src/apis/hasdata/scrape.ts';

await load({
	envPath: '../.env',
	export: true
});

const testUrls = [
	'https://news.ycombinator.com/',
	'https://www.reddit.com/r/programming/',
	'https://github.com/trending',
	'https://dev.to/',
	'https://stackoverflow.com/questions',
	// 'https://www.producthunt.com/',
	'https://techcrunch.com/',
	'https://arstechnica.com/',
	'https://www.theverge.com/',
	'https://www.wired.com/',
	'https://www.engadget.com/',
	'https://www.cnet.com/',
	'https://slashdot.org/',
	'https://www.reddit.com/r/technology/',
	'https://www.reddit.com/r/webdev/',
	'https://news.google.com/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXlnQVAB',
	'https://www.bbc.com/news/technology',
	'https://www.reuters.com/technology/',
	'https://www.cnbc.com/technology/',
	'https://www.forbes.com/innovation/'
];

console.log('Testing HasData Web Scraping API - Concurrent Batch\n');
console.log('='.repeat(80));

console.log(`\nScraping ${testUrls.length} URLs concurrently...\n`);

const startTime = Date.now();
const results = await scrapeWebBatch(testUrls, { formats: ['markdown'] }, 29);
const duration = ((Date.now() - startTime) / 1000).toFixed(2); console.log(`\n✅ Completed ${testUrls.length} URLs in ${duration}s`);
console.log(`   Average: ${(parseFloat(duration) / testUrls.length).toFixed(2)}s per URL\n`);

console.log('='.repeat(80));
console.log('\nResults Summary:\n');

results.forEach((result, index) => {
	console.log(`${index + 1}. ${testUrls[index]}`);
	if (result.markdown) {
		const preview = result.markdown.substring(0, 100).replace(/\n/g, ' ');
		console.log('   ✅ Success');
		console.log(`   Markdown: ${preview}...`);
	} else {
		console.log('   ❌ No content returned');
	}
	console.log();
});

const successCount = results.filter(r => r.markdown).length;
const failedCount = results.filter(r => !r.markdown).length;

console.log('='.repeat(80));
console.log('\nFinal Statistics:');
console.log(`  Total URLs: ${testUrls.length}`);
console.log(`  Successful: ${successCount}`);
console.log(`  Failed: ${failedCount}`);
console.log(`  Total time: ${duration}s`);
console.log(`  Avg time per URL: ${(parseFloat(duration) / testUrls.length).toFixed(2)}s`);
console.log();
