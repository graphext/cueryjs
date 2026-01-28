
/**
 * @link https://developers.google.com/google-ads/api/reference/rpc/v21/KeywordPlanNetworkEnum.KeywordPlanNetwork
 */
export type KeywordPlanNetwork =
	| 'UNSPECIFIED'
	| 'UNKNOWN'
	| 'GOOGLE_SEARCH'
	| 'GOOGLE_SEARCH_AND_PARTNERS';

/**
 * @link https://developers.google.com/google-ads/api/reference/rpc/v21/KeywordPlanKeywordAnnotationEnum.KeywordPlanKeywordAnnotation
 */
export type KeywordPlanKeywordAnnotation =
	| 'UNSPECIFIED'
	| 'UNKNOWN'
	| 'KEYWORD_CONCEPT';

/**
 * @link https://developers.google.com/google-ads/api/reference/rpc/v21/KeywordPlanCompetitionLevelEnum.KeywordPlanCompetitionLevel
 */
export type KeywordPlanCompetitionLevel =
	| 'UNSPECIFIED'
	| 'UNKNOWN'
	| 'LOW'
	| 'MEDIUM'
	| 'HIGH';

/**
 * @link https://developers.google.com/google-ads/api/reference/rpc/v21/KeywordPlanIdeaService/GenerateKeywordIdeas?transport=rest#keywordplanconceptgrouptype
 */
type KeywordPlanConceptGroupType =
	| 'UNSPECIFIED'
	| 'UNKNOWN'
	| 'BRAND'
	| 'OTHER_BRANDS'
	| 'NON_BRAND';

/**
 * @link https://developers.google.com/google-ads/api/reference/rpc/v21/MonthOfYearEnum.MonthOfYear
 */
export type MonthOfYear =
	| 'UNSPECIFIED'
	| 'UNKNOWN'
	| 'JANUARY'
	| 'FEBRUARY'
	| 'MARCH'
	| 'APRIL'
	| 'MAY'
	| 'JUNE'
	| 'JULY'
	| 'AUGUST'
	| 'SEPTEMBER'
	| 'OCTOBER'
	| 'NOVEMBER'
	| 'DECEMBER';

/**
 * @link https://developers.google.com/google-ads/api/reference/rpc/v21/KeywordPlanIdeaService/GenerateKeywordIdeas?transport=rest#request-body
 */
export interface GenerateKeywordIdeasRequest {
	language?: string;
	geoTargetConstants?: Array<string>;
	includeAdultKeywords?: boolean;
	pageToken?: string;
	pageSize?: number;
	keywordPlanNetwork?: KeywordPlanNetwork;
	keywordAnnotation?: Array<KeywordPlanKeywordAnnotation>;
	aggregateMetrics?: {
		aggregate_metric_types: Array<'UNSPECIFIED' | 'UNKNOWN' | 'DEVICE'>
	};
	historicalMetricsOptions?: {
		include_average_cpc?: boolean;
		year_month_range?: {
			start?: {
				year: number;
				month: MonthOfYear;
			};
			end?: {
				year: number;
				month: MonthOfYear;
			};
		};
	};
	keywordAndUrlSeed?: {
		url?: string;
		keywords?: Array<string>;
	};
	keywordSeed?: {
		keywords: Array<string>;
	};
	urlSeed?: {
		 url: string;
	};
	siteSeed?: {
		site: string;
	};
}

/**
 * @link https://developers.google.com/google-ads/api/reference/rpc/v21/KeywordPlanIdeaService/GenerateKeywordHistoricalMetrics?transport=rest#request-body
 */
export interface GenerateKeywordHistoricalMetricsRequest {
	keywords?: Array<string>;
	language?: string;
	includeAdultKeywords?: boolean;
	geoTargetConstants?: Array<string>;
	keywordPlanNetwork?: KeywordPlanNetwork;
	aggregateMetrics?: {
		aggregate_metric_types: Array<'UNSPECIFIED' | 'UNKNOWN' | 'DEVICE'>;
	};
	historicalMetricsOptions?: {
		include_average_cpc?: boolean;
		year_month_range?: {
			start?: {
				year: number;
				month: MonthOfYear;
			};
			end?: {
				year: number;
				month: MonthOfYear;
			};
		};
	};
}

export interface KeywordIdeaResult {
	text?: string | null;
	keywordIdeaMetrics?: KeywordMetrics | null;
	keywordAnnotations?: KeywordAnnotations | null;
	closeVariants?: Array<string> | null;
}

export interface HistoricalMetricsResult {
	text?: string | null;
	closeVariants?: Array<string> | null;
	keywordMetrics?: KeywordMetrics | null;
}

export type KeywordResult = KeywordIdeaResult | HistoricalMetricsResult;

export interface GenerateKeywordHistoricalMetricsResponse {
	results: Array<HistoricalMetricsResult>;
}

export interface GenerateKeywordIdeaResponse {
	results: Array<KeywordIdeaResult>;
}

export type KeywordServiceResponse =
	| GenerateKeywordHistoricalMetricsResponse
	| GenerateKeywordIdeaResponse;

export interface KeywordAnnotations {
	concepts?: Array<{
		name?: string | null;
		conceptGroup?: {
			name?: string | null;
			type?: KeywordPlanConceptGroupType | null;
		} | null;
	}> | null;
}

export interface MonthlySearchVolume {
	year?: number | null;
	month?: MonthOfYear | null;
	monthlySearches?: number | null;
}

export interface KeywordMetrics {
	avgMonthlySearches?: number | null;
	monthlySearchVolumes?: Array<MonthlySearchVolume> | null;
	competition?: KeywordPlanCompetitionLevel | null;
	competitionIndex?: number | null;
	lowTopOfPageBidMicros?: number | null;
	highTopOfPageBidMicros?: number | null;
	averageCpcMicros?: number | null;
}
