// Test to verify positions are correctly assigned using simple fetch
// This doesn't use npm modules

const apiKey = Deno.env.get('BRIGHTDATA_API_KEY');
if (!apiKey) {
    console.error('BRIGHTDATA_API_KEY not set');
    Deno.exit(1);
}

const url = 'https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_m7aof0k82r803d5bjm&include_errors=true';

interface Link {
    url?: string;
    position?: number;
    text?: string;
}

interface Citation {
    url: string;
    title?: string;
    cited?: boolean;
}

interface RawResponse {
    answer_text_markdown?: string;
    citations?: Citation[];
    links_attached?: Link[];
}

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
const lines = text.split('\n').filter((l: string) => l.trim());

for (const line of lines) {
    const data: RawResponse = JSON.parse(line);
    
    // Simulate validate() logic
    const linkPositions: Record<string, number[]> = {};
    for (const link of data.links_attached || []) {
        if (link.url && link.position != null) {
            if (!linkPositions[link.url]) {
                linkPositions[link.url] = [];
            }
            linkPositions[link.url].push(link.position);
        }
    }
    
    // Build sources with positions
    const sources = (data.citations || []).map(cit => ({
        title: cit.title || '',
        url: cit.url,
        cited: cit.cited,
        positions: linkPositions[cit.url] || undefined
    }));
    
    console.log('\n=== SOURCES with positions (as validate() would return) ===');
    for (let i = 0; i < Math.min(sources.length, 8); i++) {
        const s = sources[i];
        const posStr = s.positions ? JSON.stringify(s.positions) : '[]';
        console.log(`[${i}] positions=${posStr.padEnd(10)} cited=${s.cited} | ${s.title.substring(0, 45)}`);
    }
    
    console.log('\n=== VERIFICATION ===');
    const answer = data.answer_text_markdown || '';
    const citationMatches = answer.match(/\\\[(\d+)\\\]/g) || [];
    const citationNumbers = [...new Set(citationMatches.map(m => parseInt(m.replace(/\\\[|\\\]/g, ''))))].sort((a, b) => a - b);
    console.log('Citations in text:', citationNumbers);
    
    // Build position -> source mapping
    console.log('\nPosition -> Source title:');
    for (const pos of citationNumbers) {
        const source = sources.find(s => s.positions?.includes(pos));
        if (source) {
            console.log(`  [${pos}] -> ${source.title.substring(0, 50)} ✓`);
        } else {
            console.log(`  [${pos}] -> NOT FOUND ✗`);
        }
    }
    
    // Show answer excerpt with citations
    console.log('\n=== ANSWER excerpt ===');
    for (const line of answer.split('\n').slice(0, 20)) {
        if (line.includes('\\[')) {
            console.log(line.substring(0, 120));
        }
    }
}
