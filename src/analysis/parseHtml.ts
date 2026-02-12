import { extractDomain } from '../helpers/urls.ts';

import type { CheerioAPI, Cheerio } from 'cheerio';
import { load } from 'cheerio';

export function html(html: string, baseURI: string): CheerioAPI {
	return load(html, { baseURI: baseURI });
}

/**
 * Finds the closest heading above an element by traversing up the DOM tree.
 * Checks previous siblings and their descendants at each level.
 * Returns the last (closest) heading found.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findClosestHeading($: CheerioAPI, element: Cheerio<any>): string {
	const headingSelector = 'h1, h2, h3, h4, h5, h6';
	let closestHeading = '';
	let current = element;

	while (current.length > 0) {
		const prevSiblings = current.prevAll();

		for (let i = 0; i < prevSiblings.length; i++) {
			const sibling = $(prevSiblings[i]);

			if (sibling.is(headingSelector)) {
				closestHeading = sibling.text().trim();
			}

			const headingsInside = sibling.find(headingSelector);
			if (headingsInside.length > 0) {
				closestHeading = headingsInside.last().text().trim();
			}
		}

		if (closestHeading) {
			return closestHeading;
		}

		current = current.parent();
	}

	return closestHeading;
}

/**
 * Finds the closest text above an element by traversing up the DOM tree.
 * Checks previous siblings and their descendants at each level.
 * Returns the first non-empty text found, truncated to maxChars.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findClosestText($: CheerioAPI, element: Cheerio<any>, maxChars: number = 500): string {
	let current = element;

	while (current.length > 0) {
		let sibling = current.prev();
		while (sibling.length > 0) {
			const text = sibling.text().trim();
			if (text) {
				return text.slice(0, maxChars);
			}
			sibling = sibling.prev();
		}
		current = current.parent();
	}

	return '';
}

/**
 * Finds headings within a container that appear before the first target element.
 * Returns the last (closest) heading found inside the container.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findHeadingInContainer($: CheerioAPI, container: Cheerio<any>, targetSelectors: string): string {
	const headingSelector = 'h1, h2, h3, h4, h5, h6';
	const firstTarget = container.find(targetSelectors).first();

	if (firstTarget.length === 0) {
		return '';
	}

	let closestHeading = '';
	const allHeadings = container.find(headingSelector);

	allHeadings.each((_, heading) => {
		const $heading = $(heading);

		if ($heading[0] === firstTarget[0]) {
			return false;
		}

		const headingPosition = $heading.index();
		const targetPosition = firstTarget.index();

		if (headingPosition < targetPosition) {
			closestHeading = $heading.text().trim();
		}
	});

	return closestHeading;
}

export function main($: CheerioAPI): CheerioAPI {
	$('script, style, nav, header, footer, noscript').remove();
	return $;
}

export type Heading = { tag: string; text: string };
export type HeadingNode = Heading & { children: Array<HeadingNode> };

export function headings($: CheerioAPI) {
	const headings: Array<Heading> = [];

	$('h1, h2, h3, h4, h5, h6').each((_, el) => {
		headings.push({
			tag: el.tagName.toLowerCase(),
			text: $(el).text().trim()
		});
	});

	return headings;
}

export function headingStructure($: CheerioAPI): Array<HeadingNode> {
	const roots: Array<HeadingNode> = [];
	const stack: Array<HeadingNode> = [];

	$('h1, h2, h3, h4, h5, h6').each((_, el) => {
		const tag = el.tagName.toLowerCase();
		const level = parseInt(tag.substring(1), 10);
		const text = $(el).text().trim();

		const node: HeadingNode = {
			tag,
			text,
			children: []
		};

		while (stack.length > 0) {
			const last = stack[stack.length - 1];
			const lastLevel = parseInt(last.tag.substring(1), 10);
			if (lastLevel < level) {
				break;
			}
			stack.pop();
		}

		if (stack.length === 0) {
			roots.push(node);
		} else {
			stack[stack.length - 1].children.push(node);
		}

		stack.push(node);
	});

	return roots;
}

export function flattenHeadingStructure(nodes: Array<HeadingNode>): Array<Heading> {
	const result: Array<Heading> = [];

	function traverse(nodes: Array<HeadingNode>) {
		for (const node of nodes) {
			result.push({ tag: node.tag, text: node.text });
			if (node.children.length > 0) {
				traverse(node.children);
			}
		}
	}

	traverse(nodes);
	return result;
}

export type HeadingStats = {
	totalHeadings: number;
	oneH1: boolean;
	maxDepth: number;
	avgSubheadings: number;
	skippedLevels: number;
	emptyHeadings: number;
	duplicateHeadings: number;
	headingCounts: Record<string, number>;
};

export function headingStats(structure: HeadingNode[]): HeadingStats {
	let totalHeadings = 0;
	let maxDepth = 0;
	let skippedLevels = 0;
	let emptyHeadings = 0;
	let duplicateHeadings = 0;
	const headingCounts: Record<string, number> = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
	const seenTexts = new Set<string>();
	let totalSubheadings = 0;
	let parentsWithSubheadings = 0;

	function traverse(nodes: HeadingNode[], currentDepth: number, parentLevel: number) {
		if (nodes.length > 0 && currentDepth > maxDepth) {
			maxDepth = currentDepth;
		}

		for (const node of nodes) {
			totalHeadings++;
			const level = parseInt(node.tag.substring(1), 10);

			// Counts
			headingCounts[node.tag] = (headingCounts[node.tag] || 0) + 1;

			// Empty
			if (!node.text || node.text.trim() === '') {
				emptyHeadings++;
			}

			// Duplicates
			const text = node.text.trim().toLowerCase();
			if (text && seenTexts.has(text)) {
				duplicateHeadings++;
			} else if (text) {
				seenTexts.add(text);
			}

			// Skipped levels (check against parent)
			if (parentLevel > 0 && level > parentLevel + 1) {
				skippedLevels++;
			} else if (parentLevel === 0 && level > 1) {
				skippedLevels++;
			}

			// Subheadings stats
			if (node.children.length > 0) {
				totalSubheadings += node.children.length;
				parentsWithSubheadings++;
				traverse(node.children, currentDepth + 1, level);
			}
		}
	}

	traverse(structure, 1, 0);

	const avgSubheadings = parentsWithSubheadings > 0 ? totalSubheadings / parentsWithSubheadings : 0;

	return {
		totalHeadings,
		oneH1: headingCounts.h1 === 1,
		maxDepth: totalHeadings > 0 ? maxDepth : 0,
		avgSubheadings,
		skippedLevels,
		emptyHeadings,
		duplicateHeadings,
		headingCounts
	};
}

export function paragraphs($: CheerioAPI, maxChars: number = 500) {
	const paragraphs: Array<string> = [];

	$('p').each((_, el) => {
		const text = $(el).text().trim();
		if (text.length > 20) {
			paragraphs.push(text.slice(0, maxChars));
		}
	});

	return paragraphs;
}

export type List = {
	ordered: boolean;
	items: Array<string>;
	contextHeading?: string;
	closestText?: string;
};

export function lists($: CheerioAPI): Array<List> {

	const lists: Array<List> = [];

	$('ul, ol').each((_, el) => {
		const ordered = el.tagName.toLowerCase() === 'ol';
		const items: Array<string> = [];
		const $el = $(el);

		$el
			.find('li')
			.each((_, li) => {
				items.push($(li).text().trim());
			});

		let heading = findHeadingInContainer($, $el, 'li');
		if (!heading) {
			heading = findClosestHeading($, $el);
		}

		const firstLi = $el.find('li').first();
		const startElement = firstLi.length > 0 ? firstLi : $el;
		let closestText = findClosestText($, startElement);
		if (closestText.trim() === heading?.trim()) {
			closestText = '';
		}

		lists.push({ ordered, items, contextHeading: heading || undefined, closestText: closestText || undefined });
	});

	return lists;
}

type Row = Array<string>;
export type Table = { table: Array<Row>; contextHeading: string };

export function tables($: CheerioAPI): Array<Table> {

	const tables: Array<Table> = [];

	$('table').each((_, table) => {
		const rows: Array<Row> = [];

		$(table)
			.find('tr')
			.each((_, tr) => {
				const row: string[] = [];

				$(tr)
					.find('th, td')
					.each((_, cell) => {
						row.push($(cell).text().trim());
					});

				if (row.length > 0) rows.push(row);
			});

		const heading = findClosestHeading($, $(table));
		tables.push({ table: rows, contextHeading: heading });
	});

	return tables;
}

type FormField = { type: string; id?: string, name?: string; label?: string };
export type Form = {
	id?: string;
	class?: string;
	fields: Array<FormField>;
	contextHeading?: string;
	closestText?: string;
};

export function forms($: CheerioAPI): Array<Form> {

	const forms: Array<Form> = [];
	const seenForms = new Set<unknown>();

	// Find all form input elements
	const formSelectors = 'input, select, textarea, button[type="submit"]';

	$(formSelectors).each((_, field) => {
		// Find the closest form container
		let formContainer = $(field).closest('form');

		// If no <form> tag, look for common parent containers heuristically
		if (formContainer.length === 0) {
			// Look for divs/sections with form-related classes or multiple inputs
			const parent = $(field).closest('div[class*="form"], section[class*="form"], div[id*="form"]');
			if (parent.length > 0) {
				formContainer = parent;
			} else {
				// Find common parent with multiple form elements
				let currentParent = $(field).parent();
				let depth = 0;
				while (currentParent.length > 0 && depth < 5) {
					const formElementsInParent = currentParent.find(formSelectors).length;
					if (formElementsInParent >= 2) {
						formContainer = currentParent;
						break;
					}
					currentParent = currentParent.parent();
					depth++;
				}
			}
		}

		// If we found a container and haven't processed it yet
		if (formContainer.length > 0 && !seenForms.has(formContainer[0])) {
			seenForms.add(formContainer[0]);

			const fields: Array<FormField> = [];

			// Extract all form fields from this container
			formContainer.find(formSelectors).each((_, el) => {
				const $el = $(el);
				const tagName = el.tagName.toLowerCase();
				let type = tagName;

				if (tagName === 'input') {
					type = $el.attr('type') || 'text';
				}

				const name = $el.attr('name');

				// Try to find associated label
				let label: string | undefined;
				const id = $el.attr('id');
				if (id) {
					const labelEl = formContainer.find(`label[for="${id}"]`);
					if (labelEl.length > 0) {
						label = labelEl.text().trim();
					}
				}

				// Fallback: look for parent label or sibling label
				if (!label) {
					const parentLabel = $el.closest('label');
					if (parentLabel.length > 0) {
						label = parentLabel.text().trim();
					} else {
						const siblingLabel = $el.siblings('label');
						if (siblingLabel.length > 0) {
							label = siblingLabel.text().trim();
						}
					}
				}

				// Fallback: use placeholder or aria-label
				if (!label) {
					label = $el.attr('placeholder') || $el.attr('aria-label');
				}

				fields.push({ type, id, name, label });
			});

			// Only add forms with at least one field
			if (fields.length > 0) {
				let heading = findHeadingInContainer($, formContainer, formSelectors);

				if (!heading) {
					heading = findClosestHeading($, formContainer);
				}

				const firstField = formContainer.find(formSelectors).first();
				const closestText = findClosestText($, firstField);

				forms.push({
					id: formContainer.attr('id'),
					class: formContainer.attr('class'),
					fields,
					contextHeading: heading ? heading.replace(/\s+/g, ' ').trim() : undefined,
					closestText: closestText || undefined
				});
			}
		}
	});

	return forms;
}

export type Link = { href: string; text: string; isPdf: boolean, isExternal: boolean };

export function links($: CheerioAPI, unique?: boolean): Array<Link> {
	const baseURI = $._options.baseURI || '';
	const baseURL = baseURI instanceof URL ? baseURI.href : baseURI;
	const domain = extractDomain(baseURL).toLowerCase();
	const links: Array<Link> = [];
	const seenUrls = new Set<string>();

	$('a').each((_, el) => {
		let href = $(el).attr('href') || '';
		if (!href) {
			return;
		}

		try {
			href = new URL(href).href;
		} catch {
			return;
		}

		if (unique) {
			if (seenUrls.has(href)) {
				return;
			}

			seenUrls.add(href);
		}

		links.push({
			text: $(el).text().trim(),
			href: href,
			isExternal: extractDomain(href) !== domain,
			isPdf: href.toLowerCase().endsWith('.pdf')
		});
	});

	return links;
}

/**
 * Structured data (JSON-LD) extraction. For rich results in Google e.g.
 * Also See:
 * - https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data
 * - https://schema.org/docs/gs.html
 */
