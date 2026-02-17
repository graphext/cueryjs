import { assertEquals, assert } from '@std/assert';

import { scrapeBrightData } from '../src/apis/brightdata/scrape.ts';

const SKIP_BRIGHTDATA = !Deno.env.get('RUN_BRIGHTDATA_TESTS');

Deno.test({
    name: 'scrapeBrightData - returns raw HTML for a single URL',
    ignore: SKIP_BRIGHTDATA,
    async fn() {
        const url = 'https://salavillanos.es/agenda/';
        const result = await scrapeBrightData(url);

        assertEquals(result.url, url);
        assert(result.html != null, 'Expected html to be present in the response');
        assert(result.html.length > 0, 'Expected html to be non-empty');
        assert(result.html.includes('<'), 'Expected response to contain HTML tags');
        assert(result.html.includes('</'), 'Expected response to contain closing HTML tags');
        assert(
            result.html.toLowerCase().includes('<!doctype') || result.html.toLowerCase().includes('<html'),
            'Expected response to be a full HTML document'
        );
    }
});
