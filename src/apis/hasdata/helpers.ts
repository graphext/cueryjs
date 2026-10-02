import { NetworkRetryError, sleep, withRetries, type RetryConfig } from '../../helpers/async.ts';

import type { Source } from '../../schemas/sources.schema.ts';
import { extractDomain } from '../../helpers/urls.ts';

export const HASDATA_CONCURRENCY = 15;

export const HASDATA_RETRY_CONFIG: RetryConfig = {
	maxRetries: 3,
	initialDelay: 1000,
	maxDelay: 8000,
	backoffMultiplier: 2,
	statusCodes: [400, 429, 500]
};

export class HasDataError extends Error {
	readonly retryable: boolean;

	constructor(message: string, readonly status?: number, options?: ErrorOptions) {
		super(message, options);
		this.name = 'HasDataError';
		this.retryable = status == null || [400, 408, 425, 429, 500, 502, 503, 504].includes(status);
	}
}

async function logHasDataFailure(response: Response, url: string, requestValues: Array<string>): Promise<void> {
	const parsedUrl = new URL(url);
	const sensitiveParams = [...parsedUrl.searchParams.entries()]
		.filter(([key]) => /^(q|query|page[_-]?token|token|api[_-]?key|key|authorization|auth)$/i.test(key))
		.map(([, value]) => value);
	const sensitiveValues = [getHasDataApiKey(), ...sensitiveParams, ...requestValues]
		.filter(value => value.length > 0).sort((left, right) => right.length - left.length);
	const sensitiveVariants = [...new Set(sensitiveValues.flatMap(value => {
		const encoded = [encodeURIComponent(value), new URLSearchParams({ value }).toString().slice(6)];
		return [value, ...encoded, ...encoded.map(item => item.replace(/%[A-F\d]{2}/g, part => part.toLowerCase()))];
	}))].sort((left, right) => right.length - left.length);
	const sanitize = (value: string): string => {
		for (const sensitive of sensitiveVariants) {
			value = value.replaceAll(sensitive, '[redacted]');
		}
		return value.replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
			.replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
			.replace(/[A-Za-z0-9_=-]{32,}/g, '[redacted]')
			.replace(/[\r\n\t]/g, ' ').slice(0, 500);
	};
	let detail: unknown = 'Response body unavailable';
	try {
		const reader = response.body?.getReader();
		if (reader) {
			const chunks: Array<Uint8Array> = [];
			let length = 0;
			try {
				while (length <= 8192) {
					const chunk = await reader.read();
					if (chunk.done) { break; }
					length += chunk.value.byteLength;
					if (length <= 8192) { chunks.push(chunk.value); }
				}
			} finally {
				await reader.cancel();
			}
			if (length <= 8192) {
				const bytes = new Uint8Array(length);
				let offset = 0;
				for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
				const body = JSON.parse(new TextDecoder().decode(bytes));
				// Keep validation structure, never echoed inputs, tokens, or request metadata.
				const summarize = (value: unknown, depth = 0): unknown => {
					if (depth > 4) { return '[truncated]'; }
					if (Array.isArray(value)) { return value.slice(0, 5).map(item => summarize(item, depth + 1)); }
					if (value && typeof value === 'object') {
						return Object.fromEntries(Object.entries(value)
							.filter(([key]) => ['error', 'errors', 'detail', 'message', 'msg', 'type', 'code', 'loc'].includes(key))
							.map(([key, item]) => [key, summarize(item, depth + 1)]));
					}
					return typeof value === 'string' ? sanitize(value) : typeof value === 'number' ? value : null;
				};
				detail = summarize(body);
			} else { detail = 'Response body exceeds diagnostic limit'; }
		}
	} catch { /* Diagnostic failures must not replace the provider error. */ }
	const requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? '';
	console.error('HasData request failed', {
		status: response.status,
		endpoint: `${parsedUrl.origin}${parsedUrl.pathname}`,
		requestId: /^[A-Za-z0-9._:-]{1,128}$/.test(requestId) && !sensitiveValues.includes(requestId)
			? requestId : undefined,
		detail
	});
}

export function getHasDataApiKey(): string {
	const apiKey = Deno.env.get('HASDATA_API_KEY');
	if (!apiKey) {
		throw new Error('HASDATA_API_KEY environment variable is required');
	}
	return apiKey;
}

export interface HasDataRetryOptions {
	diagnosticSensitiveValues?: Array<string>;
	expiresAt?: number;
}

