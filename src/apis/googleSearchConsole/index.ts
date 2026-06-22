export const GOOGLE_SEARCH_CONSOLE_READONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const GOOGLE_SEARCH_CONSOLE_AUTHORIZATION_SCOPE = `openid email ${GOOGLE_SEARCH_CONSOLE_READONLY_SCOPE}`;
export const GOOGLE_SEARCH_CONSOLE_DEFAULT_QUERY_ROW_LIMIT = 250;

const GOOGLE_OAUTH_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_SEARCH_CONSOLE_API_BASE_URL = 'https://www.googleapis.com/webmasters/v3';

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

export const GOOGLE_SEARCH_CONSOLE_QUERY_PAGE_DIMENSIONS: ReadonlyArray<SearchConsoleDimension> = ['query', 'page'];

export type SearchConsoleSearchType = 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews';

export type SearchConsoleAggregationType = 'auto' | 'byPage' | 'byProperty' | 'byNewsShowcasePanel';

export type SearchConsoleDataState = 'final' | 'all' | 'hourly_all';

export type SearchConsoleFilterDimension = 'query' | 'page' | 'country' | 'device' | 'searchAppearance';

export type SearchConsoleDimensionFilterOperator =
	| 'equals'
	| 'notEquals'
	| 'contains'
	| 'notContains'
	| 'includingRegex'
	| 'excludingRegex';

export interface SearchConsoleDimensionFilter {
	dimension: SearchConsoleFilterDimension;
	operator?: SearchConsoleDimensionFilterOperator;
	expression: string;
}

export interface SearchConsoleDimensionFilterGroup {
	groupType?: 'and';
	filters: Array<SearchConsoleDimensionFilter>;
}

export interface ListSearchConsoleSitesParams {
	accessToken: string;
	signal?: AbortSignal;
}

export interface FetchSearchConsoleQueriesParams {
	accessToken: string;
	siteUrl: string;
	startDate: string;
	endDate: string;
	rowLimit?: number;
	startRow?: number;
	dimensions?: Array<SearchConsoleDimension>;
	signal?: AbortSignal;
	type?: SearchConsoleSearchType;
	aggregationType?: SearchConsoleAggregationType;
	dataState?: SearchConsoleDataState;
	dimensionFilterGroups?: Array<SearchConsoleDimensionFilterGroup>;
}

export interface GoogleOAuthClientCredentials {
	clientId: string;
	clientSecret: string;
}

export interface ExchangeGoogleOAuthCodeParams extends GoogleOAuthClientCredentials {
	code: string;
	redirectUri: string;
	signal?: AbortSignal;
}

export interface RefreshGoogleAccessTokenParams extends GoogleOAuthClientCredentials {
	refreshToken: string;
	signal?: AbortSignal;
}

export interface GoogleOAuthTokenSet {
	accessToken: string;
	refreshToken: string;
	scope?: string;
	googleAccountEmail?: string;
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

interface GoogleOAuthTokenResponse {
	access_token?: string;
	refresh_token?: string;
	scope?: string;
	id_token?: string;
}

interface GoogleIdTokenPayload {
	email?: unknown;
	email_verified?: unknown;
}

const ERROR_BODY_PREVIEW_LENGTH = 500;

function sanitizeGoogleErrorMessage(message: string, sensitiveValues: Array<string | undefined>): string {
	let sanitized = message;
	for (const value of sensitiveValues) {
		const trimmed = value?.trim();
		if (trimmed) {
			sanitized = sanitized.replaceAll(trimmed, '[redacted]');
		}
	}

	return sanitized.replace(
		/\b(?:Bearer\s+[A-Za-z0-9._~+/=-]+|google-[a-z-]*(?:code|token)|ya29\.[A-Za-z0-9._-]+|1\/\/[A-Za-z0-9._-]+)\b/g,
		'[redacted]',
	);
}

async function readResponseBody(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch {
		return '[failed to read response body]';
	}
}

function previewGoogleErrorBody(body: string, sensitiveValues: Array<string | undefined>): string {
	const sanitized = sanitizeGoogleErrorMessage(body, sensitiveValues);

	return sanitized.length > ERROR_BODY_PREVIEW_LENGTH
		? `${sanitized.slice(0, ERROR_BODY_PREVIEW_LENGTH)}...`
		: sanitized;
}

function buildGoogleErrorMessage(
	apiName: string,
	response: Response,
	body: string,
	sensitiveValues: Array<string | undefined>,
): string {
	const preview = previewGoogleErrorBody(body, sensitiveValues);
	const statusText = response.statusText
		? ` ${sanitizeGoogleErrorMessage(response.statusText, sensitiveValues)}`
		: '';

	return `${apiName} error: ${response.status}${statusText}. Response body: ${preview}`;
}

function requireSearchConsoleAccessToken(accessToken: string): string {
	const trimmed = accessToken.trim();
	if (!trimmed) {
		throw new Error('accessToken is required for Google Search Console requests.');
	}

	return trimmed;
}

async function parseGoogleResponse<T>(response: Response, accessToken: string): Promise<T> {
	if (response.ok) {
		return await response.json() as T;
	}

	const body = await readResponseBody(response);
	throw new Error(buildGoogleErrorMessage('Google Search Console API', response, body, [accessToken]));
}

async function requestGoogleOAuthToken(
	body: URLSearchParams,
	signal: AbortSignal | undefined,
	sensitiveValues: Array<string | undefined>,
): Promise<GoogleOAuthTokenResponse> {
	const response = await fetch(GOOGLE_OAUTH_TOKEN_ENDPOINT, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body,
		signal,
	});

