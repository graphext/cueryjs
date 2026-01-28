import { join, dirname, fromFileUrl } from "https://deno.land/std@0.208.0/path/mod.ts";
import { z } from "https://esm.sh/zod@3.22.4";
import OpenAI from "https://esm.sh/openai@4.20.1";

// --- Types & Interfaces ---

interface InputResult {
    place: string;
    structured_output?: {
        companies_mentioned?: Array<{
            company_name: string;
            pros: Array<string>;
            cons: Array<string>;
            neutral_statements: Array<string>;
        }>;
        summary_recommendation?: Array<{
            criterion: string;
            recommendations: Array<{
                reason: string;
            }>;
        }>;
    };
}

interface InputFile {
    results: Array<InputResult>;
}

interface EnrichedStatement {
    text: string;
    inferred_topic: string;
    inferred_subtopic: string;
}

interface EnrichedCompany {
    company_name: string;
    pros: Array<EnrichedStatement>;
    cons: Array<EnrichedStatement>;
    neutral_statements: Array<EnrichedStatement>;
    [key: string]: any;
}

interface EnrichedRecommendationItem {
    reason: string;
    inferred_topic: string;
    inferred_subtopic: string;
    [key: string]: any;
}

interface EnrichedCriterion {
    criterion: string;
    inferred_topic: string;
    inferred_subtopic: string;
    recommendations: Array<EnrichedRecommendationItem>;
    [key: string]: any;
}

interface EnrichedResult {
    place: string;
    structured_output?: {
        companies_mentioned?: Array<EnrichedCompany>;
        summary_recommendation?: Array<EnrichedCriterion>;
        [key: string]: any;
    };
    [key: string]: any;
}

// --- OpenAI Setup ---

function getApiKey(): string {
    const envKey = Deno.env.get("OPENAI_API_KEY");
    if (envKey) return envKey;
    console.error("OPENAI_API_KEY not found in environment.");
    Deno.exit(1);
}

const openai = new OpenAI({
    apiKey: getApiKey(),
});

async function askOpenAI<T>(
    messages: any[],
    model: string,
    schema: z.ZodType<T>
): Promise<T | null> {
    try {
        const completion = await openai.chat.completions.create({
            model: model,
            messages: messages,
            response_format: { type: "json_object" },
        });

        const content = completion.choices[0].message.content;
        if (!content) return null;

        try {
            const parsed = JSON.parse(content);
            return schema.parse(parsed);
        } catch (e) {
            console.error("Failed to parse JSON or validate schema:", e);
            console.log("Raw Content:", content);
            throw e;
        }
    } catch (error) {
        console.error("OpenAI API Error:", error);
        return null;
    }
}

// --- Topic Extraction Logic ---

const TopicBase = z.object({
    topic: z.string(),
    subtopics: z.array(z.string())
});

const Taxonomy = z.object({
    topics: z.array(TopicBase)
});

type TaxonomyType = z.infer<typeof Taxonomy>;

const TOPICS_PROMPT = `
# Instructions

From the data records below, extract a two-level nested list of topics.
The output MUST be a valid JSON object with the following structure:
{
  "topics": [
    {
      "topic": "Topic Name",
      "subtopics": ["Subtopic 1", "Subtopic 2"]
    }
  ]
}

The top-level should not contain more than {n_topics} topics, and each top-level
should not contain more than {n_subtopics} subtopics.

Make sure top-level topics are generalizable and capture broad themes.
Subtopics should represent more specific categories within each theme.

{instructions}

# Data Records

{records}
`;

async function extractTopics({
    records,
    nTopics = 10,
    nSubtopics = 5,
    instructions = ''
}: { records: { text: string }[], nTopics?: number, nSubtopics?: number, instructions?: string }): Promise<TaxonomyType> {

    const formattedRecords = records.map(r => `- ${r.text}`).join('\n');
    const prompt = TOPICS_PROMPT
        .replace('{n_topics}', String(nTopics))
        .replace('{n_subtopics}', String(nSubtopics))
        .replace('{instructions}', instructions)
        .replace('{records}', formattedRecords);

    const result = await askOpenAI(
        [{ role: 'user', content: prompt }],
        'gpt-4o-2024-08-06', // Use a model that supports structured output well
        Taxonomy
    );

    if (!result) {
        throw new Error('Failed to extract topics');
    }
    return result;
}

// --- Topic Assignment Logic ---

const LABEL_PROMPT_SYSTEM = `
You're task is to use the following hierarchy of topics and subtopics (in json format),
to assign the correct topic and subtopic to each text in the input.

# Topics

{taxonomy}
`;

const LABEL_PROMPT_USER = `
Assign the correct topic and subtopic to the following text.

# Text

{text}
`;

const TopicLabel = z.object({
    topic: z.string().nullable().optional(),
    subtopic: z.string().nullable().optional()
});

