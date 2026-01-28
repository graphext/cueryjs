export default async function mapParallel<T, U>(
	iterable: Array<T> | Set<T> | Iterator<T>,
	nWorkers: number,
	callback: (value: T, index: number) => Promise<U>
) {
	let size: number | null = null;

	if (Array.isArray(iterable)) {
		size = iterable.length;
	}

	if (!('next' in iterable)) {
		iterable = iterable[Symbol.iterator]();
	}

	nWorkers = Math.max(1, Math.min(nWorkers, size || Number.MAX_VALUE));

	const result: Array<U> = [];
	let myIndex = 0;
	const workerPromises = Array(nWorkers).fill(0).map(async () => {
		let iterResult: IteratorResult<T>;
		while (!(iterResult = iterable.next()).done) {
			const index = myIndex++;
			result[index] = await callback(iterResult.value, index);
		}
	});

	await Promise.all(workerPromises);

	return result;
}