export function structuredData($: CheerioAPI): Array<Record<string, unknown>> {
	const blocks: Array<Record<string, unknown>> = [];

	$('script[type="application/ld+json"]').each((_, el) => {
		try {
			const json = JSON.parse($(el).html() || '{}');
			blocks.push(json);
		} catch { }
	});

	return blocks;
}

export function checkStructuredDataTypes(blocks: Array<Record<string, unknown>>): Record<string, unknown> {
	const result: Record<string, boolean | Record<string, boolean>> = {};
	const typeNames = ['Article', 'BlogPosting', 'BreadcrumbList', 'Event', 'FAQPage', 'HowTo', 'JobPosting', 'LocalBusiness', 'Organization', 'Person', 'Product', 'Recipe', 'Review', 'Service', 'SoftwareApplication', 'VideoObject', 'WebSite'];

	// Check top-level item existence
	for (const typeName of typeNames) {
		result[typeName] = blocks.some(b => b['@type'] === typeName);
	}

	// Check if there is an Author Author can be a top-level Person, or in the "author"
	// field of Article/BlogPosting, FAQPage, HowTo, Recipe, etc.

	let authorFound: Record<string, unknown> | null = null;
	for (const b of blocks) {
		if (b['@type'] === 'Person') {
			authorFound = b;
			break;
		}
		if (b['author']) {
			const author = b['author'] as Record<string, unknown>;
			if (typeof author === 'object' && author['@type'] === 'Person') {
				authorFound = author;
				break;
			}
		}
	}
	result['Author'] = authorFound !== null;

	// Check Organization fields
	if (result['Organization']) {
		const orgFields = ['name', 'url', 'logo', 'sameAs', 'brand', 'contactPoint', 'address'];
		const orgResult: Record<string, boolean> = {};
		for (const field of orgFields) {
			orgResult[field] = blocks.some(b => b['@type'] === 'Organization' && b[field] !== undefined);
		}
		result['OrganizationFields'] = orgResult;
	}

	// Check Author fields
	if (authorFound) {
		const authorResult: Record<string, boolean> = {};
		const authorFields = ['name', 'url', 'sameAs', 'address', 'contactPoint', 'email'];
		for (const field of authorFields) {
			authorResult[field] = authorFound[field] !== undefined;
		}
		result['AuthorFields'] = authorResult;
	} else {
		result['Author'] = false;
	}

	return Object.fromEntries(Object.entries(result).sort((a, b) => a[0].localeCompare(b[0])));
}

export function bodyText($: CheerioAPI) {
	const text = $('body').text();

	return text
		.replace(/\s+/g, ' ')
		.replace(/\n\s*\n/g, '\n')
		.trim();
}

export function metadata($: CheerioAPI): Record<string, string> {
	const meta: Record<string, string> = {};
	const title = $('head > title').text().trim();
	if (title) {
		meta['title'] = title;
	}

	const supportedMetaNames = ['description', 'keywords', 'author', 'language', 'abstract', 'topic', 'summary', 'subject', 'category', 'date'];
	supportedMetaNames.forEach(name => {
		const content = $(`head > meta[name='${name}']`).attr('content') || $(`head > meta[property='${name}']`).attr('content');
		if (content) {
			meta[name] = content;
		}
	});

	return meta;
}
