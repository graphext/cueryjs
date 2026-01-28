import { parse } from 'tldts';

/**
 * Parse a URL, adding scheme if missing (internal helper).
 */
export function parseUrl(url: string): URL {
	let normalizedUrl = url.trim();

	if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://') && !normalizedUrl.startsWith('//')) {
		normalizedUrl = 'http://' + normalizedUrl;
	}

	return new URL(normalizedUrl);
}

/**
 * Check if a URL is a Google Translate URL (internal helper).
 */
function isGoogleTranslateUrl(parsedUrl: URL): boolean {
	return (
		parsedUrl.hostname === 'translate.google.com' &&
		parsedUrl.pathname.startsWith('/translate') &&
		parsedUrl.searchParams.has('u')
	);
}

/**
 * Extract the domain from a URL or hostname.
 * Handles incomplete URLs (missing scheme), Google Translate redirects, and subdomains.
 */
export function extractDomain(
	url: string,
	withSubdomain: boolean = false,
	resolveGoogleTranslate: boolean = true
): string {
	if (!url) {
		return url;
	}

	try {
		let targetUrl = url.trim();

		if (resolveGoogleTranslate) {
			const parsedUrl = parseUrl(targetUrl);
			if (isGoogleTranslateUrl(parsedUrl)) {
				const originalUrl = parsedUrl.searchParams.get('u');
				if (originalUrl != null) {
					targetUrl = originalUrl;
				}
			}
		}

		const extracted = parse(targetUrl);

		if (withSubdomain) {
			const fqdn = extracted.hostname ?? '';
			return fqdn.replace(/^www\./, '');
		}

		return extracted.domain ?? url;
	} catch {
		return url;
	}
}
