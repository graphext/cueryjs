import { z } from '@zod/zod';

import { searchWithFormat } from '../src/search.ts';

// Define a structured response schema using Zod
const WeatherInfo = z.object({
	temperature: z.string().describe('Current temperature'),
	conditions: z.string().describe('Weather conditions'),
	location: z.string().describe('Location'),
	humidity: z.string().nullable().describe('Humidity level, null if not available')
});

const result = await searchWithFormat({
	prompt: 'What is the weather like in Madrid today?',
	model: 'gpt-4.1-mini',
	responseSchema: WeatherInfo,
	countryISOCode: 'ES',
	contextSize: 'medium',
	reasoningEffort: 'low',
	useSearch: true
});

console.log('Structured weather info:', result);
console.log('Temperature:', result.temperature);
console.log('Conditions:', result.conditions);
console.log('Location:', result.location);