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

// Browser-safe Google Search Console exports
export {
	fetchSearchConsoleQueries,
	getGoogleAccountEmailFromIdToken,
	GOOGLE_SEARCH_CONSOLE_AUTHORIZATION_SCOPE,
	GOOGLE_SEARCH_CONSOLE_DEFAULT_QUERY_ROW_LIMIT,
	GOOGLE_SEARCH_CONSOLE_QUERY_PAGE_DIMENSIONS,
	GOOGLE_SEARCH_CONSOLE_READONLY_SCOPE,
	listSearchConsoleSites,
} from './src/apis/googleSearchConsole/index.ts';
export type {
	FetchSearchConsoleQueriesParams,
	ListSearchConsoleSitesParams,
	SearchConsoleAggregationType,
	SearchConsoleDataState,
	SearchConsoleDimension,
	SearchConsoleDimensionFilter,
	SearchConsoleDimensionFilterGroup,
	SearchConsoleDimensionFilterOperator,
	SearchConsoleFilterDimension,
	SearchConsoleQueryRow,
	SearchConsoleSearchType,
	SearchConsoleSite,
} from './src/apis/googleSearchConsole/index.ts';
