/**

Google Ads API integration for comprehensive keyword research and analysis.

This module provides a streamlined interface to the Google Ads API for keyword planning
and research. It enables users to generate keyword ideas, retrieve historical search
volume data, and analyze keyword performance metrics across different geographic regions
and time periods. The module handles authentication, batching, and data processing to
deliver clean, structured keyword data for SEO and content strategy development.

Key features include keyword idea generation from seed keywords or landing pages,
historical metrics retrieval with monthly breakdowns, geographic and language targeting,
and automated data cleaning and aggregation for analysis workflows.

Useful documentation:
	- Keyword ideas:
		- https://developers.google.com/google-ads/api/docs/keyword-planning/generate-keyword-ideas
		- https://developers.google.com/google-ads/api/samples/generate-keyword-ideas
		- https://developers.google.com/google-ads/api/reference/rpc/v21/KeywordPlanIdeaService/GenerateKeywordIdeas?transport=rest
	- Historical metrics:
		- https://developers.google.com/google-ads/api/docs/keyword-planning/generate-historical-metrics
		- https://developers.google.com/google-ads/api/reference/rpc/v21/KeywordPlanIdeaService/GenerateKeywordHistoricalMetrics?transport=rest
	- ID/Code references:
		- https://developers.google.com/google-ads/api/data/codes-formats#expandable-7
		- https://developers.google.com/google-ads/api/data/geotargets

**/

import type {
	GenerateKeywordHistoricalMetricsRequest, GenerateKeywordIdeasRequest,
	GenerateKeywordHistoricalMetricsResponse, GenerateKeywordIdeaResponse, KeywordServiceResponse,
	KeywordIdeaResult, KeywordResult, KeywordMetrics, MonthlySearchVolume,
	KeywordPlanKeywordAnnotation, KeywordPlanNetwork, MonthOfYear,
	KeywordPlanCompetitionLevel
} from './apiTypes.ts';
import { createGoogleAdsClient } from './client.ts';
import { COUNTRY_RESOURCE_MAP } from './countryResourceMap.ts';
import { LANGUAGE_RESOURCE_MAP } from './languageResourceMap.ts';

const MONTH_NUMBER_TO_NAME: Array<Exclude<MonthOfYear, 'UNSPECIFIED' | 'UNKNOWN'>> = [
	'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
	'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'
];

const MONTH_TO_NUMBER: Record<
	typeof MONTH_NUMBER_TO_NAME[number],
	number | undefined
> = {
	JANUARY: 0,
	FEBRUARY: 1,
	MARCH: 2,
	APRIL: 3,
	MAY: 4,
	JUNE: 5,
	JULY: 6,
	AUGUST: 7,
	SEPTEMBER: 8,
	OCTOBER: 9,
	NOVEMBER: 10,
	DECEMBER: 11
};

interface YearMonth {
	year: number;
	month: MonthOfYear;
}

export interface GoogleKeywordConfig {
	keywords?: Array<string>;
	url?: string;
	wholeSite?: boolean;
	ideas?: boolean;
	maxIdeas?: number;
	language?: string;
	countryISOCode?: string;
	metricsStart?: string;
	metricsEnd?: string;
	/** When true, includes seedKeywords in output records. Defaults to false. */
	includeSeedKeywords?: boolean;
}

interface NormalizedConfig {
	keywords?: Array<string>;
	url?: string;
	wholeSite: boolean;
	ideas: boolean;
	maxIdeas: number;
	language?: string;
	countryISOCode?: string;
	metricsRange?: { start: YearMonth; end: YearMonth };
}

export interface KeywordRecord {
	keyword: string;
	avgMonthlySearches?: number;
	competition?: KeywordPlanCompetitionLevel;
	competitionIndex?: number;
	averageCpc?: number;
	lowTopOfPageBid?: number;
	highTopOfPageBid?: number;
	searchVolume?: Array<number>;
	searchVolumeDate?: Array<string>;
	searchVolumeGrowthYoy?: number;
	searchVolumeGrowth3m?: number;
	searchVolumeGrowth1m?: number;
	searchVolumeTrend?: number;
	concepts?: Array<string>;
	conceptGroups?: Array<string>;
	closeVariants?: Array<string>;
	seedKeywords?: Array<string>;
	keywordId?: number;
	deduplicatedKeywords?: Array<string>;
}

