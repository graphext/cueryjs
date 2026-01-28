export interface Source {
	title: string;
	url: string;
	domain: string;
	cited?: boolean;
	positions?: Array<number>;
}

/**
 * Extended Source with brand mentions and links.
 * Mentions refer to the source title, and links refer to the source URL.
 */
export interface EnrichedSource extends Source {
	mentionedBrands: Array<string>;
	mentionedCompetitors: Array<string>;
	linkedBrand: string | null;
	linkedCompetitor: string | null;
}

/**
 * Source with category information from WEB_TAXONOMY.
 */
export interface CategorizedSource extends EnrichedSource {
	category: string | null;
	subcategory: string | null;
}

export interface SearchSource extends Source {
	rank: number;
	datePublished: string | null;
}