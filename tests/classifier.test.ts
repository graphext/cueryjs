import { assertEquals, assertExists } from '@std/assert';

import { classify, classifyBatch, extractLabels } from '../src/tools/classifier.ts';

const SKIP_OPENAI = !Deno.env.get('RUN_OPENAI_TESTS');

// =============================================================================
// Tests that require OpenAI
// =============================================================================

Deno.test({
	name: 'classify - classifies tech content correctly',
	ignore: SKIP_OPENAI,
	async fn() {
		const labels = {
			'Technology': 'Content about software, hardware, AI, and digital innovation',
			'Marketing': 'Content about advertising, branding, and promotion strategies',
			'Finance': 'Content about money, investments, and economic topics'
		};

		const record = {
			title: 'New AI Model Released',
			description: 'OpenAI announces GPT-5 with improved reasoning capabilities'
		};

		const result = await classify(record, labels);

		assertExists(result);
		assertEquals(result, 'Technology');
	}
});

Deno.test({
	name: 'classifyBatch - classifies multiple records correctly',
	ignore: SKIP_OPENAI,
	async fn() {
		const labels = {
			'Technology': 'Content about software, hardware, AI, and digital innovation',
			'Sports': 'Content about athletic activities, competitions, and fitness',
			'Food': 'Content about cooking, recipes, and culinary topics'
		};

		const records = [
			{ text: 'The new JavaScript framework improves performance by 50%' },
			{ text: 'The championship game went into overtime' },
			{ text: 'This pasta recipe uses fresh tomatoes and basil' }
		];

		const results = await classifyBatch(records, labels);

		assertEquals(results.length, 3);
		assertEquals(results[0], 'Technology');
		assertEquals(results[1], 'Sports');
		assertEquals(results[2], 'Food');
	}
});

Deno.test({
	name: 'extractLabels - extracts labels from product records',
	ignore: SKIP_OPENAI,
	async fn() {
		const records = [
			{ name: 'iPhone 15', description: 'Latest smartphone with advanced camera' },
			{ name: 'MacBook Pro', description: 'High-performance laptop for professionals' },
			{ name: 'Yoga Mat', description: 'Premium fitness equipment for home workouts' },
			{ name: 'Protein Powder', description: 'Nutrition supplement for muscle building' },
			{ name: 'Running Shoes', description: 'Athletic footwear for marathon training' },
			{ name: 'Business Strategy Book', description: 'Guide to corporate planning and growth' },
			{ name: 'Python Course', description: 'Learn programming and data science' },
			{ name: 'Wireless Earbuds', description: 'Bluetooth audio device with noise cancellation' }
		];

		const result = await extractLabels({
			records,
			nLabels: 4,
			maxSamples: 50
		});

		console.log('Extracted labels:', result);

		assertExists(result);
		assertEquals(typeof result, 'object');

		const labelNames = Object.keys(result);
		assertEquals(labelNames.length > 0, true);
		assertEquals(labelNames.length <= 4, true);

		for (const [name, description] of Object.entries(result)) {
			assertEquals(typeof name, 'string');
			assertEquals(name.length > 0, true);
			assertEquals(typeof description, 'string');
			assertEquals(description.length > 0, true);
		}
	}
});

Deno.test({
	name: 'extractLabels + classifyBatch - end-to-end workflow',
	ignore: SKIP_OPENAI,
	async fn() {
		const records = [
			{ title: 'New React Framework', content: 'A revolutionary approach to building UIs' },
			{ title: 'Healthy Smoothie Recipe', content: 'Blend fruits and vegetables for breakfast' },
			{ title: 'Python Tutorial', content: 'Learn programming basics with examples' },
			{ title: 'Vegan Meal Prep', content: 'Plant-based cooking for the week' },
			{ title: 'TypeScript Best Practices', content: 'Type safety patterns for large apps' },
			{ title: 'Chocolate Cake Recipe', content: 'Bake a delicious dessert from scratch' }
		];

		// Step 1: Extract labels
		const labels = await extractLabels({
			records,
			nLabels: 2,
			instructions: 'Focus on the main content categories'
		});

		console.log('Extracted labels:', labels);

		assertExists(labels);
		const labelNames = Object.keys(labels);
		assertEquals(labelNames.length > 0, true);

		// Step 2: Classify using extracted labels
		const classifications = await classifyBatch(records, labels);

		console.log('Classifications:', classifications);

		assertEquals(classifications.length, records.length);

		for (const classification of classifications) {
			assertExists(classification);
			assertEquals(labelNames.includes(classification!), true);
		}
	}
});

// =============================================================================
// Tests that don't require OpenAI (null/empty handling)
// =============================================================================

Deno.test('classify - returns null for null record', async () => {
	const labels = {
		'Technology': 'Tech content',
		'Sports': 'Sports content'
	};

	const result = await classify(null, labels);

	assertEquals(result, null);
});

Deno.test('classify - returns null for empty record', async () => {
	const labels = {
		'Technology': 'Tech content',
		'Sports': 'Sports content'
	};

	const result = await classify({}, labels);

	assertEquals(result, null);
});

Deno.test('classifyBatch - handles null records in batch', async () => {
	const labels = {
		'Technology': 'Tech content',
		'Sports': 'Sports content'
	};

	const records = [null, {}, null];

	const results = await classifyBatch(records, labels);

	assertEquals(results.length, 3);
	assertEquals(results[0], null);
	assertEquals(results[1], null);
	assertEquals(results[2], null);
});

Deno.test('extractLabels - returns empty object for empty records', async () => {
	const result = await extractLabels({ records: [] });

	assertEquals(result, {});
});

Deno.test('extractLabels - returns empty object for null-ish records', async () => {
	// @ts-expect-error Testing null handling
	const result = await extractLabels({ records: null });

	assertEquals(result, {});
});
