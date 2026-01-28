const apiKey = Deno.env.get('BRIGHTDATA_API_KEY');
const url = 'https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_m7aof0k82r803d5bjm&include_errors=true';

const response = await fetch(url, {
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        custom_output_fields: 'url|prompt|answer_text_markdown|citations|links_attached|search_sources',
        input: [{
            url: 'http://chatgpt.com/',
            prompt: 'mejor academia de ingles para ninos en Alcudia',
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
console.log('Response length:', text.length);
const lines = text.split('\n').filter((l: string) => l.trim());
console.log('Lines:', lines.length);

for (const line of lines) {
    const data = JSON.parse(line);
    console.log('\nKeys:', Object.keys(data));
    console.log('citations count:', (data.citations || []).length);
    console.log('links_attached count:', (data.links_attached || []).length);
    
    if (data.links_attached && data.links_attached.length > 0) {
        console.log('\n=== LINKS_ATTACHED ===');
        for (const link of data.links_attached.slice(0, 5)) {
            console.log(`  pos=${link.position} | ${(link.url || '').substring(0, 60)}`);
        }
    }
    
    if (data.citations && data.citations.length > 0) {
        console.log('\n=== CITATIONS ===');
        for (let i = 0; i < Math.min(data.citations.length, 5); i++) {
            const cit = data.citations[i];
            console.log(`  [${i}] cited=${cit.cited} | ${(cit.title || '').substring(0, 50)}`);
        }
    }
    
    if (data.answer_text_markdown) {
        console.log('\n=== ANSWER excerpt ===');
        const lines = data.answer_text_markdown.split('\n');
        for (const l of lines.slice(0, 15)) {
            if (l.includes('\\[')) {
                console.log(l.substring(0, 100));
            }
        }
    }
}