export async function fetchHasDataWithRetry(
	url: string,
	retryConfig: RetryConfig = HASDATA_RETRY_CONFIG,
	requestSignal?: AbortSignal,
	{ diagnosticSensitiveValues = [], expiresAt }: HasDataRetryOptions = {}
): Promise<Response> {
	const headers: Record<string, string> = {
		'x-api-key': getHasDataApiKey()
	};
	const globalSignal = (globalThis as Record<string, unknown>).abortSignal as AbortSignal | undefined;
	const signals = [requestSignal, retryConfig.signal, globalSignal].filter((value): value is AbortSignal => value != null);
	const callerSignal = signals.length > 0 ? AbortSignal.any(signals) : undefined;
	const freshness = expiresAt == null ? undefined : new AbortController();
	const signal = freshness ? AbortSignal.any([...signals, freshness.signal]) : callerSignal;
	let rateLimitDelay = retryConfig.initialDelay ?? 1000;

	let response: Response;
	try {
		response = await withRetries(
			async () => {
				while (true) {
					callerSignal?.throwIfAborted();
					// Honor the full Retry-After wait before deciding whether to refresh an expired token.
					if (expiresAt != null && Date.now() >= expiresAt) {
						freshness?.abort(new HasDataError('HasData AI Overview request expired; refresh the search', 400));
					}
					signal?.throwIfAborted();
					const response = await fetch(url, { headers, signal });
					if (response.status !== 429) {
						return response;
					}

					// Rate limiting defers this attempt; it does not consume the failure budget.
					const retryAfter = response.headers.get('Retry-After')?.trim();
					let delay = rateLimitDelay;
					if (retryAfter) {
						const seconds = /^\d+$/.test(retryAfter) ? Number(retryAfter) : NaN;
						const date = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(retryAfter)
							? Date.parse(retryAfter) : NaN;
						if (Number.isSafeInteger(seconds * 1000)) {
							delay = seconds * 1000;
						} else if (Number.isFinite(date)) {
							delay = Math.max(0, date - Date.now());
						}
					}
					await response.body?.cancel();
					// setTimeout overflows above a signed 32-bit duration; keep long waits abortable.
					while (delay > 2147483647) {
						await sleep(2147483647, signal);
						delay -= 2147483647;
					}
					await sleep(delay, signal);
					rateLimitDelay = Math.min(
						rateLimitDelay * (retryConfig.backoffMultiplier ?? 2),
						retryConfig.maxDelay ?? 8000
					);
				}
			},
			{ ...retryConfig, signal }
		);
	} catch (error) {
		callerSignal?.throwIfAborted();
		if (freshness?.signal.aborted) {
			throw freshness.signal.reason;
		}
		signal?.throwIfAborted();
		if (error instanceof NetworkRetryError) {
			throw new HasDataError(error.message, undefined, { cause: error.cause });
		}
		throw error;
	}
	signal?.throwIfAborted();

	if (!response.ok) {
		const status = response.status;
		let errorMessage: string;

		if (status === 401) {
			errorMessage = 'HasData API error (401): Invalid API key';
		} else if (status === 403) {
			errorMessage = 'HasData API error (403): API credits exhausted';
		} else if (status === 404) {
			errorMessage = 'HasData API error (404): Page not found';
		} else {
			errorMessage = `HasData API error: ${status} ${response.statusText}`;
		}

		await logHasDataFailure(response, url, diagnosticSensitiveValues);
		signal?.throwIfAborted();
		throw new HasDataError(errorMessage, status);
	}

	return response;
}

interface ListItem {
	title?: string;
	snippet?: string;
	list?: Array<ListItem>;
}

interface TextBlock {
	type?: string;
	snippet?: string;
	snippetHighlightedWords?: Array<string>;
	referenceIndexes?: Array<number>;
	list?: Array<ListItem>;
	rows?: Array<Array<string>>;
	thumbnail?: string;
	language?: string;
}

interface Reference {
	index?: number;
	title?: string;
	link?: string;
	url?: string;
	snippet?: string;
	source?: string;
}

export interface AIOverview {
	textBlocks?: Array<TextBlock>;
	references?: Array<Reference>;
	aiOverview?: AIOverview;
	pageToken?: string;
	hasdataLink?: string;
}

interface RequestMetadata {
	id?: string;
	status?: string;
	html?: string;
	url?: string;
}

export interface AIMode {
	requestMetadata?: RequestMetadata;
	textBlocks?: Array<TextBlock>;
	references?: Array<Reference>;
}

export interface AIOParsed {
	answer: string;
	answerMarkdown?: string;
	sources: Array<Source>;
}

interface ParseOptions {
	allowNestedOverview?: boolean;
}

