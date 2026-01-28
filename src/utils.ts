/**
 * Remove leading whitespace from a string, similar to Python's textwrap.dedent.
 * Also collapses newlines within paragraphs (except for markdown list items).
 */
export function dedent(text: string): string {
	/**
	 * Check if a line is a markdown list item.
	 */
	function isMarkdownListItem(line: string): boolean {
		const trimmedLine = line.trim();

		// Unordered lists
		if (
			trimmedLine.startsWith('- ') ||
			trimmedLine.startsWith('* ') ||
			trimmedLine.startsWith('+ ')
		) {
			return true;
		}

		// Ordered lists: Detect a number or single letter followed by a dot and space
		return /^\d+\. |^[a-zA-Z]\. /.test(trimmedLine);
	}

	// Clean doc: Remove leading/trailing whitespace and normalize indentation
	const cleanedText = cleanDoc(text);

	// Split into paragraphs
	const paragraphs = cleanedText.split('\n\n');

	// Replace newlines with spaces in non-list paragraphs
	const processedParagraphs = paragraphs.map((p) => isMarkdownListItem(p) ? p : p.replace(/\n/g, ' '));

	return processedParagraphs.join('\n\n').trim();
}

/**
 * Clean up indentation in a multi-line string (similar to Python's inspect.cleandoc).
 * Removes leading blank lines, trailing blank lines, and common leading whitespace.
 */
function cleanDoc(text: string): string {
	const lines = text.split('\n');

	// Remove leading blank lines
	while (lines.length > 0 && lines[0].trim() === '') {
		lines.shift();
	}

	// Remove trailing blank lines
	while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
		lines.pop();
	}

	if (lines.length === 0) {
		return '';
	}

	// Find the minimum indentation (ignoring blank lines)
	let minIndent = Infinity;
	for (const line of lines) {
		if (line.trim() !== '') {
			const indent = line.match(/^[ \t]*/)?.[0].length ?? 0;
			minIndent = Math.min(minIndent, indent);
		}
	}

	// Remove the common leading whitespace
	if (minIndent > 0 && minIndent !== Infinity) {
		return lines.map((line) => line.trim() === '' ? line : line.slice(minIndent)).join('\n');
	}

	return lines.join('\n');
}

/**
 * Formats records in attribute-wise format (column-oriented).
 * Each section shows all values for a single attribute across all records.
 * Equivalent to records_attr_wise.jinja template.
 *
 * @param records - Array of record objects to format
 * @returns Formatted string with records grouped by attribute
 */
export function formatRecordsAttrWise(records: Array<Record<string, unknown>>): string {
	if (!records || records.length === 0) {
		return '';
	}

	const attributes = Object.keys(records[0]);
	const sections: Array<string> = [];

	for (const attrName of attributes) {
		const title = attrName.replace(/_/g, ' ')
			.split(' ')
			.map(word => word.charAt(0).toUpperCase() + word.slice(1))
			.join(' ');

		const values: Array<string> = [];

		for (const record of records) {
			const value = record[attrName];

			if (value == null || value === '') {
				continue;
			}

			if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
				values.push(JSON.stringify(value));
			} else {
				values.push(String(value));
			}
		}

		if (values.length > 0) {
			sections.push(`## ${title}\n\n${values.join(', ')}`);
		}
	}

	return sections.join('\n\n');
}

/**
 * Clean a string to make it suitable for use as a column name.
 * Converts to lowercase, replaces non-alphanumeric characters with underscores,
 * and removes consecutive underscores.
 */
export function cleanColumnName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.replace(/_+/g, '_');
}

export function sampleArray<T>(array: Array<T>, n: number): Array<T> {
	if (n >= array.length) {
		return [...array];
	}

	const shuffled = [...array];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}

	return shuffled.slice(0, n);
}

/**
 * Load an object from a JSON file accessing the object with the provided
 * path. The path is a sequence of keys/indexes to traverse the object.
 * If the file, or any key doesn't exist, return null.
 */
export async function fromCache<T>(fp: string, ...path: any[]): Promise<T | null> {
	try {
		const data = await Deno.readTextFile(fp);
		let obj: any = JSON.parse(data);

		for (const key of path) {
			if (obj == null || !(key in obj)) {
				return null;
			}
			obj = obj[key];
		}
		return obj as T;
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) {
			return null;
		}
		throw error;
	}
}

/**
 * Save an object in a JSON file under the provided path.
 * The path is a sequence of keys/indexes to traverse the object.
 * If the file, or any key doesn't exist, we create them.
 */
export async function toCache(
	fp: string,
	obj: any,
	ifExists: 'throw' | 'overwrite' | 'skip' = 'overwrite',
	...path: any[]
): Promise<void> {
	let cache: any = await fromCache<any>(fp);
	if (cache == null) {
		console.log(`Cache file ${fp} not found. Creating new cache.`);
		cache = {};
	}

	if (path.length === 0) {
		if (ifExists === 'throw' && Object.keys(cache).length > 0) {
			throw new Error(`Cache file ${fp} already contains data.`);
		}
		await Deno.writeTextFile(fp, JSON.stringify(obj, null, 2));
		return;
	}

	let current = cache;
	for (let i = 0; i < path.length - 1; i++) {
		const key = path[i];
		if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
			current[key] = {};
		}
		current = current[key];
	}

	const finalKey = path[path.length - 1];
	const hasExistingValue = finalKey in current;
	if (hasExistingValue) {
		if (ifExists === 'throw') {
			throw new Error(
				`Cache entry at path [${path.join(' -> ')}] already exists in ${fp}`
			);
		}
		else if (ifExists === 'skip') {
			return;
		}
	}

	if (!hasExistingValue || ifExists === 'overwrite') {
		current[finalKey] = obj;
	}

	await Deno.writeTextFile(fp, JSON.stringify(cache, null, 2));
}

/**
 * Clears cache file at the given path.
 */
export async function clearCache(fp: string): Promise<void> {
	const cache: any = await fromCache<any>(fp);
	if (cache == null) {
		console.log(`Cache file ${fp} not found. Nothing to clear.`);
		return;
	}
	await Deno.writeTextFile(fp, JSON.stringify({}, null, 2));
}
