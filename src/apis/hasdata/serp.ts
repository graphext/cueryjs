/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
import mapParallel from '../../mapParallel.ts';

import {
	fetchHasDataWithRetry,
	HASDATA_CONCURRENCY,
	parseAIO,
	type AIOverview,
	type AIOParsed
} from './helpers.ts';

type SerpSearchType = 'all' | 'images' | 'videos' | 'news' | 'shopping' | 'local';

const SEARCH_TYPE_TO_TBM: Record<Exclude<SerpSearchType, 'all'>, string> = {
	images: 'isch',
	videos: 'vid',
	news: 'nws',
	shopping: 'shop',
	local: 'lcl'
};

export interface SerpRequestOptions {
	location: string; // HasData param: location
	country: string; // HasData param: gl
	language: string; // HasData param: hl
	contentLanguage?: string; // HasData param: lr
	domain?: string; // HasData param: domain
	filters?: string | Array<string>; // HasData param: tbs
	safeSearch?: 'active' | 'off' | boolean; // HasData param: safe
	filterResults?: boolean; // HasData param: filter
	preventAutoCorrect?: boolean; // HasData param: nfpr
	offset?: number; // HasData param: start
	resultsPerPage?: number; // HasData param: num
	type?: SerpSearchType; // HasData param: tbm
	device?: 'desktop' | 'mobile' | 'tablet'; // HasData param: deviceType
	placeId?: string; // HasData param: ludocid
	lsig?: string; // HasData param: lsig
	entityId?: string; // HasData param: kgmid
	encodedLocation?: string; // HasData param: uule
	searchId?: string; // HasData param: si
}

interface SerpInlineSiteLink {
	title?: string;
	link?: string;
}

interface SerpListSiteLink {
	title?: string;
	link?: string;
	snippet?: string;
}

interface SerpRichSnippetTop {
	extensions?: Array<string>;
	detectedExtensions?: Record<string, string | number>;
}

interface SerpRichSnippet {
	top?: SerpRichSnippetTop;
}

interface SerpSiteLinks {
	inline?: Array<SerpInlineSiteLink>;
	list?: Array<SerpListSiteLink>;
}

export interface SerpOrganicResult {
	position?: number;
	title?: string;
	link?: string;
	url?: string;
	displayedLink?: string;
	source?: string;
	snippet?: string;
	snippetHighlitedWords?: Array<string>;
	images?: Array<string>;
	richSnippet?: SerpRichSnippet;
	sitelinks?: SerpSiteLinks;
}

export interface SerpRequestMetadata {
	id?: string;
	status?: string;
	html?: string;
	url?: string;
}

export interface SerpSearchInformation {
	totalResults?: string;
	formattedTotalResults?: string;
	timeTaken?: number;
	searchTime?: number;
}

export interface SerpLocalPlace {
	position?: number;
	title?: string;
	rating?: number;
	reviews?: number;
	reviewsOriginal?: string;
	address?: string;
	hours?: string;
	placeId?: string;
	description?: string;
}

export interface SerpLocalResults {
	places?: Array<SerpLocalPlace>;
	moreLocationsLink?: string;
}

export interface SerpRelatedSearch {
	query?: string;
	link?: string;
}

export interface SerpRelatedQuestion {
	question?: string;
	snippet?: string;
	link?: string;
	title?: string;
	displayedLink?: string;
	date?: string;
	list?: Array<string>;
	table?: Array<Array<string>>;
	aiOverview?: AIOverview;
}

export interface SerpPerspective {
	index?: number;
	author?: string;
	source?: string;
	duration?: string;
	extensions?: Array<string>;
	thumbnail?: string;
	title?: string;
	link?: string;
	date?: string;
	snippet?: string;
}

export interface SerpImmersiveProduct {
	position?: number;
	category?: string;
	title?: string;
	productId?: string;
	productLink?: string;
	price?: string;
	extractedPrice?: number;
	source?: string;
	reviews?: number;
	rating?: number;
	delivery?: string;
	extensions?: Array<string>;
	thumbnail?: string;
}

export interface SerpPagination {
	next?: string;
	pages?: Array<Record<string, string>>;
}

export interface SerpResponse {
	requestMetadata?: SerpRequestMetadata;
	searchMetadata?: Record<string, unknown>;
	searchParameters?: Record<string, unknown>;
	searchInformation?: SerpSearchInformation;
	organicResults?: Array<SerpOrganicResult>;
	adsResults?: Array<Record<string, unknown>>;
	localResults?: SerpLocalResults;
	knowledgeGraph?: Record<string, unknown>;
	relatedSearches?: Array<SerpRelatedSearch>;
	topStories?: Array<Record<string, unknown>>;
	peopleAlsoAsk?: Array<Record<string, unknown>>;
	relatedQuestions?: Array<SerpRelatedQuestion>;
	imagesResults?: Array<Record<string, unknown>>;
	videosResults?: Array<Record<string, unknown>>;
	perspectives?: Array<SerpPerspective>;
	immersiveProducts?: Array<SerpImmersiveProduct>;
	pagination?: SerpPagination;
	aiOverview?: AIOParsed;
}

