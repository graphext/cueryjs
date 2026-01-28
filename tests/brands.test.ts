import { assertEquals } from '@std/assert';

import { rankBrandsInText } from '../src/brands.ts';
import type { Entity } from '../src/entities.ts';
import type { FlaggedBrand } from '../src/schemas/brand.schema.ts';

Deno.test('rankBrandsInText - should not duplicate brand when entity matches FlaggedBrand with different casing', () => {
	const text = `Quizás te refieres a Kids&Us. Aquí tienes lo que es:



Kids&Us es una red de academias de inglés orientadas a bebés, niños y adolescentes — desde 1 hasta 18 años. [1]

Su método se basa en la llamada "Natural English": se enseña inglés imitando el proceso natural de adquisición de la lengua materna (escuchar → entender → hablar → leer → escribir). [2]

Ofrecen distintos cursos según la edad: "Babies" (1–2 años), "Kids" (3–8), "Tweens" (9–12) y "Teens" (13–18). [3]

Las clases pueden ser presenciales en sus centros, y además cuentan con una plataforma digital (por ejemplo "Kids zONe") para aprendizaje online cuando sea necesario. [4]

Están presentes en varios países (no solo España) y manejan un modelo de franquicias que incluye centros propios y franquiciados. [5]


Si quieres —puedo revisar si hay un centro Kids&Us en Valencia y darte direcciones. ¿Te lo busco?`;

	const brands: Array<FlaggedBrand> = [
		{
			name: 'Kids&Us English, S.L.',
			shortName: 'Kids&Us',
			description: 'Red de academias de inglés para niños',
			domain: 'kidsandus.es',
			sectors: ['education'],
			markets: ['Spain'],
			portfolio: [],
			marketPosition: 'leader',
			favicon: null,
			isCompetitor: false
		}
	];

	const entities: Array<Entity> = [
		{
			name: 'kids&us',
			type: 'brand'
		}
	];

	const result = rankBrandsInText(text, brands, entities);

	assertEquals(result, ['Kids&Us']);
	assertEquals(result.length, 1);
});

Deno.test('rankBrandsInText - should use entity text position when entity matches FlaggedBrand', () => {
	const text = 'First we have kids&us mentioned, then later some other brand.';

	const brands: Array<FlaggedBrand> = [
		{
			name: 'Kids&Us English, S.L.',
			shortName: 'Kids&Us',
			description: 'Red de academias de inglés para niños',
			domain: 'kidsandus.es',
			sectors: ['education'],
			markets: ['Spain'],
			portfolio: [],
			marketPosition: 'leader',
			favicon: null,
			isCompetitor: false
		}
	];

	const entities: Array<Entity> = [
		{
			name: 'kids&us',
			type: 'brand'
		}
	];

	const result = rankBrandsInText(text, brands, entities);

	assertEquals(result.includes('Kids&Us'), true);
	assertEquals(result.length, 1);
});

Deno.test('rankBrandsInText - should include entity brands that do not match any FlaggedBrand', () => {
	const text = 'This text mentions kids&us and also mentions another brand called Duolingo.';

	const brands: Array<FlaggedBrand> = [
		{
			name: 'Kids&Us English, S.L.',
			shortName: 'Kids&Us',
			description: 'Red de academias de inglés para niños',
			domain: 'kidsandus.es',
			sectors: ['education'],
			markets: ['Spain'],
			portfolio: [],
			marketPosition: 'leader',
			favicon: null,
			isCompetitor: false
		}
	];

	const entities: Array<Entity> = [
		{
			name: 'kids&us',
			type: 'brand'
		},
		{
			name: 'duolingo',
			type: 'brand'
		}
	];

	const result = rankBrandsInText(text, brands, entities);

	assertEquals(result.includes('Kids&Us'), true);
	assertEquals(result.includes('duolingo'), true);
	assertEquals(result.length, 2);
});

Deno.test('rankBrandsInText - should order brands by first mention position', () => {
	const text = 'Duolingo is great, but kids&us is better for children.';

	const brands: Array<FlaggedBrand> = [
		{
			name: 'Kids&Us English, S.L.',
			shortName: 'Kids&Us',
			description: 'Red de academias de inglés para niños',
			domain: 'kidsandus.es',
			sectors: ['education'],
			markets: ['Spain'],
			portfolio: [],
			marketPosition: 'leader',
			favicon: null,
			isCompetitor: false
		}
	];

	const entities: Array<Entity> = [
		{
			name: 'kids&us',
			type: 'brand'
		},
		{
			name: 'duolingo',
			type: 'brand'
		}
	];

	const result = rankBrandsInText(text, brands, entities);

	assertEquals(result[0], 'duolingo');
	assertEquals(result[1], 'Kids&Us');
});

