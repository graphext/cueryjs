/* eslint no-console: ["warn", { allow: ["log", "warn", "error"] }] */
/**
 * Manual mode example:
 * deno task run examples/audit.ts \
  --env ".env" \
  --brand "https://www.peugeot.es" \
  --sector "coches eléctricos" \
  --language es \
  --models gpt-4.1-mini
 *
 * Wizard mode example:
 * deno task run examples/audit.ts \
  --env ".env" \
  --models gpt-4.1-mini \
  --wizard /Users/thomas/Downloads/peugeot.es-wizard-config-2025-10-24.json
 */
import { load } from '@std/dotenv';

import { audit, type ContextConfig } from '../src/audit.ts';

interface CliArgs {
	brand?: string | boolean;
	sector?: string | boolean;
	language?: string | boolean;
	country?: string | boolean;
	models?: string | boolean;
	personas?: number | string | boolean;
	sample?: number | string | boolean;
	cache?: string | boolean;
	wizard?: string | boolean;
	output?: string | boolean;
	env?: string | boolean;
	generateIdeasFromSeeds?: boolean;
	help?: boolean;
}

interface WizardExport {
	brandInfo?: {
		domain?: string;
		sector?: string;
		sectors?: Array<string>;
		language?: string;
		country?: string;
	};
	personas?: {
		items?: Array<unknown>;
	};
}

interface WizardDerivedConfig {
	brand: string;
	sector: string;
	languageCode: string;
	countryCode: string | null;
	numPersonas: number;
}

function printUsage() {
	console.log(`
Usage: deno task run examples/audit.ts [options]

Provide exactly one of the following modes:
--wizard <filepath>     Import context from wizard export (disables --brand, --sector,
--language, --country, --personas, --cache)
OR
--brand <url>           Brand URL to audit (e.g., https://www.peugeot.es)
--sector <name>      Industry sector (e.g., "coches eléctricos")
--language <code>    Language code (e.g., es, en, fr)

Optional:
--models <list>         Comma-separated list of model IDs (e.g., gpt-4.1,gpt-4.1-mini) (default: gpt-4.1-mini)
--country <code>        Country code (manual mode only, e.g., ES, US, FR)
--personas <count>      Number of personas to generate (manual mode only, default: 5)
	--sample <size>         Sample size for keyword audit (default: 400)
	--cache <filepath>      Path to cache file for resuming audit (manual mode only)
	--output <filepath>     Path to save audit results (default: audit-results.json)
	--env <filepath>        Path to .env file (default: ../../.env)
	--generateIdeasFromSeeds Generate keyword ideas from seed keywords instead of getting metrics (default: false)
	--help                  Show this help message

Examples:
	# Manual mode
	deno run --allow-read --allow-write --allow-net --allow-env examples/audit.ts \\
		--brand "https://www.peugeot.es" \\
		--sector "coches eléctricos" \\
		--language es \\
		--models gpt-4.1-mini

	# Wizard mode
	deno run --allow-read --allow-write --allow-net --allow-env examples/audit.ts \\
		--models gpt-4.1,gpt-4.1-mini \\
		--wizard ./wizard-export.json

	# Manual mode with cache
	deno run --allow-read --allow-write --allow-net --allow-env examples/audit.ts \\
		--brand "https://www.peugeot.es" \\
		--sector "Automotive" \\
		--language es \\
		--models gpt-4.1-mini \\
		--cache ./cache.json

	# Manual mode generating ideas from seed keywords
	deno run --allow-read --allow-write --allow-net --allow-env examples/audit.ts \\
		--brand "https://www.peugeot.es" \\
		--sector "coches eléctricos" \\
		--language es \\
		--models gpt-4.1-mini \\
		--generateIdeasFromSeeds
`);
}

function parseCliArgs(): CliArgs {
	const args: Record<string, string | boolean | number> = {};
	let currentKey: string | null = null;

	for (const arg of Deno.args) {
		if (arg.startsWith('--')) {
			currentKey = arg.slice(2);
			args[currentKey] = true;
		} else if (currentKey != null) {
			const value = arg;
			if (!isNaN(Number(value))) {
				args[currentKey] = Number(value);
			} else {
				args[currentKey] = value;
			}
			currentKey = null;
		}
	}

	return args as unknown as CliArgs;
}

