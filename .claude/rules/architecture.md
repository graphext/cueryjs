# Architecture Rules

## Directory Structure

```
src/
├── *.ts           # Utilities (no LLM calls)
├── tools/         # LLM-powered tools (call OpenAI)
├── schemas/       # Zod schemas for all data types
└── apis/          # External API integrations
```

## File Placement

### Root `/src/` (Utilities)
- Pure functions, no OpenAI calls
- Shared across tools
- Examples: `async.ts`, `cache.ts`, `urls.ts`, `utils.ts`
- Orchestrators: `api.ts`, `audit.ts`

### `/src/tools/` (LLM Tools)
- Functions that call OpenAI
- Import utilities from `../`
- Import other tools from `./`
- Each tool should have corresponding tests

### `/src/schemas/` (Data Types)
- Zod schemas defining all data structures
- Export types alongside schemas
- Re-export everything from `index.ts`

### `/src/apis/` (External APIs)
- Third-party API integrations
- SERP APIs, scrapers, etc.
- Subdirectories for complex integrations

## Import Rules

From tools:
```typescript
import { utility } from '../utility.ts';       # utility from parent
import { otherTool } from './otherTool.ts';   # tool from same dir
import type { Schema } from '../schemas/x.ts'; # schema
```

From root orchestrators:
```typescript
import { tool } from './tools/tool.ts';
import { utility } from './utility.ts';
```

## OpenAI Integration

- All LLM calls go through `src/openai.ts`
- Use Zod schemas for response validation
- Use `askOpenAISafe` for graceful error handling

## Schema Design

- Define schema first, then implement tool
- Export both schema and inferred type
- Use `.describe()` for LLM-facing field documentation