Deno.test('rankBrandsInText - should handle entity with "and" instead of "&" matching FlaggedBrand', () => {
	const text = 'Check out kidsandus for English lessons.';

	const brands: Array<FlaggedBrand> = [
		{
			name: 'Kids&Us English, S.L.',
			shortName: 'Kids&Us',
			description: 'Red de academias de inglés para niños',
			domain: 'kidsandus.es',
			sectors: ['education'],
			markets: ['Spain'],
			portfolio: [],
			marketPosition: 'leader',
			favicon: null,
			isCompetitor: false
		}
	];

	const entities: Array<Entity> = [
		{
			name: 'kidsandus',
			type: 'brand'
		}
	];

	const result = rankBrandsInText(text, brands, entities);

	assertEquals(result.includes('Kids&Us'), true);
	assertEquals(result.length, 1);
});

Deno.test('rankBrandsInText - should find brand via domain when text contains domain', () => {
	const text = 'Visit kidsandus.es for more information.';

	const brands: Array<FlaggedBrand> = [
		{
			name: 'Kids&Us English, S.L.',
			shortName: 'Kids&Us',
			description: 'Red de academias de inglés para niños',
			domain: 'kidsandus.es',
			sectors: ['education'],
			markets: ['Spain'],
			portfolio: [],
			marketPosition: 'leader',
			favicon: null,
			isCompetitor: false
		}
	];

	const result = rankBrandsInText(text, brands, []);

	assertEquals(result.includes('Kids&Us'), true);
});

Deno.test('rankBrandsInText - should work when entities is undefined', () => {
	const text = 'Kids&Us is a great school.';

	const brands: Array<FlaggedBrand> = [
		{
			name: 'Kids&Us English, S.L.',
			shortName: 'Kids&Us',
			description: 'Red de academias de inglés para niños',
			domain: 'kidsandus.es',
			sectors: ['education'],
			markets: ['Spain'],
			portfolio: [],
			marketPosition: 'leader',
			favicon: null,
			isCompetitor: false
		}
	];

	const result = rankBrandsInText(text, brands, undefined);

	assertEquals(result.includes('Kids&Us'), true);
});

Deno.test('rankBrandsInText - should ignore non-brand entities', () => {
	const text = 'Kids&Us is located in Madrid.';

	const brands: Array<FlaggedBrand> = [
		{
			name: 'Kids&Us English, S.L.',
			shortName: 'Kids&Us',
			description: 'Red de academias de inglés para niños',
			domain: 'kidsandus.es',
			sectors: ['education'],
			markets: ['Spain'],
			portfolio: [],
			marketPosition: 'leader',
			favicon: null,
			isCompetitor: false
		}
	];

	const entities: Array<Entity> = [
		{
			name: 'kids&us',
			type: 'brand'
		},
		{
			name: 'madrid',
			type: 'location'
		}
	];

	const result = rankBrandsInText(text, brands, entities);

	assertEquals(result, ['Kids&Us']);
	assertEquals(result.includes('madrid'), false);
});

const kidsUsTextVariations = [
	'Kids&Us',
	'kids&us',
	'Kids & Us',
	'kids & us',
	'KidsAndUs',
	'Kids and us'
];

const kidsUsBrandShortNameVariations = [
	'Kids&Us',
	'kids&us',
	'Kids & Us',
	'kids & us',
	'KidsAndUs',
	'Kids and us'
];

function createKidsUsBrand(shortName: string): FlaggedBrand {
	return {
		name: 'Kids&Us English, S.L.',
		shortName,
		description: 'Red de academias de inglés para niños',
		domain: 'kidsandus.es',
		sectors: ['education'],
		markets: ['Spain'],
		portfolio: [],
		marketPosition: 'leader',
		favicon: null,
		isCompetitor: false
	};
}

for (const textVariant of kidsUsTextVariations) {
	for (const brandVariant of kidsUsBrandShortNameVariations) {
		Deno.test(`Kids&Us variations - should match text "${textVariant}" with brand shortName "${brandVariant}"`, () => {
			const text = `Check out ${textVariant} for English lessons.`;
			const brands = [createKidsUsBrand(brandVariant)];

			const result = rankBrandsInText(text, brands, []);

			assertEquals(result.includes(brandVariant), true);
			assertEquals(result.length, 1);
		});
	}
}

