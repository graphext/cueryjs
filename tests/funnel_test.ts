import { assertEquals, assertRejects } from '@std/assert';

import { customizeFunnel, FunnelSchema } from '../src/funnel.ts';

Deno.test('customizeFunnel - successful OpenAI call', async () => {
	const result = await customizeFunnel(
		'software development',
		'English',
		'United States',
		'gpt-4.1'
	);

	// Check that we got a valid funnel response
	assertEquals(typeof result, 'object');
	assertEquals(Array.isArray(result.stages), true);
	assertEquals(result.stages.length > 0, true);

	// Check structure of first stage
	const firstStage = result.stages[0];
	assertEquals(typeof firstStage.stage, 'string');
	assertEquals(typeof firstStage.goal, 'string');
	assertEquals(Array.isArray(firstStage.categories), true);
	assertEquals(firstStage.categories.length > 0, true);

	// Check structure of first category
	const firstCategory = firstStage.categories[0];
	assertEquals(typeof firstCategory.name, 'string');
	assertEquals(typeof firstCategory.description, 'string');
	assertEquals(typeof firstCategory.intent, 'string');
	assertEquals(Array.isArray(firstCategory.keywordPatterns), true);
	assertEquals(Array.isArray(firstCategory.keywordSeeds), true);
	assertEquals(firstCategory.name.length > 0, true);
	assertEquals(firstCategory.keywordPatterns.length > 0, true);
	assertEquals(firstCategory.keywordSeeds.length > 0, true);

	// Validate against schema
	const validated = FunnelSchema.parse(result);
	assertEquals(validated, result);
});

Deno.test('customizeFunnel - customizes for specific sector', async () => {
	const result = await customizeFunnel(
		'healthcare',
		'English',
		'global',
		'gpt-4.1'
	);

	// Check that the result contains sector-specific content
	const allContent = JSON.stringify(result).toLowerCase();
	assertEquals(allContent.includes('health') || allContent.includes('medical') || allContent.includes('patient'), true);
});

Deno.test('customizeFunnel - handles different languages', async () => {
	const result = await customizeFunnel(
		'technology',
		'Spanish',
		'Spain',
		'gpt-4.1'
	);

	// Check that stages and categories exist
	assertEquals(result.stages.length > 0, true);
	assertEquals(result.stages[0].categories.length > 0, true);
});

Deno.test('customizeFunnel - fails with invalid API key', async () => {
	// Save original API key
	const originalKey = Deno.env.get('OPENAI_API_KEY');

	try {
		// Set invalid API key
		Deno.env.set('OPENAI_API_KEY', 'invalid-key');

		// Should throw an error
		await assertRejects(
			async () => {
				await customizeFunnel('technology', 'English', 'global', 'gpt-4.1');
			},
			Error
		);
	} finally {
		// Restore original API key
		if (originalKey) {
			Deno.env.set('OPENAI_API_KEY', originalKey);
		}
	}
});

Deno.test('customizeFunnel - preserves funnel stages', async () => {
	const result = await customizeFunnel(
		'e-commerce',
		'English',
		'global',
		'gpt-4.1'
	);

	// Check that we have multiple stages (generic funnel has 5)
	assertEquals(result.stages.length >= 3, true);

	// Check that stages have expected properties
	for (const stage of result.stages) {
		assertEquals(typeof stage.stage, 'string');
		assertEquals(typeof stage.goal, 'string');
		assertEquals(stage.stage.length > 0, true);
		assertEquals(stage.categories.length > 0, true);
	}
});