function isDomain(url: string | undefined | null): boolean {
	if (!url) {
		return false;
	}

	const normalized = url.startsWith('http') ? url : `https://${url}`;
	try {
		const parsed = new URL(normalized);
		const path = parsed.pathname ?? '';
		return !path || path === '/' || path.replaceAll('/', '') === '';
	} catch {
		return false;
	}
}

function parseYearMonth(value: string): YearMonth {
	const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
	if (!match) {
		throw new Error(`Invalid year-month value "${value}". Expected format YYYY-MM.`);
	}

	const year = Number(match[1]);
	const month = Number(match[2]);
	if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
		throw new Error(`Invalid year-month value "${value}". Month must be between 01 and 12.`);
	}

	return { year, month: MONTH_NUMBER_TO_NAME[month - 1] };
}

function monthEnumToMonthNumber(
	input: MonthlySearchVolume['month'] | null | undefined
): number | null {
	if (input == null || input === 'UNSPECIFIED' || input === 'UNKNOWN') {
		return null;
	}
	return MONTH_TO_NUMBER[input] ?? null;
}

function normalizeConfig(input: GoogleKeywordConfig): NormalizedConfig {
	const trimmedKeywords = input.keywords
		?.map((kw) => kw.trim())
		.filter((kw) => kw.length > 0);

	const url = input.url?.trim() || undefined;
	const wholeSite = Boolean(url && input.wholeSite && isDomain(url));

	let ideas = Boolean(input.ideas);
	if (!ideas && !trimmedKeywords?.length && url) {
		console.warn(
			'Idea generation is disabled, no keywords are provided, but a URL is set. Enabling idea generation automatically.'
		);
		ideas = true;
	}

	let keywords = trimmedKeywords;
	if (ideas && keywords && !wholeSite && keywords.length > 20) {
		console.warn(
			'Google only supports up to 20 seed keywords for idea generation. The first 20 will be used.'
		);
		keywords = keywords.slice(0, 20);
	}

	const languageRaw = input.language?.trim() || 'EN'; // If not set the API defaults to 'EN' on their end...;
	const language =
		languageRaw && !languageRaw.includes('/') ? languageRaw.toLowerCase() : languageRaw || undefined;

	const countryRaw = input.countryISOCode?.trim();
	const countryISOCode =
		countryRaw && !countryRaw.includes('/') ? countryRaw.toUpperCase() : countryRaw || undefined;

	let metricsRange: { start: YearMonth; end: YearMonth } | undefined;
	if (input.metricsStart || input.metricsEnd) {
		if (!input.metricsStart || !input.metricsEnd) {
			throw new Error('Either provide both metricsStart and metricsEnd or neither.');
		}
		const start = parseYearMonth(input.metricsStart);
		const end = parseYearMonth(input.metricsEnd);
		if (start.year > end.year || (start.year === end.year && start.month > end.month)) {
			throw new Error('Metrics start date must be before or equal to metrics end date.');
		}
		metricsRange = { start, end };
	}

	return {
		keywords,
		url,
		wholeSite,
		ideas,
		maxIdeas: input.maxIdeas ?? 100,
		language,
		countryISOCode,
		metricsRange
	};
}

function toNumberLike(value: unknown): number | null {
	if (value == null) {
		return null;
	}

	if (typeof value === 'number') {
		return Number.isNaN(value) ? null : value;
	}

	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) {
			return null;
		}
		const parsed = Number(trimmed);
		return Number.isNaN(parsed) ? null : parsed;
	}

	if (typeof value === 'bigint') {
		return Number(value);
	}

	if (
		typeof value === 'object' &&
		value !== null &&
		'toNumber' in value &&
		typeof (value as { toNumber: unknown }).toNumber === 'function'
	) {
		const num = (value as { toNumber: () => number }).toNumber();
		return Number.isNaN(num) ? null : num;
	}

	return null;
}

