/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */

import { mapParallel, withRetries, type RetryConfig } from '../../helpers/async.ts';


const HASDATA_CONCURRENCY = 29;

const HASDATA_RETRY_CONFIG: RetryConfig = {
	maxRetries: 3,
	initialDelay: 1000,
	maxDelay: 8000,
	backoffMultiplier: 2,
	statusCodes: [429, 500]
};

type ProxyType = 'datacenter' | 'residential';

type OutputFormat = 'markdown' | 'text' | 'html';

interface JSScenarioAction {
	click?: string;
	fill?: [string, string];
	wait?: number;
	waitFor?: string;
	scroll?: string;
	evaluate?: string;
}

export interface ScrapeOptions {
	formats: Array<OutputFormat>;
	proxyType?: ProxyType;
	proxyCountry?: string;
	extractLinks?: boolean;
	wait?: number;
	waitFor?: string;
	blockResources?: boolean;
	blockAds?: boolean;
	blockUrls?: Array<string>;
	jsRendering?: boolean;
	jsScenario?: Array<JSScenarioAction>;
	headers?: Record<string, string>;
}

export interface ScrapeResponse {
	url?: string;
	markdown?: string;
	text?: string;
	html?: string;
	links?: Array<string>;
}

export interface BatchJobResponse {
	jobId: string;
	status: string;
}

export interface BatchJobStatus {
	jobId: string;
	status: string;
	data: {
		status: string;
		requestsCount: number;
		responsesCount: number;
	}
}

/**
 * In batch jobs, results are only links to json files containing the actual scrape results.
*/

export interface BatchResultItem {
	query: Record<string, unknown>;
	result: {
		id: string;
		status: string;
		json?: string;
	};
}

export interface BatchResults {
	page: number;
	limit: number;
	total: number;
	results: Array<BatchResultItem>;
}

function cleanMarkdown(markdown: string, excludeImages: boolean = true): string {
	if (!markdown) {
		return '';
	}

	if (excludeImages) {
		// Remove markdown images: ![alt text](url)
		markdown = markdown.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');
		// Remove standalone "Image" text between line breaks (from plain text format)
		markdown = markdown.replace(/\n\s*Image\s*\n/g, '\n');
		// Clean up multiple consecutive newlines
		markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();
	}

	markdown = markdown.replace(/\u00a0/g, ' ');
	markdown = markdown.replace(/[ \t]+/g, ' ');

	const lines = markdown.split('\n').map(line => line.trim());
	const cleaned: Array<string> = [];

	for (const line of lines) {
		if (line || (cleaned.length > 0 && cleaned[cleaned.length - 1])) {
			cleaned.push(line);
		}
	}

	return cleaned.join('\n').trim();
}

async function fetchWithRetry(
	url: string,
	options: RequestInit,
	retryConfig: RetryConfig = HASDATA_RETRY_CONFIG
): Promise<Response> {
	const response = await withRetries(
		async () => fetch(url, {
			...options,
			signal: (globalThis as Record<string, unknown>).abortSignal as AbortSignal | undefined
		}),
		retryConfig
	);

	if (!response.ok) {
		const status = response.status;
		let errorMessage: string;

		if (status === 400) {
			let details = '';
			try {
				const body = await response.text();
				details = ` - ${body}`;
			} catch {
			}
			errorMessage = `HasData API error (400): Bad Request${details}`;
		} else if (status === 401) {
			errorMessage = 'HasData API error (401): Invalid API key';
		} else if (status === 403) {
			errorMessage = 'HasData API error (403): API credits exhausted';
		} else if (status === 404) {
			errorMessage = 'HasData API error (404): Resource not found';
		} else if (status === 422) {
			let details = '';
			try {
				const body = await response.text();
				details = ` - ${body}`;
			} catch {
			}
			errorMessage = `HasData API error (422): Unprocessable Entity${details}`;
		} else if (status === 429) {
			errorMessage = 'HasData API error (429): Rate limit exceeded';
		} else {
			errorMessage = `HasData API error: ${status} ${response.statusText}`;
		}

		console.error(errorMessage);
		throw new Error(errorMessage);
	}

	return response;
}