function removeCSSChunks(text: string): string {
	if (!text) {
		return '';
	}

	// Remove CSS blocks that start with :root (anchored pattern - safe)
	text = text.replace(/:root\{[^}]*\}(?:@supports[^}]*\{[^}]*\{[^}]*\}\})?(?:\.[a-zA-Z0-9_-]+\{[^}]*\})*\.?/g, '');

	// Remove standalone @supports blocks (less common but safe anchor)
	text = text.replace(/@supports[^\{]*\{(?:[^{}]|\{[^}]*\})*\}/g, '');

	// Only remove class blocks if they appear in suspicious patterns (3+ consecutive)
	text = text.replace(/(?:\.[a-zA-Z0-9_-]+\{[^}]*\}){3,}/g, '');

	return text;
}

function cleanText(text: string): string {
	if (!text) {
		return '';
	}
	text = removeCSSChunks(text);
	text = text.replace(/\u00a0/g, ' ');
	text = text.replace(/[ \t]+/g, ' ');
	const lines = text.split('\n').map(line => line.trim());
	const cleaned: Array<string> = [];
	for (const line of lines) {
		if (line || (cleaned.length > 0 && cleaned[cleaned.length - 1])) {
			cleaned.push(line);
		}
	}
	return cleaned.join('\n').trim();
}

function* iterListItems(items: Array<ListItem>, indent: number = 0): Generator<string> {
	const prefix = '  '.repeat(indent) + '- ';
	for (const obj of items) {
		const title = obj.title || '';
		const snippet = obj.snippet || '';
		let line: string;
		if (title && snippet && title.endsWith(':')) {
			line = `${title} ${snippet}`.trim();
		} else {
			line = [title, snippet].filter(p => p).join(' ').trim();
		}
		if (line) {
			yield prefix + cleanText(line);
		}
		if (obj.list && Array.isArray(obj.list)) {
			yield* iterListItems(obj.list, indent + 1);
		}
	}
}

function* iterPlainListItems(items: Array<ListItem>): Generator<string> {
	for (const obj of items) {
		const title = obj.title || '';
		const snippet = obj.snippet || '';
		const line = [title, snippet].filter(Boolean).join(' ').trim();
		if (line) {
			yield cleanText(line);
		}
		if (obj.list && Array.isArray(obj.list)) {
			yield* iterPlainListItems(obj.list);
		}
	}
}

function formatTable(block: TextBlock): string {
	const rows = block.rows || [];
	if (rows.length === 0) {
		return '';
	}
	const out: Array<string> = [];
	const header = rows[0].map(cell => removeCSSChunks(cell));
	out.push('| ' + header.join(' | ') + ' |');
	out.push('| ' + header.map(() => '---').join(' | ') + ' |');
	for (let i = 1; i < rows.length; i++) {
		const cleanedRow = rows[i].map(cell => removeCSSChunks(cell));
		out.push('| ' + cleanedRow.join(' | ') + ' |');
	}
	return out.join('\n');
}

function formatCode(block: TextBlock): string {
	const lang = block.language || '';
	const snippet = block.snippet || '';
	if (!snippet) {
		return '';
	}
	const header = `[Code${lang ? ': ' + lang : ''}]`;
	return `${header}\n${snippet.trim()}`;
}

function formatPlainTable(block: TextBlock): string {
	const rows = block.rows || [];
	if (rows.length === 0) {
		return '';
	}
	return rows
		.map((row) => row.map(cell => removeCSSChunks(cell)).join(' | '))
		.join('\n');
}

function formatPlainCode(block: TextBlock): string {
	return cleanText(block.snippet || '');
}

function formatCitationMarkers(refIndexes: Array<number>): string {
	if (refIndexes.length === 0) {
		return '';
	}
	return ' ' + refIndexes.map(i => `[${i + 1}]`).join('');
}

