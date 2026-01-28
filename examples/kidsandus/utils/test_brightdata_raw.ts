// Test script to see raw Brightdata response structure
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
const lines = text.split('\n').filter(l => l.trim());

for (const line of lines) {
    const data = JSON.parse(line);
    console.log('\n=== RAW RESPONSE ===');
    console.log('Keys:', Object.keys(data));
    
    console.log('\n=== CITATIONS ===');
    console.log(JSON.stringify(data.citations?.slice(0, 5), null, 2));
    
    console.log('\n=== LINKS_ATTACHED ===');
    console.log(JSON.stringify(data.links_attached?.slice(0, 10), null, 2));
    
    console.log('\n=== ANSWER excerpt ===');
    const answer = data.answer_text_markdown || '';
    // Show first 1000 chars
    console.log(answer.substring(0, 1500));
}
