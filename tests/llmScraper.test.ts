import { assertEquals, assertExists } from '@std/assert';

import { brightdataProvider } from '../src/apis/brightdata/llmScraper/brightdata.ts';
import { oxylabsProvider } from '../src/apis/brightdata/llmScraper/oxy.ts';

Deno.test('brightdataProvider.transformResponse prefers plain text and maps positions from links_attached', () => {
	const raw = [{
		prompt: 'prompt',
		answer_text: 'Plain answer [1] [2] [3]',
		answer_text_markdown: '**Markdown answer** \\[1\\]',
		links_attached: [
			{ url: 'https://links.test/a', text: 'Link A', position: 1 },
			{ url: 'https://links.test/a', text: 'Link A', position: 2 },
			{ url: 'https://links.test/b', text: 'Link B', position: 3 },
		],
		citations: [
			{
				url: 'https://citations.test/source',
				title: 'Citation Source',
				description: 'Citation snippet',
				cited: false,
			},
		],
	}];

	const result = brightdataProvider.transformResponse(raw);

	assertExists(result);
	assertEquals(result.answer, 'Plain answer [1] [2] [3]');
	assertEquals(result.answerMarkdown, '**Markdown answer** \\[1\\]');
	assertEquals('answer_text' in result, false);
	assertEquals(result.sources, [
		{
			title: 'Link A',
			url: 'https://links.test/a',
			domain: 'links.test',
			cited: true,
			positions: [1, 2],
		},
		{
			title: 'Link B',
			url: 'https://links.test/b',
			domain: 'links.test',
			cited: true,
			positions: [3],
		},
		{
			title: 'Citation Source',
			snippet: 'Citation snippet',
			url: 'https://citations.test/source',
			domain: 'citations.test',
			cited: false,
		},
	]);
});

Deno.test('brightdataProvider.transformResponse merges exact URL overlap between links_attached and citations', () => {
	const raw = [{
		prompt: 'prompt',
		answer_text: 'Plain answer [1]',
		links_attached: [
			{ url: 'https://example.com/page', text: 'Short label', position: 1 },
		],
		citations: [
			{
				url: 'https://example.com/page',
				title: 'Full citation title',
				description: 'Citation snippet',
				cited: false,
			},
		],
	}];

	const result = brightdataProvider.transformResponse(raw);

	assertExists(result);
	assertEquals(result.answer, 'Plain answer [1]');
	assertEquals(result.answerMarkdown, '');
	assertEquals('answer_text' in result, false);
	assertEquals(result.sources, [
		{
			title: 'Full citation title',
			snippet: 'Citation snippet',
			url: 'https://example.com/page',
			domain: 'example.com',
			cited: true,
			positions: [1],
		},
	]);
});

Deno.test('oxylabsProvider.transformResponse prefers plain response_text over markdown_text', () => {
	const raw = {
		results: [{
			content: {
				prompt: 'prompt',
				response_text: 'Plain response [1]',
				markdown_text: '**Markdown response** \\[1\\]',
				citations: [],
			},
		}],
	};

	const result = oxylabsProvider.transformResponse(raw);

	assertExists(result);
	assertEquals(result.answer, 'Plain response [1]');
	assertEquals(result.answerMarkdown, '**Markdown response** \\[1\\]');
	assertEquals('answer_text' in result, false);
});
