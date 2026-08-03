import type { JobPosting, MaterialPreview, ProfileFact, RequirementResult, ScoreResult, UserProfile } from "../types";
import type { OpenAiCompatibleLlmClient } from "./llmClient";
import { getConfirmedFacts, toFactTrace } from "./facts";
import { isRecord, stripMarkdownFence } from "./shared";

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
  "Do not copy resume-fact text verbatim. Rewrite each confirmed fact into a polished, professional resume line: reorganize it using STAR (situation/task, action, result) where the fact supports that structure, lead with the outcome or impact when the fact contains one, and combine facts that belong to the same larger accomplishment into one coherent line. Writing a resume fuller and more polished than the literal fact text is the normal, expected way to write a resume — do this by default.",
  "Judge every line by this test: can it be reasonably inferred from the confirmed fact(s) it cites? If yes, write it, even if it reads stronger than the fact's literal wording. If no supporting fact exists for it, do not write it.",
  "Three things you may do: (1) name the underlying capability a concrete fact demonstrates, using professional or industry terminology, even if the fact's own words do not contain that terminology; (2) make explicit the routine work a stated role necessarily implies, but only when that work is a necessary consequence of the fact, not merely something that could plausibly also be true; (3) combine multiple related facts into one plausible combined-capability statement, as long as every component of that statement is supported by the cited facts.",
  "Do not invent any experience, skill, project, metric, duration, employer, tool, or collaborator that is not in the cited facts.",
  "Never state or imply a broader scope than the facts support (one component of a thing becoming 'the entire system' or 'full end-to-end ownership'); never elevate a role beyond what the facts support (participated in / helped with becoming 'led' or 'architected'; did once becoming 'expert in' or 'senior'); never add an activity, collaborator, tool, employer, metric, or duration the cited facts do not contain; never stack several intensifiers in one line so the combined impression is stronger than any cited fact supports; never drop a real qualifier (e.g. 'course project', 'prototype', 'with a team', 'offline experiment') if removing it would imply a stronger claim than the fact supports.",
  "There is no banned-word list. The same word can be true for one candidate and false for another — judge each line by whether the cited facts support that level of strength, not by which words are used.",
  "Every resume line must be traceable to the provided confirmed fact ids only.",
  "factIds may only reference the exact confirmed fact ids provided in the input.",
  "If a job requirement lacks confirmed fact support, do not write content for it.",
  "Preserve the original language of the confirmed facts: if the confirmed facts are written in Chinese, write every resumeLines text in Chinese; if they are written in another language, write in that language. Do not translate into a different language. This constrains language choice only, not wording — you are still expected to rephrase, restructure, and strengthen wording within that language exactly as instructed above.",
  "The greeting must be short, in Chinese, and based only on real confirmed match points.",
  'Return json with exactly this shape: {"greeting":"...","resumeLines":[{"text":"...","factIds":["fact-..."]}]}',
  "Do not return markdown. Do not return prose. Return json only."
].join("\n");

export async function draftApplicationMaterial(input: {
  profile: UserProfile;
  job: JobPosting;
  scoreResult: ScoreResult;
  client: OpenAiCompatibleLlmClient;
  // 仅供评测脚本 A/B 对照用：覆盖系统 prompt 文案。不传时用生产默认值。机制层（下方溯源/丢弃逻辑）不受影响。
  systemPrompt?: string;
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
    system: input.systemPrompt ?? MATERIAL_DRAFTING_SYSTEM_PROMPT,
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

function isProfileFact(fact: ProfileFact | undefined): fact is ProfileFact {
  return Boolean(fact);
}
