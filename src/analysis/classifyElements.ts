import { z } from '@zod/zod';

import mapParallel from '../mapParallel.ts';
import { askOpenAISafe } from '../openai.ts';

import type { List, Table, Form } from './parseHtml.ts';


const ListClassificationSchema = z.object({
	type: z.enum([
		'Listicle',
		'Product Comparison',
		'Product Features',
		'FAQ',
		'Navigation',
		'Checklist',
		'Steps',
		'Benefits',
		'Specifications',
		'Other'
	]).describe('Category that best describes the purpose and content of this list.'),
	confidence: z.enum(['high', 'medium', 'low']).describe('Confidence level in this classification.'),
	reason: z.string().describe('Brief explanation (single phrase) of why this classification was assigned.')
}).describe('Classification of a list element.');

const TableClassificationSchema = z.object({
	type: z.enum([
		'Product Comparison',
		'Specifications',
		'Pricing',
		'Features Matrix',
		'Data Table',
		'FAQ',
		'Pros/Cons',
		'Timeline',
		'Other'
	]).describe('Category that best describes the purpose and content of this table.'),
	confidence: z.enum(['high', 'medium', 'low']).describe('Confidence level in this classification.'),
	reason: z.string().describe('Brief explanation (single phrase) of why this classification was assigned.')
}).describe('Classification of a table element.');

const FormClassificationSchema = z.object({
	type: z.enum([
		'Calculator',
		'Newsletter Signup',
		'Contact Form',
		'Lead Generation',
		'Search',
		'Filter',
		'Configuration',
		'Quote Request',
		'Registration',
		'Other'
	]).describe('Category that best describes the purpose and function of this form.'),
	confidence: z.enum(['high', 'medium', 'low']).describe('Confidence level in this classification.'),
	reason: z.string().describe('Brief explanation (single phrase) of why this classification was assigned.')
}).describe('Classification of a form element.');

type ListClassification = z.infer<typeof ListClassificationSchema>;
type TableClassification = z.infer<typeof TableClassificationSchema>;
type FormClassification = z.infer<typeof FormClassificationSchema>;


interface ElementTypeMap {
	list: { element: List; schema: typeof ListClassificationSchema; classification: ListClassification };
	table: { element: Table; schema: typeof TableClassificationSchema; classification: TableClassification };
	form: { element: Form; schema: typeof FormClassificationSchema; classification: FormClassification };
}

const schemaMap = {
	list: ListClassificationSchema,
	table: TableClassificationSchema,
	form: FormClassificationSchema
} as const;

const ELEM_CAT_PROMPT = `
Classify the following {elementType} element based on its content and structure.

{content}

Analyze the content and provide a classification with the appropriate type, confidence level, and reasoning.
`.trim();

async function classifySingleElement<T extends keyof ElementTypeMap>(
	element: ElementTypeMap[T]['element'],
	elementType: T,
	model: string
): Promise<ElementTypeMap[T]['classification']> {
	const prompt = ELEM_CAT_PROMPT
		.replace('{elementType}', elementType)
		.replace('{content}', JSON.stringify(element, null, 2));
	const schema = schemaMap[elementType] as z.ZodType<ElementTypeMap[T]['classification']>;
	const { parsed } = await askOpenAISafe(prompt, model, schema);
	if (!parsed) {
		throw new Error(`Failed to classify ${elementType} element`);
	}
	return parsed;
}

export async function classifyElements<T extends keyof ElementTypeMap>(
	elements: Array<ElementTypeMap[T]['element']>,
	elementType: T,
	model: string = 'gpt-4.1-mini',
	maxConcurrency: number = 100
): Promise<Array<ElementTypeMap[T]['element'] & { classification: ElementTypeMap[T]['classification'] }>> {
	const classifications = await mapParallel(
		elements,
		maxConcurrency,
		element => classifySingleElement(element, elementType, model)
	);

	return elements.map((element, index) => ({
		...element,
		classification: classifications[index]
	}));
}



