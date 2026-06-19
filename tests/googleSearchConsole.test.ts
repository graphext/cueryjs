import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';

import { fetchSearchConsoleQueries, listSearchConsoleSites } from '../src/apis/googleSearchConsole/index.ts';

type FetchCall = {
	input: string | URL | Request;
	init?: RequestInit;
};

function installFetch(response: Response): { calls: Array<FetchCall>; restore: () => void } {
	const originalFetch = globalThis.fetch;
	const calls: Array<FetchCall> = [];

	globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
		calls.push({ input, init });
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

Deno.test('listSearchConsoleSites fetches and maps Search Console sites', async () => {
	const token = 'test-access-token';
	const { calls, restore } = installFetch(
		new Response(
			JSON.stringify({
				siteEntry: [
					{ siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' },
					{ siteUrl: 'sc-domain:example.org', permissionLevel: 'siteFullUser' },
				],
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			},
		),
	);

	try {
		const sites = await listSearchConsoleSites({ accessToken: token });

		assertEquals(sites, [
			{ siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' },
			{ siteUrl: 'sc-domain:example.org', permissionLevel: 'siteFullUser' },
		]);
		assertEquals(calls.length, 1);
		assertEquals(String(calls[0].input), 'https://www.googleapis.com/webmasters/v3/sites');
		assertEquals(calls[0].init?.method, 'GET');
		assertEquals(header(calls[0].init, 'authorization'), `Bearer ${token}`);
	} finally {
		restore();
	}
});

Deno.test('fetchSearchConsoleQueries posts encoded site URL and maps query rows', async () => {
	const token = 'test-access-token';
	const siteUrl = 'https://www.example.com/path/?a=b';
	const { calls, restore } = installFetch(
		new Response(
			JSON.stringify({
				rows: [
					{
						keys: ['running shoes'],
						clicks: 12,
						impressions: 240,
						ctr: 0.05,
						position: 3.4,
					},
				],
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			},
		),
	);

	try {
		const rows = await fetchSearchConsoleQueries({
			accessToken: token,
			siteUrl,
			startDate: '2026-03-01',
			endDate: '2026-06-01',
		});

		assertEquals(rows, [
			{
				query: 'running shoes',
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
		assertEquals(header(calls[0].init, 'authorization'), `Bearer ${token}`);
		assertEquals(header(calls[0].init, 'content-type'), 'application/json');
		assertEquals(JSON.parse(String(calls[0].init?.body)), {
			startDate: '2026-03-01',
			endDate: '2026-06-01',
			dimensions: ['query'],
			rowLimit: 250,
		});
	} finally {
		restore();
	}
});

Deno.test('fetchSearchConsoleQueries returns an empty array when rows are missing', async () => {
	const { restore } = installFetch(
		new Response(JSON.stringify({}), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		}),
	);

	try {
		const rows = await fetchSearchConsoleQueries({
			accessToken: 'test-access-token',
			siteUrl: 'sc-domain:example.com',
			startDate: '2026-03-01',
			endDate: '2026-06-01',
		});

		assertEquals(rows, []);
	} finally {
		restore();
	}
});

Deno.test('Google API errors include status and sanitized response body preview', async () => {
	const token = 'token-that-must-not-leak';
	const { restore } = installFetch(
		new Response(
			JSON.stringify({
				error: {
					code: 403,
					message: `Permission denied for ${token}`,
				},
			}),
			{
				status: 403,
				statusText: 'Forbidden',
				headers: { 'Content-Type': 'application/json' },
			},
		),
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

Deno.test('fetchSearchConsoleQueries supports async token providers and Search Analytics options', async () => {
	const { calls, restore } = installFetch(
		new Response(
			JSON.stringify({
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
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			},
		),
	);

	try {
		const rows = await fetchSearchConsoleQueries({
			getAccessToken: () => Promise.resolve('provider-token'),
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
