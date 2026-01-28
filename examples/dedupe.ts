/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
import { deduplicate, deduplicateLast } from '../src/dedupe.ts';

console.log('Testing deduplication functions\n');
console.log('='.repeat(50));
console.log();

// Sample data with duplicates
const records = [
	{ id: 1, name: 'Alice', email: 'alice@example.com' },
	{ id: 2, name: 'Bob', email: 'bob@example.com' },
	{ id: 3, name: 'Charlie', email: 'charlie@example.com' },
	{ id: 1, name: 'Alice Updated', email: 'alice.new@example.com' },
	{ id: 4, name: 'Diana', email: 'diana@example.com' },
	{ id: 2, name: 'Bob Smith', email: 'bob.smith@example.com' },
	{ id: 5, name: 'Eve', email: 'eve@example.com' }
];

console.log('Original records:');
records.forEach((record, i) => {
	console.log(`  ${i + 1}. id=${record.id}, name="${record.name}", email="${record.email}"`);
});
console.log();

// Test deduplicate (keeps first occurrence)
console.log('Test 1: deduplicate() - Keep first occurrence');
console.log('-'.repeat(50));
const uniqueFirst = deduplicate(records, 'id');
console.log(`Original count: ${records.length}`);
console.log(`After deduplication: ${uniqueFirst.length}`);
console.log('Result:');
uniqueFirst.forEach((record, i) => {
	console.log(`  ${i + 1}. id=${record.id}, name="${record.name}", email="${record.email}"`);
});
console.log();

// Test deduplicateLast (keeps last occurrence)
console.log('Test 2: deduplicateLast() - Keep last occurrence');
console.log('-'.repeat(50));
const uniqueLast = deduplicateLast(records, 'id');
console.log(`Original count: ${records.length}`);
console.log(`After deduplication: ${uniqueLast.length}`);
console.log('Result:');
uniqueLast.forEach((record, i) => {
	console.log(`  ${i + 1}. id=${record.id}, name="${record.name}", email="${record.email}"`);
});
console.log();

// Test with email field
console.log('Test 3: Deduplicate by email field');
console.log('-'.repeat(50));
const recordsWithDupeEmails = [
	{ id: 1, name: 'Alice', email: 'alice@example.com' },
	{ id: 2, name: 'Bob', email: 'bob@example.com' },
	{ id: 3, name: 'Alice Smith', email: 'alice@example.com' },
	{ id: 4, name: 'Robert', email: 'bob@example.com' }
];

console.log('Records with duplicate emails:');
recordsWithDupeEmails.forEach((record, i) => {
	console.log(`  ${i + 1}. id=${record.id}, name="${record.name}", email="${record.email}"`);
});

const uniqueByEmail = deduplicate(recordsWithDupeEmails, 'email');
console.log(`\nAfter deduplication by email: ${uniqueByEmail.length}`);
uniqueByEmail.forEach((record, i) => {
	console.log(`  ${i + 1}. id=${record.id}, name="${record.name}", email="${record.email}"`);
});
console.log();

// Test with null/undefined values
console.log('Test 4: Handling null/undefined values');
console.log('-'.repeat(50));
const recordsWithNulls = [
	{ id: 1, name: 'Alice', category: 'A' },
	{ id: 2, name: 'Bob', category: null },
	{ id: 3, name: 'Charlie', category: 'A' },
	{ id: 4, name: 'Diana', category: null },
	{ id: 5, name: 'Eve', category: 'B' }
];

console.log('Records with null categories:');
recordsWithNulls.forEach((record, i) => {
	console.log(`  ${i + 1}. id=${record.id}, name="${record.name}", category=${record.category}`);
});

const uniqueByCategory = deduplicate(recordsWithNulls, 'category');
console.log(`\nAfter deduplication by category: ${uniqueByCategory.length}`);
console.log('(Note: null values are skipped and not included in result)');
uniqueByCategory.forEach((record, i) => {
	console.log(`  ${i + 1}. id=${record.id}, name="${record.name}", category=${record.category}`);
});
console.log();

console.log('='.repeat(50));
console.log('All tests completed!');
