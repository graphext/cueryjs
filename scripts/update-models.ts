/**
 * Fetches model pricing data from models.dev and writes it to src/pricing/models.json.
 *
 * Run with: deno task update-models
 */

const MODELS_API_URL = 'https://models.dev/api.json';
const OUTPUT_PATH = new URL('../src/assets/models.json', import.meta.url).pathname;

async function main() {
	console.log(`Fetching model data from ${MODELS_API_URL}...`);

	const response = await fetch(MODELS_API_URL);

	if (!response.ok) {
		throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
	}

	const data = await response.json();

	// Count models for logging
	let modelCount = 0;
	for (const provider of Object.values(data) as Array<{ models?: Record<string, unknown> }>) {
		if (provider.models) {
			modelCount += Object.keys(provider.models).length;
		}
	}

	console.log(`Fetched ${modelCount} models from ${Object.keys(data).length} providers`);
	console.log(`Writing to ${OUTPUT_PATH}...`);

	await Deno.writeTextFile(OUTPUT_PATH, JSON.stringify(data, null, '\t'));

	console.log('Done!');
}

main().catch((error) => {
	console.error('Error:', error.message);
	Deno.exit(1);
});
