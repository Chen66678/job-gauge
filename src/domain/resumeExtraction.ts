import type { ProfileFact } from "../types";
import type { OpenAiCompatibleLlmClient } from "./llmClient";
import { clampConfidence, isRecord, slugifyAsciiWithCjk, stripMarkdownFence } from "./shared";

export interface ResumeExtractionInput {
  kind: "text";
  resumeText: string;
  sourceRef?: string;
  client: OpenAiCompatibleLlmClient;
}

interface ResumeFactEnvelope {
  facts: ResumeFactItem[];
}

interface ResumeFactItem {
  category: string;
  label: string;
  value: string;
  confidence: number;
}

const RESUME_EXTRACTION_SYSTEM_PROMPT = [
  "You extract resume facts into json.",
  "Only extract information that is explicitly stated in the resume or is a strong direct implication from the resume text.",
  "Do not invent, guess, embellish, normalize into stronger claims, or fill missing details.",
  "If a fact is unclear, unsupported, contradictory, or absent, leave it out.",
  'Every returned fact is still unconfirmed by the user, so treat every item as pending confirmation.',
  'GRANULARITY RULE FOR JOBS/PROJECTS: group by real-world context, not by bullet punctuation. If multiple bullet points describe the same job or the same project, merge them into ONE fact item for that job/project, so the resulting fact value reads as one coherent card covering what it is, when, role, stack, and what was done. Only keep bullets as separate fact items when they describe genuinely different jobs, different projects, or unrelated topics (e.g. skills vs. education vs. a different project). This rule is STRICTLY scoped to bullets within the SAME job or SAME project. NEVER apply it across two different jobs or two different projects: each distinct job (different company/role/duration) and each distinct project must remain its own separate fact item, never merged with another distinct job or project even if that would reduce the total count.',
  'GRANULARITY RULE FOR SHORT IDENTITY/INTENT FIELDS: this is a SEPARATE rule, unrelated to jobs/projects above, and only applies to short factual fields that carry no wording-amplification risk. Merge ALL personal contact fields (name, gender, age, phone, email, current city, etc.) into ONE "personal" fact item. Merge ALL job-search intent fields (target role, expected salary, expected city, etc.) into ONE "job_search" fact item. Merge one school\'s institution + major + degree + duration into ONE "education" fact item per school (a different school stays a separate item). This rule never applies to jobs, projects, skills, or any experience narrative — those follow the job/project rule above, where each distinct job and each distinct project must stay separate.',
  "While merging bullets or fields under the same job, project, or category into one fact value, you must preserve the original wording as closely as possible: keep every sentence's or field's original phrasing, keep every qualifier (e.g. 'course project', 'participated in', 'prototype'), and simply concatenate or lightly connect the original sentences/fields. Do not paraphrase, compress, summarize, or rewrite them into a shorter or stronger-sounding sentence. Merging changes card boundaries only, never the wording strength of the content.",
  'Preserve every quantified metric (numbers, percentages, time durations) and every specific proper noun (tool names, technology names, named mechanisms) exactly as written, each retained in the fact it belongs to.',
  'Preserve the original language of the resume in every extracted value. Do not translate any value into another language, even if it would read more naturally. If the resume is in Chinese, all extracted values must remain in Chinese exactly as written.',
  'Return json with exactly this shape: {"facts":[{"category":"...","label":"...","value":"...","confidence":0.0}]}',
  'For the category field, prefer a consistent name from this set when it fits: personal, skill, experience, project, education, job_search. If none fits well, you may use a new concise category name, but keep it consistent across the whole output for facts of the same kind.',
  "Confidence means how clearly the fact is supported by the resume itself, not how strong the candidate is.",
  "High confidence only for directly stated facts. Lower confidence for strong direct implications.",
  "Do not return markdown. Do not return prose. Return json only.",
  "If nothing reliable can be extracted, return {\"facts\":[]}."
].join("\n");

export async function extractFactsFromResume(input: ResumeExtractionInput): Promise<ProfileFact[]> {
  const sourceRef = input.sourceRef?.trim() || defaultSourceRef();
  const raw = await input.client.completeText({
    system: RESUME_EXTRACTION_SYSTEM_PROMPT,
    user: buildTextUserPrompt(input.resumeText),
    responseFormatJson: true
  });

  const parsed = parseEnvelope(raw);
  if (!parsed) {
    return [];
  }

  return parsed.facts.flatMap((fact, index) => {
    const normalized = normalizeFactItem(fact);
    if (!normalized) {
      return [];
    }
    return [
      {
        id: buildFactId(normalized, index),
        category: normalized.category,
        label: normalized.label,
        value: normalized.value,
        sourceType: "resume",
        sourceRef,
        status: "unconfirmed",
        confidence: normalized.confidence
      } satisfies ProfileFact
    ];
  });
}

function buildTextUserPrompt(resumeText: string): string {
  return [`Resume text:`, resumeText.trim()].join("\n");
}

function defaultSourceRef(): string {
  return "resume_text";
}

function parseEnvelope(raw: string): ResumeFactEnvelope | null {
  const normalized = raw.trim();
  if (!normalized) {
    return null;
  }

  const withoutFence = stripMarkdownFence(normalized);

  let value: unknown;
  try {
    value = JSON.parse(withoutFence);
  } catch {
    return null;
  }

  if (!isRecord(value) || !Array.isArray(value.facts)) {
    return null;
  }

  return {
    facts: value.facts
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .map((item) => ({
        category: item.category,
        label: item.label,
        value: item.value,
        confidence: item.confidence
      }))
      .filter(isResumeFactItem)
  };
}

function normalizeFactItem(item: ResumeFactItem): ResumeFactItem | null {
  const category = item.category.trim();
  const label = item.label.trim();
  const value = item.value.trim();
  if (!category || !label || !value) {
    return null;
  }

  return {
    category,
    label,
    value,
    confidence: clampConfidence(item.confidence)
  };
}

function buildFactId(item: ResumeFactItem, index: number): string {
  const slug = slugifyAsciiWithCjk(`${item.category}-${item.label}`);
  return `fact-resume-${index + 1}-${slug}`;
}

function isResumeFactItem(value: unknown): value is ResumeFactItem {
  return (
    isRecord(value) &&
    typeof value.category === "string" &&
    typeof value.label === "string" &&
    typeof value.value === "string" &&
    typeof value.confidence === "number"
  );
}
