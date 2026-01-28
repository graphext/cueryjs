/**
 * Deduplicates an array of records based on a single scalar field.
 * Keeps the first occurrence of each unique value and removes subsequent duplicates.
 */
export function deduplicate<T extends Record<string, unknown>>(
	records: Array<T>,
	field: keyof T
): Array<T> {
	const seen = new Set<unknown>();
	const result: Array<T> = [];

	for (const record of records) {
		const value = record[field];

		// Skip records where the field is null or undefined
		if (value == null) {
			continue;
		}

		// Only add if we haven't seen this value before
		if (!seen.has(value)) {
			seen.add(value);
			result.push(record);
		}
	}

	return result;
}

/**
 * Deduplicates an array of records based on a single scalar field.
 * Keeps the last occurrence of each unique value, removing earlier duplicates.
 */
export function deduplicateLast<T extends Record<string, unknown>>(
	records: Array<T>,
	field: keyof T
): Array<T> {
	const map = new Map<unknown, T>();

	for (const record of records) {
		const value = record[field];

		// Skip records where the field is null or undefined
		if (value == null) {
			continue;
		}

		// Always update, so last occurrence wins
		map.set(value, record);
	}

	return Array.from(map.values());
}
