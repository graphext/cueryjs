import { customizeFunnel, reseedFunnel } from '../src/funnel.ts';
/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */

/**
 * Example: Batch regenerate all seed keywords for a funnel concurrently
 * This is much faster than iterating and generating one by one
 */
async function main() {
	console.log('🔧 Customizing funnel for electric cars in Spanish market...\n');
	
	const config = {
		'sector': 'coches eléctricos',
		'language': 'español',
		'country': 'España',
		'model': 'gpt-4.1'
	};

	let start = Date.now();
	const funnel = await customizeFunnel(
		config.sector,
		config.language,
		config.country,
		config.model
	);
	let duration = ((Date.now() - start) / 1000).toFixed(1);
	console.log(`✅ Funnel customized in ${duration}!\n`);	 
	console.log('🔄 Regenerating all seed keywords concurrently...\n');

	start = Date.now();
	await reseedFunnel(
		funnel,
		config.sector,
		config.language,
		config.country,
		config.model,
		50
	);
	duration = ((Date.now() - start) / 1000).toFixed(1);
	console.log(`✅ All seeds regenerated in ${duration}s!\n`);
	console.log('📊 Updated funnel:\n');
	console.log(JSON.stringify(funnel, null, 2));
}

main().catch(console.error);
