/**
 * Generic AI step tool for processing records with LLM-inferred response schemas.
 *
 * This tool allows for generic tasks that iterate over data, where the response schema
 * is either provided directly or inferred from the user's instructions using an LLM.
 */

import { z } from '@zod/zod';
import { mapParallel } from '../async.ts';
import { askOpenAISafe, type AIParams } from '../openai.ts';
import { dedent } from '../utils.ts';

// ============================================================================
// Prompts
// ============================================================================

const GENERIC_PROMPT = dedent(`
# Instructions

{instructions}

# Data Record

{record}
`);

const SCHEMA_GENERATION_SYSTEM_PROMPT = dedent(`
You are an expert at designing JSON schemas for structured data extraction from LLMs.

Your role is to:
1. Understand what kind of data the user wants to extract
2. Define appropriate field names, types, constraints and descriptions
3. Return a valid JSON schema specification

Schema design considerations:
- Use appropriate data types (string, number, integer, boolean, array, object)
- Include constraints if appropriate (minLength, maxLength, minimum, maximum, enum, etc.)
- Use "format" attributes where relevant (email, uri, date, etc.)
- Provide clear, helpful descriptions for each field
- Consider whether fields should be required or optional
- Use consistent naming conventions (camelCase preferred)

The "reasoning" field should contain your thought process behind the schema design,
and the "jsonSchema" field should contain the complete JSON schema.
`);

const SCHEMA_GENERATION_PROMPT = dedent(`
Create a JSON schema for extracting information based on these instructions:

{instructions}

The schema will be used to validate LLM outputs when processing data records.
Design a schema that captures all the information described in the instructions.
`);

const SCHEMA_CONVERSION_PROMPT = dedent(`
A user has provided instructions for a task that involves extracting information
from data records. Your task is to translate these instructions into new instructions
for generating a JSON schema that describes the information to extract.

## Example 1

- User instruction: "Extract any emails and URLs from the text."
- Your instruction: "Create a JSON schema with fields for 'emails' (array of strings with email format) and 'urls' (array of strings with uri format)."

## Example 2

- User instruction: "Extract the name and age of the person from their bio."
- Your instruction: "Create a JSON schema with fields for 'name' (string) and 'age' (integer, minimum 0)."

Make sure to capture all relevant details from the user's instructions, e.g. whether fields
should be scalar or arrays, whether they should be required or optional, and any specific
formats that should be used.

# User instruction

{instructions}
`);

// ============================================================================
// Schemas
// ============================================================================

/**
 * Schema for the schema generation response.
 */
const SchemaResponseSchema = z.object({
	reasoning: z.string().describe('Brief explanation of schema design choices'),
	jsonSchema: z.record(z.string(), z.unknown()).describe('Valid JSON schema as an object')
});

export type SchemaResponse = z.infer<typeof SchemaResponseSchema>;

/**
 * Schema for the schema instruction conversion response.
 */
const SchemaInstructionsSchema = z.object({
	instructions: z.string().describe('Instructions for generating the JSON schema')
});

// ============================================================================
// Utilities
// ============================================================================

/**
 * Formats a record object into a human-readable text representation.
 */
function formatRecord(record: Record<string, unknown>): string {
	return Object.entries(record)
		.map(([key, value]) => `${key}: ${JSON.stringify(value, null, 2)}`)
		.join('\n\n');
}

// ============================================================================
// Schema Generation
// ============================================================================

export interface GenerateSchemaOptions {
	instructions: string;
	model?: string;
	modelParams?: AIParams;
	maxRetries?: number;
}

/**
 * Generates a JSON schema from natural language instructions.
 *
 * @param options - Configuration options
 * @returns The generated schema response with reasoning and JSON schema
 */
export async function generateSchema({
	instructions,
	model = 'gpt-4.1',
	modelParams = {},
	maxRetries = 5
}: GenerateSchemaOptions): Promise<SchemaResponse> {
	const prompt = [
		{ role: 'system' as const, content: SCHEMA_GENERATION_SYSTEM_PROMPT },
		{ role: 'user' as const, content: SCHEMA_GENERATION_PROMPT.replace('{instructions}', instructions) }
	];

	const { parsed, error } = await askOpenAISafe(
		prompt,
		model,
		SchemaResponseSchema,
		modelParams,
		maxRetries,
		'return'
	);

	if (error || !parsed) {
		throw new Error(`Failed to generate schema: ${error?.message ?? 'Unknown error'}`);
	}

	return parsed;
}

/**
 * Converts general task instructions into schema generation instructions.
 * This is used when the user provides only task instructions without a schema.
 */
async function convertToSchemaInstructions(
	instructions: string,
	model: string,
	modelParams: AIParams,
	maxRetries: number
): Promise<string> {
	const prompt = SCHEMA_CONVERSION_PROMPT.replace('{instructions}', instructions);

	const { parsed, error } = await askOpenAISafe(
		prompt,
		model,
		SchemaInstructionsSchema,
		modelParams,
		maxRetries,
		'return'
	);

	if (error || !parsed) {
		throw new Error(`Failed to convert instructions: ${error?.message ?? 'Unknown error'}`);
	}

	return parsed.instructions;
}

// ============================================================================
// Generic Processing
// ============================================================================

/** Common options for LLM calls */
interface BaseLLMOptions {
	instructions: string;
	model?: string;
	modelParams?: AIParams;
	maxRetries?: number;
}

