import { assertEquals, assertExists } from '@std/assert';

import { SentimentExtractor } from '../src/tools/sentiment.ts';

const SKIP_OPENAI = !Deno.env.get('RUN_OPENAI_TESTS');

// =============================================================================
// Tests that require OpenAI
// =============================================================================

Deno.test({
	name: 'SentimentExtractor.invoke - extracts sentiments with quotes',
	ignore: SKIP_OPENAI,
	async fn() {
		const text = 'The room service at the Grand Hotel was absolutely terrible and the staff were rude, but the view from our room was breathtaking.';

		const extractor = new SentimentExtractor({}, { model: 'gpt-4.1-mini' });
		const response = await extractor.invoke(text);

		assertExists(response.parsed);
		assertEquals(Array.isArray(response.parsed), true);
		assertEquals(response.parsed!.length > 0, true);

		// Check that each sentiment has all required fields
		for (const sentiment of response.parsed!) {
			assertExists(sentiment.aspect);
			assertExists(sentiment.sentiment);
			assertExists(sentiment.reason);
			assertExists(sentiment.quote);
			// context can be string or null
			assertEquals('context' in sentiment, true);

			assertEquals(typeof sentiment.aspect, 'string');
			assertEquals(['positive', 'negative'].includes(sentiment.sentiment), true);
			assertEquals(typeof sentiment.reason, 'string');
			assertEquals(typeof sentiment.quote, 'string');
			assertEquals(sentiment.context === null || typeof sentiment.context === 'string', true);

			// Verify that the quote is actually a substring of the input
			assertEquals(text.includes(sentiment.quote), true,
				`Quote "${sentiment.quote}" should be a substring of the input text`);
		}
	}
});

Deno.test({
	name: 'SentimentExtractor.invoke - validates quotes are substrings',
	ignore: SKIP_OPENAI,
	async fn() {
		const text = 'This product is amazing! I love it.';

		const extractor = new SentimentExtractor({}, { model: 'gpt-4.1-mini' });
		const response = await extractor.invoke(text);

		assertExists(response.parsed);

		// All quotes should be substrings of the original text
		for (const sentiment of response.parsed!) {
			assertEquals(
				text.includes(sentiment.quote),
				true,
				`Quote "${sentiment.quote}" must be a substring of input text`
			);
		}
	}
});

Deno.test({
	name: 'SentimentExtractor.batch - processes multiple texts with quote validation',
	ignore: SKIP_OPENAI,
	async fn() {
		const texts = [
			'The service was excellent and the food was delicious.',
			'Terrible experience, would not recommend.',
			'The location is perfect but the rooms are small.'
		];

		const extractor = new SentimentExtractor({}, { model: 'gpt-4.1-mini' });
		const results = await extractor.batch(texts);
		const resultsArray = results.toArray();

		assertEquals(resultsArray.length, 3);

		// Check each result
		for (let i = 0; i < resultsArray.length; i++) {
			const result = resultsArray[i];
			const originalText = texts[i];

			assertExists(result);
			assertEquals(Array.isArray(result), true);

			// Validate quotes for each sentiment
			for (const sentiment of result!) {
				assertExists(sentiment.quote);
				assertEquals(
					originalText.includes(sentiment.quote),
					true,
					`Quote "${sentiment.quote}" should be a substring of "${originalText}"`
				);
			}
		}
	}
});

Deno.test({
	name: 'SentimentExtractor.invoke - handles brand context',
	ignore: SKIP_OPENAI,
	async fn() {
		const text = 'I love the teaching method, it makes learning so easy!';

		const brand = {
			name: 'EduCorp Inc.',
			shortName: 'EduCorp',
			description: 'An online education platform',
			domain: 'educorp.com',
			sectors: ['Education'],
			markets: ['US'],
			portfolio: [
				{ name: 'Online Courses', category: 'Education' }
			],
			marketPosition: 'leader' as const,
			favicon: null,
			language: 'en',
			country: 'US',
			sector: 'Education',
			briefing: null
		};

		const extractor = new SentimentExtractor({ brand }, { model: 'gpt-4.1-mini' });
		const response = await extractor.invoke(text);

		assertExists(response.parsed);
		assertEquals(Array.isArray(response.parsed), true);

		// Check that quotes are still valid substrings despite brand context
		for (const sentiment of response.parsed!) {
			assertExists(sentiment.quote);
			assertEquals(
				text.includes(sentiment.quote),
				true,
				`Quote "${sentiment.quote}" must remain a substring of the original text`
			);
			// When brand context is provided, context may be null for non-brand aspects,
			// but if set it should match the brand short name.
			assertEquals(
				sentiment.context === null || sentiment.context === 'EduCorp',
				true,
				'Sentiment context must be either null or the brand short name when brand context is provided'
			);
		}

		// At least one sentiment should be explicitly associated with the brand context
		const hasBrandContext = response.parsed!.some(
			(s) => s.context === 'EduCorp'
		);
		assertEquals(
			hasBrandContext,
			true,
			'At least one sentiment should have context set to the brand short name when brand context is provided'
		);
	}
});

Deno.test({
	name: 'SentimentExtractor.invoke - handles brand context with empty portfolio',
	ignore: SKIP_OPENAI,
	async fn() {
		const text = 'I love the teaching method, it makes learning so easy!';

		const brand = {
			name: 'EduCorp Inc.',
			shortName: 'EduCorp',
			description: 'An online education platform',
			domain: 'educorp.com',
			sectors: ['Education'],
			markets: ['US'],
			portfolio: [],  // Empty portfolio
			marketPosition: 'leader' as const,
			favicon: null,
			language: 'en',
			country: 'US',
			sector: 'Education',
			briefing: null
		};

		const extractor = new SentimentExtractor({ brand }, { model: 'gpt-4.1-mini' });
		const response = await extractor.invoke(text);

		assertExists(response.parsed);
		assertEquals(Array.isArray(response.parsed), true);

		// Check that quotes are still valid substrings even with empty portfolio
		for (const sentiment of response.parsed!) {
			assertExists(sentiment.quote);
			assertEquals(
				text.includes(sentiment.quote),
				true,
				`Quote "${sentiment.quote}" must remain a substring of the original text`
			);
			// When brand context is provided, context should be set to the brand name
			assertEquals(sentiment.context, 'EduCorp');
		}
	}
});

// =============================================================================
// Tests that don't require OpenAI (null/empty handling)
// =============================================================================

Deno.test('SentimentExtractor.invoke - returns null for null input', async () => {
	const extractor = new SentimentExtractor({}, { model: 'gpt-4.1-mini' });
	const response = await extractor.invoke(null);

	assertEquals(response.parsed, null);
});

Deno.test('SentimentExtractor.invoke - returns null for empty string', async () => {
	const extractor = new SentimentExtractor({}, { model: 'gpt-4.1-mini' });
	const response = await extractor.invoke('');

	assertEquals(response.parsed, null);
});

Deno.test('SentimentExtractor.batch - handles null/empty inputs in batch', async () => {
	const texts = [null, '', '   ', null];

	const extractor = new SentimentExtractor({}, { model: 'gpt-4.1-mini' });
	const results = await extractor.batch(texts);
	const resultsArray = results.toArray();

	assertEquals(resultsArray.length, 4);
	assertEquals(resultsArray[0], null);
	assertEquals(resultsArray[1], null);
	assertEquals(resultsArray[2], null);
	assertEquals(resultsArray[3], null);
});
