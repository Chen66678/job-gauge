import type { ProfileFact, ProfileFactGroup } from "../types";
import type { OpenAiCompatibleLlmClient } from "./llmClient";
import { clampConfidence, isRecord, slugifyAsciiWithCjk, stripMarkdownFence } from "./shared";

export interface ResumeExtractionInput {
  kind: "text";
  resumeText: string;
  sourceRef?: string;
  client: OpenAiCompatibleLlmClient;
}

// D034②：抽取结果不再只是扁平事实数组，还携带父级分组（同一段工作经历/项目）。
// 分组本身不是 ProfileFact，从不参与生成投喂，只用于把子事实挂到同一张父卡下展示。
export interface ResumeExtractionResult {
  facts: ProfileFact[];
  groups: ProfileFactGroup[];
}

interface ResumeFactEnvelope {
  facts: ResumeFactItem[];
}

interface ResumeFactItem {
  category: string;
  label: string;
  value: string;
  confidence: number;
  // D034②：仅工作经历/项目类事实需要填；同一份工作/项目下的多条子事实必须共享同一个 groupKey 字符串，
  // 由模型自己起（如公司名或项目名的简写 key），不是最终 ProfileFactGroup.id，只用于本次调用内配对子事实与分组。
  groupKey?: string | null;
  // D034②：仅当 groupKey 存在时随第一次出现该 groupKey 一起填：公司/项目 + 角色 + 完整时间（不缩写），
  // 供该分组下所有子事实共用；后续同 groupKey 的条目可省略或重复，取第一条非空值。
  groupLabel?: string | null;
  // D034③：展示专用摘要，回答“这是哪件事”，与 value 分开生成，从不改写/替代 value。
  summary?: string | null;
}

const RESUME_EXTRACTION_SYSTEM_PROMPT = [
  "You extract resume facts into json.",
  "Only extract information that is explicitly stated in the resume or is a strong direct implication from the resume text.",
  "Do not invent, guess, embellish, normalize into stronger claims, or fill missing details.",
  "If a fact is unclear, unsupported, contradictory, or absent, leave it out.",
  'Every returned fact is still unconfirmed by the user, so treat every item as pending confirmation.',
  'GRANULARITY RULE FOR JOBS/PROJECTS (rule A, self-contained — does not apply to anything outside a job or a project): within ONE job or ONE project, split its content into multiple fact items, one fact item per independently statable thing — each responsibility, each outcome, each tool/technology used, each metric, each thing that could stand on its own as a separate claim. Do not force a fixed number of fact items and do not pad or force-fit to reach any target count; split purely by how many genuinely separate things the resume text actually states for that job or project. This rule ONLY governs how many fact items ONE job or ONE project is split into. THIS RULE NEVER APPLIES TO merging or comparing across two different jobs or two different projects: each distinct job (different company/role/duration) and each distinct project is its own separate boundary, decided before this rule runs, and this rule never causes two distinct jobs or two distinct projects to share fact items. THIS RULE NEVER APPLIES TO personal contact fields, job-search intent fields, education fields, or standalone skills — those are governed only by rule B below, never by this rule.',
  'GRANULARITY RULE FOR SHORT IDENTITY/INTENT FIELDS (rule B, self-contained — does not apply to jobs or projects): Merge ALL personal contact fields (name, gender, age, phone, email, current city, etc.) into ONE "personal" fact item. Merge ALL job-search intent fields (target role, expected salary, expected city, etc.) into ONE "job_search" fact item. Merge one school\'s institution + major + degree + duration into ONE "education" fact item per school (a different school stays a separate item). THIS RULE NEVER APPLIES TO jobs, projects, or any experience narrative — those are governed only by rule A above, never by this rule, regardless of how short or long any individual bullet under a job or project is.',
  "Whether you are splitting a job/project under rule A or merging short fields under rule B, every resulting fact value must preserve the original wording as closely as possible: keep every sentence's or field's original phrasing, keep every qualifier (e.g. 'course project', 'participated in', 'prototype'), and simply keep or lightly connect the original sentence/field text. Do not paraphrase, compress, summarize, or rewrite the value into a shorter or stronger-sounding sentence. Splitting or merging changes card boundaries only, never the wording strength of the value content.",
  'Preserve every quantified metric (numbers, percentages, time durations) and every specific proper noun (tool names, technology names, named mechanisms) exactly as written, each retained in the fact it belongs to.',
  'Preserve the original language of the resume in every extracted value. Do not translate any value into another language, even if it would read more naturally. If the resume is in Chinese, all extracted values must remain in Chinese exactly as written.',
  'GROUP KEY RULE (rule C, self-contained — only concerns the groupKey/groupLabel fields, never changes category/label/value/confidence): if and only if a fact item was produced under rule A (it belongs to a specific job or a specific project), set groupKey to a short stable string identifying that one job or project (e.g. derived from the company name or project name), and every fact item split from that SAME job or SAME project under rule A must reuse the exact identical groupKey string. Fact items produced under rule B (personal, job_search, education) or any other non-job/project fact must leave groupKey as null. Two distinct jobs or two distinct projects must never share a groupKey.',
  'GROUP LABEL RULE (rule D, self-contained — only concerns the groupLabel field): on at least one fact item for each groupKey, set groupLabel to a single string combining: company-or-project name + role/title + the full time period exactly as it appears in the resume. NEVER abbreviate, shorten, or use a nickname for the company or project name in groupLabel — always use the full name exactly as written in the resume, in full, because this name must remain verifiable against the candidate\'s real job history. Do not abbreviate the time period either (write the full date range, not a shortened form). It is fine to leave groupLabel empty on the other fact items that share the same groupKey.',
  'COMPANY/PROJECT NAME RULE (rule E, self-contained — applies to the label and value fields of job/project facts): NEVER abbreviate, shorten, or use a nickname for a company name or project name inside the label or value field of any fact item. Always use the full name exactly as it appears in the resume, because label and value may be used to verify against the candidate\'s real job history. Abbreviation is only acceptable, if at all, outside of label/value — never write a shortened company or project name into label or value.',
  'SUMMARY RULE (rule F, self-contained — only concerns the summary field, never changes label/value): for every fact item, also produce a summary string that briefly answers "which thing is this" in a few words — a short, readable label-like phrase, not a full restatement. The summary MAY be shorter and more compressed than the value (unlike label/value, summary is allowed to paraphrase). The summary must never contradict the value, must never add information absent from the value, and must never be used as a substitute for the value — value keeps the full original wording regardless of what the summary says. If no useful short summary can be produced, you may return an empty string for summary, but still include the field.',
  'Return json with exactly this shape: {"facts":[{"category":"...","label":"...","value":"...","confidence":0.0,"groupKey":"..."|null,"groupLabel":"..."|null,"summary":"..."|null}]}',
  'For the category field, prefer a consistent name from this set when it fits: personal, skill, experience, project, education, job_search. If none fits well, you may use a new concise category name, but keep it consistent across the whole output for facts of the same kind.',
  "Confidence means how clearly the fact is supported by the resume itself, not how strong the candidate is.",
  "High confidence only for directly stated facts. Lower confidence for strong direct implications.",
  "Do not return markdown. Do not return prose. Return json only.",
  "If nothing reliable can be extracted, return {\"facts\":[]}."
].join("\n");

