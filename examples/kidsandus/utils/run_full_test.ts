// Full test with all cities - standalone version
const apiKey = Deno.env.get('BRIGHTDATA_API_KEY')!;
const OUTPUT_DIRECTORY = '/Users/victoriano/Code/datocat/supabase/functions/_shared/cuery/examples/kidsandus/chatgpt_response_data';

const places = [
	'Castellón', 'A Coruña', 'Albacete', 'Alcalá de Henares', 'Alcanar',
	'Alcobendas', 'Alcoi', 'Alcorcón', 'Alcúdia', 'Algeciras',
	'Algete', 'Getxo', 'Alhaurín de la Torre', 'Alicante', 'Almeria',
	'Madrid', 'Amposta', 'Aranda de Duero', 'Aranjuez', 'Arenys de Mar'
];

const prompts = places.map(place => `mejor academia de inglés para niños en ${place}`);

console.log(`Starting full test with ${places.length} cities...\n`);

interface RawSource {
	url: string;
	title?: string;
	domain?: string;
	cited?: boolean;
}

interface LinkAttached {
	url: string;
	position?: number;
	text?: string;
}

interface RawResponse {
	prompt?: string;
	answer_text_markdown?: string;
	citations?: Array<RawSource>;
	links_attached?: Array<LinkAttached>;
	search_sources?: Array<{ url?: string; title?: string; snippet?: string; rank?: number; date_published?: string }>;
	index?: number;
}

interface ProcessedSource {
	url: string;
	title: string;
	domain: string;
	cited?: boolean;
	positions?: number[];
}

function extractDomain(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

async function submitRequest(): Promise<string | null> {
	const url = 'https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_m7aof0k82r803d5bjm&include_errors=true';
	
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			custom_output_fields: 'url|prompt|answer_text_markdown|citations|links_attached|search_sources|index',
			input: prompts.map((prompt, index) => ({
				url: 'http://chatgpt.com/',
				prompt,
				web_search: true,
				country: 'ES',
				index
			}))
		})
	});
	
	console.log('Submit status:', response.status);
	
	if (response.status === 200) {
		return await response.text();
	} else if (response.status === 202) {
		const body = await response.json();
		return `SNAPSHOT:${body.snapshot_id}`;
	}
	return null;
}

async function waitForSnapshot(snapshotId: string): Promise<boolean> {
	const monitorUrl = `https://api.brightdata.com/datasets/v3/progress/${snapshotId}`;
	
	for (let i = 0; i < 120; i++) { // Up to 10 minutes
		const response = await fetch(monitorUrl, {
			headers: { 'Authorization': `Bearer ${apiKey}` }
		});
		
		if (response.ok) {
			const status = await response.json();
			console.log(`Poll ${i + 1}: ${status.status}`);
			
			if (status.status === 'ready' || status.status === 'complete') {
				return true;
			}
			if (status.status === 'failed' || status.status === 'error') {
				return false;
			}
		}
		
		await new Promise(r => setTimeout(r, 5000));
	}
	return false;
}

async function downloadSnapshot(snapshotId: string): Promise<RawResponse[]> {
	const downloadUrl = `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`;
	
	const response = await fetch(downloadUrl, {
		headers: { 'Authorization': `Bearer ${apiKey}` }
	});
	
	if (response.ok) {
		return await response.json();
	}
	return [];
}

function processResponse(data: RawResponse): {
	answer: string;
	sources: ProcessedSource[];
	searchSources: Array<{ url: string; title: string; domain: string; rank: number; datePublished: string | null }>;
} {
	const positionMap: Record<string, number[]> = {};
	for (const link of data.links_attached || []) {
		if (link.url && link.position != null) {
			if (!positionMap[link.url]) {
				positionMap[link.url] = [];
			}
			positionMap[link.url].push(link.position);
		}
	}
	
	const sources: ProcessedSource[] = (data.citations || []).map(cit => ({
		url: cit.url,
		title: cit.title || '',
		domain: cit.domain || extractDomain(cit.url),
		cited: cit.cited,
		positions: positionMap[cit.url] || undefined
	}));
	
	const searchSources = (data.search_sources || [])
		.filter(s => s.url)
		.map(s => ({
			url: s.url!,
			title: s.title || s.snippet || '',
			domain: extractDomain(s.url!),
			rank: s.rank || 0,
			datePublished: s.date_published || null
		}));
	
	return {
		answer: data.answer_text_markdown || '',
		sources,
		searchSources
	};
}

// Main
const responseData = await submitRequest();

let rawResults: RawResponse[] = [];

if (responseData?.startsWith('SNAPSHOT:')) {
	const snapshotId = responseData.replace('SNAPSHOT:', '');
	console.log('Waiting for snapshot:', snapshotId);
	const ready = await waitForSnapshot(snapshotId);
	if (ready) {
		rawResults = await downloadSnapshot(snapshotId);
	}
} else if (responseData) {
	rawResults = responseData.split('\n')
		.filter(l => l.trim())
		.map(l => JSON.parse(l));
}

// Sort by index
rawResults.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

console.log(`\n✓ Got ${rawResults.length} results\n`);

// Stats
let totalSourcesWithPositions = 0;
let totalSources = 0;

const processedResults = rawResults.map((raw, index) => {
	const processed = processResponse(raw);
	const place = places[index] || `Place ${index}`;
	
	const sourcesWithPositions = processed.sources.filter(s => s.positions && s.positions.length > 0);
	totalSources += processed.sources.length;
	totalSourcesWithPositions += sourcesWithPositions.length;
	
	console.log(`${place.padEnd(25)} | sources: ${processed.sources.length.toString().padStart(2)} | with positions: ${sourcesWithPositions.length}`);
	
	return {
		place,
		prompt: prompts[index],
		answer: processed.answer,
		sources: processed.sources,
		searchSources: processed.searchSources,
		searchQueries: []
	};
});

console.log(`\n=== SUMMARY ===`);
console.log(`Total sources: ${totalSources}`);
console.log(`Sources with positions: ${totalSourcesWithPositions} (${((totalSourcesWithPositions/totalSources)*100).toFixed(1)}%)`);

// Save results
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputPath = `${OUTPUT_DIRECTORY}/kidsandus_results_${timestamp}.json`;

await Deno.writeTextFile(outputPath, JSON.stringify({
	timestamp,
	places,
	prompts,
	results: processedResults
}, null, 2));

console.log(`\n✓ Results saved to: ${outputPath}`);
console.log('\nDone!');
