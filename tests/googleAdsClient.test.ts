import { assertEquals, assertStringIncludes } from '@std/assert';

import { buildGoogleAdsErrorMessage, GOOGLE_ADS_API_VERSION } from '../src/apis/googleAds/client.ts';

Deno.test('Google Ads client targets a supported API version', () => {
	assertEquals(GOOGLE_ADS_API_VERSION, 'v25');
});

Deno.test('buildGoogleAdsErrorMessage includes actionable Google Ads diagnostics', () => {
	const message = buildGoogleAdsErrorMessage({
		apiMethod: 'generateKeywordIdeas',
		params: {
			keywordSeed: { keywords: ['tarifas luz', 'gas natural hogar'] },
			language: 'languageConstants/1003',
			geoTargetConstants: ['geoTargetConstants/2724'],
			developerToken: 'must-not-be-logged',
		},
		status: 400,
		statusText: 'Bad Request',
		requestId: 'google-request-123',
		responseBody: JSON.stringify({
			error: {
				code: 400,
				status: 'INVALID_ARGUMENT',
				message: 'Request contains an invalid argument.',
			},
		}),
	});

	assertStringIncludes(message, 'HTTP 400 Bad Request');
	assertStringIncludes(message, 'request ID: google-request-123');
	assertStringIncludes(message, 'generateKeywordIdeas');
	assertStringIncludes(message, 'gas natural hogar');
	assertStringIncludes(message, 'languageConstants/1003');
	assertStringIncludes(message, 'geoTargetConstants/2724');
	assertStringIncludes(message, 'INVALID_ARGUMENT');
	assertEquals(message.includes('must-not-be-logged'), false);
});

Deno.test('buildGoogleAdsErrorMessage handles text responses and missing request IDs', () => {
	const message = buildGoogleAdsErrorMessage({
		apiMethod: 'generateKeywordHistoricalMetrics',
		params: { keywords: ['electricidad verde'] },
		status: 503,
		statusText: 'Service Unavailable',
		responseBody: 'upstream temporarily unavailable',
	});

	assertStringIncludes(message, 'HTTP 503 Service Unavailable');
	assertStringIncludes(message, 'generateKeywordHistoricalMetrics');
	assertStringIncludes(message, 'electricidad verde');
	assertStringIncludes(message, 'upstream temporarily unavailable');
	assertEquals(message.includes('request ID:'), false);
});