function microsToUnit(value: unknown, zerosToNull: boolean): number | null {
	const micros = toNumberLike(value);
	if (micros == null) {
		return null;
	}
	const unit = micros / 1_000_000;
	if (zerosToNull && unit === 0) {
		return null;
	}
	return unit;
}

function extractMonthlyVolumes(
	volumes: ReadonlyArray<MonthlySearchVolume> | null | undefined
): { dates: Array<string>; values: Array<number> } | null {
	if (!volumes || volumes.length === 0) {
		return null;
	}

	type ParsedVolume = {
		year: number;
		month: number;
		value: number;
		date: string;
	};

	const parsedVolumes: Array<ParsedVolume> = [];

	for (const volume of volumes) {
		const year = toNumberLike(volume.year);
		const month = monthEnumToMonthNumber(volume.month);
		const searches = toNumberLike(volume.monthlySearches);
		if (year == null || month == null || searches == null) {
			continue;
		}
		const date = new Date(Date.UTC(year, month, 1)).toISOString();
		parsedVolumes.push({ year, month, value: searches, date });
	}

	parsedVolumes.sort((a, b) => (a.year === b.year ? a.month - b.month : a.year - b.year));

	if (parsedVolumes.length === 0) {
		return null;
	}

	return {
		dates: parsedVolumes.map((item) => item.date),
		values: parsedVolumes.map((item) => item.value)
	};
}

function calculateTrendPct(volumes: Array<number>, nMonths: number): number | null {
	if (!Array.isArray(volumes) || volumes.length < nMonths) {
		return null;
	}
	const end = volumes[volumes.length - 1];
	const start = volumes[volumes.length - nMonths];
	const denominator = start === 0 ? 1 : start;
	return ((end - start) / denominator) * 100;
}

function linregTrend(values: Array<number>): number | null {
	if (!Array.isArray(values) || values.length < 3) {
		return null;
	}
	const n = values.length;
	const sumX = ((n - 1) * n) / 2;
	const sumXX = ((n - 1) * n * (2 * n - 1)) / 6;
	let sumY = 0;
	let sumXY = 0;
	for (let i = 0; i < n; i += 1) {
		const y = values[i];
		sumY += y;
		sumXY += i * y;
	}
	const denominator = n * sumXX - sumX * sumX;
	if (denominator === 0) {
		return null;
	}
	const slope = (n * sumXY - sumX * sumY) / denominator;
	const meanY = sumY / n;
	if (meanY === 0) {
		return null;
	}
	return slope / meanY;
}

function addTrendFields(record: KeywordRecord): void {
	const volumes = record.searchVolume;
	if (!volumes || volumes.length === 0) {
		return;
	}

	if (volumes.length >= 12) {
		const yoy = calculateTrendPct(volumes, 12);
		if (yoy != null) {
			record.searchVolumeGrowthYoy = yoy;
		}
	}
	if (volumes.length >= 3) {
		const threeMonth = calculateTrendPct(volumes, 3);
		if (threeMonth != null) {
			record.searchVolumeGrowth3m = threeMonth;
		}
		const trend = linregTrend(volumes);
		if (trend != null) {
			record.searchVolumeTrend = trend;
		}
	}
	if (volumes.length > 1) {
		const oneMonth = calculateTrendPct(volumes, 2);
		if (oneMonth != null) {
			record.searchVolumeGrowth1m = oneMonth;
		}
	}
}

function lookupResource(
	table: Readonly<Record<string, string>>,
	rawValue: string
): string | null {
	const value = rawValue.trim();
	if (!value) {
		return null;
	}
	return (
		table[value] ??
		table[value.toLowerCase()] ??
		table[value.toUpperCase()] ??
		null
	);
}

