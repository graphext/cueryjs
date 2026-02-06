/**
 * Central export for all Edge Function schemas and types.
 *
 * For backend (Deno): Import schemas with runtime validation
 * For frontend (Node/TypeScript): Import types only using `import type`
 *
 * Types are inferred from Zod schemas using z.infer<typeof Schema>
 * This ensures a single source of truth.
 *
 * NOTE: For seed keyword functions, import from '@supabase/lib/seedKeywords' (frontend)
 * or 'shared/cuery/lib/seedKeywords/index.ts' (backend).
 */

// Export types from schema files (single source of truth)
export type * from './persona.schema.ts';
export type * from './brand.schema.ts';
export type * from './funnel.schema.ts';
export type * from './keyword.schema.ts';
export type * from './models.schema.ts';
export type * from './seedKeyword.schema.ts';
export type * from './topics.schema.ts';
export type * from './summary.schema.ts';
export type * from './prompt.schema.ts';