for (const textVariant of kidsUsTextVariations) {
	for (const brandVariant of kidsUsBrandShortNameVariations) {
		Deno.test(`Kids&Us variations - should match entity "${textVariant}" with brand shortName "${brandVariant}"`, () => {
			const text = `Check out ${textVariant} for English lessons.`;
			const brands = [createKidsUsBrand(brandVariant)];
			const entities: Array<Entity> = [
				{
					name: textVariant.toLowerCase(),
					type: 'brand'
				}
			];

			const result = rankBrandsInText(text, brands, entities);

			assertEquals(result.includes(brandVariant), true);
			assertEquals(result.length, 1);
		});
	}
}

const casitaDelTextVariations = [
	'LaCasitaDelIngles',
	'la casita del ingles',
	'La Casita Del Inglés'
];

const casitaDelBrandShortNameVariations = [
	'LaCasitaDelIngles',
	'la casita del ingles',
	'La Casita Del Inglés'
];

function createCasitaBrand(shortName: string): FlaggedBrand {
	return {
		name: 'La Casita Del Inglés S.L.',
		shortName,
		description: 'Academia de inglés para niños',
		domain: 'lacasitadelingles.es',
		sectors: ['education'],
		markets: ['Spain'],
		portfolio: [],
		marketPosition: 'challenger',
		favicon: null,
		isCompetitor: false
	};
}

for (const textVariant of casitaDelTextVariations) {
	for (const brandVariant of casitaDelBrandShortNameVariations) {
		Deno.test(`La Casita Del Inglés variations - should match text "${textVariant}" with brand shortName "${brandVariant}"`, () => {
			const text = `Check out ${textVariant} for English lessons.`;
			const brands = [createCasitaBrand(brandVariant)];

			const result = rankBrandsInText(text, brands, []);

			assertEquals(result.includes(brandVariant), true);
			assertEquals(result.length, 1);
		});
	}
}

for (const textVariant of casitaDelTextVariations) {
	for (const brandVariant of casitaDelBrandShortNameVariations) {
		Deno.test(`La Casita Del Inglés variations - should match entity "${textVariant}" with brand shortName "${brandVariant}"`, () => {
			const text = `Check out ${textVariant} for English lessons.`;
			const brands = [createCasitaBrand(brandVariant)];
			const entities: Array<Entity> = [
				{
					name: textVariant.toLowerCase(),
					type: 'brand'
				}
			];

			const result = rankBrandsInText(text, brands, entities);

			assertEquals(result.includes(brandVariant), true);
			assertEquals(result.length, 1);
		});
	}
}

const benJerryTextVariations = [
	"Ben & Jerry's",
	"ben & jerry's",
	"Ben and Jerry's",
	'benandjerrys',
	'Ben&Jerrys',
	'BenAndJerrys'
];

const benJerryBrandShortNameVariations = [
	"Ben & Jerry's",
	"ben & jerry's",
	"Ben and Jerry's",
	'benandjerrys',
	'Ben&Jerrys',
	'BenAndJerrys'
];

function createBenJerryBrand(shortName: string): FlaggedBrand {
	return {
		name: "Ben & Jerry's Homemade Holdings Inc.",
		shortName,
		description: 'Ice cream company',
		domain: 'benjerry.com',
		sectors: ['food'],
		markets: ['United States'],
		portfolio: [],
		marketPosition: 'leader',
		favicon: null,
		isCompetitor: false
	};
}

for (const textVariant of benJerryTextVariations) {
	for (const brandVariant of benJerryBrandShortNameVariations) {
		Deno.test(`Ben & Jerry's variations - should match text "${textVariant}" with brand shortName "${brandVariant}"`, () => {
			const text = `I love ${textVariant} ice cream.`;
			const brands = [createBenJerryBrand(brandVariant)];

			const result = rankBrandsInText(text, brands, []);

			assertEquals(result.includes(brandVariant), true);
			assertEquals(result.length, 1);
		});
	}
}

