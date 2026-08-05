import type {
  FactStatus,
  JobPosting,
  MaterialPreview,
  PreferenceRuleSet,
  ProfileFact,
  ProfileFactGroup,
  ScoreResult
} from "../types";
import type { FollowUpQuestion } from "./followUp";
import type { KeywordPreScreenResult } from "./jobPreScreen";
import type { HardVetoRules } from "./preferenceParsing";
import type { RiskSensitivity } from "./llmScoring";
import { type LocalStorageLike } from "./storage";
import { collectSensitiveRepositoryFindings } from "./workbenchRepository";
import { isRecord } from "./shared";

export const CORE_STATE_STORAGE_KEY = "boss-local-core-state:v1";

export interface CoreState {
  schemaVersion: 1;
  updatedAt: string;
  factLibrary: ProfileFact[];
  /** 父级分组（同一段工作经历/项目）。D034。 */
  factGroups: ProfileFactGroup[];
  preferences: CorePreferences | null;
  jobs: CoreJobRecord[];
}

export interface CorePreferences {
  ruleSet: PreferenceRuleSet;
  riskSensitivity: RiskSensitivity;
  hardVeto: HardVetoRules;
  autoReevaluateRecentCount?: number;
}

export interface CoreJobRecord {
  job: JobPosting;
  evaluation: CoreEvaluation | null;
  evaluationError: string | null;
  followUps: FollowUpQuestion[];
  material: MaterialPreview | null;
  preScreenResult?: KeywordPreScreenResult;
  /** 首次采集时间；重采同一岗位时必须保留。 */
  collectedAt: string;
  /** 偏好或简历更新后，原评分不能再作为当前评分展示。 */
  evaluationStale: boolean;
  /** 最近一次成功评估时已确认事实 id 集合的有序指纹；缺失视为不匹配。 */
  evaluatedFactFingerprint?: string;
  updatedAt: string;
}

export type CoreEvaluation =
  | { vetoed: true; vetoRuleId: string; vetoRuleLabel: string }
  | { vetoed: false; score: ScoreResult };

export interface BatchDiagnosis {
  totalJobsInLibrary: number;
  evaluatedCount: number;
  vetoedCount: number;
  scoredCount: number;
  strategyBreakdown: Record<string, number>;
  matchRate: number;
  averageScore: number;
  llmAnalysis:
    | {
        patternSummary: string;
        possibleMismatch: string | null;
        searchSuggestions: string[];
      }
    | null;
  diagnosedAt: string;
}

export function createEmptyCoreState(): CoreState {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    factLibrary: [],
    factGroups: [],
    preferences: null,
    jobs: []
  };
}

export function upsertFacts(state: CoreState, facts: ProfileFact[]): CoreState {
  const existingById = new Map(state.factLibrary.map((fact) => [fact.id, fact] as const));
  const nextFactLibrary = [...state.factLibrary];

  for (const fact of facts) {
    const existing = existingById.get(fact.id);
    if (!existing) {
      nextFactLibrary.push(fact);
      existingById.set(fact.id, fact);
      continue;
    }
    const index = nextFactLibrary.findIndex((item) => item.id === fact.id);
    if (index >= 0) {
      // 重复抽取（如重传同一份简历）不得推翻用户已做过的确认/排除：
      // 内容未变时保留原状态，内容变了才要求重新确认。
      const keepUserDecision =
        existing.value === fact.value &&
        existing.category === fact.category &&
        existing.status !== "unconfirmed" &&
        fact.status === "unconfirmed";
      const merged = keepUserDecision ? { ...fact, status: existing.status } : fact;
      nextFactLibrary[index] = merged;
      existingById.set(fact.id, merged);
    }
  }

  return withUpdatedAt({
    ...state,
    factLibrary: nextFactLibrary
  });
}

export function setFactStatus(state: CoreState, factId: string, status: FactStatus): CoreState {
  let changed = false;
  const nextFactLibrary = state.factLibrary.map((fact) => {
    if (fact.id !== factId) {
      return fact;
    }
    changed = true;
    return { ...fact, status };
  });

  return changed
    ? withUpdatedAt({
        ...state,
        factLibrary: nextFactLibrary
      })
    : state;
}

export function setFactStatusBatch(state: CoreState, updates: Array<{ factId: string; status: FactStatus }>): CoreState {
  const statusById = new Map(updates.map((item) => [item.factId, item.status] as const));
  let changed = false;

  const nextFactLibrary = state.factLibrary.map((fact) => {
    const nextStatus = statusById.get(fact.id);
    if (!nextStatus) {
      return fact;
    }
    changed = true;
    return { ...fact, status: nextStatus };
  });

  return changed
    ? withUpdatedAt({
        ...state,
        factLibrary: nextFactLibrary
      })
    : state;
}

