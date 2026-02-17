import { mapParallel, withRetries, type RetryConfig } from '../../helpers/async.ts';


const BRIGHTDATA_CONCURRENCY = 10;

const BRIGHTDATA_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 8000,
    backoffMultiplier: 2,
    statusCodes: [429, 500, 502, 503]
};

export interface BrightDataScrapeOptions {
    /** BrightData zone name. Defaults to "web_unlocker". */
    zone?: string;
    /** HTTP method for the target request. Defaults to "GET". */
    method?: 'GET' | 'POST';
    /** Country code for geo-targeting (e.g. "us", "gb", "de"). */
    country?: string;
    /** Request body for POST requests to the target URL. */
    body?: string;
    /** Additional headers to send to the target URL. */
    headers?: Record<string, string>;
    /** Custom retry configuration. */
    retryConfig?: RetryConfig;
}

export interface BrightDataScrapeResponse {
    url: string;
    html?: string;
}

function getApiKey(): string {
    const apiKey = Deno.env.get('BRIGHTDATA_API_KEY');
    if (apiKey == null) {
        throw new Error('BRIGHTDATA_API_KEY environment variable is required');
    }
    return apiKey;
}

async function fetchBrightData(
    url: string,
    apiKey: string,
    options: BrightDataScrapeOptions,
    retryConfig: RetryConfig
): Promise<Response> {
    const response = await withRetries(
        async () => {
            const body: Record<string, unknown> = {
                zone: options.zone ?? 'web_unlocker',
                url,
                format: 'raw',
                method: options.method ?? 'GET'
            };

            if (options.country != null) {
                body.country = options.country;
            }
            if (options.body != null) {
                body.body = options.body;
            }

            const headers: Record<string, string> = {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            };

            if (options.headers != null) {
                // Forward custom headers as part of the BrightData request
                body.headers = options.headers;
            }

            return fetch('https://api.brightdata.com/request', {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: (globalThis as Record<string, unknown>).abortSignal as AbortSignal | undefined
            });
        },
        retryConfig
    );

    if (!response.ok) {
        const status = response.status;
        let details = '';
        try {
            details = ` - ${await response.text()}`;
        } catch {
            // ignore
        }

        const errorMessage = status === 401
            ? 'BrightData API error (401): Invalid API key'
            : status === 403
                ? 'BrightData API error (403): Forbidden or credits exhausted'
                : status === 429
                    ? 'BrightData API error (429): Rate limit exceeded'
                    : `BrightData API error: ${status} ${response.statusText}${details}`;

        console.error(errorMessage);
        throw new Error(errorMessage);
    }

    return response;
}

/**
 * Scrape a single URL using BrightData Web Unlocker API.
 * Returns raw HTML content.
 */
export async function scrapeBrightData(
    url: string,
    options: BrightDataScrapeOptions = {}
): Promise<BrightDataScrapeResponse> {
    const apiKey = getApiKey();
    const retryConfig = options.retryConfig ?? BRIGHTDATA_RETRY_CONFIG;

    try {
        const response = await fetchBrightData(url, apiKey, options, retryConfig);
        const html = await response.text();
        return { url, html };
    } catch (error) {
        console.error(`BrightData scrape error for ${url}:`, error);
        return { url };
    }
}

/**
 * Scrape multiple URLs in parallel using BrightData Web Unlocker API.
 * Uses mapParallel with configurable concurrency.
 */
export async function scrapeBrightDataBatch(
    urls: Array<string>,
    options: BrightDataScrapeOptions = {},
    maxConcurrency: number = BRIGHTDATA_CONCURRENCY
): Promise<Array<BrightDataScrapeResponse>> {
    return mapParallel(
        urls,
        maxConcurrency,
        async (url: string) => {
            return await scrapeBrightData(url, options);
        }
    );
}