for (const textVariant of benJerryTextVariations) {
	for (const brandVariant of benJerryBrandShortNameVariations) {
		Deno.test(`Ben & Jerry's variations - should match entity "${textVariant}" with brand shortName "${brandVariant}"`, () => {
			const text = `I love ${textVariant} ice cream.`;
			const brands = [createBenJerryBrand(brandVariant)];
			const entities: Array<Entity> = [
				{
					name: textVariant.toLowerCase(),
					type: 'brand'
				}
			];

			const result = rankBrandsInText(text, brands, entities);

			assertEquals(result.includes(brandVariant), true);
			assertEquals(result.length, 1);
		});
	}
}

const sevenElevenTextVariations = [
	'7-Eleven',
	'7 Eleven',
	'7eleven',
	'7-eleven'
];

const sevenElevenBrandShortNameVariations = [
	'7-Eleven',
	'7 Eleven',
	'7eleven'
];

function createSevenElevenBrand(shortName: string): FlaggedBrand {
	return {
		name: '7-Eleven, Inc.',
		shortName,
		description: 'Convenience store chain',
		domain: '7-eleven.com',
		sectors: ['retail'],
		markets: ['United States'],
		portfolio: [],
		marketPosition: 'leader',
		favicon: null,
		isCompetitor: false
	};
}

for (const textVariant of sevenElevenTextVariations) {
	for (const brandVariant of sevenElevenBrandShortNameVariations) {
		Deno.test(`7-Eleven variations - should match text "${textVariant}" with brand shortName "${brandVariant}"`, () => {
			const text = `I shop at ${textVariant} every day.`;
			const brands = [createSevenElevenBrand(brandVariant)];

			const result = rankBrandsInText(text, brands, []);

			assertEquals(result.includes(brandVariant), true);
			assertEquals(result.length, 1);
		});
	}
}

const hmTextVariations = [
	'H&M',
	'H & M',
	'h&m',
	'HandM',
	'H and M'
];

const hmBrandShortNameVariations = [
	'H&M',
	'H & M'
];

function createHMBrand(shortName: string): FlaggedBrand {
	return {
		name: 'H & M Hennes & Mauritz AB',
		shortName,
		description: 'Fashion retailer',
		domain: 'hm.com',
		sectors: ['fashion'],
		markets: ['Global'],
		portfolio: [],
		marketPosition: 'leader',
		favicon: null,
		isCompetitor: false
	};
}

for (const textVariant of hmTextVariations) {
	for (const brandVariant of hmBrandShortNameVariations) {
		Deno.test(`H&M variations - should match text "${textVariant}" with brand shortName "${brandVariant}"`, () => {
			const text = `I bought clothes at ${textVariant} yesterday.`;
			const brands = [createHMBrand(brandVariant)];

			const result = rankBrandsInText(text, brands, []);

			assertEquals(result.includes(brandVariant), true);
			assertEquals(result.length, 1);
		});
	}
}

const cocaColaTextVariations = [
	'Coca-Cola',
	'Coca Cola',
	'CocaCola',
	'coca-cola',
	'cocacola',
	'coca cola'
];

const cocaColaBrandShortNameVariations = [
	'Coca-Cola',
	'Coca Cola',
	'CocaCola'
];

function createCocaColaBrand(shortName: string): FlaggedBrand {
	return {
		name: 'The Coca-Cola Company',
		shortName,
		description: 'Beverage company',
		domain: 'coca-cola.com',
		sectors: ['beverages'],
		markets: ['Global'],
		portfolio: [],
		marketPosition: 'leader',
		favicon: null,
		isCompetitor: false
	};
}

for (const textVariant of cocaColaTextVariations) {
	for (const brandVariant of cocaColaBrandShortNameVariations) {
		Deno.test(`Coca-Cola variations - should match text "${textVariant}" with brand shortName "${brandVariant}"`, () => {
			const text = `I drink ${textVariant} every day.`;
			const brands = [createCocaColaBrand(brandVariant)];

			const result = rankBrandsInText(text, brands, []);

			assertEquals(result.includes(brandVariant), true);
			assertEquals(result.length, 1);
		});
	}
}

const mercedesTextVariations = [
	'Mercedes-Benz',
	'Mercedes Benz',
	'MercedesBenz',
	'mercedes-benz',
	'mercedesbenz'
];

const mercedesBrandShortNameVariations = [
	'Mercedes-Benz',
	'Mercedes Benz',
	'MercedesBenz'
];

