import { assertEquals } from '@std/assert';

import { parseAIM, parseAIO } from '../src/apis/hasdata/helpers.ts';

Deno.test('parseAIO preserves reference snippet separately from reference title', () => {
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
	assertEquals(result.answerMarkdown, 'Answer block [1]');
	assertEquals(result.sources, [
		{
			title: 'Example Title',
			snippet: 'Reference snippet',
			url: 'https://example.com/article',
			domain: 'example.com',
			cited: true,
			positions: [1],
		},
	]);
});

Deno.test('parseAIO does not use source as a fallback title', () => {
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
				source: 'Example Publisher',
				url: 'https://example.com/article',
			},
		],
	});

	assertEquals(result.sources, [
		{
			title: '',
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
	assertEquals(result.answerMarkdown, 'First block [1]\n\nSecond block [2]');
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

Deno.test('parseAIO returns formatted markdown separately from minimal answer', () => {
	const result = parseAIO({
		textBlocks: [
			{
				type: 'list',
				list: [
					{ title: 'First', snippet: 'Alpha' },
					{ title: 'Second', snippet: 'Beta' },
				],
				referenceIndexes: [0],
			},
			{
				type: 'code',
				language: 'ts',
				snippet: 'const x = 1;',
			},
		],
		references: [
			{
				index: 0,
				title: 'List Source',
				url: 'https://list.test/source',
			},
		],
	});

	assertEquals(result.answer, 'First Alpha\nSecond Beta [1]\n\nconst x = 1;');
	assertEquals(result.answerMarkdown, '- First Alpha\n- Second Beta [1]\n\n[Code: ts]\nconst x = 1;');
});
