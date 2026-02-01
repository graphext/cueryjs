import { z } from '@zod/zod';
import { Tool, type ModelConfig } from '../tool.ts';
import { dedent } from '../helpers/utils.ts';

const PROMPT = dedent(`
# Instructions

Assign a {name} ({type} score between {min} and {max}) to the data record below.

Score description: {description}

Make sure to consider all the attributes of the data record, and assign the score
based on the content of the attributes.

# Data Record

{record}
`);

type ScoreSchema = z.ZodObject<{ value: z.ZodNumber }>;

/**
 * Dynamically create a Zod schema for a score based on provided parameters.
 */
function makeScoreSchema(
	type: 'integer' | 'number',
	min: number,
	max: number,
	description: string
): ScoreSchema {
	let schema: z.ZodNumber;
	if (type === 'integer') {
		schema = z.number().int().min(min).max(max).describe(description);
	} else {
		schema = z.number().min(min).max(max).describe(description);
	}

	return z.object({
		value: schema,
	});
}

/**
 * Configuration for the Scorer tool.
 */
export interface ScorerConfig {
	name: string;
	description: string;
	type: 'integer' | 'number';
	min: number;
	max: number;
}

/**
 * A tool that scores records based on configured criteria.
 */
export class Scorer extends Tool<Record<string, unknown> | null, { value: number }, number> {
	private readonly scoreSchema: ScoreSchema;
	private readonly promptTemplate: string;

	constructor(config: ScorerConfig, modelConfig: ModelConfig) {
		super(modelConfig);
		const { name, description, type, min, max } = config;
		this.scoreSchema = makeScoreSchema(type, min, max, description);
		this.promptTemplate = PROMPT
			.replace('{name}', name)
			.replace('{type}', type)
			.replace('{min}', min.toString())
			.replace('{max}', max.toString())
			.replace('{description}', description);
	}

	protected override schema() {
		return this.scoreSchema;
	}

	protected prompt(record: Record<string, unknown> | null) {
		return this.promptTemplate.replace('{record}', JSON.stringify(record, null, 2));
	}

	protected override extractResult(parsed: { value: number }) {
		return parsed.value;
	}
}