export function setPreferences(state: CoreState, prefs: CorePreferences): CoreState {
  return withUpdatedAt({
    ...state,
    preferences: prefs
  });
}

export function upsertJobRecord(state: CoreState, record: CoreJobRecord): CoreState {
  const index = state.jobs.findIndex((item) => item.job.id === record.job.id);
  const nextRecord = withJobUpdatedAt(record);
  if (index < 0) {
    return withUpdatedAt({
      ...state,
      jobs: [...state.jobs, nextRecord]
    });
  }

  const nextJobs = [...state.jobs];
  nextJobs[index] = nextRecord;
  return withUpdatedAt({
    ...state,
    jobs: nextJobs
  });
}

export function getJobRecord(state: CoreState, jobId: string): CoreJobRecord | null {
  return state.jobs.find((item) => item.job.id === jobId) ?? null;
}

export function setJobPinned(state: CoreState, jobId: string, pinned: boolean): CoreState {
  const record = getJobRecord(state, jobId);
  if (!record || record.job.pinned === pinned) {
    return state;
  }
  return upsertJobRecord(state, { ...record, job: { ...record.job, pinned } });
}

export function removeJobRecord(state: CoreState, jobId: string): CoreState {
  const nextJobs = state.jobs.filter((item) => item.job.id !== jobId);
  if (nextJobs.length === state.jobs.length) {
    return state;
  }
  return withUpdatedAt({
    ...state,
    jobs: nextJobs
  });
}

export function getConfirmedFacts(state: CoreState): ProfileFact[] {
  return state.factLibrary.filter((fact) => fact.status === "confirmed");
}

export function computeConfirmedFactsFingerprint(state: CoreState): string {
  return getConfirmedFacts(state)
    .map((fact) => fact.id)
    .sort()
    .join(",");
}

export function clearFactLibrary(state: CoreState): CoreState {
  return withUpdatedAt({ ...state, factLibrary: [] });
}

export function deleteFact(state: CoreState, factId: string): CoreState {
  const nextFactLibrary = state.factLibrary.filter((fact) => fact.id !== factId);
  if (nextFactLibrary.length === state.factLibrary.length) return state;
  return withUpdatedAt({ ...state, factLibrary: nextFactLibrary });
}

export function upsertFactGroups(state: CoreState, groups: ProfileFactGroup[]): CoreState {
  const existingById = new Map(state.factGroups.map((group) => [group.id, group] as const));
  const nextFactGroups = [...state.factGroups];

  for (const group of groups) {
    const index = nextFactGroups.findIndex((item) => item.id === group.id);
    if (index >= 0) {
      nextFactGroups[index] = group;
    } else {
      nextFactGroups.push(group);
    }
    existingById.set(group.id, group);
  }

  return withUpdatedAt({ ...state, factGroups: nextFactGroups });
}

/** 删父级：分组及其全部子事实一并删除（首席裁定）。 */
export function deleteFactGroup(state: CoreState, groupId: string): CoreState {
  const nextFactGroups = state.factGroups.filter((group) => group.id !== groupId);
  const nextFactLibrary = state.factLibrary.filter((fact) => fact.groupId !== groupId);
  if (nextFactGroups.length === state.factGroups.length && nextFactLibrary.length === state.factLibrary.length) {
    return state;
  }
  return withUpdatedAt({ ...state, factGroups: nextFactGroups, factLibrary: nextFactLibrary });
}

export function serializeCoreState(state: CoreState): string {
  return JSON.stringify(state);
}

export function parseCoreState(raw: string): CoreState | null {
  try {
    const value: unknown = JSON.parse(raw);
    return isCoreState(value) ? value : null;
  } catch {
    return null;
  }
}

export function loadCoreState(storage: LocalStorageLike): CoreState {
  const raw = storage.getItem(CORE_STATE_STORAGE_KEY);
  if (!raw) {
    return createEmptyCoreState();
  }
  const parsed = parseCoreState(raw);
  return parsed ? normalizeCoreState(parsed) : createEmptyCoreState();
}

export function saveCoreState(storage: LocalStorageLike, state: CoreState): void {
  const nextState = withUpdatedAt(state);
  const findings = collectSensitiveRepositoryFindings(nextState, "coreState");
  if (findings.length > 0) {
    throw new Error(`Core state rejected sensitive/raw evidence fields: ${findings.slice(0, 5).join(", ")}`);
  }
  storage.setItem(CORE_STATE_STORAGE_KEY, serializeCoreState(nextState));
}

export function clearCoreState(storage: LocalStorageLike): void {
  storage.removeItem(CORE_STATE_STORAGE_KEY);
}

