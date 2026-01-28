/* eslint-disable no-console */
import { assignTopics } from '../src/topics.ts';

const taxonomy = [
	{
		topic: 'Technology',
		subtopics: [
			'Artificial Intelligence',
			'Cloud Computing',
			'Cybersecurity',
			'Software Development'
		]
	},
	{
		topic: 'Business',
		subtopics: [
			'Marketing',
			'Finance',
			'Human Resources',
			'Operations'
		]
	},
	{
		topic: 'Science',
		subtopics: [
			'Physics',
			'Biology',
			'Chemistry',
			'Astronomy'
		]
	}
];

const textsToClassify = [
	'Machine learning models are revolutionizing data analysis and prediction capabilities across industries.',
	'The company\'s quarterly earnings report shows strong growth in revenue and profit margins.',
	'DNA sequencing technology has advanced rapidly, enabling personalized medicine approaches.',
	'Our cloud infrastructure scales automatically to handle increased traffic during peak hours.',
	'The marketing campaign achieved a 300% ROI through targeted social media advertising.',
	'Black holes are regions of spacetime where gravity is so strong that nothing can escape.',
	'We implemented zero-trust security architecture to protect against sophisticated cyber threats.',
	'The HR department is rolling out a new employee wellness program next quarter.',
	'Chemical reactions at the molecular level determine the properties of new materials.',
	'Agile methodologies improve team collaboration and accelerate software delivery cycles.'
];

async function main() {
	console.log('Starting concurrent topic classification...\n');
	console.log(`Classifying ${textsToClassify.length} texts with max concurrency of 100\n`);

	const startTime = Date.now();

	const results = await assignTopics(
		textsToClassify,
		taxonomy,
		'gpt-4.1-mini',
		{},
		100
	);

	const endTime = Date.now();
	const duration = ((endTime - startTime) / 1000).toFixed(2);

	console.log(`\n✓ Classification completed in ${duration} seconds\n`);
	console.log('Results:\n');

	results.forEach((result, index) => {
		if (result != null) {
			console.log(`${index + 1}. "${textsToClassify[index].substring(0, 60)}..."`);
			console.log(`   Topic: ${result.topic}`);
			console.log(`   Subtopic: ${result.subtopic}\n`);
		} else {
			console.log(`${index + 1}. [No classification - empty text]\n`);
		}
	});

	const topicCounts: Record<string, number> = {};
	results.forEach(result => {
		if (result != null) {
			topicCounts[result.topic] = (topicCounts[result.topic] || 0) + 1;
		}
	});

	console.log('Summary by Topic:');
	Object.entries(topicCounts).forEach(([topic, count]) => {
		console.log(`  ${topic}: ${count} items`);
	});
}

if (import.meta.main) {
	main().catch(error => {
		console.error('Error:', error);
		Deno.exit(1);
	});
}
