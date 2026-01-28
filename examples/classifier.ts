import { classify, classifyBatch } from '../src/classifier.ts';

// Define categories for sentiment classification
const sentimentCategories = {
	positive: 'Text expressing positive sentiment, satisfaction, or praise',
	negative: 'Text expressing negative sentiment, dissatisfaction, or criticism',
	neutral: 'Text that is factual, objective, or lacks clear sentiment'
};

// Test single classification
console.log('Testing single classification...\n');

const singleRecord = {
	text: 'This product is amazing! I love it so much.',
	author: 'John Doe'
};

const result = await classify(
	singleRecord,
	sentimentCategories,
	'Focus on the sentiment expressed in the text field.'
);

console.log('Record:', singleRecord);
console.log('Classification:', result);
console.log('\n---\n');

// Test batch classification
console.log('Testing batch classification...\n');

const batchRecords = [
	{ text: 'Terrible experience, would not recommend.', author: 'Jane Smith' },
	{ text: 'The item arrived on Tuesday.', author: 'Bob Johnson' },
	{ text: 'Best purchase ever! Highly recommended!', author: 'Alice Brown' },
	{ text: 'It works as described.', author: 'Charlie Wilson' }
];

const batchResults = await classifyBatch(
	batchRecords,
	sentimentCategories,
	'Focus on the sentiment expressed in the text field.',
	'gpt-4.1-mini',
	2 // Lower concurrency for testing
);

batchRecords.forEach((record, i) => {
	console.log(`Record ${i + 1}:`, record.text);
	console.log('Classification:', batchResults[i]);
	console.log();
});
