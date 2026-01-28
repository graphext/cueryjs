const apiKey = Deno.env.get('BRIGHTDATA_API_KEY')!;

// Step 1: Submit request
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
            input: [{
                url: 'http://chatgpt.com/',
                prompt: 'mejor academia de ingles para ninos en Alcudia',
                web_search: true,
                country: 'ES'
            }]
        })
    });
    
    console.log('Submit status:', response.status);
    
    if (response.status === 200) {
        // Direct result
        const text = await response.text();
        processResults(text);
        return null;
    } else if (response.status === 202) {
        const body = await response.json();
        return body.snapshot_id;
    }
    return null;
}

// Step 2: Poll for snapshot
async function waitForSnapshot(snapshotId: string): Promise<boolean> {
    const monitorUrl = `https://api.brightdata.com/datasets/v3/progress/${snapshotId}`;
    
    for (let i = 0; i < 60; i++) { // Max 5 minutes
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
        
        await new Promise(r => setTimeout(r, 5000)); // Wait 5 seconds
    }
    return false;
}

// Step 3: Download results
async function downloadSnapshot(snapshotId: string): Promise<void> {
    const downloadUrl = `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`;
    
    const response = await fetch(downloadUrl, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    
    if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
            for (const item of data) {
                processResult(item);
            }
        }
    }
}

function processResults(text: string) {
    const lines = text.split('\n').filter(l => l.trim());
    for (const line of lines) {
        processResult(JSON.parse(line));
    }
}

function processResult(data: any) {
    console.log('\n=== PROCESSING RESULT ===');
    
    // Build linkPositions map
    const linkPositions: Record<string, number[]> = {};
    for (const link of data.links_attached || []) {
        if (link.url && link.position != null) {
            if (!linkPositions[link.url]) {
                linkPositions[link.url] = [];
            }
            linkPositions[link.url].push(link.position);
        }
    }
    
    console.log('links_attached count:', (data.links_attached || []).length);
    console.log('citations count:', (data.citations || []).length);
    
    // Show links_attached
    if (data.links_attached?.length > 0) {
        console.log('\n=== LINKS_ATTACHED (position map) ===');
        for (const link of data.links_attached.slice(0, 6)) {
            console.log(`  position=${link.position} | ${(link.url || '').substring(0, 55)}...`);
        }
    }
    
    // Build sources with positions
    const sources = (data.citations || []).map((cit: any) => ({
        title: cit.title || '',
        url: cit.url,
        cited: cit.cited,
        positions: linkPositions[cit.url] || undefined
    }));
    
    console.log('\n=== SOURCES with positions ===');
    for (let i = 0; i < Math.min(sources.length, 8); i++) {
        const s = sources[i];
        const posStr = s.positions ? JSON.stringify(s.positions) : '[]';
        console.log(`[${i}] positions=${posStr.padEnd(12)} cited=${s.cited} | ${s.title.substring(0, 40)}`);
    }
    
    // Verification
    const answer = data.answer_text_markdown || '';
    const citationMatches = answer.match(/\\\[(\d+)\\\]/g) || [];
    const citationNumbers = [...new Set(citationMatches.map((m: string) => parseInt(m.replace(/\\\[|\\\]/g, ''))))].sort((a, b) => a - b);
    
    console.log('\n=== VERIFICATION ===');
    console.log('Citations in text:', citationNumbers);
    
    console.log('\nPosition -> Source:');
    for (const pos of citationNumbers) {
        const source = sources.find((s: any) => s.positions?.includes(pos));
        if (source) {
            console.log(`  [${pos}] -> ${source.title.substring(0, 45)} ✓`);
        } else {
            console.log(`  [${pos}] -> NOT FOUND ✗`);
        }
    }
    
    console.log('\n=== ANSWER excerpt ===');
    for (const line of answer.split('\n').slice(0, 15)) {
        if (line.includes('\\[')) {
            console.log(line.substring(0, 100));
        }
    }
}

// Main
const snapshotId = await submitRequest();
if (snapshotId) {
    console.log('Waiting for snapshot:', snapshotId);
    const ready = await waitForSnapshot(snapshotId);
    if (ready) {
        await downloadSnapshot(snapshotId);
    } else {
        console.log('Snapshot failed or timed out');
    }
}
