interface BrandContextOptions {
	brand?: string | Array<string>;
	brandDomain?: string | Array<string>;
	sector?: string | null;
	market?: string | null;
	briefing?: string | null;
}

export function buildBrandContext({
	brand,
	brandDomain,
	sector,
	market,
	briefing
}: BrandContextOptions): string {
	let brandContext: string;
	if (brandDomain) {
		const domainText = Array.isArray(brandDomain) ? brandDomain.join(', ') : brandDomain;
		if (brand) {
			const nameText = Array.isArray(brand) ? brand.join(', ') : brand;
			brandContext = ` "${nameText}" (domain: ${domainText})`;
		} else {
			brandContext = ` with domain "${domainText}"`;
		}
	} else {
		brandContext = ` "${brand}"`;
	}
	if (sector) {
		brandContext += ` in the ${sector} sector`;
	}
	if (market) {
		brandContext += ` operating in ${market}`;
	}
	if (briefing) {
		brandContext += ` Briefing: ${briefing}`;
	}
	return brandContext;
}

export type { BrandContextOptions };
