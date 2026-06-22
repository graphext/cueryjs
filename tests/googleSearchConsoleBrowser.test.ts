import { assertEquals } from '@std/assert';

import {
	fetchSearchConsoleQueries,
	GOOGLE_SEARCH_CONSOLE_QUERY_PAGE_DIMENSIONS,
	listSearchConsoleSites,
} from '../browser.ts';

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

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		headers: { 'Content-Type': 'application/json' },
	});
}

Deno.test('browser entry exposes Google Search Console constants without server entry imports', () => {
	assertEquals(GOOGLE_SEARCH_CONSOLE_QUERY_PAGE_DIMENSIONS, ['query', 'page']);
});

Deno.test('browser entry lists Search Console sites', async () => {
	const { calls, restore } = installFetch(jsonResponse({
		siteEntry: [{ siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' }],
	}));

	try {
		const sites = await listSearchConsoleSites({ accessToken: 'access-token' });

		assertEquals(sites, [{ siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' }]);
		assertEquals(String(calls[0].input), 'https://www.googleapis.com/webmasters/v3/sites');
		assertEquals(calls[0].init?.signal, undefined);
	} finally {
		restore();
	}
});

Deno.test('browser entry fetches Search Console queries', async () => {
	const { calls, restore } = installFetch(jsonResponse({
		rows: [{
			keys: ['running shoes', 'https://example.com/running-shoes'],
			clicks: 12,
			impressions: 240,
			ctr: 0.05,
			position: 3.4,
		}],
	}));

	try {
		const rows = await fetchSearchConsoleQueries({
			accessToken: 'access-token',
			siteUrl: 'sc-domain:example.com',
			startDate: '2026-03-01',
			endDate: '2026-06-01',
			dimensions: ['query', 'page'],
		});

		assertEquals(rows, [{
			query: 'running shoes',
			page: 'https://example.com/running-shoes',
			clicks: 12,
			impressions: 240,
			ctr: 0.05,
			position: 3.4,
		}]);
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
