# Visibility gap root cause analysis and fixes

We have an AI visibility tool that auto-generates many (100s) of keyword terms and derived LLM prompts relevant for a specific brand, sector market and SEO briefing. These are then run through multiple AI answer engines (Google's AI Overview and AI Mode, ChatGpt etc.), to check how visibile the brand is compared to its competitors. Prompts are enriched with scores and categories like:
- semantic topics
- marketing funnel stages
- intent and purchase probability
- entity recognition and aspect-based sentiments in LLM answers
- sources used by LLMs (categorized into news, blogs, proprietary etc.)
- visibility of brand name or domain in answers and sources
- etc...

The idea then is to identify whether visibility gaps exist, and if so, whether they're due to a gap in content, or a failure of the AI to use/rank existing content in its answers.

We can calculate an AI visibility score (AIV), and a content gap score (GP). Then:

- Case 1 — Low CG, Low AIV → **Model Gap**

    Brand should appear but doesn’t → LLM retrieval issue
    Use this to generate “Model SEO” recommendations.

- Case 2 — High CG, Low AIV → **True Content Gap**

    Brand lacks content → create topic-aligned content clusters.

- Case 3 — Low CG, High AIV → **Overperformance**

    AI visibility exceeds web evidence → brand might be “algorithm-favored”

- Case 4 — High CG, High AIV → **Underoptimized but present**

    The model mentions the brand even without (proper) content.


# Content Gap

Evaluate and combine multiple content gap scores into one.

Content Gap ccore (CG) as:

$CG = 1 - (0.25*CIPS + 0.25*SCS + 0.25*TAS + 0.25*EPW)$

See below for individual scores.

## Surface Gap

There are few or no pages matching the topic.

Calculate a **Crawl / Index Presence Score** (CIPS):

- Generate search engine queries from prompt cluster
- Query Google, Bing, SerpAPI etc..
- Count:
    - Number of brand-owned URLs in top 50
    - Number of unique pages that semantically match the topic

CIPS Score = (# brandUrls in top 50 search results for topic) / 50

## Semantic Coverage Gap

Does the brand’s content actually answer the topic? Content exists but does not answer the user intent.

Use embeddings or an LLM to score how relevant brand pages are:

- Extract the top N pages from the brand’s domain for the topic.
- Compute semantic similarity between each page and the canonical prompt.
- Take the maximum or mean.

$SCS = mean(similarity(brandPageEmbeddings, topicEmbedding))$

## Authority Gap

Weak depth, breadth, freshness, or internal linking.

A measure of:
- Depth (how much content on the domain for the topic)
- Breadth (covering subtopics, FAQs, intent types)
- Internal linking around that topic
- Freshness
- EEAT markers: author, citations, clarity (LLM-evaluated)

$TAS = w1*depth + w2*breadth + w3*internalLinking + w4*freshness$

## External Signal Gap

Does the brand appear in non-owned sources for that topic? Few third-party citations and low entity presence.

Search:
- Wikipedia/Wikidata
- Directories
- Product comparisons
- Review sites
- News articles
- Forums

EPW = (# of independent sources mentioning brand in topic context) / (max_sources)

**If this is close to 0 → huge content gap, because LLMs rely heavily on external mentions.**

## Terminology Gap

Brand uses language that differs from the query cluster wording.

Example
- Prompt: “Best eco-friendly CRMs for SMBs”
- Brand content uses terms like “sustainable business software” instead of “eco-friendly CRM”

Measure semantic gap between brand’s terminology and user prompt clusters. This uses embeddings or keyword overlap.

If semantic gap is high but content exists → fix with SEO term alignment.

# Model Bias

LLMs either don't find your content (retrieval) or don't include it in their synthesis (ranking or synthesis bias).

## Retrieval Bias

Model fails to fetch the brand from web sources.

The content exists on the web, but the model’s search engine (or its training snapshot) does not surface it.

Symptoms:
- Other models mention the brand
- But the model with web access doesn’t
- Or the model is using an old index

## Ranking or Synthesis Bias
Content is retrieved but excluded from the final answer.

The model retrieves the content but doesn’t include it in the final synthesis.

Often due to:
- popularity weighting
- domain authority weighting
- similarity-to-query penalties

Score, e.g.:
- Proportion of all sources mentioning the brand (in scraped content) but not cited

## Snapshot Bias
Internal training is outdated, so no-web answers fail.

Force retrieval test without search
- Prompts like: "List all notable {category} brands including lesser-known ones."

## Other Biases
- **Snapshot Bias**
    - Internal training is outdated, so no-web answers fail
    - Force retrieval test without search with prompts like: "List all notable {category} brands including lesser-known ones."
    - **Cannot be fixed in short term** without RAG or context injection
- **Algorithmic Popularity Bias**
    - Ranking overweights well-known brands. Models sometimes heavily favor the top 5 most searched brands.
- **Safety or Policy Filtering**
    - Brand or category is suppressed by moderation rules. Some models suppress financial, medical, or regulated products intentionally.
- **Engine-Specific Retrieval Quirks**
    - Differences between engines (e.g. Bing vs Google vs internal) prevent consistent recall.

## Potential Fixes

Changes to web content so the model retrieves and ranks it well.

Model bias often originates upstream in the web evidence. These are fixes clients can implement:

### Add structure for better LLM crawling

- Schema.org
- JSON-LD
- Product reviews
- Competitor comparison pages
- FAQ blocks

LLMs often prioritize structured data because they score it as authoritative.

### Shift language to match query clusters

If your model cluster analysis reveals a mismatch in terms:

- AI answers use term X
- Your client uses term Y

→ Harmonize terminology

### Increase external citations

LLMs may not use brand-owned pages unless supported by non-owned sources. **This is the biggest upstream fix.**

### Improve coverage depth

If your content gap score is 0.3 (not terrible) but your AI visibility is still 0:
→ Add depth pages to fill semantic holes the model uses to retrieve.

## Measuring model bias
Provide a “Model Reliability Score”. For each engine:

- Retrieval consistency
- Ranking fairness
- Cluster-level sensitivity
- Brand omission rate vs evidence

Flag “algorithmic suppression” if a brand has:

- Good content
- Strong web presence
- Is missing in answers across certain models


# Prompt Mismatch

## Query Intent Misinterpretation
Model misunderstands the request intent.

## Semantic Distance
Prompt language does not match brand terminology.

## Scope Restriction
Prompt is unintentionally too narrow.

## Missing Context
Brand only appears when explicit context is provided.

