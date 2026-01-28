/* eslint-disable no-console */
import { formatRecordsAttrWise } from '../src/utils.ts';

const sampleRecords = [
	{
		product_name: 'Laptop Pro',
		category: 'Electronics',
		price: 1299.99,
		tags: ['portable', 'high-performance'],
		in_stock: true,
		description: 'Professional laptop with 16GB RAM and 512GB SSD'
	},
	{
		product_name: 'Wireless Mouse',
		category: 'Electronics',
		price: 29.99,
		tags: ['wireless', 'ergonomic'],
		in_stock: true,
		description: 'Ergonomic wireless mouse with precision tracking'
	},
	{
		product_name: 'Standing Desk',
		category: 'Furniture',
		price: 499.99,
		tags: ['adjustable', 'ergonomic', 'electric'],
		in_stock: false,
		description: 'Electric height-adjustable standing desk'
	},
	{
		product_name: 'Office Chair',
		category: 'Furniture',
		price: 349.99,
		tags: ['ergonomic', 'lumbar-support'],
		in_stock: true,
		description: null
	},
	{
		product_name: 'USB-C Hub',
		category: 'Electronics',
		price: 79.99,
		tags: ['multiport', 'compact'],
		in_stock: true,
		description: '7-in-1 USB-C hub with HDMI and ethernet ports'
	}
];

function main() {
	console.log('=== formatRecordsAttrWise() Example ===\n');
	console.log('Input: Array of product records\n');
	console.log('Sample record structure:');
	console.log(JSON.stringify(sampleRecords[0], null, 2));
	console.log('\n' + '='.repeat(60) + '\n');

	const formatted = formatRecordsAttrWise(sampleRecords);

	console.log('Output: Attribute-wise formatted string\n');
	console.log(formatted);
	console.log('\n' + '='.repeat(60) + '\n');

	console.log('Explanation:');
	console.log('- Each attribute becomes a section with ## heading');
	console.log('- Attribute names converted from snake_case to Title Case');
	console.log('- Values listed comma-separated across all records');
	console.log('- Arrays/objects serialized as JSON');
	console.log('- Null/empty values skipped');
	console.log('- Format optimized for LLM context in topic extraction');
}

main();