function createMercedesBrand(shortName: string): FlaggedBrand {
	return {
		name: 'Mercedes-Benz Group AG',
		shortName,
		description: 'Luxury automobile manufacturer',
		domain: 'mercedes-benz.com',
		sectors: ['automotive'],
		markets: ['Global'],
		portfolio: [],
		marketPosition: 'leader',
		favicon: null,
		isCompetitor: false
	};
}

for (const textVariant of mercedesTextVariations) {
	for (const brandVariant of mercedesBrandShortNameVariations) {
		Deno.test(`Mercedes-Benz variations - should match text "${textVariant}" with brand shortName "${brandVariant}"`, () => {
			const text = `I drive a ${textVariant} car.`;
			const brands = [createMercedesBrand(brandVariant)];

			const result = rankBrandsInText(text, brands, []);

			assertEquals(result.includes(brandVariant), true);
			assertEquals(result.length, 1);
		});
	}
}

const drPepperTextVariations = [
	'Dr. Pepper',
	'Dr Pepper',
	'DrPepper',
	'dr. pepper',
	'drpepper'
];

const drPepperBrandShortNameVariations = [
	'Dr. Pepper',
	'Dr Pepper',
	'DrPepper'
];

function createDrPepperBrand(shortName: string): FlaggedBrand {
	return {
		name: 'Dr Pepper Snapple Group',
		shortName,
		description: 'Beverage company',
		domain: 'drpepper.com',
		sectors: ['beverages'],
		markets: ['United States'],
		portfolio: [],
		marketPosition: 'challenger',
		favicon: null,
		isCompetitor: false
	};
}

for (const textVariant of drPepperTextVariations) {
	for (const brandVariant of drPepperBrandShortNameVariations) {
		Deno.test(`Dr. Pepper variations - should match text "${textVariant}" with brand shortName "${brandVariant}"`, () => {
			const text = `I love drinking ${textVariant}.`;
			const brands = [createDrPepperBrand(brandVariant)];

			const result = rankBrandsInText(text, brands, []);

			assertEquals(result.includes(brandVariant), true);
			assertEquals(result.length, 1);
		});
	}
}

const haagenDazsTextVariations = [
	'Häagen-Dazs',
	'Haagen-Dazs',
	'Häagen Dazs',
	'Haagen Dazs',
	'HaagenDazs',
	'haagendazs',
	'häagen-dazs'
];

const haagenDazsBrandShortNameVariations = [
	'Häagen-Dazs',
	'Haagen-Dazs',
	'HaagenDazs'
];

function createHaagenDazsBrand(shortName: string): FlaggedBrand {
	return {
		name: 'Häagen-Dazs',
		shortName,
		description: 'Ice cream brand',
		domain: 'haagendazs.com',
		sectors: ['food'],
		markets: ['Global'],
		portfolio: [],
		marketPosition: 'leader',
		favicon: null,
		isCompetitor: false
	};
}

for (const textVariant of haagenDazsTextVariations) {
	for (const brandVariant of haagenDazsBrandShortNameVariations) {
		Deno.test(`Häagen-Dazs variations - should match text "${textVariant}" with brand shortName "${brandVariant}"`, () => {
			const text = `I love ${textVariant} ice cream.`;
			const brands = [createHaagenDazsBrand(brandVariant)];

			const result = rankBrandsInText(text, brands, []);

			assertEquals(result.includes(brandVariant), true);
			assertEquals(result.length, 1);
		});
	}
}

const citroenTextVariations = [
	'Citroën',
	'Citroen',
	'citroën',
	'citroen',
	'CITROËN',
	'CITROEN'
];

const citroenBrandShortNameVariations = [
	'Citroën',
	'Citroen'
];

function createCitroenBrand(shortName: string): FlaggedBrand {
	return {
		name: 'Citroën',
		shortName,
		description: 'French automobile manufacturer',
		domain: 'citroen.com',
		sectors: ['automotive'],
		markets: ['Europe'],
		portfolio: [],
		marketPosition: 'challenger',
		favicon: null,
		isCompetitor: false
	};
}

for (const textVariant of citroenTextVariations) {
	for (const brandVariant of citroenBrandShortNameVariations) {
		Deno.test(`Citroën variations - should match text "${textVariant}" with brand shortName "${brandVariant}"`, () => {
			const text = `I drive a ${textVariant} car.`;
			const brands = [createCitroenBrand(brandVariant)];

			const result = rankBrandsInText(text, brands, []);

			assertEquals(result.includes(brandVariant), true);
			assertEquals(result.length, 1);
		});
	}
}

