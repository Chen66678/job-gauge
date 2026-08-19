import type {
  JobPosting,
  JobRequirement,
  PreferenceRuleSet,
  ProfileFact,
  RequirementResult,
  RiskSeverity,
  ScoreResult,
  UserProfile
} from "../types";
import type { OpenAiCompatibleLlmClient } from "./llmClient";
import { getConfirmedFacts } from "./facts";
import { findExcludedKeywords, scorePreference, STRATEGY_LABELS, classifyStrategy, summarizeStrategy } from "./scoring";
import { isRecord, stripMarkdownFence } from "./shared";

export type RiskSensitivity = Record<RiskSeverity, number>;

export const DEFAULT_RISK_SENSITIVITY: RiskSensitivity = {
  low: 5,
  medium: 14,
  high: 28
};

interface MatchEnvelope {
  matches: MatchItem[];
}

interface MatchItem {
  requirementId: string;
  matchLevel: MatchLevel;
  factIds: string[];
  reason: string;
}

type MatchLevel = "none" | "implied" | "direct";

const MATCH_COEFFICIENTS: Record<MatchLevel, number> = {
  none: 0,
  implied: 0.6,
  direct: 1
};

const LLM_SCORING_SYSTEM_PROMPT = [
  "You perform semantic matching between confirmed profile facts and job requirements and return json.",
  "You only decide whether the provided confirmed facts support each requirement.",
  "You must not invent abilities, experience, evidence, or fact ids.",
  "You must not output any numeric scores, weights, percentages, rankings, totals, or floating point values.",
  'For each requirement, return exactly one matchLevel: "none", "implied", or "direct".',
  "direct means the confirmed facts explicitly satisfy the requirement.",
  "implied means the confirmed facts do not state the requirement verbatim, but they strongly and reasonably imply it.",
  "none means there is no reliable support from the confirmed facts.",
  "factIds may only reference the exact fact ids from the provided confirmed facts list.",
  "If there is no supporting confirmed fact, use matchLevel none and an empty factIds array.",
  "Do not invent missing fact ids. Do not cite facts that were not provided.",
  'Return json with exactly this shape: {"matches":[{"requirementId":"...","matchLevel":"none|implied|direct","factIds":["..."],"reason":"..."}]}',
  "Do not return markdown. Do not return prose. Return json only."
].join("\n");

export async function scoreJobWithLlm(input: {
  profile: UserProfile;
  job: JobPosting;
  client: OpenAiCompatibleLlmClient;
  riskSensitivity?: RiskSensitivity;
  preferences?: PreferenceRuleSet;
}): Promise<ScoreResult> {
  const confirmedFacts = getConfirmedFacts(input.profile);
  const riskSensitivity = input.riskSensitivity ?? DEFAULT_RISK_SENSITIVITY;

  if (confirmedFacts.length === 0 || input.job.requirements.length === 0) {
    return buildScoreResult(input.job, riskSensitivity, buildDefaultRequirementResults(input.job.requirements), input.preferences);
  }

  const raw = await input.client.completeText({
    system: LLM_SCORING_SYSTEM_PROMPT,
    user: buildScoringUserPrompt(confirmedFacts, input.job.requirements),
    responseFormatJson: true
  });

  const parsed = parseMatchEnvelope(raw);
  const requirementResults = buildRequirementResults(input.job.requirements, confirmedFacts, parsed?.matches ?? []);
  return buildScoreResult(input.job, riskSensitivity, requirementResults, input.preferences);
}

function buildScoringUserPrompt(confirmedFacts: ProfileFact[], requirements: JobRequirement[]): string {
  return JSON.stringify(
    {
      confirmedFacts: confirmedFacts.map((fact) => ({
        id: fact.id,
        category: fact.category,
        label: fact.label,
        value: fact.value
      })),
      requirements: requirements.map((requirement) => ({
        id: requirement.id,
        kind: requirement.kind,
        label: requirement.label,
        evidence: requirement.evidence
      }))
    },
    null,
    2
  );
}

function parseMatchEnvelope(raw: string): MatchEnvelope | null {
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

  if (!isRecord(value) || !Array.isArray(value.matches)) {
    return null;
  }

  return {
    matches: value.matches
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .map((item) => ({
        requirementId: item.requirementId,
        matchLevel: item.matchLevel,
        factIds: item.factIds,
        reason: item.reason
      }))
      .filter(isMatchItem)
  };
}

