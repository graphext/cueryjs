# Edge Function Schemas

This directory contains Zod schemas and TypeScript types for Supabase Edge Function endpoints.

## Structure

```
schemas/
├── index.ts          # Central export for all schemas (re-exports types from schema files)
├── persona.schema.ts # Zod schemas + types for persona endpoints
├── brand.schema.ts   # Zod schemas + types for brand/competitor endpoints
└── funnel.schema.ts  # Zod schemas + types for funnel endpoints
```

## Purpose

This architecture provides:
- **Single Source of Truth**: Zod schemas are the only place types are defined (via `z.infer`)
- **Type Safety**: Frontend types guaranteed to match backend validation
- **Zero Bundle Risk**: Schema files contain no business logic or runtime code
- **Tree-Shaking Safe**: Frontend uses `import type` to prevent bundling

## Usage

### Backend (Deno)

Import schemas with runtime validation:

```typescript
import { PersonaSchema, BrandSchema, FunnelSchema } from './schemas/persona.schema.ts';

// Use for validation
const { parsed } = await askOpenAISafe(prompt, model, PersonaSchema);
```

### Frontend (Next.js/TypeScript)

Import types only (no runtime code):

```typescript
import type { Persona, Brand, Funnel } from '@supabase/schemas';

// Use for type annotations
const response = await supabaseClient.functions.invoke<Array<Persona>>('ai_audit/personas', {
	body: { brand, sector, market }
});
```

## How It Works

The Zod schemas in `*.schema.ts` files define both validation rules AND types:

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

The frontend imports types using TypeScript's module resolution:
- `@zod/zod` imports (Deno JSR) are mapped to `zod` npm package via ambient module declaration
- `import type` ensures only types are extracted, not runtime code
- Zod is installed as dev dependency for type extraction only

## Key Principles

### ✅ DO

- Use `import type` in frontend code
- Keep schema files focused on schemas only (no business logic)
- Update both schema definitions and types.ts when changing schemas
- Document schema fields with `.describe()` for LLM guidance

### ❌ DON'T

- Import schemas without `type` keyword in frontend
- Add business logic (prompts, functions) to schema files
- Mix runtime dependencies in types.ts
- Forget to update types.ts when changing schemas

## Type Maintenance

Types are automatically inferred from Zod schemas using `z.infer<typeof Schema>`. When updating:

1. Update the Zod schema in `*.schema.ts`
2. Types are automatically updated (no manual sync needed)
3. Run `yarn type-check` to verify compatibility
4. Run `yarn test` to ensure no breaking changes

## Configuration

### TypeScript Path Mapping

The frontend imports are configured in `tsconfig.json`:

```json
{
	"compilerOptions": {
		"paths": {
			"@supabase/schemas": ["./supabase/functions/_shared/cuery/src/schemas/index.ts"]
		}
	}
}
```

### Module Resolution

An ambient module declaration (`src/types/deno-modules.d.ts`) maps Deno JSR imports to npm packages:

```typescript
declare module '@zod/zod' {
	export * from 'zod';
}
```

This allows TypeScript to resolve `@zod/zod` imports in schema files to the `zod` npm package installed as a dev dependency.

## Verification

To verify no backend code is bundled, check that:
1. All `@supabase/schemas` imports use `import type`
2. Schema files contain only Zod definitions and type exports
3. No business logic appears in schema files

Run the verification:

```bash
# Check imports are type-only
grep -r "import type.*@supabase/schemas" src/

# Verify schema files have no business logic
grep -E "(askOpenAI|dedent|PROMPT)" supabase/functions/_shared/cuery/src/schemas/*.ts
# (should return empty)
```

## Related Patterns

This pattern is inspired by:
- [tRPC](https://trpc.io/) - Type-safe API calls
- [Zodios](https://www.zodios.org/) - OpenAPI + Zod integration
- [ts-rest](https://ts-rest.com/) - Type-safe REST APIs
