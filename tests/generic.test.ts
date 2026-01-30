import { assertEquals, assertExists } from '@std/assert';

import { auto, autoBatch, generic, genericBatch, generateSchema } from '../src/tools/generic.ts';

const SKIP_OPENAI = !Deno.env.get('RUN_OPENAI_TESTS');

// =============================================================================
// Tests that require OpenAI
// =============================================================================

// TODO: Fix z.record() incompatibility with OpenAI strict mode
Deno.test({
	name: 'generateSchema - generates schema from instructions',
	ignore: true,
	async fn() {
		const result = await generateSchema({
			instructions: 'Create a schema for extracting a person\'s name (string) and age (integer).'
		});

		console.log('Generated schema:', JSON.stringify(result.jsonSchema, null, 2));
		console.log('Reasoning:', result.reasoning);

		assertExists(result.jsonSchema);
		assertExists(result.reasoning);
		assertEquals(typeof result.jsonSchema, 'object');
		assertEquals(typeof result.reasoning, 'string');

		// Schema should have properties
		assertExists(result.jsonSchema.properties);
	}
});

Deno.test({
	name: 'generic - extracts data using provided schema',
	ignore: SKIP_OPENAI,
	async fn() {
		const schema = {
			type: 'object',
			properties: {
				name: { type: 'string', description: 'The person\'s name' },
				age: { type: 'integer', description: 'The person\'s age' }
			},
			required: ['name', 'age']
		};

		const record = {
			bio: 'John Smith is a 32-year-old software engineer from San Francisco.'
		};

		const response = await generic<{ name: string; age: number }>({
			record,
			instructions: 'Extract the name and age from the bio.',
			schema
		});

		console.log('Extracted:', response.parsed);

		assertExists(response.parsed);
		assertEquals(response.parsed!.name.toLowerCase(), 'john smith');
		assertEquals(response.parsed!.age, 32);
	}
});

Deno.test({
	name: 'genericBatch - extracts data from multiple records',
	ignore: SKIP_OPENAI,
	async fn() {
		const schema = {
			type: 'object',
			properties: {
				emails: {
					type: 'array',
					items: { type: 'string' },
					description: 'Email addresses found in the text'
				}
			},
			required: ['emails']
		};

		const records = [
			{ text: 'Contact us at hello@example.com or support@test.org' },
			{ text: 'No email here, just text.' },
			{ text: 'Reach out to john.doe@company.io' }
		];

		const response = await genericBatch<{ emails: string[] }>({
			records,
			instructions: 'Extract all email addresses from the text.',
			schema,
			maxConcurrency: 3
		});
		const results = response.toArray();

		console.log('Extracted emails:', results);

		assertEquals(results.length, 3);

		// First record should have 2 emails
		assertExists(results[0]);
		assertEquals(results[0]!.emails.length, 2);

		// Second record should have no emails
		assertExists(results[1]);
		assertEquals(results[1]!.emails.length, 0);

		// Third record should have 1 email
		assertExists(results[2]);
		assertEquals(results[2]!.emails.length, 1);
	}
});

// TODO: Fix z.record() incompatibility with OpenAI strict mode
Deno.test({
	name: 'auto - generates schema and extracts data automatically',
	ignore: true,
	async fn() {
		const record = {
			text: 'The iPhone 15 Pro costs $999 and has a 6.1-inch display.'
		};

		const result = await auto<{ product: string; price: number }>({
			record,
			instructions: 'Extract the product name and price from the text.'
		});

		console.log('Auto result:', result);
		console.log('Generated schema:', JSON.stringify(result.schema, null, 2));

		assertExists(result.data);
		assertExists(result.schema);
		assertExists(result.schemaReasoning);

		// Check that the schema was generated with appropriate fields
		assertEquals(typeof result.schema, 'object');
		assertExists(result.schema.properties);
	}
});

