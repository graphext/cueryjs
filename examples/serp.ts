import { fetchSerpBatch } from '../src/apis/hasdata/serp.ts';

const queries = [
	'what is the ISS?',
	'mejores academias de inglés para niños en barrio de las letras',
	'clima en madrid durante el mes de septiembre',
	'eventos culturales en barcelona este fin de semana',
	'restaurantes vegetarianos recomendados en sevilla',
];

const results = await fetchSerpBatch(queries, {
	domain: 'google.es',
	location: 'ES',
	country: 'ES',
	language: 'es'
});

if (results.length !== queries.length) {
	throw new Error('Batch results length does not match queries length');
}

results.forEach((result, index) => {
	console.log(`\n=== Result for Query: "${queries[index]}" ===\n`);
	console.log(JSON.stringify(result, null, 2));
});