	if (response.ok) {
		return await response.json() as GoogleOAuthTokenResponse;
	}

	const responseBody = await readResponseBody(response);
	throw new Error(buildGoogleErrorMessage('Google OAuth API', response, responseBody, sensitiveValues));
}

export function getGoogleAccountEmailFromIdToken(idToken: string | undefined): string | undefined {
	const payloadPart = idToken?.split('.')[1];
	if (!payloadPart) {
		return undefined;
	}

	try {
		const payload = JSON.parse(base64UrlDecode(payloadPart)) as GoogleIdTokenPayload;
		const email = typeof payload.email === 'string' ? payload.email.trim() : '';
		return email && payload.email_verified === true ? email : undefined;
	} catch {
		return undefined;
	}
}

function base64UrlDecode(value: string): string {
	const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
	const paddingLength = (4 - normalized.length % 4) % 4;
	return atob(`${normalized}${'='.repeat(paddingLength)}`);
}

export async function exchangeGoogleOAuthCode(
	params: ExchangeGoogleOAuthCodeParams,
): Promise<GoogleOAuthTokenSet> {
	const body = await requestGoogleOAuthToken(
		new URLSearchParams({
			client_id: params.clientId,
			client_secret: params.clientSecret,
			code: params.code,
			grant_type: 'authorization_code',
			redirect_uri: params.redirectUri,
		}),
		params.signal,
		[params.code, params.clientSecret],
	);

	const accessToken = body.access_token?.trim();
	const refreshToken = body.refresh_token?.trim();
	if (!accessToken) {
		throw new Error('Google OAuth code exchange did not return an access token.');
	}
	if (!refreshToken) {
		throw new Error('Google OAuth code exchange did not return a refresh token.');
	}

	const googleAccountEmail = getGoogleAccountEmailFromIdToken(body.id_token);
	return {
		accessToken,
		refreshToken,
		...(body.scope != null ? { scope: body.scope } : {}),
		...(googleAccountEmail != null ? { googleAccountEmail } : {}),
	};
}

export async function refreshGoogleAccessToken(
	params: RefreshGoogleAccessTokenParams,
): Promise<string> {
	const body = await requestGoogleOAuthToken(
		new URLSearchParams({
			client_id: params.clientId,
			client_secret: params.clientSecret,
			refresh_token: params.refreshToken,
			grant_type: 'refresh_token',
		}),
		params.signal,
		[params.refreshToken, params.clientSecret],
	);

	const accessToken = body.access_token?.trim();
	if (!accessToken) {
		throw new Error('Google OAuth refresh did not return an access token.');
	}

	return accessToken;
}

function buildSearchAnalyticsRequest(
	params: FetchSearchConsoleQueriesParams,
	dimensions: Array<SearchConsoleDimension>,
): SearchConsoleQueryRequest {
	const request: SearchConsoleQueryRequest = {
		startDate: params.startDate,
		endDate: params.endDate,
		dimensions,
		rowLimit: params.rowLimit ?? GOOGLE_SEARCH_CONSOLE_DEFAULT_QUERY_ROW_LIMIT,
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

function mapSearchConsoleQueryRow(
	row: SearchConsoleAnalyticsRow,
	dimensions: Array<SearchConsoleDimension>,
): SearchConsoleQueryRow {
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
}

export async function listSearchConsoleSites(
	params: ListSearchConsoleSitesParams,
): Promise<Array<SearchConsoleSite>> {
	const accessToken = requireSearchConsoleAccessToken(params.accessToken);
	const response = await fetch(`${GOOGLE_SEARCH_CONSOLE_API_BASE_URL}/sites`, {
		method: 'GET',
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
		signal: params.signal,
	});
	const data = await parseGoogleResponse<SearchConsoleSitesResponse>(response, accessToken);

	return data.siteEntry ?? [];
}

export async function fetchSearchConsoleQueries(
	params: FetchSearchConsoleQueriesParams,
): Promise<Array<SearchConsoleQueryRow>> {
	const accessToken = requireSearchConsoleAccessToken(params.accessToken);
	const dimensions = params.dimensions ?? [...GOOGLE_SEARCH_CONSOLE_QUERY_PAGE_DIMENSIONS];
	const response = await fetch(
		`${GOOGLE_SEARCH_CONSOLE_API_BASE_URL}/sites/${encodeURIComponent(params.siteUrl)}/searchAnalytics/query`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(buildSearchAnalyticsRequest(params, dimensions)),
			signal: params.signal,
		},
	);
	const data = await parseGoogleResponse<SearchConsoleAnalyticsResponse>(response, accessToken);

	return (data.rows ?? []).map((row) => mapSearchConsoleQueryRow(row, dimensions));
}
