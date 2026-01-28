/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
import { generatePersonas } from '../src/personas.ts';

if (import.meta.main) {
	const config = {
		sector: 'coches eléctricos',
		market: 'España',
		brand: 'Peugeot.es',
		count: 5
	};
	const start = Date.now();
	const answer = await generatePersonas({
		sector: config.sector,
		market: config.market,
		brand: config.brand,
		count: config.count
	});
	const duration = ((Date.now() - start) / 1000).toFixed(1);
	console.log(`Generated personas in ${duration}s`);
	console.log(answer);
}
