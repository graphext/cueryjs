// Simple test to verify positions field - direct API call
const apiKey = Deno.env.get('BRIGHTDATA_API_KEY');
if (!apiKey) {
    console.error('BRIGHTDATA_API_KEY not set');
    Deno.exit(1);
}

const url = 'https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_m7aof0k82r803d5bjm&include_errors=true';

const response = await fetch(url, {
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        custom_output_fields: 'url|prompt|answer_text_markdown|citations|links_attached|search_sources|model|web_search_query',
        input: [{
            url: 'http://chatgpt.com/',
            prompt: 'mejor academia de inglés para niños en Alcúdia',
            web_search: true,
            country: 'ES'
        }]
    })
});

console.log('Status:', response.status);

if (response.status === 202) {
    const body = await response.json();
    console.log('Timeout, snapshot_id:', body.snapshot_id);
    Deno.exit(0);
}

const text = await response.text();
const lines = text.split('\n').filter((l: string) => l.trim());

for (const line of lines) {
    const data = JSON.parse(line);
    
    // Process like the updated validate() should do
    // Build position map from links_attached
    const positionMap = new Map<string, number[]>();
    
    if (data.links_attached) {
        for (const link of data.links_attached) {
            if (link.url && link.position) {
                const existing = positionMap.get(link.url) || [];
                existing.push(link.position);
                positionMap.set(link.url, existing);
            }
        }
    }
    
    console.log('\n=== LINKS_ATTACHED (raw) ===');
    console.log(JSON.stringify(data.links_attached?.slice(0, 8), null, 2));
    
    console.log('\n=== POSITION MAP (url -> positions) ===');
    for (const [url, positions] of positionMap.entries()) {
        const shortUrl = url.substring(0, 60);
        console.log(`positions: ${JSON.stringify(positions)} | ${shortUrl}...`);
    }
    
    console.log('\n=== ANSWER excerpt ===');
    const answer = data.answer_text_markdown || '';
    const lines2 = answer.split('\n');
    for (const line2 of lines2.slice(0, 30)) {
        if (line2.includes('\\[') && line2.includes('\\]')) {
            console.log(line2.substring(0, 120));
        }
    }
    
    console.log('\n=== VERIFICATION: Position -> URL ===');
    const allPositions: {pos: number, url: string, title: string}[] = [];
    for (const link of (data.links_attached || [])) {
        if (link.position) {
            allPositions.push({pos: link.position, url: link.url, title: link.text || ''});
        }
    }
    allPositions.sort((a, b) => a.pos - b.pos);
    
    for (const item of allPositions) {
        console.log(`[${item.pos}] -> ${item.title.substring(0, 40)} | ${item.url.substring(0, 50)}...`);
    }
}
