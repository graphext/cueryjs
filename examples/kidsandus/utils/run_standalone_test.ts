// Standalone test script - no npm dependencies
const apiKey = Deno.env.get('BRIGHTDATA_API_KEY')!;
const OUTPUT_DIRECTORY = '/Users/victoriano/Code/datocat/supabase/functions/_shared/cuery/examples/kidsandus/chatgpt_response_data';

// Small test with 3 cities
const places = ['Alcúdia', 'Barcelona', 'Madrid'];
const prompts = places.map(place => `mejor academia de inglés para niños en ${place}`);

console.log('Starting small test with 3 cities...\n');

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

// Submit request
async function submitRequest(): Promise<string | null> {
	const url = 'https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_m7aof0k82r803d5bjm&include_errors=true';
	
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			custom_output_fields: 'url|prompt|answer_text_markdown|citations|links_attached|search_sources',
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
		const text = await response.text();
		return text; // Return raw text for 200
	} else if (response.status === 202) {
		const body = await response.json();
		return `SNAPSHOT:${body.snapshot_id}`;
	}
	return null;
}

// Poll for snapshot
async function waitForSnapshot(snapshotId: string): Promise<boolean> {
	const monitorUrl = `https://api.brightdata.com/datasets/v3/progress/${snapshotId}`;
	
	for (let i = 0; i < 60; i++) {
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

// Download snapshot
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

// Process response with positions
function processResponse(data: RawResponse): {
	answer: string;
	sources: ProcessedSource[];
} {
	// Build position map from links_attached
	const positionMap: Record<string, number[]> = {};
	for (const link of data.links_attached || []) {
		if (link.url && link.position != null) {
			if (!positionMap[link.url]) {
				positionMap[link.url] = [];
			}
			positionMap[link.url].push(link.position);
		}
	}
	
	// Process citations with positions
	const sources: ProcessedSource[] = (data.citations || []).map(cit => ({
		url: cit.url,
		title: cit.title || '',
		domain: cit.domain || extractDomain(cit.url),
		cited: cit.cited,
		positions: positionMap[cit.url] || undefined
	}));
	
	return {
		answer: data.answer_text_markdown || '',
		sources
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
	// Parse NDJSON
	rawResults = responseData.split('\n')
		.filter(l => l.trim())
		.map(l => JSON.parse(l));
}

console.log(`\n✓ Got ${rawResults.length} results\n`);

// Process results
const processedResults = rawResults.map((raw, index) => {
	const processed = processResponse(raw);
	const place = places[index] || `Place ${index}`;
	
	const sourcesWithPositions = processed.sources.filter(s => s.positions && s.positions.length > 0);
	
	console.log(`\n=== ${place} ===`);
	console.log(`Total sources: ${processed.sources.length}`);
	console.log(`Sources with positions: ${sourcesWithPositions.length}`);
	
	if (sourcesWithPositions.length > 0) {
		console.log('\nSources with positions:');
		sourcesWithPositions.forEach(s => {
			console.log(`  positions=${JSON.stringify(s.positions).padEnd(12)} | ${s.title?.substring(0, 40)}`);
		});
	}
	
	return {
		place,
		prompt: prompts[index],
		answer: processed.answer,
		sources: processed.sources,
		sources_count: processed.sources.length,
		sources_with_positions: sourcesWithPositions.length
	};
});

// Save results
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputPath = `${OUTPUT_DIRECTORY}/kidsandus_small_test_${timestamp}.json`;

await Deno.writeTextFile(outputPath, JSON.stringify({
	timestamp,
	places,
	prompts,
	results: processedResults
}, null, 2));

console.log(`\n\n✓ Results saved to: ${outputPath}`);
console.log('\nTest completed!');
