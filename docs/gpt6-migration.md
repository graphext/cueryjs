# Small-model defaults and GPT-6 Responses support

Version 0.11.14 changes the existing GPT-4.1 mini defaults in generic tools,
HTML element classification and search to GPT-6 Luna with reasoning `none`.
Callers explicitly selecting another model retain that choice. Existing
full-size GPT-4.1 and GPT-5.1 defaults are unchanged; no saved model identifiers
are silently rewritten.

For Luna/Sol, the Responses provider and web search normalize flat
`reasoning_effort` into `reasoning.effort` (flat wins). Luna defaults to `none`,
Sol to `medium`; explicit effort is preserved, except `minimal` becomes `low`
and Sol `none` becomes `low`. Temperature/top_p are omitted when reasoning is
enabled. Other provider options and nested reasoning settings are retained.
Search and formatted search preserve the old GPT-5 default effort `low`.

The existing locked OpenAI SDK 6.49.0 supports the required Responses calls;
no SDK dependency update or lockfile rewrite was needed. Release 0.11.13 was
confirmed as npm latest before preparing 0.11.14. Merging this version bump
into main triggers the existing npm/JSR release workflow; do not merge until
reviewed. DatoCat must consume the published version before its new defaults
are deployed. Its existing internal-package age exemptions already cover Cuery.

## Verification

- `deno check mod.ts` passes.
- `deno test --allow-env --allow-net tests/`: 475 passed, 40 existing integration
  cases skipped, no failures.
- Four focused tests cover actual SDK request serialization and Zod parsing,
  schema rejection, parallel requests, web search, formatted search,
  effort/temperature normalization and model pricing.
- A standalone bundle of this code, the locked SDK and Zod was executed with
  the existing OpenAI credential inside the Deckard pod (no credential export):
  Luna `none` and `medium`, Sol `low` structured requests all parsed correctly;
  two parallel Luna web searches returned answers and sources; the combined
  search-then-Zod flow returned a valid URL. All completed successfully.

This does not migrate DatoCat database records or verify its UI. Cached-token
cost accounting retains the existing implementation; pricing entries include
OpenAI's cached input rate, but aggregate cost still uses total input tokens.
