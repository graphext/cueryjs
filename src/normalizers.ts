import { extractDomain } from './urls.ts';

const DOMAIN_LIKE_PATTERN = /^[a-z0-9.-]+$/i;
const GENERIC_SINGLE_WORDS = new Set([
	'academia',
	'academy',
	'english',
	'language',
	'school',
	'centro',
	'center',
	'centre',
	'idiomas',
	'ingles',
	'escuela',
	'instituto',
	'colegio'
]);

export interface SourceLike {
	url?: string;
	domain?: string;
}

export interface CompanyNameNormalizationOptions {
	locationHints?: Array<string>;
	aliasRules?: Array<AliasRule>;
}

export interface AliasRule {
	canonical: string;
	patterns?: Array<RegExp>;
	startsWith?: Array<string>;
}

export const DEFAULT_ALIAS_RULES: Array<AliasRule> = [];

export function normalizeSources<T extends SourceLike>(sources: Array<T> | undefined | null): Array<T> {
	if (!Array.isArray(sources)) {
		return [];
	}

	return sources.map(source => ({
		...source,
		domain: resolveDomain(source)
	}));
}

export function buildLocationHints(place?: string | null): Array<string> {
	if (!place) {
		return [];
	}

	const cleaned = place.replace(/–|—/g, '-').trim();
	if (cleaned.length === 0) {
		return [];
	}

	const directSplits = cleaned
		.split(/[,/|]/)
		.map(part => part.trim())
		.filter(part => part.length > 0);

	const hints = new Set<string>([cleaned, ...directSplits]);
	const queue = [...hints];

	for (const value of queue) {
		const hyphenParts = value
			.split(/\s*-\s*/)
			.map(part => part.trim())
			.filter(part => part.length > 0);

		if (hyphenParts.length > 1) {
			for (const part of hyphenParts) {
				if (!hints.has(part)) {
					hints.add(part);
					queue.push(part);
				}
			}
		}
	}

	return Array.from(hints);
}

export function normalizeCompanyName(name: string, options: CompanyNameNormalizationOptions = {}): string {
	if (!name) {
		return name;
	}

	const trimmed = name.trim();
	if (trimmed.length === 0) {
		return name;
	}

	const standardizedSpacing = trimmed.replace(/\s+/g, ' ');
	const tokens = tokenizeValue(standardizedSpacing);

	if (tokens.length === 0) {
		return standardizedSpacing;
	}

	const aliasFromOriginal = applyAliasRules(tokens, options.aliasRules);

	const locationGroups = buildLocationGroups(options.locationHints);
	if (locationGroups.length === 0) {
		return aliasFromOriginal ?? standardizedSpacing;
	}

	let workingTokens = tokens.slice();
	let modified = false;
	let keepStripping = true;

	while (keepStripping) {
		keepStripping = false;
		for (const group of locationGroups) {
			const stripped = stripSuffixIfMatches(workingTokens, group);
			if (stripped && stripped.length > 0 && stripped.length !== workingTokens.length) {
				if (isSingleGenericToken(stripped)) {
					continue;
				}
				workingTokens = stripped;
				modified = true;
				keepStripping = true;
				break;
			}
		}
	}

	const aliasResolved = applyAliasRules(workingTokens, options.aliasRules);
	if (!modified) {
		return aliasResolved ?? aliasFromOriginal ?? standardizedSpacing;
	}

	const rebuilt = rejoinTokens(workingTokens);

	if (aliasResolved) {
		return aliasResolved;
	}

	return aliasResolved ?? (rebuilt.length > 0 ? rebuilt : aliasFromOriginal ?? standardizedSpacing);
}

function resolveDomain(source: SourceLike): string {
	if (source.url && source.url.trim().length > 0) {
		return extractDomain(source.url);
	}

	if (source.domain && DOMAIN_LIKE_PATTERN.test(source.domain.trim())) {
		return extractDomain(source.domain);
	}

	return source.domain?.trim() ?? '';
}

function tokenizeValue(value: string): Array<string> {
	return value
		.replace(/[()[\]{}]/g, ' ')
		.replace(/[,/|]/g, ' ')
		.replace(/[-–—]/g, ' ')
		.split(/\s+/)
		.map(part => part.trim())
		.filter(part => part.length > 0);
}

function normalizeToken(value: string): string {
	return value
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]/g, '');
}

function buildLocationGroups(hints?: Array<string>): Array<Array<string>> {
	if (!Array.isArray(hints) || hints.length === 0) {
		return [];
	}

	const groups: Array<Array<string>> = [];
	const seen = new Set<string>();

	for (const hint of hints) {
		if (!hint) continue;

		const tokens = tokenizeValue(hint);
		if (tokens.length === 0) continue;

		const key = tokens.map(normalizeToken).join('|');
		if (key.length === 0 || seen.has(key)) continue;

		seen.add(key);
		groups.push(tokens);
	}

	return groups.sort((a, b) => b.length - a.length);
}

function stripSuffixIfMatches(tokens: Array<string>, candidate: Array<string>): Array<string> | null {
	if (candidate.length === 0 || candidate.length > tokens.length) {
		return null;
	}

	const start = tokens.length - candidate.length;

	for (let i = 0; i < candidate.length; i++) {
		if (normalizeToken(tokens[start + i]) !== normalizeToken(candidate[i])) {
			return null;
		}
	}

	return tokens.slice(0, start);
}

function rejoinTokens(tokens: Array<string>): string {
	return tokens.join(' ').replace(/\s+/g, ' ').trim();
}

function isSingleGenericToken(tokens: Array<string>): boolean {
	if (tokens.length !== 1) {
		return false;
	}

	return GENERIC_SINGLE_WORDS.has(normalizeToken(tokens[0]));
}

function applyAliasRules(tokens: Array<string>, aliasRules?: Array<AliasRule>): string | null {
	if (!Array.isArray(aliasRules) || aliasRules.length === 0) {
		return null;
	}

	const normalizedValue = normalizeToken(tokens.join(''));
	if (normalizedValue.length === 0) {
		return null;
	}

	for (const rule of aliasRules) {
		if (rule.patterns && rule.patterns.some(pattern => pattern.test(normalizedValue))) {
			return rule.canonical;
		}
		if (rule.startsWith && rule.startsWith.some(prefix => normalizedValue.startsWith(prefix))) {
			return rule.canonical;
		}
	}

	return null;
}

