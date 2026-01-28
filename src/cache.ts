/**
 * File-based caching utilities for Deno.
 * These functions provide simple JSON file caching with path-based access.
 */

/**
 * Load an object from a JSON file accessing the object with the provided
 * path. The path is a sequence of keys/indexes to traverse the object.
 * If the file, or any key doesn't exist, return null.
 */
export async function fromCache<T>(fp: string, ...path: Array<string | number>): Promise<T | null> {
	try {
		const data = await Deno.readTextFile(fp);
		let obj: unknown = JSON.parse(data);

		for (const key of path) {
			if (obj == null || typeof obj !== 'object') {
				return null;
			}
			const record = obj as Record<string | number, unknown>;
			if (!(key in record)) {
				return null;
			}
			obj = record[key];
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
	obj: unknown,
	ifExists: 'throw' | 'overwrite' | 'skip' = 'overwrite',
	...path: Array<string | number>
): Promise<void> {
	let cache = await fromCache<Record<string, unknown>>(fp);
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

	let current: Record<string | number, unknown> = cache;
	for (let i = 0; i < path.length - 1; i++) {
		const key = path[i];
		if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
			current[key] = {};
		}
		current = current[key] as Record<string | number, unknown>;
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
	const cache = await fromCache<Record<string, unknown>>(fp);
	if (cache == null) {
		console.log(`Cache file ${fp} not found. Nothing to clear.`);
		return;
	}
	await Deno.writeTextFile(fp, JSON.stringify({}, null, 2));
}
