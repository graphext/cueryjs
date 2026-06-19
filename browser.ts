/**
 * Browser-safe exports for @graphext/cuery
 *
 * This module only exports types and pure functions that can safely run in the browser.
 * It excludes server-only modules like llmScraper, googleAds, and APIs that
 * depend on Node.js or Deno-specific capabilities.
 *
 * @module
 */

// Types and schemas (no runtime dependencies)
export * from './src/schemas/index.ts';

// Browser-safe APIs that only require fetch and caller-supplied credentials
export * from './src/apis/googleSearchConsole/index.ts';
