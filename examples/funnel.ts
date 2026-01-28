import { customizeFunnel } from '../src/funnel.ts';

if (import.meta.main) {
	console.log('🔍 Starting funnel customization...');
	const start = performance.now();
	
	const funnel = await customizeFunnel('Running Shoes', 'Spanish', 'Spain', 'gpt-4.1');
	
	const end = performance.now();
	console.log(`✅ Funnel customization completed in ${((end - start) / 1000).toFixed(2)}ms`);
	console.log(JSON.stringify(funnel, null, 2));
}
