import { withRetries, type RetryConfig } from '../../helpers/async.ts';

import type { Source } from '../../schemas/sources.schema.ts';
import { extractDomain } from '../../helpers/urls.ts';

export const HASDATA_CONCURRENCY = 29;

export const HASDATA_RETRY_CONFIG: RetryConfig = {
	maxRetries: 3,
	initialDelay: 1000,
	maxDelay: 8000,
	backoffMultiplier: 2,
	statusCodes: [429, 500]
};

export function getHasDataApiKey(): string {
	const apiKey = Deno.env.get('HASDATA_API_KEY');
	if (!apiKey) {
		throw new Error('HASDATA_API_KEY environment variable is required');
	}
	return apiKey;
}

export async function fetchHasDataWithRetry(
	url: string,
	retryConfig: RetryConfig = HASDATA_RETRY_CONFIG
): Promise<Response> {
	const headers: Record<string, string> = {
		'x-api-key': getHasDataApiKey()
	};

	const response = await withRetries(
		async () => fetch(url, {
			headers,
			signal: (globalThis as Record<string, unknown>).abortSignal as AbortSignal | undefined
		}),
		retryConfig
	);

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

		console.error(errorMessage);
		throw new Error(errorMessage);
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

function parseAIResult(
	data: AIOverview,
	{
		allowNestedOverview = true
	}: ParseOptions = {}
): AIOParsed {
	const textBlocks = data.textBlocks || (allowNestedOverview ? data.aiOverview?.textBlocks : []) || [];

	const parts: Array<string> = [];
	const handlers: Record<string, (block: TextBlock) => string> = {
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
		const handler = handlers[btype];
		if (handler) {
			const rendered = handler(block);
			if (rendered) {
				parts.push(rendered);
			}
		} else {
			const snippet = block.snippet || '';
			if (snippet) {
				parts.push(cleanText(snippet));
			}
		}
	}

	const deduped: Array<string> = [];
	for (const p of parts) {
		if (deduped.length === 0 || deduped[deduped.length - 1] !== p) {
			deduped.push(p);
		}
	}

	let answer = cleanText(deduped.join('\n\n'));

	if (answer.length > 16000) {
		console.warn('Warning: AI answer truncated to 16000 characters');
		answer = answer.slice(0, 16000);
	}

	const refs = data.references || (allowNestedOverview ? data.aiOverview?.references : []) || [];
	const sources: Array<Source> = [];
	for (const r of refs) {
		const link = r.link || r.url;
		const title = [r.title, r.source, r.snippet].filter(Boolean).join(' - ');
		if (link) {
			sources.push({
				title,
				url: link,
				domain: extractDomain(link)
			});
		}
	}

	return { answer, sources };
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