// TODO: Fix z.record() incompatibility with OpenAI strict mode
Deno.test({
	name: 'autoBatch - generates schema once and processes multiple records',
	ignore: true,
	async fn() {
		const records = [
			{ bio: 'Alice Johnson, 28, works as a designer in New York.' },
			{ bio: 'Bob Williams is a 45-year-old teacher from Chicago.' },
			{ bio: 'Carol Davis, age 33, is a doctor based in Boston.' }
		];

		const result = await autoBatch<{ name: string; age: number; occupation: string; city: string }>({
			records,
			instructions: 'Extract the person\'s name, age, occupation, and city from their bio.',
			maxConcurrency: 3
		});

		const data = result.data.toArray();
		console.log('AutoBatch data:', data);
		console.log('Generated schema:', JSON.stringify(result.schema, null, 2));
		console.log('Reasoning:', result.schemaReasoning);

		// Check schema was generated
		assertExists(result.schema);
		assertExists(result.schemaReasoning);
		assertEquals(typeof result.schema, 'object');

		// Check all records were processed
		assertEquals(data.length, 3);

		// Verify extracted data
		assertExists(data[0]);
		assertEquals(data[0]!.name.toLowerCase().includes('alice'), true);
		assertEquals(data[0]!.age, 28);

		assertExists(data[1]);
		assertEquals(data[1]!.name.toLowerCase().includes('bob'), true);
		assertEquals(data[1]!.age, 45);

		assertExists(data[2]);
		assertEquals(data[2]!.name.toLowerCase().includes('carol'), true);
		assertEquals(data[2]!.age, 33);
	}
});

// TODO: Fix z.record() incompatibility with OpenAI strict mode
Deno.test({
	name: 'autoBatch - with explicit schema instructions',
	ignore: true,
	async fn() {
		const records = [
			{ content: 'Visit https://example.com and https://test.org for more info.' },
			{ content: 'Check out http://website.io' }
		];

		const result = await autoBatch<{ urls: string[] }>({
			records,
			instructions: 'Extract all URLs from the content.',
			schemaOrInstructions: 'Create a schema with a urls field that is an array of strings for URLs.',
			maxConcurrency: 2
		});

		const data = result.data.toArray();
		console.log('URLs extracted:', data);

		assertEquals(data.length, 2);

		assertExists(data[0]);
		assertEquals(data[0]!.urls.length >= 2, true);

		assertExists(data[1]);
		assertEquals(data[1]!.urls.length >= 1, true);
	}
});

Deno.test({
	name: 'autoBatch - with pre-defined schema object',
	ignore: SKIP_OPENAI,
	async fn() {
		const schema = {
			type: 'object',
			properties: {
				sentiment: {
					type: 'string',
					enum: ['positive', 'negative', 'neutral'],
					description: 'The overall sentiment of the text'
				}
			},
			required: ['sentiment']
		};

		const records = [
			{ review: 'This product is amazing! Best purchase ever.' },
			{ review: 'Terrible quality, broke after one day.' },
			{ review: 'It works as expected, nothing special.' }
		];

		const result = await autoBatch<{ sentiment: 'positive' | 'negative' | 'neutral' }>({
			records,
			instructions: 'Determine the sentiment of the review.',
			schemaOrInstructions: schema,
			maxConcurrency: 3
		});

		const data = result.data.toArray();
		console.log('Sentiments:', data);

		assertEquals(data.length, 3);
		assertEquals(result.schemaReasoning, 'Schema was provided directly');

		assertEquals(data[0]!.sentiment, 'positive');
		assertEquals(data[1]!.sentiment, 'negative');
		assertEquals(data[2]!.sentiment, 'neutral');
	}
});

// =============================================================================
// Tests that don't require OpenAI (null/empty handling)
// =============================================================================

Deno.test('generic - returns null for null record', async () => {
	const schema = { type: 'object', properties: { name: { type: 'string' } } };

	const response = await generic({
		record: null,
		instructions: 'Extract name',
		schema
	});

	assertEquals(response.parsed, null);
});

Deno.test('generic - returns null for empty record', async () => {
	const schema = { type: 'object', properties: { name: { type: 'string' } } };

	const response = await generic({
		record: {},
		instructions: 'Extract name',
		schema
	});

	assertEquals(response.parsed, null);
});

Deno.test('genericBatch - handles null records in batch', async () => {
	const schema = { type: 'object', properties: { name: { type: 'string' } } };

	const records = [null, {}, null];

	const response = await genericBatch({
		records,
		instructions: 'Extract name',
		schema
	});
	const results = response.toArray();

	assertEquals(results.length, 3);
	assertEquals(results[0], null);
	assertEquals(results[1], null);
	assertEquals(results[2], null);
});
