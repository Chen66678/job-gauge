import type { ProfileFact } from "../types";
import type { OpenAiCompatibleLlmClient } from "./llmClient";

export type ResumeExtractionInput =
  | {
      kind: "text";
      resumeText: string;
      sourceRef?: string;
      client: OpenAiCompatibleLlmClient;
    }
  | {
      kind: "image";
      imageBase64: string;
      mimeType: string;
      sourceRef?: string;
      client: OpenAiCompatibleLlmClient;
    };

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
  "Only extract information that is explicitly stated in the resume or is a strong direct implication from the resume text or image.",
  "Do not invent, guess, embellish, normalize into stronger claims, or fill missing details.",
  "If a fact is unclear, unsupported, contradictory, or absent, leave it out.",
  'Every returned fact is still unconfirmed by the user, so treat every item as pending confirmation.',
  'GRANULARITY RULE: if a resume section lists multiple bullet points, responsibilities, or achievements under one job or project, extract EACH bullet as its own separate fact item. Never merge two or more bullets into a single fact value. Never summarize multiple bullets into one shorter sentence.',
  "Do not further split a single bullet's internal enumerated list (e.g. a comma-separated list of tool names or skill names within one bullet) into multiple facts unless the resume itself already separates them into distinct bullets. Keep such an enumeration together as one fact value.",
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
  const sourceRef = input.sourceRef?.trim() || defaultSourceRef(input.kind);
  const raw =
    input.kind === "text"
      ? await input.client.completeText({
          system: RESUME_EXTRACTION_SYSTEM_PROMPT,
          user: buildTextUserPrompt(input.resumeText),
          responseFormatJson: true
        })
      : await input.client.completeVision({
          system: RESUME_EXTRACTION_SYSTEM_PROMPT,
          user: buildImageUserPrompt(),
          imageBase64: input.imageBase64,
          mimeType: input.mimeType,
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

function buildImageUserPrompt(): string {
  return "Read this resume image and extract only supported resume facts as json.";
}

function defaultSourceRef(kind: ResumeExtractionInput["kind"]): string {
  return kind === "text" ? "resume_text" : "resume_image";
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
  const slug = slugify(`${item.category}-${item.label}`);
  return `fact-resume-${index + 1}-${slug}`;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return Number(value.toFixed(3));
}

function stripMarkdownFence(value: string): string {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? value;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "item";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
