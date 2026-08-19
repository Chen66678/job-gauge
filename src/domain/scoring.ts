import type {
  JobPosting,
  PreferenceRuleSet,
  RequirementResult,
  ScoreResult,
  Strategy,
  UserProfile
} from "../types";
import { getFactById } from "./facts";

export const STRATEGY_LABELS: Record<Strategy, string> = {
  personalize: "高价值精投",
  generic_apply: "普通投递候选",
  skip: "跳过",
  review: "需要人工复核"
};

export function scoreJob(
  profile: UserProfile,
  job: JobPosting,
  preferences: PreferenceRuleSet
): ScoreResult {
  const requirementResults = job.requirements.map((requirement): RequirementResult => {
    const factIds = requirement.requiredFactIds;
    const matchedFactIds = factIds.filter((factId) => getFactById(profile, factId)?.status === "confirmed");
    const blockedFactIds = factIds.filter((factId) => {
      const fact = getFactById(profile, factId);
      return Boolean(fact && fact.status !== "confirmed");
    });
    const missingFactIds = factIds.filter((factId) => !getFactById(profile, factId));
    const requiredCount = Math.max(factIds.length, 1);
    const score = factIds.length === 0 ? 0 : Math.round((matchedFactIds.length / requiredCount) * requirement.weight);
    const gap =
      blockedFactIds.length > 0
        ? "存在待确认事实，不能作为匹配依据。"
        : missingFactIds.length > 0
          ? "缺少可追溯的画像事实。"
          : matchedFactIds.length < factIds.length
            ? "匹配证据不足。"
            : null;

    return {
      requirementId: requirement.id,
      label: requirement.label,
      kind: requirement.kind,
      score,
      maxScore: requirement.weight,
      matchedFactIds,
      blockedFactIds,
      gap,
      evidence: requirement.evidence
    };
  });

  const requirementScore = requirementResults.reduce((total, item) => total + item.score, 0);
  const preferenceScore = scorePreference(job, preferences);
  const excludedKeywords = findExcludedKeywords(job, preferences);
  const riskPenalty = scoreRiskPenalty(job) + (excludedKeywords.length > 0 ? 35 : 0);
  const reviewPenalty = job.reviewFlags.length > 0 ? Math.min(8, job.reviewFlags.length * 4) : 0;
  const total = clamp(Math.round(requirementScore + preferenceScore - riskPenalty - reviewPenalty), 0, 100);
  const gaps = requirementResults
    .filter((item) => item.gap)
    .map((item) => `${item.label}: ${item.gap}`);
  const risks = [
    ...job.risks.map((risk) => `${risk.label}: ${risk.evidence}`),
    ...excludedKeywords.map((keyword) => `触发偏好排除关键词：${keyword}`)
  ];
  const hasHighRisk = job.risks.some((risk) => risk.severity === "high") || excludedKeywords.length > 0;
  const strategy = classifyStrategy(
    total,
    gaps.length,
    hasHighRisk,
    job.reviewFlags.length
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

export function classifyStrategy(
  total: number,
  gapCount: number,
  hasHighRisk: boolean,
  reviewFlagCount: number,
  riskSensitivity?: { high: number }
): Strategy {
  // 风险敏感度为“忽略”时（high 权重 0），高风险标签不强制跳过；总分仍按正常阈值分级。
  if ((hasHighRisk && (riskSensitivity?.high ?? 1) > 0) || total < 45) return "skip";
  if (gapCount > 0 || reviewFlagCount >= 2) return "review";
  if (total >= 78) return "personalize";
  if (total >= 58) return "generic_apply";
  return "review";
}

export function scorePreference(job: JobPosting, preferences: PreferenceRuleSet): number {
  let score = 0;
  if (preferences.targetCities.includes(job.city)) score += 6;
  if (preferences.targetRoles.some((role) => job.title.includes(role.replace("工程师", "")))) score += 5;
  if (job.salaryK !== null && job.salaryK[1] > 0 && job.salaryK[1] >= preferences.minSalaryK) score += 5;
  if (preferences.preferCompanyTags.some((tag) => job.companyTags.includes(tag))) score += 4;
  return score;
}

export function findExcludedKeywords(job: JobPosting, preferences: PreferenceRuleSet): string[] {
  const haystack = `${job.title} ${job.company} ${job.city} ${job.companyTags.join(" ")} ${job.jdText}`.toLowerCase();
  return preferences.excludedKeywords
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .filter((keyword) => haystack.includes(keyword.toLowerCase()));
}

function scoreRiskPenalty(job: JobPosting): number {
  return job.risks.reduce((total, risk) => {
    if (risk.severity === "high") return total + 28;
    if (risk.severity === "medium") return total + 14;
    return total + 5;
  }, 0);
}

export function summarizeStrategy(strategy: Strategy, total: number): string {
  if (strategy === "personalize") return `总分 ${total}，匹配证据充分，适合逐条定制材料后精投。`;
  if (strategy === "generic_apply") return `总分 ${total}，基本匹配，可作为普通投递候选，但仍需发送前预览。`;
  if (strategy === "skip") return `总分 ${total}，建议跳过，避免低质量投递。`;
  return `总分 ${total}，存在缺口或复核项，先补充事实或人工判断。`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
