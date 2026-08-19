export type FactStatus = "confirmed" | "unconfirmed" | "rejected";
export type FactSourceType = "resume" | "user_answer" | "manual";
export type RequirementKind = "skill" | "experience" | "preference" | "risk";
export type Strategy = "personalize" | "generic_apply" | "skip" | "review";
export type RiskSeverity = "low" | "medium" | "high";

export interface ProfileFact {
  id: string;
  category: string;
  label: string;
  value: string;
  sourceType: FactSourceType;
  sourceRef: string;
  status: FactStatus;
  confidence: number;
  /** 所属父级分组（同一份工作经历/项目）；无分组为 null。D034。 */
  groupId: string | null;
  /** 展示专用摘要，回答"这是哪件事"；从不喂给生成模型，从不替代 value。D034。 */
  summary: string | null;
}

/** 事实的父级分组：同一段工作经历/项目。分组本身不是 ProfileFact，从不参与生成投喂。D034。 */
export interface ProfileFactGroup {
  id: string;
  category: string;
  /** 公司/项目 + 角色 + 完整时间（不缩写）。 */
  label: string;
}

export interface UserProfile {
  id: string;
  displayName: string;
  headline: string;
  targetRoles: string[];
  targetCities: string[];
  resumeText: string;
  facts: ProfileFact[];
}

export interface PreferenceRuleSet {
  targetRoles: string[];
  targetCities: string[];
  minSalaryK: number;
  excludedKeywords: string[];
  preferCompanyTags: string[];
  confidence: number;
}

export interface JobRequirement {
  id: string;
  kind: RequirementKind;
  label: string;
  evidence: string;
  requiredFactIds: string[];
  weight: number;
}

export interface JobRisk {
  id: string;
  label: string;
  severity: RiskSeverity;
  evidence: string;
}

export interface JobPosting {
  id: string;
  title: string;
  company: string;
  city: string;
  salaryK: [number, number];
  companyTags: string[];
  jdText: string;
  requirements: JobRequirement[];
  risks: JobRisk[];
  reviewFlags: string[];
  pinned: boolean;
  workAddress: string | null;
  sourceUrl: string | null;
}

export interface RequirementResult {
  requirementId: string;
  label: string;
  kind: RequirementKind;
  score: number;
  maxScore: number;
  matchedFactIds: string[];
  blockedFactIds: string[];
  gap: string | null;
  evidence: string;
}

export interface ScoreBreakdown {
  requirements: RequirementResult[];
  preference: number;
  riskPenalty: number;
  reviewPenalty: number;
}

export interface ScoreResult {
  total: number;
  strategy: Strategy;
  strategyLabel: string;
  summary: string;
  breakdown: ScoreBreakdown;
  gaps: string[];
  risks: string[];
  reviewFlags: string[];
}

export interface FactTrace {
  factId: string;
  label: string;
  value: string;
  source: string;
}

export interface ResumeLine {
  text: string;
  factIds: string[];
}

export interface MaterialPreview {
  status: "ready" | "needs_review" | "blocked";
  greeting: string;
  resumeLines: ResumeLine[];
  usedFacts: FactTrace[];
  blockedFacts: FactTrace[];
  guardrailNotes: string[];
}