const SERP_ENDPOINT = 'https://api.hasdata.com/scrape/google/serp';

function appendParam(url: URL, key: string, value: string | number | boolean): void {
	url.searchParams.set(key, String(value));
}

function appendOptionalParam(
	url: URL,
	key: string,
	value: string | number | boolean | null | undefined
): void {
	if (value === undefined || value === null) {
		return;
	}
	appendParam(url, key, value);
}

function formatBooleanParam(value: string | number | boolean, trueToken: string, falseToken: string): string {
	if (typeof value === 'boolean') {
		return value ? trueToken : falseToken;
	}
	return String(value);
}

function normalizeLocale(value: string | undefined): string | undefined {
	return value ? value.toLowerCase() : undefined;
}

function normalizeDevice(device?: string): string | undefined {
	if (!device) {
		return undefined;
	}
	const normalized = device.toLowerCase();
	if (normalized === 'desktop' || normalized === 'mobile' || normalized === 'tablet') {
		return normalized;
	}
	return undefined;
}

function normalizeTbs(value?: string | Array<string>): string | undefined {
	if (!value) {
		return undefined;
	}
	if (Array.isArray(value)) {
		return value.map(entry => entry.trim()).filter(Boolean).join(',');
	}
	return value;
}

function normalizeTbm(searchType?: SerpSearchType): string | undefined {
	if (!searchType || searchType === 'all') {
		return undefined;
	}
	const key = searchType.toLowerCase() as Exclude<SerpSearchType, 'all'>;
	return SEARCH_TYPE_TO_TBM[key] || searchType;
}

function applySerpParams(url: URL, options: SerpRequestOptions): void {
	appendOptionalParam(url, 'location', options.location);
	appendOptionalParam(url, 'gl', normalizeLocale(options.country));
	appendOptionalParam(url, 'hl', normalizeLocale(options.language));
	appendOptionalParam(url, 'lr', options.contentLanguage);
	appendOptionalParam(url, 'domain', options.domain);
	appendOptionalParam(url, 'uule', options.encodedLocation);

	const tbs = normalizeTbs(options.filters);
	if (tbs) {
		appendParam(url, 'tbs', tbs);
	}

	if (options.safeSearch !== undefined) {
		const safeValue =
			typeof options.safeSearch === 'boolean'
				? options.safeSearch
					? 'active'
					: 'off'
				: options.safeSearch;
		appendParam(url, 'safe', safeValue);
	}

	if (options.filterResults !== undefined) {
		const filterValue = formatBooleanParam(options.filterResults, '1', '0');
		appendParam(url, 'filter', filterValue);
	}

	if (options.preventAutoCorrect !== undefined) {
		const nfprValue = formatBooleanParam(options.preventAutoCorrect, '1', '0');
		appendParam(url, 'nfpr', nfprValue);
	}

	const tbm = normalizeTbm(options.type);
	if (typeof options.offset === 'number' && options.offset >= 0) {
		let start = Math.floor(options.offset);
		if (tbm === 'lcl' && start % 20 !== 0) {
			start = Math.floor(start / 20) * 20;
		}
		appendParam(url, 'start', start);
	}

	if (typeof options.resultsPerPage === 'number' && options.resultsPerPage > 0) {
		const num = Math.min(Math.max(Math.floor(options.resultsPerPage), 10), 100);
		appendParam(url, 'num', num);
	}

	if (tbm) {
		appendParam(url, 'tbm', tbm);
	}

	const device = normalizeDevice(options.device);
	if (device) {
		appendParam(url, 'deviceType', device);
	}

	appendOptionalParam(url, 'ludocid', options.placeId);
	appendOptionalParam(url, 'lsig', options.lsig);
	appendOptionalParam(url, 'kgmid', options.entityId);
	appendOptionalParam(url, 'si', options.searchId);
}

async function fetchSerpInternal(url: string): Promise<SerpResponse> {
	const response = await fetchHasDataWithRetry(url);
	const content = (await response.json()) as SerpResponse;
	let aio = content.aiOverview as AIOverview | { pageToken?: string; hasdataLink?: string } | undefined;

	if (aio && aio.pageToken && aio.hasdataLink) {
		const aioResponse = await fetchHasDataWithRetry(aio.hasdataLink);
		aio = await aioResponse.json();
	}

	if (aio) {
		content.aiOverview = parseAIO(aio as AIOverview);
	}

	return content;
}

export async function fetchSerp(query: string, options: SerpRequestOptions): Promise<SerpResponse> {
	const url = new URL(SERP_ENDPOINT);
	url.searchParams.set('q', query);
	applySerpParams(url, options);

	return fetchSerpInternal(url.toString());
}

export async function fetchSerpBatch(
	queries: Array<string>,
	options: SerpRequestOptions,
	maxConcurrency: number = HASDATA_CONCURRENCY
): Promise<Array<SerpResponse>> {
	const url = new URL(SERP_ENDPOINT);
	applySerpParams(url, options);

	return mapParallel(
		queries,
		maxConcurrency,
		async query => {
			url.searchParams.set('q', query);
			return await fetchSerpInternal(url.toString());
		}
	);
}