function withUpdatedAt<T extends CoreState>(state: T, updatedAt = new Date().toISOString()): T {
  return {
    ...state,
    updatedAt
  };
}

function withJobUpdatedAt(record: CoreJobRecord, updatedAt = new Date().toISOString()): CoreJobRecord {
  return {
    ...record,
    updatedAt
  };
}

function isCoreState(value: unknown): value is CoreState {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.factLibrary) &&
    value.factLibrary.every(isProfileFact) &&
    (value.factGroups === undefined || (Array.isArray(value.factGroups) && value.factGroups.every(isProfileFactGroup))) &&
    (value.preferences === null || value.preferences === undefined || isCorePreferences(value.preferences)) &&
    Array.isArray(value.jobs) &&
    value.jobs.every(isCoreJobRecord)
  );
}

function isCorePreferences(value: unknown): value is CorePreferences {
  return (
    isRecord(value) &&
    isPreferenceRuleSet(value.ruleSet) &&
    isRiskSensitivity(value.riskSensitivity) &&
    isHardVetoRules(value.hardVeto) &&
    (value.autoReevaluateRecentCount === undefined || isAutoReevaluateRecentCount(value.autoReevaluateRecentCount))
  );
}

function isCoreJobRecord(value: unknown): value is CoreJobRecord {
  return (
    isRecord(value) &&
    isJobPosting(value.job) &&
    (value.evaluation === null || value.evaluation === undefined || isCoreEvaluation(value.evaluation)) &&
    (value.evaluationError === null || value.evaluationError === undefined || typeof value.evaluationError === "string") &&
    Array.isArray(value.followUps) &&
    value.followUps.every(isFollowUpQuestion) &&
    (value.material === null || value.material === undefined || isMaterialPreview(value.material)) &&
    (value.preScreenResult === null || value.preScreenResult === undefined || isKeywordPreScreenResult(value.preScreenResult)) &&
    (value.collectedAt === undefined || typeof value.collectedAt === "string") &&
    (value.evaluationStale === undefined || typeof value.evaluationStale === "boolean") &&
    (value.evaluatedFactFingerprint === undefined || typeof value.evaluatedFactFingerprint === "string") &&
    typeof value.updatedAt === "string"
  );
}

function normalizeCoreState(state: CoreState): CoreState {
  return {
    ...state,
    factLibrary: state.factLibrary.map((fact) => ({
      ...fact,
      groupId: fact.groupId ?? null,
      summary: fact.summary ?? null
    })),
    factGroups: state.factGroups ?? [],
    preferences: state.preferences
      ? {
          ...state.preferences,
          autoReevaluateRecentCount: normalizeAutoReevaluateRecentCount(state.preferences.autoReevaluateRecentCount)
        }
      : null,
    jobs: state.jobs.map((record) => ({
      ...record,
      collectedAt: record.collectedAt ?? record.updatedAt,
      evaluationStale: record.evaluationStale ?? false
    }))
  };
}

function isAutoReevaluateRecentCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function normalizeAutoReevaluateRecentCount(value: unknown): number {
  return isAutoReevaluateRecentCount(value) ? value : 30;
}

function isCoreEvaluation(value: unknown): value is CoreEvaluation {
  return (
    isRecord(value) &&
    ((value.vetoed === true && typeof value.vetoRuleId === "string" && typeof value.vetoRuleLabel === "string") ||
      (value.vetoed === false && isScoreResult(value.score)))
  );
}

function isPreferenceRuleSet(value: unknown): value is PreferenceRuleSet {
  return (
    isRecord(value) &&
    isStringArray(value.targetRoles) &&
    isStringArray(value.targetCities) &&
    typeof value.minSalaryK === "number" &&
    isStringArray(value.excludedKeywords) &&
    isStringArray(value.preferCompanyTags) &&
    typeof value.confidence === "number"
  );
}

function isRiskSensitivity(value: unknown): value is RiskSensitivity {
  return (
    isRecord(value) &&
    typeof value.low === "number" &&
    typeof value.medium === "number" &&
    typeof value.high === "number"
  );
}

function isHardVetoRules(value: unknown): value is HardVetoRules {
  return isRecord(value) && Array.isArray(value.rules) && value.rules.every(isHardVetoRule);
}

function isHardVetoRule(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    (value.kind === "city" || value.kind === "keyword" || value.kind === "other") &&
    (value.mode === undefined || value.mode === "allowlist" || value.mode === "blocklist") &&
    isStringArray(value.matchTerms) &&
    typeof value.evidence === "string"
  );
}

function isFollowUpQuestion(value: unknown): value is FollowUpQuestion {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.requirementId === "string" &&
    (value.kind === "probe" || value.kind === "explore") &&
    typeof value.question === "string" &&
    typeof value.rationale === "string"
  );
}

