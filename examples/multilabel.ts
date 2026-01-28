import { label, labelBatch } from '../src/classifier.ts';

// Example: Multi-label classification for content tagging
const contentLabels = {
	'technical': 'Content contains technical information, code, or developer-focused material',
	'tutorial': 'Content is instructional or educational in nature',
	'news': 'Content discusses recent events or announcements',
	'opinion': 'Content expresses personal views or commentary',
	'commercial': 'Content promotes products, services, or has commercial intent'
};

// Single record example
const blogPost = {
	title: 'Building a REST API with Node.js: A Complete Guide',
	content: 'In this tutorial, we will walk through creating a production-ready REST API...',
	tags: ['nodejs', 'api', 'backend'],
	author: 'John Doe'
};

console.log('=== Single Record Multi-Label Classification ===');
const labels = await label(blogPost, contentLabels);
console.log('Assigned labels:', labels);

// Batch example
const articles = [
	{
		title: 'TypeScript 5.0 Released',
		content: 'The TypeScript team announced the release of version 5.0...',
		category: 'announcement'
	},
	{
		title: 'Why You Should Use TypeScript',
		content: 'In my opinion, TypeScript has become essential for modern web development...',
		category: 'opinion'
	},
	{
		title: 'Learn React Hooks in 10 Minutes',
		content: 'This quick tutorial will teach you the basics of React Hooks...',
		category: 'education'
	}
];

console.log('\n=== Batch Multi-Label Classification ===');
const batchLabels = await labelBatch(articles, contentLabels);
batchLabels.forEach((labels, index) => {
	console.log(`Article ${index + 1}: ${articles[index].title}`);
	console.log(`  Labels: ${labels?.join(', ') || 'none'}`);
});
