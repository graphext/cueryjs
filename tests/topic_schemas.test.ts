import { assertEquals, assertThrows } from '@std/assert';

import { Topic, Taxonomy, createLabelSchema } from '../src/tools/topics.ts';
import type { TaxonomyType } from '../src/tools/topics.ts';

Deno.test('Topic - valid topic with distinct subtopics', () => {
	const validTopic = {
		topic: 'Technology',
		subtopics: ['Artificial Intelligence', 'Cloud Computing', 'Cybersecurity']
	};

	const result = Topic.parse(validTopic);
	assertEquals(result.topic, 'Technology');
	assertEquals(result.subtopics.length, 3);
	assertEquals(result.subtopics[0], 'Artificial Intelligence');
});

Deno.test('Topic - subtopic too similar to parent topic', () => {
	const invalidTopic = {
		topic: 'Technology',
		subtopics: ['Technology', 'Cloud Computing', 'Cybersecurity']
	};

	assertThrows(
		() => {
			Topic.parse(invalidTopic);
		},
		Error,
		'too similar to parent topic'
	);
});

Deno.test('Topic - subtopics too similar to each other (Levenshtein)', () => {
	const invalidTopic = {
		topic: 'Marketing',
		subtopics: ['Digital Marketing', 'Digital Markting', 'Content Strategy']
	};

	assertThrows(
		() => {
			Topic.parse(invalidTopic);
		},
		Error,
		'too similar to other subtopic'
	);
});

Deno.test('Topic - duplicate subtopics (permutation)', () => {
	const invalidTopic = {
		topic: 'Business',
		subtopics: ['Market Research', 'Research Market', 'Business Strategy']
	};

	assertThrows(
		() => {
			Topic.parse(invalidTopic);
		},
		Error,
		'duplicate (permutation)'
	);
});

Deno.test('Topic - empty subtopics array', () => {
	const validTopic = {
		topic: 'General',
		subtopics: []
	};

	const result = Topic.parse(validTopic);
	assertEquals(result.topic, 'General');
	assertEquals(result.subtopics.length, 0);
});

Deno.test('Taxonomy - valid object format', () => {
	const validTaxonomy = {
		topics: [
			{
				topic: 'Technology',
				subtopics: ['Artificial Intelligence', 'Cloud Computing']
			},
			{
				topic: 'Marketing',
				subtopics: ['Digital Marketing', 'Content Strategy']
			}
		]
	};

	const result: TaxonomyType = Taxonomy.parse(validTaxonomy);
	assertEquals(result.topics.length, 2);
	assertEquals(result.topics[0].topic, 'Technology');
	assertEquals(result.topics[1].topic, 'Marketing');
});


Deno.test('createLabelSchema - valid topic-subtopic combination', () => {
	const taxonomy: TaxonomyType = {
		topics: [
			{
				topic: 'Technology',
				subtopics: ['Artificial Intelligence', 'Cloud Computing']
			},
			{
				topic: 'Marketing',
				subtopics: ['Digital Marketing', 'Content Strategy']
			}
		]
	};

	const LabelSchema = createLabelSchema(taxonomy);

	const validLabel = {
		topic: 'Technology',
		subtopic: 'Artificial Intelligence'
	};

	const result = LabelSchema.parse(validLabel);
	assertEquals(result.topic, 'Technology');
	assertEquals(result.subtopic, 'Artificial Intelligence');
});

Deno.test('createLabelSchema - invalid subtopic for topic', () => {
	const taxonomy: TaxonomyType = {
		topics: [
			{
				topic: 'Technology',
				subtopics: ['Artificial Intelligence', 'Cloud Computing']
			},
			{
				topic: 'Marketing',
				subtopics: ['Digital Marketing', 'Content Strategy']
			}
		]
	};

	const LabelSchema = createLabelSchema(taxonomy);

	const invalidLabel = {
		topic: 'Technology',
		subtopic: 'Digital Marketing' // This belongs to Marketing, not Technology
	};

	assertThrows(
		() => {
			LabelSchema.parse(invalidLabel);
		},
		Error,
		'not a valid subtopic for topic'
	);
});

Deno.test('createLabelSchema - invalid topic name', () => {
	const taxonomy: TaxonomyType = {
		topics: [
			{
				topic: 'Technology',
				subtopics: ['Artificial Intelligence', 'Cloud Computing']
			},
			{
				topic: 'Marketing',
				subtopics: ['Digital Marketing', 'Content Strategy']
			}
		]
	};

	const LabelSchema = createLabelSchema(taxonomy);

	const invalidLabel = {
		topic: 'Science', // Not in the mapping
		subtopic: 'Physics'
	};

	assertThrows(
		() => {
			LabelSchema.parse(invalidLabel);
		},
		Error
	);
});

Deno.test('createLabelSchema - invalid subtopic name', () => {
	const taxonomy: TaxonomyType = {
		topics: [
			{
				topic: 'Technology',
				subtopics: ['Artificial Intelligence', 'Cloud Computing']
			},
			{
				topic: 'Marketing',
				subtopics: ['Digital Marketing', 'Content Strategy']
			}
		]
	};

	const LabelSchema = createLabelSchema(taxonomy);

	const invalidLabel = {
		topic: 'Technology',
		subtopic: 'Blockchain' // Not in any mapping
	};

	assertThrows(
		() => {
			LabelSchema.parse(invalidLabel);
		},
		Error
	);
});

Deno.test('createLabelSchema - all valid combinations', () => {
	const taxonomy: TaxonomyType = {
		topics: [
			{
				topic: 'Tech',
				subtopics: ['AI', 'Cloud']
			},
			{
				topic: 'Business',
				subtopics: ['Finance', 'HR']
			}
		]
	};

	const LabelSchema = createLabelSchema(taxonomy);

	// Test all valid combinations
	const validCombinations = [
		{ topic: 'Tech', subtopic: 'AI' },
		{ topic: 'Tech', subtopic: 'Cloud' },
		{ topic: 'Business', subtopic: 'Finance' },
		{ topic: 'Business', subtopic: 'HR' }
	];

	for (const combo of validCombinations) {
		const result = LabelSchema.parse(combo);
		assertEquals(result.topic, combo.topic);
		assertEquals(result.subtopic, combo.subtopic);
	}
});

Deno.test('Topic - case sensitivity in validation', () => {
	const validTopic = {
		topic: 'TECHNOLOGY',
		subtopics: ['Artificial Intelligence', 'ARTIFICIAL INTELLIGENCE']
	};

	// Should fail because lowercase versions are identical
	assertThrows(
		() => {
			Topic.parse(validTopic);
		},
		Error
	);
});

Deno.test('Topic - minimum Levenshtein distance enforcement', () => {
	const validTopic = {
		topic: 'Marketing',
		subtopics: ['SEO', 'PPC', 'CRO'] // All have distance >= 2
	};

	const result = Topic.parse(validTopic);
	assertEquals(result.subtopics.length, 3);
});

Deno.test('Taxonomy - empty topics array', () => {
	const emptyTaxonomy = {
		topics: []
	};

	const result: TaxonomyType = Taxonomy.parse(emptyTaxonomy);
	assertEquals(result.topics.length, 0);
});
