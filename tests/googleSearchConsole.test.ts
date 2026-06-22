import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';

import {
	exchangeGoogleOAuthCode,
	fetchSearchConsoleQueries,
	GOOGLE_SEARCH_CONSOLE_AUTHORIZATION_SCOPE,
	GOOGLE_SEARCH_CONSOLE_QUERY_PAGE_DIMENSIONS,
	GOOGLE_SEARCH_CONSOLE_READONLY_SCOPE,
	listSearchConsoleSites,
	refreshGoogleAccessToken,
} from '../src/apis/googleSearchConsole/index.ts';

type FetchCall = {
	input: string | URL | Request;
	init?: RequestInit;
};

function installFetch(...responses: Array<Response>): { calls: Array<FetchCall>; restore: () => void } {
	const originalFetch = globalThis.fetch;
	const calls: Array<FetchCall> = [];
	let responseIndex = 0;

	globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
		calls.push({ input, init });
		const response = responses[Math.min(responseIndex, responses.length - 1)];
		responseIndex += 1;
		return Promise.resolve(response);
	}) as typeof fetch;

	return {
		calls,
		restore: () => {
			globalThis.fetch = originalFetch;
		},
	};
}

function header(init: RequestInit | undefined, name: string): string | null {
	return new Headers(init?.headers).get(name);
}

function formBody(init: RequestInit | undefined): Record<string, string> {
	const params = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init?.body ?? ''));

	return Object.fromEntries(params.entries());
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		statusText: init.statusText,
		headers: { 'Content-Type': 'application/json', ...init.headers },
	});
}

function idToken(payload: Record<string, unknown>): string {
	return `header.${base64UrlEncode(JSON.stringify(payload))}.signature`;
}

function base64UrlEncode(value: string): string {
	return btoa(value)
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '');
}

Deno.test('exports Google Search Console OAuth scopes', () => {
	assertEquals(GOOGLE_SEARCH_CONSOLE_READONLY_SCOPE, 'https://www.googleapis.com/auth/webmasters.readonly');
	assertEquals(
		GOOGLE_SEARCH_CONSOLE_AUTHORIZATION_SCOPE,
		`openid email ${GOOGLE_SEARCH_CONSOLE_READONLY_SCOPE}`,
	);
	assertEquals(GOOGLE_SEARCH_CONSOLE_QUERY_PAGE_DIMENSIONS, ['query', 'page']);
});

Deno.test('exchangeGoogleOAuthCode exchanges an authorization code for tokens and verified email', async () => {
	const signal = new AbortController().signal;
	const { calls, restore } = installFetch(jsonResponse({
		access_token: 'access-token',
		refresh_token: 'refresh-token',
		scope: GOOGLE_SEARCH_CONSOLE_AUTHORIZATION_SCOPE,
		id_token: idToken({ email: ' owner@example.com ', email_verified: true }),
	}));

	try {
		const tokenSet = await exchangeGoogleOAuthCode({
			clientId: 'client-id',
			clientSecret: 'client-secret',
			code: 'google-code',
			redirectUri: 'https://app.example.com/oauth/callback',
			signal,
		});

		assertEquals(tokenSet, {
			accessToken: 'access-token',
			refreshToken: 'refresh-token',
			scope: GOOGLE_SEARCH_CONSOLE_AUTHORIZATION_SCOPE,
			googleAccountEmail: 'owner@example.com',
		});
		assertEquals(calls.length, 1);
		assertEquals(String(calls[0].input), 'https://oauth2.googleapis.com/token');
		assertEquals(calls[0].init?.method, 'POST');
		assertEquals(calls[0].init?.signal, signal);
		assertEquals(header(calls[0].init, 'content-type'), 'application/x-www-form-urlencoded');
		assertEquals(formBody(calls[0].init), {
			client_id: 'client-id',
			client_secret: 'client-secret',
			code: 'google-code',
			grant_type: 'authorization_code',
			redirect_uri: 'https://app.example.com/oauth/callback',
		});
	} finally {
		restore();
	}
});

Deno.test('exchangeGoogleOAuthCode throws when Google omits refresh token', async () => {
	const { restore } = installFetch(jsonResponse({
		access_token: 'access-token',
	}));

	try {
		const error = await assertRejects(
			() =>
				exchangeGoogleOAuthCode({
					clientId: 'client-id',
					clientSecret: 'client-secret',
					code: 'google-code',
					redirectUri: 'https://app.example.com/oauth/callback',
				}),
			Error,
		);

		assertStringIncludes(error.message, 'refresh token');
	} finally {
		restore();
	}
});