export async function extractFactsFromResume(input: ResumeExtractionInput): Promise<ProfileFact[]> {
  return (await extractFactsAndGroupsFromResume(input)).facts;
}

export async function extractFactsAndGroupsFromResume(input: ResumeExtractionInput): Promise<ResumeExtractionResult> {
  const sourceRefBase = input.sourceRef?.trim() || defaultSourceRef();
  const raw = await input.client.completeText({
    system: RESUME_EXTRACTION_SYSTEM_PROMPT,
    user: buildTextUserPrompt(input.resumeText),
    responseFormatJson: true
  });

  const parsed = parseEnvelope(raw);
  if (!parsed) {
    return { facts: [], groups: [] };
  }

  const ingestedAt = new Date().toISOString();
  // D034②：groupKey 是模型在本次调用内起的临时配对键，不是最终 group id；
  // 这里把它换算成稳定的 fact-group-<slug> id，同一个 groupKey 在同一次调用内映射到同一个 id。
  const groupIdByKey = new Map<string, string>();
  const groupLabelByKey = new Map<string, string>();

  const facts = parsed.facts.flatMap((fact, index) => {
    const normalized = normalizeFactItem(fact);
    if (!normalized) {
      return [];
    }

    let groupId: string | null = null;
    if (normalized.groupKey) {
      if (!groupIdByKey.has(normalized.groupKey)) {
        groupIdByKey.set(normalized.groupKey, `fact-group-${slugifyAsciiWithCjk(normalized.groupKey)}`);
      }
      groupId = groupIdByKey.get(normalized.groupKey)!;
      if (normalized.groupLabel && !groupLabelByKey.has(normalized.groupKey)) {
        groupLabelByKey.set(normalized.groupKey, normalized.groupLabel);
      }
    }

    return [
      {
        id: buildFactId(normalized, index),
        category: normalized.category,
        label: normalized.label,
        value: normalized.value,
        sourceType: "resume",
        // D034③：每条事实携带本次抽取时间 + 抽取序号，取代原先所有事实共享同一个 "resume_text" 常量，
        // 使 AI 合并、临时建库优先级、逐行溯源都能定位到具体这一条。
        sourceRef: `${sourceRefBase}#${ingestedAt}#${index + 1}`,
        status: "unconfirmed",
        confidence: normalized.confidence,
        groupId,
        summary: normalized.summary
      } satisfies ProfileFact
    ];
  });

  const groups: ProfileFactGroup[] = Array.from(groupIdByKey.entries()).map(([groupKey, groupId]) => {
    const ownerFact = facts.find((fact) => fact.groupId === groupId);
    return {
      id: groupId,
      category: ownerFact?.category ?? "experience",
      // 模型没给 groupLabel 时退回用 groupKey 本身占位，好过分组没有 label。
      label: groupLabelByKey.get(groupKey) ?? groupKey
    } satisfies ProfileFactGroup;
  });

  return { facts, groups };
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
      .map(
        (item) =>
          ({
            category: item.category,
            label: item.label,
            value: item.value,
            confidence: item.confidence,
            groupKey: typeof item.groupKey === "string" ? item.groupKey : null,
            groupLabel: typeof item.groupLabel === "string" ? item.groupLabel : null,
            summary: typeof item.summary === "string" ? item.summary : null
          }) as unknown
      )
      .filter(isResumeFactItem)
  };
}

function normalizeFactItem(item: ResumeFactItem): (ResumeFactItem & { groupKey: string | null; groupLabel: string | null; summary: string | null }) | null {
  const category = item.category.trim();
  const label = item.label.trim();
  const value = item.value.trim();
  if (!category || !label || !value) {
    return null;
  }

  const groupKey = item.groupKey?.trim() || null;
  const groupLabel = item.groupLabel?.trim() || null;
  const summary = item.summary?.trim() || null;

  return {
    category,
    label,
    value,
    confidence: clampConfidence(item.confidence),
    groupKey,
    groupLabel,
    summary
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

// D034②：不含新增可选字段仍视为合法条目——旧数据/旧模型输出没有 groupKey/groupLabel/summary 时不应报废整条事实。
