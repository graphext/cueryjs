/**
 * Pipeline Context Type Definitions
 *
 * These types define the structure for pipeline execution contexts.
 * They are shared between client and server code.
 *
 * IMPORTANT: This type must be kept in sync with the dynamically generated
 * type from: supabase/functions/pipelines/workflows/audit.ts
 *
 * The actual pipeline generates:
 * export type AiAuditPromptsPipelineContext = OrchestratorRunContext<typeof promptsPipeline>;
 *
 * This static definition serves as a contract for client-side usage.
 * It represents the union of all context types required by the pipeline nodes.
 */

import type { Brand, BrandContext, FlaggedBrand } from './brand.schema.ts';
import type { Funnel } from './funnel.schema.ts';
import type { ModelIdentifier } from './models.schema.ts';
import type { Persona } from './persona.schema.ts';
import type { TopicType } from './topics.schema.ts';

export interface KeywordPlannerOptions {
	url?: string;
	urlAsExpandRelevanceContext?: string;
	generateIdeasFromSeeds?: boolean;
}

export interface AiAuditPromptsPipelineOptions {
	filterLowRelevanceKeywords?: boolean;
	/** When true, adds deduplicatedKeywords column with all keywords sharing the same metrics */
	includeDeduplicatedKeywords?: boolean;
	/** When true, includes seedKeywords column in output records. Defaults to false. */
	includeSeedKeywords?: boolean;
	/** When true, generates a separate dataset with all keywords (dedup by keyword only). Defaults to false. */
	includeAllKeywordsDataset?: boolean;
}

/**
 * AI Audit Pipeline Request Structure
 *
 * This represents the structure of the request sent to the /pipelines/run endpoint.
 * The `context` field should match the AiAuditPromptsPipelineContext from the orchestrator.
 */
export interface AiAuditPromptsPipelineRequest {
	pipelineName: 'promptsPipeline';
	context: AiAuditPromptsPipelineContext;
}

/**
 * AI Audit Answers Pipeline Request Structure
 *
 * This represents the structure of the request sent to the /pipelines/run endpoint.
 * The `context` field should match the AiAuditAnswersPipelineContext from the orchestrator.
 */
export interface AiAuditAnswersPipelineRequest {
	pipelineName: 'answersPipeline';
	context: AiAuditAnswersPipelineContext;
}

/**
 * AI Audit Prompts Pipeline Context Data - Static Definition
 *
 * This represents the union of all context parameters required by the
 * various nodes in the AI audit prompts pipeline:
 *
 * - { keywordPlanner }: Keyword Planner parameters & seed sources
 * - { options }: Pipeline-level flags
 * - { workspaceId, projectName }: Project creation parameters
 * - { funnel }: Funnel assignment parameters
 * - { brand }: Brand-specific processing parameters
 * - { brands }: Brand collection parameters
 */
export interface AiAuditPromptsPipelineContext {
	// Client authentication (added by orchestrator)
	clientUserEmail: string;
	// From createProjectNode context
	workspaceId: number;
	projectName?: string;
	/** Optional existing project to append prompts into. */
	projectId?: number;

	// Keyword Planner options
	keywordPlanner: KeywordPlannerOptions;
	/** ISO 639-1 language code for prompts/keywords (e.g., "en"). */
	languageCode?: string;
	/** ISO 3166-1 alpha-2 country code to localize sources (e.g., "US"). */
	countryISOCode?: string;
	/**
	 * Custom prompts provided by the user.
	 * These go directly to the prompt dataset without keyword expansion.
	 */
	directPrompts?: Array<string>;
	/**
	 * Custom seed keywords provided by the user.
	 * These are processed through keyword expansion like other seed keywords.
	 */
	customSeedKeywords?: Array<string>;

	// From assignFunnelStagesNode context
	funnel?: Funnel;

	// From extractSentimentsNode context
	brand: BrandContext;

	// From enrichSourcesNode and rankBrandsInTextsNode context
	competitors: Array<FlaggedBrand | Brand>;

	// Additional parameters used by various nodes
	personas: Array<Persona>;

	options?: AiAuditPromptsPipelineOptions;

	topics?: Array<TopicType>;

}

/**
 * AI Audit Answers Pipeline Context Data
 *
 * Context parameters required by the answers pipeline.
 */
export interface AiAuditAnswersPipelineContext {
	// Client authentication (added by orchestrator)
	clientUserEmail: string;

	// Target project to read prompts from and upload answers to
	projectId: number;
	promptIds: Array<number>;

	// Model query configuration
	models: Array<ModelIdentifier>;
	countryISOCode?: string;

	// Brand context for enrichment
	brand: BrandContext;
	competitors?: Array<FlaggedBrand | Brand>;

	/**
	 * Panel ID for grouping answers by execution source.
	 * When present (scheduled cron execution), answers are grouped by panelId.
	 */
	panelId?: number;
}

/**
 * Persisted project configuration (pipeline context without user metadata).
 */
export type AiAuditProjectConfig = Omit<AiAuditPromptsPipelineContext, 'clientUserEmail' | 'projectId'>;

/**
 * Topic Update Pipeline Request Structure
 *
 * This represents the structure of the request sent to the /pipelines/run endpoint
 * for updating topic hierarchy in existing prompts.
 */
export interface TopicUpdatePipelineRequest {
	pipelineName: 'topicUpdatePipeline';
	context: TopicUpdatePipelineContext;
}

/**
 * Topic Update Pipeline Context Data
 *
 * Context parameters required by the topic update pipeline.
 * This pipeline downloads the prompts dataset, re-assigns topics using AI
 * based on the provided taxonomy, and uploads the updated dataset back to the project.
 */
export interface TopicUpdatePipelineContext {
	// Client authentication (added by orchestrator)
	clientUserEmail: string;

	// Target project to read and update prompts from
	projectId: number;

	/**
	 * The topics taxonomy to use for assigning topics.
	 * Each topic contains a name and a list of subtopics.
	 * The AI will classify each prompt into the appropriate topic/subtopic.
	 */
	topics: Array<TopicType>;
}