function isMaterialPreview(value: unknown): value is MaterialPreview {
  return (
    isRecord(value) &&
    (value.status === "ready" || value.status === "needs_review" || value.status === "blocked") &&
    typeof value.greeting === "string" &&
    Array.isArray(value.resumeLines) &&
    value.resumeLines.every(isResumeLine) &&
    Array.isArray(value.usedFacts) &&
    value.usedFacts.every(isFactTrace) &&
    Array.isArray(value.blockedFacts) &&
    value.blockedFacts.every(isFactTrace) &&
    isStringArray(value.guardrailNotes)
  );
}

function isResumeLine(value: unknown): boolean {
  return isRecord(value) && typeof value.text === "string" && isStringArray(value.factIds);
}

function isFactTrace(value: unknown): boolean {
  return isRecord(value) && typeof value.factId === "string" && typeof value.label === "string" && typeof value.value === "string" && typeof value.source === "string";
}

function isScoreResult(value: unknown): value is ScoreResult {
  return (
    isRecord(value) &&
    typeof value.total === "number" &&
    typeof value.strategy === "string" &&
    typeof value.strategyLabel === "string" &&
    typeof value.summary === "string" &&
    isRecord(value.breakdown) &&
    Array.isArray(value.breakdown.requirements) &&
    value.breakdown.requirements.every(isRequirementResult) &&
    typeof value.breakdown.preference === "number" &&
    typeof value.breakdown.riskPenalty === "number" &&
    typeof value.breakdown.reviewPenalty === "number" &&
    isStringArray(value.gaps) &&
    isStringArray(value.risks) &&
    isStringArray(value.reviewFlags)
  );
}

function isKeywordPreScreenResult(value: unknown): value is KeywordPreScreenResult {
  return (
    isRecord(value) &&
    isStringArray(value.matchedKeywords) &&
    isStringArray(value.missedKeywords) &&
    typeof value.matchCount === "number" &&
    typeof value.totalKeywords === "number" &&
    typeof value.matchRatio === "number" &&
    (value.quickVerdict === "likely_match" || value.quickVerdict === "possible_match" || value.quickVerdict === "likely_skip")
  );
}

function isRequirementResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.requirementId === "string" &&
    typeof value.label === "string" &&
    typeof value.kind === "string" &&
    typeof value.score === "number" &&
    typeof value.maxScore === "number" &&
    isStringArray(value.matchedFactIds) &&
    isStringArray(value.blockedFactIds) &&
    (typeof value.gap === "string" || value.gap === null) &&
    typeof value.evidence === "string"
  );
}

function isProfileFact(value: unknown): value is ProfileFact {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.category === "string" &&
    typeof value.label === "string" &&
    typeof value.value === "string" &&
    (value.sourceType === "resume" || value.sourceType === "user_answer" || value.sourceType === "manual") &&
    typeof value.sourceRef === "string" &&
    (value.status === "confirmed" || value.status === "unconfirmed" || value.status === "rejected") &&
    typeof value.confidence === "number" &&
    (value.groupId === undefined || value.groupId === null || typeof value.groupId === "string") &&
    (value.summary === undefined || value.summary === null || typeof value.summary === "string")
  );
}

function isProfileFactGroup(value: unknown): value is ProfileFactGroup {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.category === "string" &&
    typeof value.label === "string"
  );
}

function isJobPosting(value: unknown): value is JobPosting {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.company === "string" &&
    typeof value.city === "string" &&
    Array.isArray(value.salaryK) &&
    value.salaryK.length === 2 &&
    typeof value.salaryK[0] === "number" &&
    typeof value.salaryK[1] === "number" &&
    isStringArray(value.companyTags) &&
    typeof value.jdText === "string" &&
    Array.isArray(value.requirements) &&
    value.requirements.every(isJobRequirement) &&
    Array.isArray(value.risks) &&
    value.risks.every(isJobRisk) &&
    isStringArray(value.reviewFlags) &&
    typeof value.pinned === "boolean" &&
    (value.workAddress === null || typeof value.workAddress === "string") &&
    (value.sourceUrl === null || typeof value.sourceUrl === "string")
  );
}

function isJobRequirement(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.kind === "skill" || value.kind === "experience" || value.kind === "preference" || value.kind === "risk") &&
    typeof value.label === "string" &&
    typeof value.evidence === "string" &&
    isStringArray(value.requiredFactIds) &&
    typeof value.weight === "number"
  );
}

function isJobRisk(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    (value.severity === "low" || value.severity === "medium" || value.severity === "high") &&
    typeof value.evidence === "string"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