function configureRequestBody(body: Record<string, unknown>, options: ScrapeOptions): Record<string, unknown> {

	const formats: Array<string> = [...options.formats];
	if (!formats.includes('json')) {
		formats.push('json');
	}
	body.outputFormat = formats;

	if (options.proxyType) {
		body.proxyType = options.proxyType;
	}

	if (options.proxyCountry) {
		body.proxyCountry = options.proxyCountry;
	}

	if (options.extractLinks != null) {
		body.extractLinks = options.extractLinks;
	}

	if (options.wait != null) {
		body.wait = options.wait;
	}

	if (options.waitFor) {
		body.waitFor = options.waitFor;
	}

	if (options.blockResources != null) {
		body.blockResources = options.blockResources;
	}

	if (options.blockAds != null) {
		body.blockAds = options.blockAds;
	}

	if (options.blockUrls) {
		body.blockUrls = options.blockUrls;
	}

	if (options.jsRendering != null) {
		body.jsRendering = options.jsRendering;
	}

	if (options.jsScenario) {
		body.jsScenario = options.jsScenario;
	}

	if (options.headers) {
		body.headers = options.headers;
	}

	return body;
}

function getApiKey(): string {
	const apiKey = Deno.env.get('HASDATA_API_KEY');
	if (!apiKey) {
		throw new Error('HASDATA_API_KEY environment variable is required');
	}
	return apiKey;
}

export async function scrapeWeb(url: string, options: ScrapeOptions): Promise<ScrapeResponse> {
	const apiKey = getApiKey();
	const endpoint = 'https://api.hasdata.com/scrape/web';

	let requestBody: Record<string, unknown> = { url: url };
	requestBody = configureRequestBody(requestBody, options);

	try {
		const response = await fetchWithRetry(
			endpoint,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': apiKey
				},
				body: JSON.stringify(requestBody)
			}
		);

		const responseJson = await response.json();
		const result: ScrapeResponse = { url: url };

		if (responseJson.markdown) {
			result.markdown = cleanMarkdown(responseJson.markdown);
		}
		if (responseJson.text) {
			result.text = responseJson.text;
		}
		if (responseJson.content) {
			result.html = responseJson.content;
		}
		if (options.extractLinks && responseJson.links) {
			result.links = responseJson.links;
		}
		return result;
	} catch (error) {
		console.error('HasData Web Scraping API error:', error);
		return {};  // Return an empty object on error
	}
}

export async function scrapeWebBatch(
	urls: Array<string>,
	options: ScrapeOptions,
	maxConcurrency: number = HASDATA_CONCURRENCY
): Promise<Array<ScrapeResponse>> {
	return mapParallel(
		urls,
		maxConcurrency,
		async (url: string) => {
			return await scrapeWeb(url, options);
		}
	);
}

/** Submit a batch scrape job to HasData API.
 * IMPORTANT: results are not returned in original order! You need to match them by jobId and query.url.
*/
export async function submitBatchScrapeJob(
	urls: Array<string>,
	options: ScrapeOptions
): Promise<BatchJobResponse> {
	const apiKey = getApiKey();
	const endpoint = 'https://api.hasdata.com/scrape/batch/web/';

	const requestPayloads = urls.map((url) => {
		let payload: Record<string, unknown> = { url: url };
		payload = configureRequestBody(payload, options);
		return payload;
	});

	const requestBody: Record<string, unknown> = { requests: requestPayloads };

	try {
		const response = await fetchWithRetry(
			endpoint,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': apiKey
				},
				body: JSON.stringify(requestBody)
			}
		);

		return await response.json() as BatchJobResponse;
	} catch (error) {
		console.error('HasData Batch Scrape submission error:', error);
		throw error;
	}
}

export async function getBatchJobStatus(jobId: string): Promise<BatchJobStatus> {
	const apiKey = getApiKey();
	const endpoint = `https://api.hasdata.com/scrape/batch/web/${jobId}`;

	try {
		const response = await fetchWithRetry(
			endpoint,
			{
				method: 'GET',
				headers: {
					'x-api-key': apiKey
				}
			}
		);

		const status = await response.json() as BatchJobStatus;
		return status;
	} catch (error) {
		console.error('HasData Batch Job status error:', error);
		throw error;
	}
}

