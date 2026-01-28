# Schemas

This directory contains Zod schemas and TypeScript types for all data structures used in the library.

## Structure

```
schemas/
├── index.ts              # Central export for all schemas
├── persona.schema.ts     # Schemas + types for personas
├── brand.schema.ts       # Schemas + types for brands/competitors
├── funnel.schema.ts      # Schemas + types for marketing funnels
├── keyword.schema.ts     # Schemas + types for keywords
├── entity.schema.ts      # Schemas + types for entities
├── sources.schema.ts     # Schemas + types for sources
└── topics.schema.ts      # Schemas + types for topics
```

## Purpose

This architecture provides:
- **Single Source of Truth**: Zod schemas are the only place types are defined (via `z.infer`)
- **Type Safety**: Consumer types guaranteed to match validation
- **Runtime Validation**: Schemas validate LLM responses at runtime
- **Tree-Shaking Safe**: Consumers can use `import type` to prevent bundling schemas

## Usage

### With LLM Tools

Import schemas for runtime validation of LLM responses:

```typescript
import { PersonaSchema, BrandSchema, FunnelSchema } from './schemas/persona.schema.ts';

// Use for validation
const { parsed } = await askOpenAISafe(prompt, model, PersonaSchema);
```

### Type-Only Imports

Import types without runtime code:

```typescript
import type { Persona, Brand, Funnel } from '@graphext/cuery';

// Use for type annotations
function processPersonas(personas: Array<Persona>) {
	// ...
}
```

## How It Works

The Zod schemas define both validation rules AND types:

```typescript
// Single source of truth
export const PersonaSchema = z.object({
	name: z.string(),
	description: z.string(),
	keywordSeeds: z.array(z.string())
});

// Type inferred from schema (no duplication)
export type Persona = z.infer<typeof PersonaSchema>;
```

## Key Principles

### DO

- Use `import type` when you only need types (not validation)
- Keep schema files focused on schemas only (no business logic)
- Document schema fields with `.describe()` for LLM guidance
- Export both schemas and types from index.ts

### DON'T

- Add business logic (prompts, functions) to schema files
- Duplicate type definitions manually
- Mix runtime dependencies in schema files

## Type Maintenance

Types are automatically inferred from Zod schemas using `z.infer<typeof Schema>`. When updating:

1. Update the Zod schema in `*.schema.ts`
2. Types are automatically updated (no manual sync needed)
3. Run `deno task check` to verify compatibility
4. Run `deno task test` to ensure no breaking changes

## Integration with Backends

These schemas can be shared between:
- **Deno/Node backends**: Import schemas directly for validation
- **Frontend apps**: Use `import type` for type-only imports
- **Edge functions**: Validate LLM responses at the edge

For frontend integration, you may need to configure module resolution to map Deno JSR imports to npm packages:

```typescript
// Ambient module declaration (if needed)
declare module '@zod/zod' {
	export * from 'zod';
}
```

## Related Patterns

This pattern is inspired by:
- [tRPC](https://trpc.io/) - Type-safe API calls
- [Zodios](https://www.zodios.org/) - OpenAPI + Zod integration
- [ts-rest](https://ts-rest.com/) - Type-safe REST APIs
