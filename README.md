# Cuery

[![JSR](https://jsr.io/badges/@graphext/cuery)](https://jsr.io/@graphext/cuery)

> **Cuery** - LLM-powered data extraction and analysis tools with structured
> outputs

Cuery is a TypeScript/Deno library that provides tools for generating structured
marketing data using Large Language Models (LLMs). It leverages OpenAI's API
with Zod schema validation to ensure type-safe, predictable outputs for various
marketing analysis tasks.

## Features

- 🎯 **Structured Outputs**: All LLM responses are validated against Zod schemas
  for type safety
- 🔄 **Marketing Funnel Generation**: Create customized marketing funnels for
  any sector and market
- 👥 **Persona Generation**: Generate detailed customer personas based on sector
  and market
- 🚀 **Deno-First**: Built with modern Deno runtime and TypeScript
- ✅ **Type-Safe**: Full TypeScript support with exported types

## Installation

### Using JSR (Recommended)

```bash
deno add @graphext/cuery
```

### Using import maps

Add to your `deno.json`:

```json
{
  "imports": {
    "@graphext/cuery": "jsr:@graphext/cuery@^0.1.0"
  }
}
```

## Prerequisites

You'll need an OpenAI API key to use this library. Set it as an environment
variable:

```bash
export OPENAI_API_KEY="sk-..."
```

## Usage

### Generating Customer Personas

Generate detailed customer personas for a specific sector and market:

```typescript
import { generatePersonas } from "@graphext/cuery";

const personas = await generatePersonas("Running Shoes", "Spain");
console.log(personas);

// Output:
// {
//   personas: [
//     {
//       name: "Marathon Miguel",
//       description: "A 35-year-old passionate runner training for marathons..."
//     },
//     // ... 2 more personas
//   ]
// }
```

### Customizing Marketing Funnels

Create a customized marketing funnel for your specific sector and market:

```typescript
import { custom } from "@graphext/cuery/funnel";

const funnel = await custom(
  "E-commerce Fashion", // sector
  "English", // language
  "United States", // country (optional, defaults to "global")
  "gpt-4.1", // model (optional, defaults to "gpt-4.1")
);

console.log(funnel.stages);

// Output: A complete funnel with stages like:
// - Awareness / Discovery
// - Consideration / Research
// - Decision / Evaluation
// - Conversion / Action
// - Post-Purchase / Retention & Advocacy
//
// Each stage contains customized categories with:
// - name, description
// - keywordPatterns
// - intent
// - examples (actual keyword examples for SEO)
```

### Working with Funnel Types

All funnel components are fully typed:

```typescript
import type {
  Funnel,
  FunnelCategory,
  FunnelStage,
} from "@graphext/cuery/funnel";

// Use the types in your application
function analyzeFunnel(funnel: Funnel) {
  funnel.stages.forEach((stage: FunnelStage) => {
    console.log(`Stage: ${stage.stage}`);
    console.log(`Goal: ${stage.goal}`);

    stage.categories.forEach((category: FunnelCategory) => {
      console.log(`  Category: ${category.name}`);
      console.log(`  Intent: ${category.intent}`);
      console.log(`  Examples: ${category.examples.join(", ")}`);
    });
  });
}
```

## API Reference

### `generatePersonas(sector: string, market: string)`

Generates 3 detailed customer personas for a specific sector and market.

**Parameters:**

- `sector` (string): The industry or product sector (e.g., "Running Shoes",
  "SaaS", "E-commerce")
- `market` (string): The target market or geography (e.g., "Spain", "B2B",
  "North America")

**Returns:**
`Promise<{ personas: Array<{ name: string, description: string }> }>`

### `custom(sector, language, country?, model?, funnel?)`

Customizes a marketing funnel for a specific sector and market using an LLM.

**Parameters:**

- `sector` (string): The industrial sector to customize the funnel for
- `language` (string): The language for the funnel content
- `country` (string, optional): The geographic market (default: "global")
- `model` (string, optional): The OpenAI model to use (default: "gpt-4.1")
- `funnel` (Funnel | FunnelStage[], optional): The funnel structure to customize
  (default: built-in generic funnel)

**Returns:** `Promise<Funnel>`

## Development

### Running Tests

Run all tests:

```bash
deno task test
```

Run specific test files:

```bash
deno test tests/personas_test.ts --allow-env --allow-net --env-file
```

**Note:** The `--allow-env` flag is required because tests need access to the
`OPENAI_API_KEY` environment variable.

### Type Checking

Check types without running the code:

```bash
deno check mod.ts
```

Or use the task:

```bash
deno task check
```

### Running Examples

Run the example file:

```bash
deno task run examples/example.ts
```

### Running as edge functions

1. Run `supabase start` (see:
   https://supabase.com/docs/reference/cli/supabase-start)
2. Make an HTTP request:

```
curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/generate_personnas' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'
```

## Project Structure

```
cueryjs/
├── mod.ts                  # Main entry point
├── deno.json              # Deno configuration and tasks
├── deno.lock              # Lock file for dependencies
├── src/
│   ├── personas.ts        # Persona generation logic
│   ├── funnel.ts          # Marketing funnel customization
│   ├── brands.ts          # Brand info and competitor analysis
│   └── utils.ts           # Utility functions
├── tests/
│   ├── personas_test.ts   # Tests for persona generation
│   └── funnel_test.ts     # Tests for funnel customization
└── examples/
    └── example.ts         # Usage examples
```

## Dependencies

- **@openai/openai**: OpenAI API client for LLM interactions
- **zod**: Schema validation for structured outputs
- **@std/assert**: Deno standard library assertions for testing

## License

This project is part of the Graphext organization.

## Contributing

Contributions are welcome! Please ensure all tests pass before submitting a PR:

```bash
deno task test
deno task check
```

## Roadmap

- [ ] Competitor analysis tools
- [ ] Additional marketing analysis functions
- [ ] Support for more LLM providers
- [ ] Caching layer for repeated queries
- [ ] CLI tool for quick access to functions

---

Made with ❤️ by [Graphext](https://graphext.com)
