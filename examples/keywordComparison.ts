// Run with: deno task run examples/keywordComparison.ts

import { KeywordRecord } from "../lib/GoogleAds/keywordPlanner.ts";
import { expandKeywords } from "../src/keywords.ts";
import { Brand } from "shared/cuery/src/schemas/brand.schema.ts";
import { getSeedKeywords } from "../../../../../src/lib/brandWizard/getSeedKeywords.ts";
import { getGroupedSeedKeywords } from "../../../../../src/lib/brandWizard/keywordGrouping.ts";

type KeywordRecordWithSource = KeywordRecord & {
	source: string;
	sourceName: string;
};

// Get config path from args or prompt user
let configPath = Deno.args[0];

if (!configPath) {
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	// Prompt user for config file path
	await Deno.stdout.write(encoder.encode("Enter the path to the configuration JSON file: "));

	const buf = new Uint8Array(1024);
	const n = await Deno.stdin.read(buf);

	if (n) {
		configPath = decoder.decode(buf.subarray(0, n)).trim();
	}

	if (!configPath) {
		console.error("No configuration file path provided.");
		Deno.exit(1);
	}
}

// Use an exported json file (downloaded from brand wizard) to read config
const config = await Deno.readTextFile(configPath).then((data) => JSON.parse(data));

// Get the directory where the config file is located
const configDir = configPath.substring(0, configPath.lastIndexOf('/'));
const outputDir = configDir || '.';

let start: number;
let duration: string;

start = Date.now();

const seedKeywordsData = getSeedKeywords({
	brand: config.brandInfo,
	personas: config.personas,
	funnel: config.funnel,
	competitors: config.competitors,
	customKeywordsData: config.customKeywords
});

const groupedSeedKeywords = getGroupedSeedKeywords(seedKeywordsData);

console.log(groupedSeedKeywords);

const seedKeywords = groupedSeedKeywords.map((item) => {
	if (Array.isArray(item)) {
		return item.map(i => i.keyword);;
	}
	return item.keyword;
});

// Add competitor domains as seed keywords
const competitorDomains: Array<string> = [];
if (config.competitors && config.competitors.items && Array.isArray(config.competitors.items)) {
	config.competitors.items.forEach((competitor: Brand) => {
		if (competitor.domain) {
			competitorDomains.push(competitor.domain);
		}
	});
}

// Cache file path
const cacheFilePath = `${outputDir}/keywords-cache.json`;

// Try to load cached keywords
let keywords: Array<Array<KeywordRecord>>;

try {
	const cachedData = await Deno.readTextFile(cacheFilePath);
	keywords = JSON.parse(cachedData);
	console.log(`Loaded ${keywords.length} keyword groups from cache`);
	duration = ((Date.now() - start) / 1000).toFixed(1);
	console.log(`Cache loaded in ${duration}s`);
} catch {
	// Cache doesn't exist, expand keywords
	console.log("Cache not found, expanding keywords...");

	keywords = await expandKeywords({
		seedKeywords,
		url: config.brandInfo.domain,
		language: config.brandInfo.language,
		countryISOCode: config.brandInfo.country
	});

	// Expand keywords for each competitor domain
	for (const competitorDomain of competitorDomains) {
		console.log(`Expanding keywords for competitor domain: ${competitorDomain}`);
		const competitorKeywords = await expandKeywords({
			seedKeywords: [],
			url: competitorDomain,
			language: config.brandInfo.language,
			countryISOCode: config.brandInfo.country
		});

		// Add competitor keywords to the main array
		if (competitorKeywords.length > 0) {
			keywords.push(...competitorKeywords);
		}
	}

	duration = ((Date.now() - start) / 1000).toFixed(1);
	console.log(`Generated ${keywords.length} keyword groups in ${duration}s`);
	console.log(`Total keywords: ${keywords.flat().length}`);

	// Save to cache
	await Deno.writeTextFile(cacheFilePath, JSON.stringify(keywords, null, 2));
	console.log(`Saved keywords to cache: ${cacheFilePath}`);
}

// Determine the number of competitor domain groups
const numCompetitorGroups = competitorDomains.length;
const totalSeedGroups = groupedSeedKeywords.length;

const maxKeywordsinGroup = Math.max(...keywords.slice(0, totalSeedGroups).map(group => group.length));
console.log(`Max keywords in a group: ${maxKeywordsinGroup}`);
const urlGroupIndex = config.brandInfo.domain ? keywords.findIndex(g => g.length === maxKeywordsinGroup) : -1;


