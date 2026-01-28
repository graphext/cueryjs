# Code Style Rules

## General

- **Runtime**: Deno with TypeScript
- **Indentation**: TABS (not spaces)
- **Semicolons**: Always
- **Trailing commas**: Never

## TypeScript

- **Array types**: `Array<T>` not `T[]`
- **Null checks**: Always `!= null`, never implicit `if (value)` (0 is falsy but not null)
- **Conditionals**: Always use braces, never `if (...) statement;`
- **Async**: `async/await`, never `then/catch`
- **Data structures**: Prefer interfaces over type aliases
- **Immutability**: Prefer `const` and `readonly`
- **Operators**: Use optional chaining (`?.`) and nullish coalescing (`??`)
- **No `any`**: Use proper types or `unknown`

## Imports

- Deno-style imports with `.ts` extensions
- Order: Third-party -> Deno std -> local imports
- Use relative paths within the project

## Testing

- Use Deno's built-in test runner
- Use `@std/assert` for assertions
- Flag OpenAI tests with `ignore: SKIP_OPENAI` pattern
- Test file naming: `*.test.ts`

## Comments

- Only explain WHY, never WHAT
- English only
- No JSDoc unless exporting public API