async function assignTopic(text: string, taxonomy: TaxonomyType): Promise<{ topic: string, subtopic: string }> {
    const systemPrompt = LABEL_PROMPT_SYSTEM.replace('{taxonomy}', JSON.stringify(taxonomy, null, 2));
    const userPrompt = LABEL_PROMPT_USER.replace('{text}', text);

    const conversation = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ];

    const result = await askOpenAI(
        conversation,
        'gpt-4o-2024-08-06',
        TopicLabel
    );

    if (!result) {
        return { topic: "Uncategorized", subtopic: "Other" };
    }
    return {
        topic: result.topic || "Uncategorized",
        subtopic: result.subtopic || "Other"
    };
}

// --- Main ---

async function main() {
    // 1. Load the latest JSON result
    const dataDir = join(dirname(fromFileUrl(import.meta.url)), "chatgpt_response_data");
    let latestFile = "";
    let latestTime = 0;

    for await (const dirEntry of Deno.readDir(dataDir)) {
        if (dirEntry.isFile && dirEntry.name.startsWith("kidsandus_results_") && dirEntry.name.endsWith(".json") && !dirEntry.name.includes("_enriched")) {
            const filePath = join(dataDir, dirEntry.name);
            const stat = await Deno.stat(filePath);
            if (stat.mtime && stat.mtime.getTime() > latestTime) {
                latestTime = stat.mtime.getTime();
                latestFile = filePath;
            }
        }
    }

    if (!latestFile) {
        console.error("No results file found.");
        Deno.exit(1);
    }

    console.log(`Processing file: ${latestFile}`);
    const content = await Deno.readTextFile(latestFile);
    const data: InputFile = JSON.parse(content);

    // 2. Collect all text statements
    const allTexts: string[] = [];

    data.results.forEach(result => {
        if (result.structured_output) {
            result.structured_output.companies_mentioned?.forEach(company => {
                allTexts.push(...company.pros);
                allTexts.push(...company.cons);
                allTexts.push(...company.neutral_statements);
            });
            result.structured_output.summary_recommendation?.forEach(rec => {
                allTexts.push(rec.criterion);
                rec.recommendations.forEach(r => allTexts.push(r.reason));
            });
        }
    });

    console.log(`Collected ${allTexts.length} statements.`);

    // 3. Generate Taxonomy
    console.log("Generating taxonomy...");
    const sampleTexts = allTexts.length > 100 ? allTexts.slice(0, 100) : allTexts;

    const taxonomy = await extractTopics({
        records: sampleTexts.map(t => ({ text: t })),
        nTopics: 8,
        nSubtopics: 5,
        instructions: "Categorize these statements about English academies for children. Topics should cover aspects like Methodology, Teachers, Facilities, Exams, Price, etc."
    });

    console.log("Generated Taxonomy:", JSON.stringify(taxonomy, null, 2));

    // 4. Assign Topics
    console.log("Assigning topics to statements...");
    const uniqueTexts = [...new Set(allTexts)];
    const textToLabel = new Map<string, { topic: string, subtopic: string }>();

    for (const text of uniqueTexts) {
        const label = await assignTopic(text, taxonomy);
        textToLabel.set(text, label);
        // console.log(`Assigned: "${text.substring(0, 30)}..." -> ${label.topic} / ${label.subtopic}`);
    }

    // 5. Enrich Data
    const enrichedResults = data.results.map(result => {
        const enrichedResult: any = { ...result };

        if (result.structured_output) {
            const so = result.structured_output;
            const enrichedSO: any = { ...so };

            if (so.companies_mentioned) {
                enrichedSO.companies_mentioned = so.companies_mentioned.map(company => ({
                    ...company,
                    pros: company.pros.map(text => ({
                        text,
                        inferred_topic: textToLabel.get(text)?.topic || "Uncategorized",
                        inferred_subtopic: textToLabel.get(text)?.subtopic || "Other"
                    })),
                    cons: company.cons.map(text => ({
                        text,
                        inferred_topic: textToLabel.get(text)?.topic || "Uncategorized",
                        inferred_subtopic: textToLabel.get(text)?.subtopic || "Other"
                    })),
                    neutral_statements: company.neutral_statements.map(text => ({
                        text,
                        inferred_topic: textToLabel.get(text)?.topic || "Uncategorized",
                        inferred_subtopic: textToLabel.get(text)?.subtopic || "Other"
                    }))
                }));
            }

            if (so.summary_recommendation) {
                enrichedSO.summary_recommendation = so.summary_recommendation.map(rec => ({
                    ...rec,
                    inferred_topic: textToLabel.get(rec.criterion)?.topic || "Uncategorized",
                    inferred_subtopic: textToLabel.get(rec.criterion)?.subtopic || "Other",
                    recommendations: rec.recommendations.map(r => ({
                        ...r,
                        inferred_topic: textToLabel.get(r.reason)?.topic || "Uncategorized",
                        inferred_subtopic: textToLabel.get(r.reason)?.subtopic || "Other"
                    }))
                }));
            }

            enrichedResult.structured_output = enrichedSO;
        }
        return enrichedResult;
    });

    // 6. Save Enriched JSON
    const newFileName = latestFile.replace(".json", "_enriched.json");
    const outputData = { ...data, results: enrichedResults };

    await Deno.writeTextFile(newFileName, JSON.stringify(outputData, null, 2));
    console.log(`Enriched data saved to: ${newFileName}`);
}

if (import.meta.main) {
    main();
}