// Add source and sourceName to each keyword based on its seed keyword origin
const keywordsWithSource: Array<Array<KeywordRecordWithSource>> = keywords.map((group, index) => {
	// Determine source info
	let source: string;
	let sourceName: string;

	// Check if this is the URL group (last group when URL is provided)
	const isUrlGroup = config.brandInfo.domain && index === urlGroupIndex;

	// Check if this is a competitor domain group
	const competitorGroupStartIndex = totalSeedGroups + (config.brandInfo.domain ? 1 : 0);
	const isCompetitorGroup = index >= competitorGroupStartIndex;

	if (isCompetitorGroup) {
		const competitorIndex = index - competitorGroupStartIndex;
		source = 'brand';
		sourceName = competitorDomains[competitorIndex] || 'unknown';
	} else if (isUrlGroup) {
		source = 'brand';
		sourceName = config.brandInfo.domain || 'unknown';
	} else {
		const seedKeywordOrigin = groupedSeedKeywords[(index > urlGroupIndex && urlGroupIndex !== -1) ? index - 1 : index];
		if (Array.isArray(seedKeywordOrigin)) {
			// Use the first keyword's source as representative
			source = seedKeywordOrigin[0]?.source || 'unknown';
			sourceName = seedKeywordOrigin[0]?.sourceName || 'unknown';
		} else {
			source = seedKeywordOrigin?.source || 'unknown';
			sourceName = seedKeywordOrigin?.sourceName || 'unknown';
		}
	}

	return group.map(keyword => ({
		...keyword,
		source,
		sourceName
	}));
});

// Save keywords with source info
const cacheFilePathWithSource = `${outputDir}/keywords-with-source-cache.json`;
await Deno.writeTextFile(cacheFilePathWithSource, JSON.stringify(keywordsWithSource, null, 2));
console.log(`Saved keywords with source to: ${cacheFilePathWithSource}`);

// Generate keywords.csv (without source fields)
const keywordsCsvFilePath = `${outputDir}/keywords.csv`;
const flatKeywordsOriginal = keywords.flat();

if (flatKeywordsOriginal.length > 0) {
	const allKeysOriginal = new Set<string>();
	flatKeywordsOriginal.forEach(kw => {
		Object.keys(kw).forEach(key => allKeysOriginal.add(key));
	});

	const csvHeadersOriginal = Array.from(allKeysOriginal).sort();

	const csvRowsOriginal = [
		csvHeadersOriginal.join(','),
		...flatKeywordsOriginal.map(kw =>
			csvHeadersOriginal.map(header => {
				const value = kw[header as keyof KeywordRecord];
				if (value == null) return '';
				if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
				if (Array.isArray(value)) return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
				return String(value);
			}).join(',')
		)
	];

	await Deno.writeTextFile(keywordsCsvFilePath, csvRowsOriginal.join('\n'));
	console.log(`Saved CSV with ${flatKeywordsOriginal.length} keywords to: ${keywordsCsvFilePath}`);
}

// Generate keywords-with-source.csv
const csvFilePath = `${outputDir}/keywords-with-source.csv`;
const flatKeywords = keywordsWithSource.flat();

if (flatKeywords.length > 0) {
	// Get all unique keys from all keywords
	const allKeys = new Set<string>();
	flatKeywords.forEach(kw => {
		Object.keys(kw).forEach(key => allKeys.add(key));
	});

	// Convert to array and sort for consistent column order
	const csvHeaders = Array.from(allKeys).sort();

	const csvRows = [
		csvHeaders.join(','),
		...flatKeywords.map(kw =>
			csvHeaders.map(header => {
				const value = kw[header as keyof KeywordRecordWithSource];
				if (value == null) return '';
				if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
				if (Array.isArray(value)) return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
				return String(value);
			}).join(',')
		)
	];

	await Deno.writeTextFile(csvFilePath, csvRows.join('\n'));
	console.log(`Saved CSV with ${flatKeywords.length} keywords to: ${csvFilePath}`);
} else {
	console.log('No keywords to export to CSV');
}

// Show sample with source info
console.log('\nSample keywords with source:');
keywordsWithSource.slice(0, 3).forEach((group, i) => {
	console.log(`\nGroup ${i + 1} (source: ${group[0]?.source}, sourceName: ${group[0]?.sourceName}):`);
	group.slice(0, 3).forEach(kw => {
		console.log(`  - ${kw.keyword} (searches: ${kw.avgMonthlySearches ?? 'N/A'})`);
	});
});