function parseAIResult(
	data: AIOverview,
	{
		allowNestedOverview = true
	}: ParseOptions = {}
): AIOParsed {
	const textBlocks = data.textBlocks || (allowNestedOverview ? data.aiOverview?.textBlocks : []) || [];

	// Build reference index → source index mapping and track cited refs
	const refs = data.references || (allowNestedOverview ? data.aiOverview?.references : []) || [];
	const sources: Array<Source> = [];
	const refIndexToSourceIndex = new Map<number, number>();

	for (const r of refs) {
		const link = r.link || r.url;
		const title = r.title ?? '';
		const snippet = cleanText(r.snippet || '') || undefined;
		if (link && r.index != null) {
			// Deduplicate by URL
			const existingIdx = sources.findIndex(s => s.url === link);
			if (existingIdx >= 0) {
				refIndexToSourceIndex.set(r.index, existingIdx);
				if (!sources[existingIdx].title && title) {
					sources[existingIdx].title = title;
				}
				if (!sources[existingIdx].snippet && snippet) {
					sources[existingIdx].snippet = snippet;
				}
			} else {
				refIndexToSourceIndex.set(r.index, sources.length);
				sources.push({
					title,
					snippet,
					url: link,
					domain: extractDomain(link)
				});
			}
		}
	}

	const citedSourceIndexes = new Set<number>();

	const answerParts: Array<string> = [];
	const answerMarkdownParts: Array<string> = [];
	const plainHandlers: Record<string, (block: TextBlock) => string> = {
		paragraph: (b) => cleanText(b.snippet || ''),
		list: (b) => Array.from(iterPlainListItems(b.list || [])).join('\n'),
		table: formatPlainTable,
		code: formatPlainCode
	};
	const markdownHandlers: Record<string, (block: TextBlock) => string> = {
		paragraph: (b) => cleanText(b.snippet || ''),
		list: (b) => Array.from(iterListItems(b.list || [])).join('\n'),
		table: formatTable,
		code: formatCode
	};

	for (const block of textBlocks) {
		const btype = block.type || (block.snippet ? 'paragraph' : null);
		if (!btype || btype === 'carousel') {
			continue;
		}
		const plainHandler = plainHandlers[btype];
		const markdownHandler = markdownHandlers[btype];
		let rendered = '';
		let renderedMarkdown = '';
		if (plainHandler) {
			rendered = plainHandler(block);
		} else {
			const snippet = block.snippet || '';
			if (snippet) {
				rendered = cleanText(snippet);
			}
		}
		if (markdownHandler) {
			renderedMarkdown = markdownHandler(block);
		} else {
			const snippet = block.snippet || '';
			if (snippet) {
				renderedMarkdown = cleanText(snippet);
			}
		}
		if (rendered || renderedMarkdown) {
			// Append citation markers and track positions
			const refIndexes = block.referenceIndexes || [];
			if (refIndexes.length > 0) {
				// Map ref indexes to 1-based source indexes for display
				const sourceIndexes = refIndexes
					.map(ri => refIndexToSourceIndex.get(ri))
					.filter((si): si is number => si != null);
				const uniqueSourceIndexes = sourceIndexes.filter((v, i, a) => a.indexOf(v) === i);

				for (const si of uniqueSourceIndexes) {
					citedSourceIndexes.add(si);
					sources[si].positions ??= [];
					const citationNumber = si + 1;
					if (!sources[si].positions!.includes(citationNumber)) {
						sources[si].positions!.push(citationNumber);
					}
				}

				const citationMarkers = formatCitationMarkers(uniqueSourceIndexes);
				rendered += citationMarkers;
				renderedMarkdown += citationMarkers;
			}
			answerParts.push(rendered);
			answerMarkdownParts.push(renderedMarkdown);
		}
	}

	// Mark cited sources
	for (const si of citedSourceIndexes) {
		sources[si].cited = true;
	}

	const dedupedAnswer: Array<string> = [];
	for (const part of answerParts) {
		if (dedupedAnswer.length === 0 || dedupedAnswer[dedupedAnswer.length - 1] !== part) {
			dedupedAnswer.push(part);
		}
	}

	const dedupedAnswerMarkdown: Array<string> = [];
	for (const part of answerMarkdownParts) {
		if (dedupedAnswerMarkdown.length === 0 || dedupedAnswerMarkdown[dedupedAnswerMarkdown.length - 1] !== part) {
			dedupedAnswerMarkdown.push(part);
		}
	}

	let answer = cleanText(dedupedAnswer.join('\n\n'));
	let answerMarkdown = cleanText(dedupedAnswerMarkdown.join('\n\n'));

	if (answer.length > 16000) {
		console.warn('Warning: AI answer truncated to 16000 characters');
		answer = answer.slice(0, 16000);
	}

	if (answerMarkdown.length > 16000) {
		console.warn('Warning: AI markdown answer truncated to 16000 characters');
		answerMarkdown = answerMarkdown.slice(0, 16000);
	}

	return { answer, answerMarkdown, sources };
}

export function parseAIO(aio: AIOverview): AIOParsed {
	return parseAIResult(aio, {
		allowNestedOverview: true
	});
}

export function parseAIM(aim: AIMode): AIOParsed {
	return parseAIResult(aim, {
		allowNestedOverview: false
	});
}
