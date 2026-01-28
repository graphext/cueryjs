/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
import { load } from '@std/dotenv';

import { runBatchScrape, type ScrapeResponse } from '../src/apis/hasdata/scrape.ts';

await load({
	envPath: '../.env',
	export: true
});

const testUrls = [
	// 'https://news.ycombinator.com/',
	// 'https://www.reddit.com/r/programming/',
	// 'https://github.com/trending',
	// 'https://dev.to/',
	// 'https://stackoverflow.com/questions'
	// 'https://www.producthunt.com/',
	// 'https://techcrunch.com/',
	// 'https://arstechnica.com/',
	// 'https://www.theverge.com/',
	// 'https://www.wired.com/',
	// 'https://www.engadget.com/',
	// 'https://www.cnet.com/',
	// 'https://slashdot.org/',
	// 'https://www.reddit.com/r/technology/',
	// 'https://www.reddit.com/r/webdev/',
	// 'https://news.google.com/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXlnQVAB',
	'https://www.bbc.com/news/technology',
	'https://www.reuters.com/technology/',
	'https://www.cnbc.com/technology/',
	'https://www.forbes.com/innovation/'
];

console.log('Testing HasData Web Scraping API - Batch Scrape\n');
console.log('='.repeat(80));
console.log(`\nRunning batch scrape for ${testUrls.length} URLs...\n`);

const start = Date.now();

let results: Array<ScrapeResponse> = [];

try {
	results = await runBatchScrape(
		testUrls,
		{ formats: ['markdown', 'text'] },
		10
	);
	const duration = ((Date.now() - start) / 1000).toFixed(2);

	console.log(`✅ Batch scrape completed in ${duration}s`);
	console.log(`   Retrieved ${results.length} results\n`);
	console.log('='.repeat(80));
	console.log('\nResults Summary:\n');

	results.forEach((item, index) => {
		console.log(`${index + 1}. URL: ${testUrls[index]}`);
		if (!item || Object.keys(item).length === 0) {
			console.log('   ❌ Error or empty response');
		} else {
			const markdownPreview = item.markdown
				? `${item.markdown.substring(0, 100).replace(/\n/g, ' ')}...`
				: 'N/A';
			console.log('   ✅ Success');
			console.log(`      Markdown preview: ${markdownPreview}`);
		}
	});

	console.log('\n' + '='.repeat(80));
	console.log('First markdown content preview:\n');
	console.log(results[0].markdown?.substring(0, 500) + '\n...');
} catch (error) {
	console.error('\n❌ Batch scrape failed:', (error as Error).message);
	const duration = ((Date.now() - start) / 1000).toFixed(2);
	console.error(`   Failed after ${duration}s`);
}

console.log('\n' + '='.repeat(80));
console.log('Batch scrape example finished.');
await Deno.writeTextFile('hasdata_batch_scrape.json', JSON.stringify(results));
console.log('Wrote hasdata_batch_scrape.json');