const nestleTextVariations = [
	'Nestlé',
	'Nestle',
	'nestlé',
	'nestle',
	'NESTLÉ',
	'NESTLE'
];

const nestleBrandShortNameVariations = [
	'Nestlé',
	'Nestle'
];

function createNestleBrand(shortName: string): FlaggedBrand {
	return {
		name: 'Nestlé S.A.',
		shortName,
		description: 'Food and beverage company',
		domain: 'nestle.com',
		sectors: ['food'],
		markets: ['Global'],
		portfolio: [],
		marketPosition: 'leader',
		favicon: null,
		isCompetitor: false
	};
}

for (const textVariant of nestleTextVariations) {
	for (const brandVariant of nestleBrandShortNameVariations) {
		Deno.test(`Nestlé variations - should match text "${textVariant}" with brand shortName "${brandVariant}"`, () => {
			const text = `I buy ${textVariant} products.`;
			const brands = [createNestleBrand(brandVariant)];

			const result = rankBrandsInText(text, brands, []);

			assertEquals(result.includes(brandVariant), true);
			assertEquals(result.length, 1);
		});
	}
}

const appleTextVariations = [
	'Apple',
	'Apple Inc.',
	'Apple Inc',
	'apple',
	'APPLE'
];

const appleBrandShortNameVariations = [
	'Apple'
];

function createAppleBrand(shortName: string): FlaggedBrand {
	return {
		name: 'Apple Inc.',
		shortName,
		description: 'Technology company',
		domain: 'apple.com',
		sectors: ['technology'],
		markets: ['Global'],
		portfolio: [],
		marketPosition: 'leader',
		favicon: null,
		isCompetitor: false
	};
}

for (const textVariant of appleTextVariations) {
	for (const brandVariant of appleBrandShortNameVariations) {
		Deno.test(`Apple variations - should match text "${textVariant}" with brand shortName "${brandVariant}"`, () => {
			const text = `I use ${textVariant} products.`;
			const brands = [createAppleBrand(brandVariant)];

			const result = rankBrandsInText(text, brands, []);

			assertEquals(result.includes(brandVariant), true);
			assertEquals(result.length, 1);
		});
	}
}

const teslaTextVariations = [
	'Tesla',
	'Tesla, Inc.',
	'Tesla Inc.',
	'Tesla Inc',
	'tesla',
	'TESLA'
];

const teslaBrandShortNameVariations = [
	'Tesla'
];

function createTeslaBrand(shortName: string): FlaggedBrand {
	return {
		name: 'Tesla, Inc.',
		shortName,
		description: 'Electric vehicle manufacturer',
		domain: 'tesla.com',
		sectors: ['automotive'],
		markets: ['Global'],
		portfolio: [],
		marketPosition: 'leader',
		favicon: null,
		isCompetitor: false
	};
}

for (const textVariant of teslaTextVariations) {
	for (const brandVariant of teslaBrandShortNameVariations) {
		Deno.test(`Tesla variations - should match text "${textVariant}" with brand shortName "${brandVariant}"`, () => {
			const text = `I drive a ${textVariant} car.`;
			const brands = [createTeslaBrand(brandVariant)];

			const result = rankBrandsInText(text, brands, []);

			assertEquals(result.includes(brandVariant), true);
			assertEquals(result.length, 1);
		});
	}
}

Deno.test('Weird formatting - should match brand with extra spaces in text', () => {
	const text = "I love Ben  &  Jerry's ice cream."; // Extra spaces
	const brands: Array<FlaggedBrand> = [
		{
			name: "Ben & Jerry's Homemade Holdings Inc.",
			shortName: "Ben & Jerry's",
			description: 'Ice cream company',
			domain: 'benjerry.com',
			sectors: ['food'],
			markets: ['United States'],
			portfolio: [],
			marketPosition: 'leader',
			favicon: null,
			isCompetitor: false
		}
	];

	const result = rankBrandsInText(text, brands, []);

	assertEquals(result.includes("Ben & Jerry's"), true);
});

Deno.test('Weird formatting - should match brand with tabs in text', () => {
	const text = 'I love Coca\tCola drinks.'; // Tab character
	const brands: Array<FlaggedBrand> = [
		{
			name: 'The Coca-Cola Company',
			shortName: 'Coca-Cola',
			description: 'Beverage company',
			domain: 'coca-cola.com',
			sectors: ['beverages'],
			markets: ['Global'],
			portfolio: [],
			marketPosition: 'leader',
			favicon: null,
			isCompetitor: false
		}
	];

	const result = rankBrandsInText(text, brands, []);

	assertEquals(result.includes('Coca-Cola'), true);
});

