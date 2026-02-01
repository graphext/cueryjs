import { Tool, type ModelConfig } from '../tool.ts';
import { dedent } from '../helpers/utils.ts';
import type { BrandContext } from '../schemas/brand.schema.ts';

const TRANSLATE_PROMPT = dedent(`
You are an expert in understanding search intent and conversational AI interactions.

Convert the following Google search keyword into an equivalent natural language prompt that
someone would use when interacting with an LLM like ChatGPT. The LLM prompt should:

- Be conversational and natural, as if speaking to an assistant
- Capture the same intent and information need as the keyword
- Be a complete sentence or question
- Not be overly verbose - keep it concise but natural
- Be written in "{language}"

For example:
- "best running shoes" → "What are the best running shoes?"
- "how to train for marathon" → "How do I train for a marathon?"
- "nike air max review" → "Can you give me a review of Nike Air Max shoes?"
- "weather new york" → "What's the weather like in New York?"

## Brand Context Rules

You will receive brand context (sector, country). Follow these rules strictly:

1. **DO NOT** change the core intent or meaning of the keyword
2. **DO** use brand context to disambiguate terms when multiple interpretations exist
3. The keyword's original intent must be preserved - brand context only helps clarify ambiguous terms

**Example of correct disambiguation:**
- Keyword: "geo"
- Brand sector: "ai visibility search"
- WRONG: "Tell me about geography" (ignores sector context)
- CORRECT: "What is GEO in AI visibility and search optimization?" (uses sector to disambiguate the acronym)

{instructions}

# Keyword

{keyword}

# Brand Context (for reference only)
- Sector: {sector}
- Country: {country}

Return only the converted prompt, nothing else.
`);

export interface KeywordTranslatorConfig {
	/** Brand context for disambiguation */
	brandContext: BrandContext;
	/** Language for the output prompt (default: 'en') */
	language?: string;
	/** Additional instructions */
	instructions?: string;
}

/**
 * A tool that converts Google search keywords into natural language LLM prompts.
 * Uses raw text mode (no schema) since the output is plain text.
 */
export class KeywordTranslator extends Tool<string | null, string, string> {
	private readonly promptTemplate: string;

	constructor(config: KeywordTranslatorConfig, modelConfig: ModelConfig) {
		super(modelConfig);
		const { brandContext, language = 'en', instructions = '' } = config;

		this.promptTemplate = TRANSLATE_PROMPT
			.replace('{language}', language)
			.replace('{sector}', brandContext.sector)
			.replace('{country}', brandContext.country)
			.replace('{instructions}', instructions);
	}

	// No schema() override - uses default null for raw text mode

	protected prompt(keyword: string | null) {
		return this.promptTemplate.replace('{keyword}', keyword ?? '');
	}

	protected override isEmpty(keyword: string | null): boolean {
		return keyword == null || keyword.trim() === '';
	}
}

// =============================================================================
// PromptToKeyword (LLM prompt → keyword)
// =============================================================================

const REVERSE_TRANSLATE_PROMPT = dedent(`
You are an expert in understanding search intent.

Convert the following natural language prompt into an equivalent Google search keyword.
The keyword should:

- Be concise
- Capture the core search intent
- Remove conversational filler and politeness
- Use common search terms

For example:
- "What are the best running shoes?" → "best running shoes"
- "How do I train for a marathon?" → "how to train marathon"
- "Can you give me a review of Nike Air Max shoes?" → "nike air max review"
- "What's the weather like in New York?" → "weather new york"

Make sure the keyword is in the language "{language}".

It's mandatory that the keyword contains no more than 4 words, ideally 2-3 words.
Otherwise, Google keyword planner will not accept it.

# Prompt

{prompt}

Return only the keyword, nothing else.
`);

export interface PromptToKeywordConfig {
	/** Language for the output keyword (default: 'en') */
	language?: string;
}

/**
 * A tool that converts natural language prompts into Google search keywords.
 * Uses raw text mode (no schema) since the output is plain text.
 */
export class PromptToKeyword extends Tool<string | null, string, string> {
	private readonly promptTemplate: string;

	constructor(config: PromptToKeywordConfig = {}, modelConfig: ModelConfig) {
		super(modelConfig);
		const { language = 'en' } = config;

		this.promptTemplate = REVERSE_TRANSLATE_PROMPT.replace('{language}', language);
	}

	// No schema() override - uses default null for raw text mode

	protected prompt(text: string | null) {
		return this.promptTemplate.replace('{prompt}', text ?? '');
	}

	protected override isEmpty(text: string | null): boolean {
		return text == null || text.trim() === '';
	}
}
