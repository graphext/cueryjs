import { assertEquals, assertRejects } from '@std/assert';

import { generatePersonas } from '../src/personas.ts';

Deno.test('personas - successful OpenAI call', async () => {
	const result = await generatePersonas({
		sector: 'technology',
		market: 'B2B',
		brand: 'holded',
		language: 'english'
	});

	// Check that we got a response with personas
	assertEquals(typeof result, 'object');
	assertEquals(Array.isArray(result.personas), true);
	assertEquals(result.personas.length >= 3, true);

	// Check structure of first persona
	assertEquals(typeof result.personas[0].name, 'string');
	assertEquals(typeof result.personas[0].description, 'string');
	assertEquals(result.personas[0].name.length > 0, true);
	assertEquals(result.personas[0].description.length > 0, true);
});

Deno.test('personas - fails with invalid API key', async () => {
	// Save original API key
	const originalKey = Deno.env.get('OPENAI_API_KEY');

	try {
		// Set invalid API key
		Deno.env.set('OPENAI_API_KEY', 'invalid-key');

		// Should throw an error
		await assertRejects(
			async () => {
				await generatePersonas({
					sector: 'technology',
					market: 'B2B',
					brand: 'holded',
					language: 'english'
				});
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