export interface GenericOptions extends BaseLLMOptions {
	record: Record<string, unknown> | null;
	schema: Record<string, unknown>;
}

export interface GenericBatchOptions extends BaseLLMOptions {
	records: Array<Record<string, unknown> | null>;
	schema: Record<string, unknown>;
	maxConcurrency?: number;
}

/**
 * Processes a single record using an LLM with a provided JSON schema.
 */
export async function generic<T = Record<string, unknown>>({
	record,
	instructions,
	schema,
	model = 'gpt-4.1-mini',
	modelParams = {},
	maxRetries = 3
}: GenericOptions): Promise<T | null> {
	if (record == null || Object.keys(record).length === 0) {
		return null;
	}

	const zodSchema = z.fromJSONSchema(schema);
	const prompt = GENERIC_PROMPT
		.replace('{instructions}', instructions)
		.replace('{record}', formatRecord(record));

	const { parsed, error } = await askOpenAISafe(
		prompt,
		model,
		zodSchema,
		modelParams,
		maxRetries,
		'return'
	);

	if (error || parsed == null) {
		throw new Error(`Failed to process record: ${error?.message ?? 'Unknown error'}`);
	}

	return parsed as T;
}

/**
 * Processes multiple records using an LLM with a provided JSON schema.
 */
export function genericBatch<T = Record<string, unknown>>({
	records,
	instructions,
	schema,
	model = 'gpt-4.1-mini',
	modelParams = {},
	maxRetries = 3,
	maxConcurrency = 100
}: GenericBatchOptions): Promise<Array<T | null>> {
	return mapParallel(
		records,
		maxConcurrency,
		(record) => generic<T>({ record, instructions, schema, model, modelParams, maxRetries })
	);
}

// ============================================================================
// Auto Processing (Schema Generation + Processing)
// ============================================================================

interface ResolvedSchema {
	schema: Record<string, unknown>;
	schemaReasoning: string;
}

/**
 * Resolves a schema from various input types:
 * - If schemaOrInstructions is an object, use it directly as the schema
 * - If it's a string, use it as instructions to generate a schema
 * - If it's null/undefined, derive schema instructions from the task instructions
 */
async function resolveSchema(
	schemaOrInstructions: string | Record<string, unknown> | null | undefined,
	taskInstructions: string,
	model: string,
	modelParams: AIParams,
	maxRetries: number
): Promise<ResolvedSchema> {
	// Schema already provided as object
	if (schemaOrInstructions != null && typeof schemaOrInstructions === 'object') {
		return {
			schema: schemaOrInstructions,
			schemaReasoning: 'Schema was provided directly'
		};
	}

	// Determine schema instructions
	const schemaInstructions = typeof schemaOrInstructions === 'string'
		? schemaOrInstructions
		: await convertToSchemaInstructions(taskInstructions, model, modelParams, maxRetries);

	// Generate the schema
	const schemaResponse = await generateSchema({
		instructions: schemaInstructions,
		model,
		modelParams,
		maxRetries
	});

	return {
		schema: schemaResponse.jsonSchema,
		schemaReasoning: schemaResponse.reasoning
	};
}

/** Common options for auto functions */
interface BaseAutoOptions extends BaseLLMOptions {
	schemaOrInstructions?: string | Record<string, unknown> | null;
	schemaModel?: string;
}

export interface AutoOptions extends BaseAutoOptions {
	record: Record<string, unknown> | null;
}

export interface AutoBatchOptions extends BaseAutoOptions {
	records: Array<Record<string, unknown> | null>;
	maxConcurrency?: number;
}

/** Result from auto functions includes the resolved schema */
export interface AutoResult<T> {
	data: T;
	schema: Record<string, unknown>;
	schemaReasoning: string;
}

/**
 * Automatically generates a response schema from instructions and processes a single record.
 *
 * This is a fully automatic tool that:
 * 1. Optionally converts general instructions into schema-specific instructions
 * 2. Generates a JSON schema from the instructions
 * 3. Processes the record using the generated schema
 */
export async function auto<T = Record<string, unknown>>({
	record,
	instructions,
	schemaOrInstructions = null,
	model = 'gpt-4.1-mini',
	schemaModel = 'gpt-4.1',
	modelParams = {},
	maxRetries = 3
}: AutoOptions): Promise<AutoResult<T | null>> {
	const { schema, schemaReasoning } = await resolveSchema(
		schemaOrInstructions,
		instructions,
		schemaModel,
		modelParams,
		maxRetries
	);

	const data = await generic<T>({
		record,
		instructions,
		schema,
		model,
		modelParams,
		maxRetries
	});

	return { data, schema, schemaReasoning };
}

/**
 * Automatically generates a response schema and processes multiple records.
 *
 * The schema is generated once from the instructions, then used to process all records.
 */
export async function autoBatch<T = Record<string, unknown>>({
	records,
	instructions,
	schemaOrInstructions = null,
	model = 'gpt-4.1-mini',
	schemaModel = 'gpt-4.1',
	modelParams = {},
	maxRetries = 3,
	maxConcurrency = 100
}: AutoBatchOptions): Promise<AutoResult<Array<T | null>>> {
	const { schema, schemaReasoning } = await resolveSchema(
		schemaOrInstructions,
		instructions,
		schemaModel,
		modelParams,
		maxRetries
	);

	const data = await genericBatch<T>({
		records,
		instructions,
		schema,
		model,
		modelParams,
		maxRetries,
		maxConcurrency
	});

	return { data, schema, schemaReasoning };
}
