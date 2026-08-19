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

// D032 A/B 实测后换成生产默认（2026-08-03，内容评测域拍板）：14 条负向清单换成一句目的交底 + 单条硬约束。
// 实测依据：厚度比 0.39-0.55 → 0.94-1.41；「主导」6→0、「架构设计」6→4；factId Jaccard 同量级；0 编造。
// 越界判据不是字面词匹配（D032 §二·附：判的是事实够不够格，不是词在不在原文），故本文案不再列词表/清单式禁令。
const MATERIAL_DRAFTING_SYSTEM_PROMPT = [
  "一位朋友把简历和一份 JD 发给你，请你帮他把简历改得更好，投这个岗位。",
  "像一个真正懂行的简历顾问那样去写：把经历组织清楚，突出成果和影响，该合并的合并，该讲清楚的讲清楚——把它写成一份真正专业、充分展开的简历，而不是把事实原样罗列。",
  "唯一必须守住的一条：不能凑不存在的经历、技能、项目、数据、时长、雇主、工具或合作者。写的每一句都要能从下面给你的 confirmed 事实里找到依据。",
  "因为这份简历要能追溯到真实依据，请用 json 返回，每一行都标上它依据的 factIds，形状严格为：",
  '{"greeting":"...","resumeLines":[{"text":"...","factIds":["fact-..."]}]}',
  "confirmed 事实是中文就用中文写，不要翻译成别的语言。",
  "只返回 json，不要markdown，不要多余的话。"
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

  const keptLineCandidates = parsed.resumeLines.flatMap((line) => {
    const text = line.text.trim();
    const factIds = unique(line.factIds.filter((factId) => confirmedFactById.has(factId)));
    if (!text || factIds.length === 0) {
      droppedLineCount += 1;
      return [];
    }
    const referencedFacts = factIds
      .map((factId) => confirmedFactById.get(factId))
      .filter(isProfileFact);
    return [{
      text,
      factIds,
      traceable: hasTraceableAnchor(text, referencedFacts)
    }];
  });
  const keptLines = keptLineCandidates.map(({ text, factIds }) => ({ text, factIds }));

  const usedFacts = unique(keptLines.flatMap((line) => line.factIds))
    .map((factId) => confirmedFactById.get(factId))
    .filter(isProfileFact)
    .map(toFactTrace);

  const unsupportedRequirements = input.scoreResult.breakdown.requirements.filter((item) => item.matchedFactIds.length === 0);
  const anchorReviewNotes = keptLineCandidates.flatMap((line, index) =>
    line.traceable ? [] : [`第 ${index + 1} 行未与引用事实建立字面锚点，请重点复核。`]
  );
  const guardrailNotes = [
    ...unsupportedRequirements.map((item) => `${item.label}无确认事实支撑,未纳入材料。`),
    ...(droppedLineCount > 0 ? [`已丢弃 ${droppedLineCount} 行无溯源材料表达。`] : []),
    ...anchorReviewNotes,
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

function hasTraceableAnchor(text: string, facts: ProfileFact[]): boolean {
  const lineTokens = extractAnchorTokens(text);
  if (lineTokens.size === 0) return true;
  const sourceTokens = new Set(facts.flatMap((fact) => [...extractAnchorTokens(fact.value)]));
  for (const token of lineTokens) {
    if (sourceTokens.has(token)) return true;
  }
  return false;
}

function extractAnchorTokens(value: string): Set<string> {
  const normalized = value.toLowerCase();
  const tokens = new Set<string>();
  for (const match of normalized.matchAll(/[a-z0-9]{2,}/g)) {
    tokens.add(match[0]);
  }

  const compact = Array.from(normalized.replace(/\s+/g, ""));
  for (let index = 0; index < compact.length - 1; index += 1) {
    const pair = `${compact[index]}${compact[index + 1]}`;
    if (isHanPair(pair)) tokens.add(pair);
  }
  return tokens;
}

function isHanPair(value: string): boolean {
  return Array.from(value).length === 2 && Array.from(value).every((character) => /\p{Script=Han}/u.test(character));
}

function isProfileFact(fact: ProfileFact | undefined): fact is ProfileFact {
  return Boolean(fact);
}
