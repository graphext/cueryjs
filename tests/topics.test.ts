import { assertEquals, assertExists } from '@std/assert';

import { assignTopic, extractTopics, createLabelSchema } from '../src/tools/topics.ts';
import type { TaxonomyType } from '../src/tools/topics.ts';

const SKIP_OPENAI = !Deno.env.get('RUN_OPENAI_TESTS');

Deno.test({
	name: 'assignTopic - successful classification with Taxonomy format',
	ignore: SKIP_OPENAI,
	async fn() {
		const taxonomy: TaxonomyType = {
			topics: [
				{
					topic: 'Technology',
					subtopics: ['Artificial Intelligence', 'Cloud Computing', 'Cybersecurity']
				},
				{
					topic: 'Marketing',
					subtopics: ['Digital Marketing', 'Content Strategy', 'SEO']
				},
				{
					topic: 'Business',
					subtopics: ['Strategy', 'Operations', 'Finance']
				}
			]
		};

		const labelSchema = createLabelSchema(taxonomy);
		const text = 'Machine learning models are revolutionizing how we process data and make predictions';

		const response = await assignTopic({ text, taxonomy, labelSchema });

		assertExists(response.parsed);
		assertEquals(typeof response.parsed!.topic, 'string');
		assertEquals(typeof response.parsed!.subtopic, 'string');
		assertEquals(response.parsed!.topic, 'Technology');
		assertEquals(response.parsed!.subtopic, 'Artificial Intelligence');
	}
});

Deno.test({
	name: 'assignTopic - successful classification with SEO content and array',
	ignore: SKIP_OPENAI,
	async fn() {
		const taxonomy = [
			{
				topic: 'Technology',
				subtopics: ['Artificial Intelligence', 'Cloud Computing', 'Cybersecurity']
			},
			{
				topic: 'Marketing',
				subtopics: ['Digital Marketing', 'Content Strategy', 'SEO']
			}
		];

		const labelSchema = createLabelSchema({ topics: taxonomy });
		const text = 'Our SEO strategy focuses on keyword optimization and link building to improve rankings';

		const response = await assignTopic({ text, taxonomy, labelSchema });

		assertExists(response.parsed);
		assertEquals(typeof response.parsed!.topic, 'string');
		assertEquals(typeof response.parsed!.subtopic, 'string');
		assertEquals(response.parsed!.topic, 'Marketing');
		assertEquals(response.parsed!.subtopic, 'SEO');
	}
});

// These tests don't require OpenAI - they test null/empty handling
Deno.test('assignTopic - returns null for null text', async () => {
	const taxonomy: TaxonomyType = {
		topics: [
			{
				topic: 'Technology',
				subtopics: ['Artificial Intelligence', 'Cloud Computing']
			}
		]
	};

	const labelSchema = createLabelSchema(taxonomy);
	const response = await assignTopic({ text: null, taxonomy, labelSchema });

	assertEquals(response.parsed, null);
});

Deno.test('assignTopic - returns null for empty text', async () => {
	const taxonomy: TaxonomyType = {
		topics: [
			{
				topic: 'Technology',
				subtopics: ['Artificial Intelligence', 'Cloud Computing']
			}
		]
	};

	const labelSchema = createLabelSchema(taxonomy);
	const response = await assignTopic({ text: '', taxonomy, labelSchema });

	assertEquals(response.parsed, null);
});

Deno.test('assignTopic - returns null for whitespace-only text', async () => {
	const taxonomy: TaxonomyType = {
		topics: [
			{
				topic: 'Technology',
				subtopics: ['Artificial Intelligence', 'Cloud Computing']
			}
		]
	};

	const labelSchema = createLabelSchema(taxonomy);
	const response = await assignTopic({ text: '   \n\t  ', taxonomy, labelSchema });

	assertEquals(response.parsed, null);
});

Deno.test({
	name: 'assignTopic - classifies business strategy text',
	ignore: SKIP_OPENAI,
	async fn() {
		const taxonomy: TaxonomyType = {
			topics: [
				{
					topic: 'Business',
					subtopics: ['Strategy', 'Operations', 'Finance', 'Human Resources']
				},
				{
					topic: 'Technology',
					subtopics: ['Software Development', 'Data Science', 'Infrastructure']
				},
				{
					topic: 'Sales',
					subtopics: ['Lead Generation', 'Account Management', 'Closing Deals']
				}
			]
		};

		const labelSchema = createLabelSchema(taxonomy);
		const text = 'We need to develop a comprehensive business strategy that aligns with our long-term goals and market positioning';

		const response = await assignTopic({ text, taxonomy, labelSchema });

		assertExists(response.parsed);
		assertEquals(response.parsed!.topic, 'Business');
		assertEquals(response.parsed!.subtopic, 'Strategy');
	}
});

