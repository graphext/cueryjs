/* eslint-disable no-console */
import { extractTopics } from '../src/topics.ts';

const sampleRecords = [
	{
		product_name: 'Laptop Pro',
		category: 'Electronics',
		price: 1299.99,
		description: 'Professional laptop with 16GB RAM and 512GB SSD'
	},
	{
		product_name: 'Wireless Mouse',
		category: 'Electronics',
		price: 29.99,
		description: 'Ergonomic wireless mouse with precision tracking'
	},
	{
		product_name: 'Standing Desk',
		category: 'Furniture',
		price: 499.99,
		description: 'Electric height-adjustable standing desk'
	},
	{
		product_name: 'Office Chair',
		category: 'Furniture',
		price: 349.99,
		description: 'Ergonomic office chair with lumbar support'
	},
	{
		product_name: 'USB-C Hub',
		category: 'Electronics',
		price: 79.99,
		description: '7-in-1 USB-C hub with HDMI and ethernet ports'
	},
	{
		product_name: 'Mechanical Keyboard',
		category: 'Electronics',
		price: 149.99,
		description: 'RGB mechanical keyboard with blue switches'
	},
	{
		product_name: 'Monitor Stand',
		category: 'Furniture',
		price: 89.99,
		description: 'Adjustable monitor stand with storage drawer'
	},
	{
		product_name: 'Webcam HD',
		category: 'Electronics',
		price: 119.99,
		description: '1080p HD webcam with auto-focus and noise cancellation'
	}
];

async function main() {
	console.log('=== extractTopics() Example ===\n');
	console.log(`Processing ${sampleRecords.length} product records\n`);
	console.log('Parameters:');
	console.log('- nTopics: 3');
	console.log('- nSubtopics: 4');
	console.log('- instructions: "Focus on product categories and price ranges"');
	console.log('\n' + '='.repeat(60) + '\n');

	const startTime = Date.now();

	const taxonomy = await extractTopics({
		records: sampleRecords,
		nTopics: 3,
		nSubtopics: 4,
		instructions: 'Focus on product categories and price ranges',
		maxSamples: 500,
		model: 'gpt-5.1',
		modelParams: { reasoning: { effort: 'none' } },
	});

	const elapsedTime = Date.now() - startTime;

	console.log('Extracted Taxonomy:\n');
	console.log(JSON.stringify(taxonomy, null, 2));
	console.log('\n' + '='.repeat(60) + '\n');

	console.log('Topics by category:');
	for (const topicObj of taxonomy.topics) {
		console.log(`\n${topicObj.topic}:`);
		for (const subtopic of topicObj.subtopics) {
			console.log(`  - ${subtopic}`);
		}
	}

	console.log(`\nCompleted in ${elapsedTime}ms`);
}

main();