function languageResourceFromInput(language?: string): string | null {
	if (!language) {
		return null;
	}
	if (language.includes('/')) {
		return language;
	}

	const resource = lookupResource(LANGUAGE_RESOURCE_MAP, language);
	if (!resource) {
		throw new Error(
			`Invalid language code "${language}" (not found in bundled Google Ads language table).`
		);
	}
	return resource;
}

function geoTargetResourceFromInput(country?: string): string | null {
	if (!country) {
		return null;
	}
	if (country.includes('/')) {
		return country;
	}

	const resource = lookupResource(COUNTRY_RESOURCE_MAP, country);
	if (!resource) {
		throw new Error(
			`Invalid country code "${country}" (not found in bundled Google Ads geo table).`
		);
	}
	return resource;
}

async function fetchKeywords(cfg: NormalizedConfig): Promise<KeywordServiceResponse> {
	const googleAdsClient = await createGoogleAdsClient();

	const languageResource = languageResourceFromInput(cfg.language);
	const geoResource = geoTargetResourceFromInput(cfg.countryISOCode);

	const baseHistoricalOptions: GenerateKeywordIdeasRequest['historicalMetricsOptions'] = {
		include_average_cpc: true
	};

	if (cfg.metricsRange) {
		baseHistoricalOptions.year_month_range = {
			start: {
				year: cfg.metricsRange.start.year,
				month: cfg.metricsRange.start.month
			},
			end: {
				year: cfg.metricsRange.end.year,
				month: cfg.metricsRange.end.month
			}
		};
	}

	const keywordPlanNetwork: KeywordPlanNetwork = 'GOOGLE_SEARCH';
	const keywordAnnotationConcept: KeywordPlanKeywordAnnotation = 'KEYWORD_CONCEPT';

	if (cfg.ideas) {
		const request: GenerateKeywordIdeasRequest = {
			includeAdultKeywords: true,
			pageSize: cfg.maxIdeas,
			keywordPlanNetwork: keywordPlanNetwork,
			keywordAnnotation: [keywordAnnotationConcept],
			historicalMetricsOptions: baseHistoricalOptions
		};

		if (languageResource) {
			request.language = languageResource;
		}

		request.geoTargetConstants = geoResource ? [geoResource] : [];

		if (cfg.url && cfg.wholeSite) {
			request.siteSeed = { site: cfg.url };
			if (cfg.keywords?.length) {
				console.warn('Seed keywords are ignored when requesting whole-site keyword ideas.');
			}
		} else if (cfg.url && !cfg.keywords?.length) {
			request.urlSeed = { url: cfg.url };
		} else if (cfg.url && cfg.keywords?.length) {
			request.keywordAndUrlSeed = { url: cfg.url, keywords: cfg.keywords };
		} else if (cfg.keywords?.length) {
			request.keywordSeed = { keywords: cfg.keywords };
		} else {
			throw new Error(
				"Either 'keywords' or 'url' must be provided when 'ideas' is true. Provide seed keywords or a URL."
			);
		}

		return googleAdsClient('generateKeywordIdeas', request) as Promise<GenerateKeywordIdeaResponse>;
	}

	if (!cfg.keywords?.length) {
		throw new Error('No keywords provided. Please provide keywords to fetch historical metrics for.');
	}

	const request: GenerateKeywordHistoricalMetricsRequest = {
		keywords: cfg.keywords,
		includeAdultKeywords: true,
		keywordPlanNetwork: keywordPlanNetwork,
		historicalMetricsOptions: baseHistoricalOptions
	};

	if (languageResource) {
		request.language = languageResource;
	}
	if (geoResource) {
		request.geoTargetConstants = [geoResource];
	}

	return googleAdsClient('generateKeywordHistoricalMetrics', request) as Promise<GenerateKeywordHistoricalMetricsResponse>;
}

function isKeywordIdeaResult(result: KeywordResult): result is KeywordIdeaResult {
	return 'keywordIdeaMetrics' in result || 'keywordAnnotations' in result;
}