Deno.test({
	name: 'assignTopic - classifies marketing content',
	ignore: SKIP_OPENAI,
	async fn() {
		const taxonomy: TaxonomyType = {
			topics: [
				{
					topic: 'Marketing',
					subtopics: ['Content Creation', 'Social Media', 'Email Campaigns', 'Brand Management']
				},
				{
					topic: 'Sales',
					subtopics: ['Lead Generation', 'Customer Outreach']
				},
				{
					topic: 'Support',
					subtopics: ['Customer Service', 'Technical Support']
				}
			]
		};

		const labelSchema = createLabelSchema(taxonomy);
		const text = 'We are launching a new social media campaign on Instagram and TikTok to reach younger audiences';

		const response = await assignTopic({ text, taxonomy, labelSchema });

		assertExists(response.parsed);
		assertEquals(response.parsed!.topic, 'Marketing');
		assertEquals(response.parsed!.subtopic, 'Social Media');
	}
});

Deno.test({
	name: 'extractTopics - extracts topics from product records',
	ignore: SKIP_OPENAI,
	async fn() {
		const records = [
			{ name: 'iPhone 15', description: 'Latest smartphone with advanced AI features and camera' },
			{ name: 'MacBook Pro', description: 'High-performance laptop for professionals' },
			{ name: 'SEO Course', description: 'Learn search engine optimization and digital marketing' },
			{ name: 'Python Bootcamp', description: 'Master programming and data science with Python' },
			{ name: 'Yoga Mat', description: 'Premium fitness equipment for home workouts' },
			{ name: 'Protein Powder', description: 'Nutrition supplement for muscle building' },
			{ name: 'Business Strategy Book', description: 'Guide to corporate planning and growth' },
			{ name: 'Financial Analysis Tool', description: 'Software for accounting and budget management' },
			{ name: 'Wireless Earbuds', description: 'Bluetooth audio device with noise cancellation' },
			{ name: 'Gaming Console', description: 'Next-gen gaming system with 4K graphics' },
			{ name: 'Content Marketing Guide', description: 'Learn to create engaging blog posts and videos' },
			{ name: 'JavaScript Fundamentals', description: 'Web development course for beginners' },
			{ name: 'Running Shoes', description: 'Athletic footwear for marathon training' },
			{ name: 'Vitamins & Supplements', description: 'Daily multivitamin for overall health' },
			{ name: 'Leadership Training', description: 'Management skills for team leaders and executives' },
			{ name: 'Project Management Software', description: 'Task tracking and collaboration tool' },
			{ name: '4K Monitor', description: 'Ultra-high definition display for creative professionals' },
			{ name: 'Mechanical Keyboard', description: 'Premium typing device for programmers' },
			{ name: 'Social Media Marketing', description: 'Master Instagram, TikTok, and LinkedIn strategies' },
			{ name: 'Data Analytics Course', description: 'Learn SQL, Python, and visualization techniques' },
			{ name: 'Dumbbells Set', description: 'Home gym equipment for strength training' },
			{ name: 'Meal Prep Containers', description: 'Food storage for healthy eating and portion control' },
			{ name: 'Accounting Basics', description: 'Financial management fundamentals for small business' },
			{ name: 'CRM Platform', description: 'Customer relationship management and sales tracking system' }
		];

		const result = await extractTopics({
			records,
			nTopics: 3,
			nSubtopics: 3,
			maxSamples: 100
		});

		console.log(result);

		assertExists(result);
		assertExists(result.topics);
		assertEquals(Array.isArray(result.topics), true);
		assertEquals(result.topics.length > 0, true);
		assertEquals(result.topics.length <= 3, true);

		for (const topic of result.topics) {
			assertExists(topic.topic);
			assertEquals(typeof topic.topic, 'string');
			assertEquals(topic.topic.length > 0, true);
			assertExists(topic.subtopics);
			assertEquals(Array.isArray(topic.subtopics), true);
			assertEquals(topic.subtopics.length > 0, true);
			assertEquals(topic.subtopics.length <= 3, true);

			for (const subtopic of topic.subtopics) {
				assertEquals(typeof subtopic, 'string');
				assertEquals(subtopic.length > 0, true);
			}
		}
	}
});
