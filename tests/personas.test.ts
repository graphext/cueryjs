import { assertEquals, assertRejects, assertThrows } from '@std/assert';

import { PersonaGenerator } from '../src/tools/personas.ts';

const SKIP_OPENAI = !Deno.env.get('RUN_OPENAI_TESTS');

Deno.test({
	name: 'PersonaGenerator.invoke - successful OpenAI call',
	ignore: SKIP_OPENAI,
	async fn() {
		const generator = new PersonaGenerator(
			{
				sector: 'technology',
				market: 'B2B',
				brand: 'holded',
				language: 'english'
			},
			{ model: 'gpt-4.1' }
		);

		const response = await generator.invoke(null);

		// Check that we got a response with personas
		assertEquals(response.parsed != null, true);
		assertEquals(Array.isArray(response.parsed!.personas), true);
		assertEquals(response.parsed!.personas.length >= 3, true);

		// Check structure of first persona
		assertEquals(typeof response.parsed!.personas[0].name, 'string');
		assertEquals(typeof response.parsed!.personas[0].description, 'string');
		assertEquals(response.parsed!.personas[0].name.length > 0, true);
		assertEquals(response.parsed!.personas[0].description.length > 0, true);
	}
});

Deno.test({
	name: 'PersonaGenerator - throws without brand or brandDomain',
	fn() {
		assertThrows(
			() => {
				new PersonaGenerator(
					{
						sector: 'technology',
						market: 'B2B'
						// Missing brand and brandDomain
					},
					{ model: 'gpt-4.1' }
				);
			},
			Error,
			'Either brand or brandDomain must be provided'
		);
	}
});

Deno.test({
	name: 'PersonaGenerator.invoke - fails with invalid API key',
	ignore: SKIP_OPENAI,
	async fn() {
		// Save original API key
		const originalKey = Deno.env.get('OPENAI_API_KEY');

		try {
			// Set invalid API key
			Deno.env.set('OPENAI_API_KEY', 'invalid-key');

			const generator = new PersonaGenerator(
				{
					sector: 'technology',
					market: 'B2B',
					brand: 'holded',
					language: 'english'
				},
				{ model: 'gpt-4.1' }
			);

			// Should return null parsed or throw an error
			const response = await generator.invoke(null);
			// With onError: 'return' in Tool base class, it returns null on error
			assertEquals(response.parsed, null);
			assertEquals(response.error != null, true);
		} finally {
			// Restore original API key
			if (originalKey) {
				Deno.env.set('OPENAI_API_KEY', originalKey);
			}
		}
	}
});

Deno.test('PersonaGenerator.batch - throws error (not supported)', () => {
	const generator = new PersonaGenerator(
		{
			sector: 'technology',
			market: 'B2B',
			brand: 'holded'
		},
		{ model: 'gpt-4.1' }
	);

	assertThrows(
		() => generator.batch(),
		Error,
		'PersonaGenerator.batch() is not supported'
	);
});
