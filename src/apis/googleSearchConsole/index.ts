export interface SearchConsoleSite {
	siteUrl: string;
	permissionLevel: string;
}

export interface SearchConsoleQueryRow {
	query: string;
	page?: string;
	country?: string;
	device?: string;
	date?: string;
	hour?: string;
	searchAppearance?: string;
	clicks: number;
	impressions: number;
	ctr: number;
	position: number;
}

export type SearchConsoleDimension = 'query' | 'page' | 'country' | 'device' | 'date' | 'hour' | 'searchAppearance';

export type SearchConsoleSearchType = 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews';

export type SearchConsoleAggregationType = 'auto' | 'byPage' | 'byProperty' | 'byNewsShowcasePanel';

export type SearchConsoleDataState = 'final' | 'all' | 'hourly_all';

export type SearchConsoleDimensionFilterOperator =
	| 'equals'
	| 'notEquals'
	| 'contains'
	| 'notContains'
	| 'includingRegex'
	| 'excludingRegex';

export interface SearchConsoleDimensionFilter {
	dimension: SearchConsoleDimension;
	operator?: SearchConsoleDimensionFilterOperator;
	expression: string;
}

export interface SearchConsoleDimensionFilterGroup {
	groupType?: 'and';
	filters: Array<SearchConsoleDimensionFilter>;
}

export interface SearchConsoleAuthParams {
	accessToken?: string;
	getAccessToken?: () => string | Promise<string>;
}

export interface ListSearchConsoleSitesParams extends SearchConsoleAuthParams {}

export interface FetchSearchConsoleQueriesParams extends SearchConsoleAuthParams {
	siteUrl: string;
	startDate: string;
	endDate: string;
	rowLimit?: number;
	startRow?: number;
	dimensions?: Array<SearchConsoleDimension>;
	type?: SearchConsoleSearchType;
	aggregationType?: SearchConsoleAggregationType;
	dataState?: SearchConsoleDataState;
	dimensionFilterGroups?: Array<SearchConsoleDimensionFilterGroup>;
}

interface SearchConsoleQueryRequest {
	startDate: string;
	endDate: string;
	dimensions: Array<SearchConsoleDimension>;
	rowLimit: number;
	startRow?: number;
	type?: SearchConsoleSearchType;
	aggregationType?: SearchConsoleAggregationType;
	dataState?: SearchConsoleDataState;
	dimensionFilterGroups?: Array<SearchConsoleDimensionFilterGroup>;
}

interface SearchConsoleSitesResponse {
	siteEntry?: Array<SearchConsoleSite>;
}

interface SearchConsoleAnalyticsRow {
	keys?: Array<string>;
	clicks?: number;
	impressions?: number;
	ctr?: number;
	position?: number;
}

interface SearchConsoleAnalyticsResponse {
	rows?: Array<SearchConsoleAnalyticsRow>;
}

const ERROR_BODY_PREVIEW_LENGTH = 500;

async function resolveAccessToken(params: SearchConsoleAuthParams): Promise<string> {
	const directToken = params.accessToken?.trim();
	if (directToken) {
		return directToken;
	}

	if (params.getAccessToken) {
		const providedToken = (await params.getAccessToken()).trim();
		if (providedToken) {
			return providedToken;
		}
	}

	throw new Error('Either accessToken or getAccessToken is required for Google Search Console requests.');
}

function sanitizeErrorBody(body: string, accessToken: string): string {
	return body
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
		.replaceAll(accessToken, '[redacted]');
}

async function parseGoogleResponse<T>(response: Response, accessToken: string): Promise<T> {
	if (response.ok) {
		return await response.json() as T;
	}

	let body = '';
	try {
		body = await response.text();
	} catch {
		body = '[failed to read response body]';
	}

	const sanitized = sanitizeErrorBody(body, accessToken);
	const preview = sanitized.length > ERROR_BODY_PREVIEW_LENGTH
		? `${sanitized.slice(0, ERROR_BODY_PREVIEW_LENGTH)}...`
		: sanitized;
	const statusText = response.statusText ? ` ${sanitizeErrorBody(response.statusText, accessToken)}` : '';

	throw new Error(
		`Google Search Console API error: ${response.status}${statusText}. Response body: ${preview}`,
	);
}

function buildSearchAnalyticsRequest(
	params: FetchSearchConsoleQueriesParams,
	dimensions: Array<SearchConsoleDimension>,
): SearchConsoleQueryRequest {
	const request: SearchConsoleQueryRequest = {
		startDate: params.startDate,
		endDate: params.endDate,
		dimensions,
		rowLimit: params.rowLimit ?? 250,
	};

	if (params.startRow != null) {
		request.startRow = params.startRow;
	}
	if (params.type) {
		request.type = params.type;
	}
	if (params.aggregationType) {
		request.aggregationType = params.aggregationType;
	}
	if (params.dataState) {
		request.dataState = params.dataState;
	}
	if (params.dimensionFilterGroups) {
		request.dimensionFilterGroups = params.dimensionFilterGroups;
	}

	return request;
}

function getDimensionValues(
	dimensions: Array<SearchConsoleDimension>,
	keys: Array<string> = [],
): Partial<Record<SearchConsoleDimension, string>> {
	const values: Partial<Record<SearchConsoleDimension, string>> = {};

	for (const [index, dimension] of dimensions.entries()) {
		const value = keys[index];
		if (value != null) {
			values[dimension] = value;
		}
	}

	return values;
}

export async function listSearchConsoleSites(
	params: ListSearchConsoleSitesParams,
): Promise<Array<SearchConsoleSite>> {
	const accessToken = await resolveAccessToken(params);
	const response = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
		method: 'GET',
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
	});
	const data = await parseGoogleResponse<SearchConsoleSitesResponse>(response, accessToken);

	return data.siteEntry ?? [];
}

export async function fetchSearchConsoleQueries(
	params: FetchSearchConsoleQueriesParams,
): Promise<Array<SearchConsoleQueryRow>> {
	const accessToken = await resolveAccessToken(params);
	const dimensions = params.dimensions ?? ['query'];
	const response = await fetch(
		`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(params.siteUrl)}/searchAnalytics/query`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(buildSearchAnalyticsRequest(params, dimensions)),
		},
	);
	const data = await parseGoogleResponse<SearchConsoleAnalyticsResponse>(response, accessToken);

	return (data.rows ?? []).map((row) => {
		const values = getDimensionValues(dimensions, row.keys);
		const queryRow: SearchConsoleQueryRow = {
			query: values.query ?? '',
			clicks: row.clicks ?? 0,
			impressions: row.impressions ?? 0,
			ctr: row.ctr ?? 0,
			position: row.position ?? 0,
		};

		for (const dimension of dimensions) {
			const value = values[dimension];
			if (value != null) {
				queryRow[dimension] = value;
			}
		}

		return queryRow;
	});
}