Deno.test('refreshGoogleAccessToken exchanges a refresh token for an access token', async () => {
	const signal = new AbortController().signal;
	const { calls, restore } = installFetch(jsonResponse({
		access_token: 'new-access-token',
	}));

	try {
		const accessToken = await refreshGoogleAccessToken({
			clientId: 'client-id',
			clientSecret: 'client-secret',
			refreshToken: 'refresh-token',
			signal,
		});

		assertEquals(accessToken, 'new-access-token');
		assertEquals(String(calls[0].input), 'https://oauth2.googleapis.com/token');
		assertEquals(calls[0].init?.method, 'POST');
		assertEquals(calls[0].init?.signal, signal);
		assertEquals(formBody(calls[0].init), {
			client_id: 'client-id',
			client_secret: 'client-secret',
			refresh_token: 'refresh-token',
			grant_type: 'refresh_token',
		});
	} finally {
		restore();
	}
});

Deno.test('Google Search Console network calls omit signal when no explicit signal is passed', async () => {
	const { calls, restore } = installFetch(
		jsonResponse({ access_token: 'access-token', refresh_token: 'refresh-token' }),
		jsonResponse({ access_token: 'new-access-token' }),
		jsonResponse({ siteEntry: [] }),
		jsonResponse({ rows: [] }),
	);

	try {
		await exchangeGoogleOAuthCode({
			clientId: 'client-id',
			clientSecret: 'client-secret',
			code: 'google-code',
			redirectUri: 'https://app.example.com/oauth/callback',
		});
		await refreshGoogleAccessToken({
			clientId: 'client-id',
			clientSecret: 'client-secret',
			refreshToken: 'refresh-token',
		});
		await listSearchConsoleSites({ accessToken: 'access-token' });
		await fetchSearchConsoleQueries({
			accessToken: 'access-token',
			siteUrl: 'sc-domain:example.com',
			startDate: '2026-03-01',
			endDate: '2026-06-01',
		});

		assertEquals(calls.map((call) => call.init?.signal), [undefined, undefined, undefined, undefined]);
	} finally {
		restore();
	}
});