function requireStringArg(value: string | number | boolean | undefined, flag: string): string {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`Error: Missing value for --${flag}`);
	}
	return value;
}

function parseOptionalNumberArg(value: number | string | boolean | undefined, flag: string): number | undefined {
	if (typeof value === 'undefined' || value === false) {
		return undefined;
	}
	if (typeof value === 'number' && !Number.isNaN(value)) {
		return value;
	}
	throw new Error(`Error: --${flag} must be a number`);
}

function parseOptionalStringArg(value: number | string | boolean | undefined, flag: string): string | undefined {
	if (typeof value === 'undefined' || value === false) {
		return undefined;
	}
	if (typeof value === 'string' && value.trim().length > 0) {
		return value.trim();
	}
	throw new Error(`Error: --${flag} must be a non-empty string`);
}

async function loadWizardConfig(filePath: string): Promise<WizardDerivedConfig> {
	let raw: string;
	try {
		raw = await Deno.readTextFile(filePath);
	} catch (error) {
		throw new Error(`Error: Failed to read wizard file "${filePath}": ${(error as Error).message}`);
	}

	let parsed: WizardExport;
	try {
		parsed = JSON.parse(raw) as WizardExport;
	} catch (error) {
		throw new Error(`Error: Wizard file "${filePath}" is not valid JSON: ${(error as Error).message}`);
	}

	const brandInfo = parsed.brandInfo;
	if (!brandInfo) {
		throw new Error('Error: Wizard file is missing "brandInfo" data');
	}

	const brand = brandInfo.domain?.trim();
	if (!brand) {
		throw new Error('Error: Wizard brandInfo.domain is required');
	}

	const sectorCandidate = brandInfo.sector ?? (Array.isArray(brandInfo.sectors) ? brandInfo.sectors[0] : undefined);
	const sector = sectorCandidate?.trim();
	if (!sector) {
		throw new Error('Error: Wizard brandInfo.sector is required');
	}

	const language = brandInfo.language?.trim();
	if (!language) {
		throw new Error('Error: Wizard brandInfo.language is required');
	}

	const personasItems = parsed.personas?.items;
	if (!Array.isArray(personasItems)) {
		throw new Error('Error: Wizard personas.items must be an array');
	}

	return {
		brand,
		sector,
		languageCode: language,
		countryCode: brandInfo.country?.trim() || null,
		numPersonas: personasItems.length
	};
}

