import { ParquetReader } from '@dsnp/parquetjs';

/**
 * Read all rows from a Parquet file.
 */
export async function readParquetRows<T = Record<string, unknown>>(filePath: string): Promise<Array<T>> {
	const reader = await ParquetReader.openFile(filePath);
	const cursor = reader.getCursor();
	const rows: Array<T> = [];

	let record = await cursor.next();
	while (record) {
		rows.push(record as T);
		record = await cursor.next();
	}

	await reader.close();
	return rows;
}