Deno.test('listSearchConsoleSites fetches and maps Search Console sites', async () => {
	const token = 'test-access-token';
	const { calls, restore } = installFetch(
		jsonResponse({
			siteEntry: [
				{ siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' },
				{ siteUrl: 'sc-domain:example.org', permissionLevel: 'siteFullUser' },
			],
		}),
	);

	try {
		const signal = new AbortController().signal;
		const sites = await listSearchConsoleSites({ accessToken: token, signal });

		assertEquals(sites, [
			{ siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' },
			{ siteUrl: 'sc-domain:example.org', permissionLevel: 'siteFullUser' },
		]);
		assertEquals(calls.length, 1);
		assertEquals(String(calls[0].input), 'https://www.googleapis.com/webmasters/v3/sites');
		assertEquals(calls[0].init?.method, 'GET');
		assertEquals(calls[0].init?.signal, signal);
		assertEquals(header(calls[0].init, 'authorization'), `Bearer ${token}`);
	} finally {
		restore();
	}
});

Deno.test('fetchSearchConsoleQueries posts encoded site URL and maps query rows', async () => {
	const token = 'test-access-token';
	const siteUrl = 'https://www.example.com/path/?a=b';
	const { calls, restore } = installFetch(
		jsonResponse({
			rows: [
				{
					keys: ['running shoes', 'https://www.example.com/product'],
					clicks: 12,
					impressions: 240,
					ctr: 0.05,
					position: 3.4,
				},
			],
		}),
	);

	try {
		const signal = new AbortController().signal;
		const rows = await fetchSearchConsoleQueries({
			accessToken: token,
			siteUrl,
			startDate: '2026-03-01',
			endDate: '2026-06-01',
			dimensions: ['query', 'page'],
			signal,
		});

		assertEquals(rows, [
			{
				query: 'running shoes',
				page: 'https://www.example.com/product',
				clicks: 12,
				impressions: 240,
				ctr: 0.05,
				position: 3.4,
			},
		]);
		assertEquals(calls.length, 1);
		assertEquals(
			String(calls[0].input),
			`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
		);
		assertEquals(calls[0].init?.method, 'POST');
		assertEquals(calls[0].init?.signal, signal);
		assertEquals(header(calls[0].init, 'authorization'), `Bearer ${token}`);
		assertEquals(header(calls[0].init, 'content-type'), 'application/json');
		assertEquals(JSON.parse(String(calls[0].init?.body)), {
			startDate: '2026-03-01',
			endDate: '2026-06-01',
			dimensions: ['query', 'page'],
			rowLimit: 250,
		});
	} finally {
		restore();
	}
});

Deno.test('fetchSearchConsoleQueries returns an empty array when rows are missing', async () => {
	const { calls, restore } = installFetch(
		jsonResponse({}),
	);

	try {
		const rows = await fetchSearchConsoleQueries({
			accessToken: 'test-access-token',
			siteUrl: 'sc-domain:example.com',
			startDate: '2026-03-01',
			endDate: '2026-06-01',
		});

		assertEquals(rows, []);
		assertEquals(JSON.parse(String(calls[0].init?.body)), {
			startDate: '2026-03-01',
			endDate: '2026-06-01',
			dimensions: ['query', 'page'],
			rowLimit: 250,
		});
	} finally {
		restore();
	}
});

Deno.test('Google API errors include status and sanitized response body preview', async () => {
	const token = 'token-that-must-not-leak';
	const { restore } = installFetch(
		jsonResponse({
			error: {
				code: 403,
				message: `Permission denied for ${token}`,
			},
		}, {
			status: 403,
			statusText: 'Forbidden',
		}),
	);

	try {
		const error = await assertRejects(
			() => listSearchConsoleSites({ accessToken: token }),
			Error,
		);

		assertStringIncludes(error.message, 'Google Search Console API error: 403 Forbidden');
		assertStringIncludes(error.message, 'Response body:');
		assertEquals(error.message.includes(token), false);
	} finally {
		restore();
	}
});

Deno.test('Google OAuth errors do not expose codes, tokens, or secrets', async () => {
	const { restore } = installFetch(
		jsonResponse({
			error: 'invalid_grant',
			error_description: 'Bad code google-code with secret client-secret and refresh 1//refresh-token',
		}, {
			status: 400,
			statusText: 'Bad Request',
		}),
	);

	try {
		const error = await assertRejects(
			() =>
				exchangeGoogleOAuthCode({
					clientId: 'client-id',
					clientSecret: 'client-secret',
					code: 'google-code',
					redirectUri: 'https://app.example.com/oauth/callback',
				}),
			Error,
		);

		assertStringIncludes(error.message, 'Google OAuth API error: 400 Bad Request');
		assertEquals(error.message.includes('google-code'), false);
		assertEquals(error.message.includes('client-secret'), false);
		assertEquals(error.message.includes('1//refresh-token'), false);
	} finally {
		restore();
	}
});

Deno.test('fetchSearchConsoleQueries supports Search Analytics options', async () => {
	const { calls, restore } = installFetch(
		jsonResponse({
			rows: [
				{
					keys: [
						'https://example.com/product',
						'trail shoes',
						'esp',
						'MOBILE',
						'2026-05-01',
						'2026-05-01T10:00:00-07:00',
						'AMP_BLUE_LINK',
					],
					clicks: 7,
					impressions: 90,
					ctr: 0.0777,
					position: 8.2,
				},
			],
		}),
	);

	try {
		const rows = await fetchSearchConsoleQueries({
			accessToken: 'provider-token',
			siteUrl: 'sc-domain:example.com',
			startDate: '2026-03-01',
			endDate: '2026-06-01',
			rowLimit: 1000,
			startRow: 25,
			dimensions: ['page', 'query', 'country', 'device', 'date', 'hour', 'searchAppearance'],
			type: 'web',
			aggregationType: 'byPage',
			dataState: 'all',
			dimensionFilterGroups: [
				{
					groupType: 'and',
					filters: [
						{
							dimension: 'query',
							operator: 'contains',
							expression: 'shoes',
						},
					],
				},
			],
		});

		assertEquals(rows, [
			{
				query: 'trail shoes',
				page: 'https://example.com/product',
				country: 'esp',
				device: 'MOBILE',
				date: '2026-05-01',
				hour: '2026-05-01T10:00:00-07:00',
				searchAppearance: 'AMP_BLUE_LINK',
				clicks: 7,
				impressions: 90,
				ctr: 0.0777,
				position: 8.2,
			},
		]);
		assertEquals(header(calls[0].init, 'authorization'), 'Bearer provider-token');
		assertEquals(JSON.parse(String(calls[0].init?.body)), {
			startDate: '2026-03-01',
			endDate: '2026-06-01',
			dimensions: ['page', 'query', 'country', 'device', 'date', 'hour', 'searchAppearance'],
			rowLimit: 1000,
			startRow: 25,
			type: 'web',
			aggregationType: 'byPage',
			dataState: 'all',
			dimensionFilterGroups: [
				{
					groupType: 'and',
					filters: [
						{
							dimension: 'query',
							operator: 'contains',
							expression: 'shoes',
						},
					],
				},
			],
		});
	} finally {
		restore();
	}
});