function buildRequirementResults(
  requirements: JobRequirement[],
  confirmedFacts: ProfileFact[],
  matches: MatchItem[]
): RequirementResult[] {
  const confirmedFactIds = new Set(confirmedFacts.map((fact) => fact.id));
  const matchByRequirementId = new Map<string, MatchItem>();

  for (const match of matches) {
    if (!requirements.some((requirement) => requirement.id === match.requirementId)) {
      continue;
    }
    if (!matchByRequirementId.has(match.requirementId)) {
      matchByRequirementId.set(match.requirementId, match);
    }
  }

  return requirements.map((requirement) => {
    const rawMatch = matchByRequirementId.get(requirement.id);
    const filteredFactIds = (rawMatch?.factIds ?? []).filter((factId) => confirmedFactIds.has(factId));
    const matchLevel = normalizeMatchLevel(rawMatch?.matchLevel ?? "none", filteredFactIds);
    const coefficient = MATCH_COEFFICIENTS[matchLevel];
    const score = round3(coefficient * requirement.weight);
    const gap = buildGap(matchLevel);

    return {
      requirementId: requirement.id,
      label: requirement.label,
      kind: requirement.kind,
      score,
      maxScore: requirement.weight,
      matchedFactIds: matchLevel === "none" ? [] : filteredFactIds,
      blockedFactIds: [],
      gap,
      evidence: requirement.evidence
    };
  });
}

function normalizeMatchLevel(matchLevel: MatchLevel, factIds: string[]): MatchLevel {
  if ((matchLevel === "implied" || matchLevel === "direct") && factIds.length === 0) {
    return "none";
  }
  return matchLevel;
}

function buildDefaultRequirementResults(requirements: JobRequirement[]): RequirementResult[] {
  return requirements.map((requirement) => ({
    requirementId: requirement.id,
    label: requirement.label,
    kind: requirement.kind,
    score: 0,
    maxScore: requirement.weight,
    matchedFactIds: [],
    blockedFactIds: [],
    gap: "缺少匹配证据",
    evidence: requirement.evidence
  }));
}

function buildScoreResult(
  job: JobPosting,
  riskSensitivity: RiskSensitivity,
  requirementResults: RequirementResult[],
  preferences?: PreferenceRuleSet
): ScoreResult {
  const totalWeight = job.requirements.reduce((sum, requirement) => sum + requirement.weight, 0);
  const weightedScore = requirementResults.reduce((sum, result) => sum + result.score, 0);
  const matchScore = totalWeight > 0 ? (weightedScore / totalWeight) * 100 : 0;
  const preferenceScore = preferences ? scorePreference(job, preferences) : 0;
  const excludedKeywords = preferences ? findExcludedKeywords(job, preferences) : [];
  const preferencePenalty = excludedKeywords.length > 0 ? 35 : 0;
  const riskPenalty = job.risks.reduce((sum, risk) => sum + riskSensitivity[risk.severity], 0) + preferencePenalty;
  const reviewPenalty = job.reviewFlags.length > 0 ? Math.min(8, job.reviewFlags.length * 4) : 0;
  const total = clamp(Math.round(matchScore + preferenceScore - riskPenalty - reviewPenalty), 0, 100);
  const gaps = requirementResults.filter((item) => item.gap).map((item) => `${item.label}: ${item.gap}`);
  const risks = [
    ...job.risks.map((risk) => `${risk.label}: ${risk.evidence}`),
    ...excludedKeywords.map((keyword) => `触发偏好排除关键词：${keyword}`)
  ];
  const hasHighRisk = job.risks.some((risk) => risk.severity === "high") || excludedKeywords.length > 0;
  const strategy = classifyStrategy(
    total,
    gaps.length,
    hasHighRisk,
    job.reviewFlags.length,
    riskSensitivity
  );

  return {
    total,
    strategy,
    strategyLabel: strategy === "skip" && hasHighRisk && total >= 45 ? "高风险跳过" : STRATEGY_LABELS[strategy],
    summary: summarizeStrategy(strategy, total),
    breakdown: {
      requirements: requirementResults,
      preference: preferenceScore,
      riskPenalty,
      reviewPenalty
    },
    gaps,
    risks,
    reviewFlags: job.reviewFlags
  };
}

function buildGap(matchLevel: MatchLevel): string | null {
  if (matchLevel === "direct") {
    return null;
  }
  if (matchLevel === "implied") {
    return "疑似具备,建议反问确认";
  }
  return "缺少匹配证据";
}

function round3(value: number): number {
  return Number(value.toFixed(3));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isMatchItem(value: unknown): value is MatchItem {
  return (
    isRecord(value) &&
    typeof value.requirementId === "string" &&
    isMatchLevel(value.matchLevel) &&
    Array.isArray(value.factIds) &&
    value.factIds.every((factId) => typeof factId === "string") &&
    typeof value.reason === "string"
  );
}

function isMatchLevel(value: unknown): value is MatchLevel {
  return value === "none" || value === "implied" || value === "direct";
}
