import type { JobPosting, MaterialPreview, ProfileFact, RequirementResult, ScoreResult, UserProfile } from "../types";
import type { OpenAiCompatibleLlmClient } from "./llmClient";
import { getConfirmedFacts, toFactTrace } from "./facts";

interface MaterialDraftEnvelope {
  greeting: string;
  resumeLines: MaterialDraftLine[];
}

interface MaterialDraftLine {
  text: string;
  factIds: string[];
}

const MATERIAL_DRAFTING_SYSTEM_PROMPT = [
  "You draft tailored application materials from confirmed facts and return json.",
  "You may only reorganize or restate the provided confirmed facts to better fit the job.",
  "Do not invent any experience, skill, project, metric, duration, employer, tool, or company.",
  "Every resume line must be traceable to the provided confirmed fact ids only.",
  "factIds may only reference the exact confirmed fact ids provided in the input.",
  "If a job requirement lacks confirmed fact support, do not write content for it.",
  "Preserve the original language of the confirmed facts in every resumeLines text value. Do not translate any value into another language, even if it would read more naturally. If the confirmed facts are in Chinese, every resumeLines text must remain in Chinese exactly as written.",
  "The greeting must be short, in Chinese, and based only on real confirmed match points.",
  "Do not exaggerate or claim unsupported ability.",
  "Do not amplify the strength of any claim beyond what the fact states: 'did once' must not become 'expert in' or 'proficient in'; 'participated in' must not become 'led' or 'architected'; 'small-scale' must not become 'enterprise-scale'; never add metrics, durations, or numbers the fact does not contain.",
  "Preserve real qualifiers from the fact (e.g. 'course project', 'with a team', 'prototype', 'offline experiment') — do not drop them to imply stronger professional experience than the fact supports.",
  "If a line cannot be phrased faithfully without amplification, omit that line rather than soften it into a technically-true-but-misleading phrasing.",
  'Return json with exactly this shape: {"greeting":"...","resumeLines":[{"text":"...","factIds":["fact-..."]}]}',
  "Do not return markdown. Do not return prose. Return json only."
].join("\n");

// 0.1 粗粒度兜底，0.3 内容评测域接管精确检测：只拦截最明显的程度和角色放大词。
const AMPLIFICATION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /精通|资深|专家级|expert in|proficient in/i, label: "程度放大词" },
  { pattern: /主导|负责架构|架构设计|led|architected/i, label: "角色放大词（若 fact 仅为参与/协助）" }
];

export async function draftApplicationMaterial(input: {
  profile: UserProfile;
  job: JobPosting;
  scoreResult: ScoreResult;
  client: OpenAiCompatibleLlmClient;
}): Promise<MaterialPreview> {
  const confirmedFacts = getConfirmedFacts(input.profile);
  if (confirmedFacts.length === 0) {
    return {
      status: "blocked",
      greeting: "",
      resumeLines: [],
      usedFacts: [],
      blockedFacts: [],
      guardrailNotes: ["无已确认事实,无法生成材料。"]
    };
  }

  const raw = await input.client.completeText({
    system: MATERIAL_DRAFTING_SYSTEM_PROMPT,
    user: buildDraftingUserPrompt(input.job, input.scoreResult.breakdown.requirements, confirmedFacts),
    responseFormatJson: true
  });

  const parsed = parseDraftEnvelope(raw);
  if (!parsed) {
    return {
      status: "blocked",
      greeting: "",
      resumeLines: [],
      usedFacts: [],
      blockedFacts: [],
      guardrailNotes: ["材料生成失败: 模型返回无法解析,请稍后重试。"]
    };
  }

  const confirmedFactById = new Map(confirmedFacts.map((fact) => [fact.id, fact] as const));
  let droppedLineCount = 0;

  const keptLines = parsed.resumeLines.flatMap((line) => {
    const text = line.text.trim();
    const factIds = unique(line.factIds.filter((factId) => confirmedFactById.has(factId)));
    if (!text || factIds.length === 0) {
      droppedLineCount += 1;
      return [];
    }
    const facts = factIds
      .map((factId) => confirmedFactById.get(factId))
      .filter(isProfileFact);
    const hasUnsupportedAmplification = AMPLIFICATION_PATTERNS.some(
      ({ pattern }) => pattern.test(text) && !facts.some((fact) => pattern.test(`${fact.label} ${fact.value}`))
    );
    if (hasUnsupportedAmplification) {
      droppedLineCount += 1;
      return [];
    }
    return [{ text, factIds }];
  });

  const usedFacts = unique(keptLines.flatMap((line) => line.factIds))
    .map((factId) => confirmedFactById.get(factId))
    .filter(isProfileFact)
    .map(toFactTrace);

  const unsupportedRequirements = input.scoreResult.breakdown.requirements.filter((item) => item.matchedFactIds.length === 0);
  const guardrailNotes = [
    ...unsupportedRequirements.map((item) => `${item.label}无确认事实支撑,未纳入材料。`),
    ...(droppedLineCount > 0 ? [`已丢弃 ${droppedLineCount} 行无溯源材料表达。`] : []),
    "打招呼语需用户发送前自查,确认未引入确认事实之外的硬信息。"
  ];

  const status = resolveMaterialStatus(keptLines.length, guardrailNotes.length);

  return {
    status,
    greeting: parsed.greeting.trim(),
    resumeLines: keptLines,
    usedFacts,
    blockedFacts: [],
    guardrailNotes
  };
}

function buildDraftingUserPrompt(job: JobPosting, requirements: RequirementResult[], confirmedFacts: ProfileFact[]): string {
  return JSON.stringify(
    {
      job: {
        title: job.title,
        company: job.company,
        requirements: requirements.map((item) => ({
          requirementId: item.requirementId,
          label: item.label,
          evidence: item.evidence,
          matchedFactIds: item.matchedFactIds
        }))
      },
      confirmedFacts: confirmedFacts.map((fact) => ({
        id: fact.id,
        category: fact.category,
        label: fact.label,
        value: fact.value
      }))
    },
    null,
    2
  );
}

function parseDraftEnvelope(raw: string): MaterialDraftEnvelope | null {
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

  if (!isRecord(value) || typeof value.greeting !== "string" || !Array.isArray(value.resumeLines)) {
    return null;
  }

  return {
    greeting: value.greeting,
    resumeLines: value.resumeLines
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .map((item) => ({
        text: typeof item.text === "string" ? item.text : "",
        factIds: Array.isArray(item.factIds) ? item.factIds.filter((factId): factId is string => typeof factId === "string") : []
      }))
  };
}

function resolveMaterialStatus(lineCount: number, guardrailCount: number): MaterialPreview["status"] {
  if (lineCount === 0) {
    return "blocked";
  }
  if (guardrailCount > 1) {
    return "needs_review";
  }
  return "ready";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function stripMarkdownFence(value: string): string {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? value;
}

function isProfileFact(fact: ProfileFact | undefined): fact is ProfileFact {
  return Boolean(fact);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