function extractMetrics(result: KeywordResult): KeywordMetrics | null {
	if ('keywordIdeaMetrics' in result && result.keywordIdeaMetrics) {
		return result.keywordIdeaMetrics;
	}
	if ('keywordMetrics' in result && result.keywordMetrics) {
		return result.keywordMetrics;
	}
	return null;
}

function extractConcepts(result: KeywordResult): { concepts?: Array<string>; conceptGroups?: Array<string> } {
	if (!isKeywordIdeaResult(result)) {
		return {};
	}

	const annotations = result.keywordAnnotations;
	const conceptList = annotations?.concepts ?? [];

	if (!conceptList || conceptList.length === 0) {
		return {};
	}

	const conceptNames = new Set<string>();
	const conceptGroups = new Set<string>();

	for (const concept of conceptList) {
		const name = concept.name?.trim();
		if (name && name !== 'Others' && name !== 'Non-Brands') {
			conceptNames.add(name);
		}
		const groupName = concept.conceptGroup?.name?.trim();
		if (groupName && groupName !== 'Others') {
			conceptGroups.add(groupName);
		}
	}

	return {
		concepts: conceptNames.size > 0 ? Array.from(conceptNames) : undefined,
		conceptGroups: conceptGroups.size > 0 ? Array.from(conceptGroups) : undefined
	};
}

function processKeywords(
	response: KeywordServiceResponse,
	collectVolumes = true,
	zerosToNull = true,
	seedKeywords?: Array<string>
): Array<KeywordRecord> {
	const results = response.results ?? [];

	const records: Array<KeywordRecord> = [];

	for (const result of results) {
		const keyword = typeof result.text === 'string' ? result.text : null;
		if (!keyword) {
			continue;
		}

		const record: KeywordRecord = { keyword };
		const metrics = extractMetrics(result);

		if (metrics) {
			const avgMonthly = toNumberLike(metrics.avgMonthlySearches);
			if (avgMonthly != null) {
				record.avgMonthlySearches = avgMonthly;
			}

			const competition = metrics.competition;
			if (competition) {
				record.competition = competition;
			}

			const competitionIndex = toNumberLike(metrics.competitionIndex);
			if (competitionIndex != null) {
				record.competitionIndex = competitionIndex;
			}

			const averageCpc = microsToUnit(
				metrics.averageCpcMicros,
				zerosToNull
			);
			if (averageCpc != null) {
				record.averageCpc = averageCpc;
			}

			const lowTopBid = microsToUnit(
				metrics.lowTopOfPageBidMicros,
				zerosToNull
			);
			if (lowTopBid != null) {
				record.lowTopOfPageBid = lowTopBid;
			}

			const highTopBid = microsToUnit(
				metrics.highTopOfPageBidMicros,
				zerosToNull
			);
			if (highTopBid != null) {
				record.highTopOfPageBid = highTopBid;
			}

			if (collectVolumes) {
				const monthly = extractMonthlyVolumes(metrics.monthlySearchVolumes);
				if (monthly) {
					record.searchVolume = monthly.values;
					record.searchVolumeDate = monthly.dates;
				}
			}
		}

		const { concepts, conceptGroups } = extractConcepts(result);
		if (concepts) {
			record.concepts = concepts;
		}
		if (conceptGroups) {
			record.conceptGroups = conceptGroups;
		}

		if (result.closeVariants && result.closeVariants.length > 0) {
			record.closeVariants = result.closeVariants;
		}

		if (seedKeywords && seedKeywords.length > 0) {
			record.seedKeywords = seedKeywords;
		}

		if (collectVolumes) {
			addTrendFields(record);
		}

		records.push(record);
	}

	return records;
}

export async function keywords(cfg: GoogleKeywordConfig): Promise<Array<KeywordRecord>> {
	const normalizedCfg = normalizeConfig(cfg);
	const response = await fetchKeywords(normalizedCfg);
	const seedKeywordsArg = cfg.includeSeedKeywords === true ? normalizedCfg.keywords : undefined;
	const processed = processKeywords(response, true, true, seedKeywordsArg);
	console.info(`Fetched ${processed.length} keyword records.`);
	return processed;
}
