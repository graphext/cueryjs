import { assertEquals } from '@std/assert';

import { parseAIM, parseAIO } from '../src/apis/hasdata/helpers.ts';

Deno.test('parseAIO preserves reference snippet separately from source title', () => {
	const result = parseAIO({
		textBlocks: [
			{
				type: 'paragraph',
				snippet: 'Answer block',
				referenceIndexes: [0],
			},
		],
		references: [
			{
				index: 0,
				title: 'Example Title',
				source: 'Example Publisher',
				url: 'https://example.com/article',
				snippet: 'Reference snippet',
			},
		],
	});

	assertEquals(result.answer, 'Answer block [1]');
	assertEquals(result.sources, [
		{
			title: 'Example Title - Example Publisher',
			snippet: 'Reference snippet',
			url: 'https://example.com/article',
			domain: 'example.com',
			cited: true,
			positions: [1],
		},
	]);
});

Deno.test('parseAIM stores citation positions using displayed citation numbers', () => {
	const result = parseAIM({
		textBlocks: [
			{
				type: 'paragraph',
				snippet: 'First block',
				referenceIndexes: [0],
			},
			{
				type: 'paragraph',
				snippet: 'Second block',
				referenceIndexes: [1],
			},
		],
		references: [
			{
				index: 0,
				title: 'First Source',
				url: 'https://first.test/page',
			},
			{
				index: 1,
				title: 'Second Source',
				url: 'https://second.test/page',
			},
		],
	});

	assertEquals(result.answer, 'First block [1]\n\nSecond block [2]');
	assertEquals(result.sources, [
		{
			title: 'First Source',
			url: 'https://first.test/page',
			domain: 'first.test',
			cited: true,
			positions: [1],
		},
		{
			title: 'Second Source',
			url: 'https://second.test/page',
			domain: 'second.test',
			cited: true,
			positions: [2],
		},
	]);
});