Deno.test('Weird formatting - should match brand with newline in text', () => {
	const text = 'I love Coca\nCola drinks.'; // Newline
	const brands: Array<FlaggedBrand> = [
		{
			name: 'The Coca-Cola Company',
			shortName: 'Coca-Cola',
			description: 'Beverage company',
			domain: 'coca-cola.com',
			sectors: ['beverages'],
			markets: ['Global'],
			portfolio: [],
			marketPosition: 'leader',
			favicon: null,
			isCompetitor: false
		}
	];

	const result = rankBrandsInText(text, brands, []);

	assertEquals(result.includes('Coca-Cola'), true);
});

// ============================================================================
// EF (Education First) - Short brand name, should NOT cause false positives
// ============================================================================

function createEFBrand(shortName: string): FlaggedBrand {
	return {
		name: 'EF Education First',
		shortName,
		description: 'International education company',
		domain: 'ef.com',
		sectors: ['education'],
		markets: ['Global'],
		portfolio: [],
		marketPosition: 'leader',
		favicon: null,
		isCompetitor: false
	};
}

Deno.test('EF - should match standalone "EF" in text', () => {
	const text = 'I studied with EF last summer.';
	const brands = [createEFBrand('EF')];

	const result = rankBrandsInText(text, brands, []);

	assertEquals(result.includes('EF'), true);
	assertEquals(result.length, 1);
});

Deno.test('EF - should match "EF" at start of sentence', () => {
	const text = 'EF offers great language courses.';
	const brands = [createEFBrand('EF')];

	const result = rankBrandsInText(text, brands, []);

	assertEquals(result.includes('EF'), true);
	assertEquals(result.length, 1);
});

Deno.test('EF - should match "EF" at end of sentence', () => {
	const text = 'The best education company is EF.';
	const brands = [createEFBrand('EF')];

	const result = rankBrandsInText(text, brands, []);

	assertEquals(result.includes('EF'), true);
	assertEquals(result.length, 1);
});

Deno.test('EF - should NOT match "EF" inside words like "bEFore"', () => {
	const text = 'Before going to school, I had breakfast.';
	const brands = [createEFBrand('EF')];

	const result = rankBrandsInText(text, brands, []);

	assertEquals(result.includes('EF'), false);
	assertEquals(result.length, 0);
});

Deno.test('EF - should NOT match "EF" inside words like "chEF"', () => {
	const text = 'The chef prepared a delicious meal.';
	const brands = [createEFBrand('EF')];

	const result = rankBrandsInText(text, brands, []);

	assertEquals(result.includes('EF'), false);
	assertEquals(result.length, 0);
});

Deno.test('EF - should NOT match "EF" inside words like "rEFer"', () => {
	const text = 'Please refer to the documentation.';
	const brands = [createEFBrand('EF')];

	const result = rankBrandsInText(text, brands, []);

	assertEquals(result.includes('EF'), false);
	assertEquals(result.length, 0);
});

Deno.test('EF - should NOT match "EF" inside words like "bEEF"', () => {
	const text = 'I love eating beef burgers.';
	const brands = [createEFBrand('EF')];

	const result = rankBrandsInText(text, brands, []);

	assertEquals(result.includes('EF'), false);
	assertEquals(result.length, 0);
});

Deno.test('EF - should NOT match "EF" inside words like "rEEF"', () => {
	const text = 'The coral reef is beautiful.';
	const brands = [createEFBrand('EF')];

	const result = rankBrandsInText(text, brands, []);

	assertEquals(result.includes('EF'), false);
	assertEquals(result.length, 0);
});

Deno.test('EF - should match lowercase "ef" as standalone', () => {
	const text = 'I studied with ef last summer.';
	const brands = [createEFBrand('EF')];

	const result = rankBrandsInText(text, brands, []);

	assertEquals(result.includes('EF'), true);
	assertEquals(result.length, 1);
});

Deno.test('EF - should match "EF Education First" full name', () => {
	const text = 'EF Education First is a great company.';
	const brands = [createEFBrand('EF')];

	const result = rankBrandsInText(text, brands, []);

	assertEquals(result.includes('EF'), true);
	assertEquals(result.length, 1);
});