async function main() {
	const args = parseCliArgs();

	let envPath = '../../.env';
	if (typeof args.env === 'string' && args.env.trim().length > 0) {
		envPath = args.env;
	} else if (typeof args.env !== 'undefined' && args.env !== false) {
		console.error('Error: --env requires a filepath');
		printUsage();
		Deno.exit(1);
	}

	await load({
		envPath,
		export: true
	});

	if (args.help) {
		printUsage();
		Deno.exit(0);
	}

	const isWizardMode = typeof args.wizard !== 'undefined';
	let config: ContextConfig;
	let sampleSize: number;
	let cachePath: string | undefined;
	const wizardPath = isWizardMode ? requireStringArg(args.wizard, 'wizard') : null;
	let outputPath: string;

	try {
		if (typeof args.output === 'string' && args.output.trim().length > 0) {
			outputPath = args.output;
		} else if (typeof args.output === 'undefined' || args.output === false) {
			outputPath = `${(wizardPath ?? '').replace(/\.json/, '-')}audit-results.json`;
		} else {
			throw new Error('Error: --output requires a filepath');
		}

		const modelsArg = parseOptionalStringArg(args.models, 'models');
		const modelsList = (modelsArg ?? 'gpt-4.1-mini')
			.split(',')
			.map(model => model.trim())
			.filter(model => model.length > 0);
		if (modelsList.length === 0) {
			throw new Error('Error: --models must include at least one model identifier');
		}

		const sampleArg = parseOptionalNumberArg(args.sample, 'sample');
		sampleSize = sampleArg ?? 400;
		if (sampleSize <= 0) {
			throw new Error('Error: --sample must be greater than zero');
		}

		if (isWizardMode) {
			const forbiddenFlags: Array<keyof CliArgs> = ['brand', 'sector', 'language', 'country', 'personas', 'cache'];
			const conflicts = forbiddenFlags.filter(flag => typeof args[flag] !== 'undefined');
			if (conflicts.length > 0) {
				throw new Error(`Error: The following options cannot be used together with --wizard: ${conflicts.map(flag => `--${flag}`).join(', ')}`);
			}

			const wizardConfig = await loadWizardConfig(wizardPath!);

			config = {
				brand: wizardConfig.brand,
				sector: wizardConfig.sector,
				languageCode: wizardConfig.languageCode,
				models: modelsList,
				numPersonas: wizardConfig.numPersonas,
				personaModel: 'gpt-4.1',
				funnelModel: 'gpt-4.1',
				countryCode: wizardConfig.countryCode,
				generateIdeasFromSeeds: Boolean(args.generateIdeasFromSeeds)
			};
		} else {
			const brandArg = requireStringArg(args.brand, 'brand');
			const sectorArg = requireStringArg(args.sector, 'sector');
			const languageArg = requireStringArg(args.language, 'language');
			const personasArg = parseOptionalNumberArg(args.personas, 'personas');
			const personas = personasArg ?? 5;
			if (personas <= 0) {
				throw new Error('Error: --personas must be greater than zero');
			}

			let countryCode: string | null = null;
			if (typeof args.country === 'string' && args.country.trim().length > 0) {
				countryCode = args.country;
			} else if (typeof args.country !== 'undefined' && args.country !== false) {
				throw new Error('Error: --country requires a value');
			}

			config = {
				brand: brandArg,
				sector: sectorArg,
				languageCode: languageArg,
				models: modelsList,
				numPersonas: personas,
				personaModel: 'gpt-4.1',
				funnelModel: 'gpt-4.1',
				countryCode: countryCode,
				generateIdeasFromSeeds: Boolean(args.generateIdeasFromSeeds)
			};
		}
		if (typeof args.cache === 'string' && args.cache.trim().length > 0) {
			cachePath = args.cache;
		} else if (typeof args.cache !== 'undefined' && args.cache !== false) {
			throw new Error('Error: --cache requires a filepath');
		} else if (wizardPath != null) {
			cachePath = `${wizardPath.replace(/\.json/, '-')}audit-cache.json`;
		}
	} catch (error) {
		console.error((error as Error).message);
		printUsage();
		Deno.exit(1);
	}

	const personasLabel = isWizardMode ? `${config.numPersonas} (already generated)` : `${config.numPersonas}`;

	console.log('Starting audit with configuration:');
	console.log(`  Brand: ${config.brand}`);
	console.log(`  Sector: ${config.sector}`);
	console.log(`  Language: ${config.languageCode}`);
	console.log(`  Country: ${config.countryCode ?? 'global'}`);
	console.log(`  Models: ${config.models.join(', ')}`);
	console.log(`  Personas: ${personasLabel}`);
	console.log(`  Sample size: ${sampleSize}`);
	console.log(`  Generate ideas from seeds: ${config.generateIdeasFromSeeds ? 'Yes' : 'No (get metrics only)'}`);
	if (cachePath) {
		console.log(`  Cache file: ${cachePath}`);
	}
	if (wizardPath) {
		console.log(`  Wizard import: ${wizardPath}`);
	}
	console.log('');

	const startTime = Date.now();

	try {
		const results = await audit(
			config,
			sampleSize,
			cachePath,
			wizardPath ?? undefined
		);

		const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
		console.log(`\nAudit completed in ${duration} minutes`);
		console.log(`Generated ${results.length} audit records`);

		console.log(`\nSaving results to ${outputPath}...`);
		await Deno.writeTextFile(outputPath, JSON.stringify(results, null, 2));
		console.log('Done!');

		console.log('\nSample result:');
		console.log(JSON.stringify(results[0], null, 2));

	} catch (error) {
		console.error('\nAudit failed with error:');
		console.error(error);
		Deno.exit(1);
	}
}

if (import.meta.main) {
	main();
}