export async function waitForBatchCompletion(
	jobId: string,
	pollInterval: number = 5000,
	maxWaitTime: number = 300000
): Promise<BatchJobStatus> {
	const startTime = Date.now();

	while (true) {
		const status = await getBatchJobStatus(jobId);
		const endStates = ['done', 'stopped', 'finished', 'failed'];

		if (endStates.includes(status.data.status)) {
			return status;
		} else {
			const total = status.data.requestsCount;
			const completed = status.data.responsesCount;
			console.log(`Batch job ${jobId} in progress: ${completed}/${total} completed.`);
		}

		const elapsed = Date.now() - startTime;
		if (elapsed >= maxWaitTime) {
			throw new Error(`Batch job ${jobId} did not complete within ${maxWaitTime}ms`);
		}

		await new Promise(resolve => setTimeout(resolve, pollInterval));
	}
}

export async function getBatchJobPage(
	jobId: string,
	page: number = 0,
	limit: number = 100
): Promise<BatchResults> {
	const apiKey = getApiKey();
	const url = new URL(`https://api.hasdata.com/scrape/batch/web/${jobId}/results`);
	url.searchParams.set('page', page.toString());
	url.searchParams.set('limit', limit.toString());
	console.log(`Fetching batch job results from: ${url.toString()}`);

	try {
		const response = await fetchWithRetry(
			url.toString(),
			{
				method: 'GET',
				headers: {
					'x-api-key': apiKey
				}
			}
		);

		return await response.json() as BatchResults;
	} catch (error) {
		console.error('HasData Batch Job results error:', error);
		throw error;
	}
}

export async function runBatchScrape(
	urls: Array<string>,
	options: ScrapeOptions,
	pageSize: number = 100,
	pollInterval: number = 5000,
	maxWaitTime: number = 300000
): Promise<Array<ScrapeResponse>> {
	const { jobId } = await submitBatchScrapeJob(urls, options);
	const status = await waitForBatchCompletion(jobId, pollInterval, maxWaitTime);
	if (status.data.status === 'done') {
		console.log(`Batch job ${jobId} finished successfully.`);
	} else {
		throw new Error(`Batch job failed with status:\n${JSON.stringify(status, null, 2)}`);
	}

	const aggregatedResults: Array<ScrapeResponse> = [];
	let currentPage = 0;
	let hasMore = true;

	while (hasMore) {
		const pageResults = await getBatchJobPage(jobId, currentPage, pageSize);
		console.log(`Fetched page ${pageResults.page} with ${pageResults.results.length} results.`);

		const scrapeResponses = await mapParallel(
			pageResults.results,
			HASDATA_CONCURRENCY,
			async (item: BatchResultItem) => {
				if (item.result.status === 'ok' && item.result.json) {
					try {
						const response = await fetchWithRetry(item.result.json, { method: 'GET' });
						const fullResponse = await response.json();
						const scrapeResponse: ScrapeResponse = {
							url: item.query.url as string
						};

						if (options.formats.includes('markdown') && fullResponse.markdown) {
							scrapeResponse.markdown = cleanMarkdown(fullResponse.markdown);
						}
						if (options.formats.includes('text') && fullResponse.text) {
							scrapeResponse.text = fullResponse.text;
						}
						if (options.formats.includes('html') && fullResponse.content) {
							scrapeResponse.html = fullResponse.content;
						}
						if (options.extractLinks && fullResponse.links) {
							scrapeResponse.links = fullResponse.links;
						}

						return scrapeResponse;
					} catch (error) {
						console.error(`Failed to fetch result for ${item.query.url}:`, error);
						return {};
					}
				}
				return {};
			}
		);

		aggregatedResults.push(...scrapeResponses);

		if (pageResults.results.length < pageSize || (pageResults.page + 1) * pageResults.limit >= pageResults.total) {
			hasMore = false;
		} else {
			currentPage += 1;
		}
	}

	return aggregatedResults;
}
