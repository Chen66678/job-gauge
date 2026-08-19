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
import type { ReconciliationPlan } from "./factReconciliation";

export const CORE_STATE_STORAGE_KEY = "boss-local-core-state:v1";

export interface CoreState {
  schemaVersion: 1;
  updatedAt: string;
  factLibrary: ProfileFact[];
  /** 父级分组（同一段工作经历/项目）。D034。 */
  factGroups: ProfileFactGroup[];
  /**
   * 调和判定为 conflict 的登记（任务①）。只登记，不裁决——
   * replace / keep-both / ask 三种归档语义 D036 §四未定，本层不许焊死任何一种。
   */
  factConflicts: FactConflict[];
  preferences: CorePreferences | null;
  jobs: CoreJobRecord[];
}

/** 调和判定为 conflict 时的登记条目。见 factReconciliation.ts 的 ReconciliationItem。 */
export interface FactConflict {
  /** 由涉及的 factId 集合派生，同一组重复出现只更新，不重复登记。 */
  id: string;
  factIds: string[];
  rationale: string;
  detectedAt: string;
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
  /**
   * 重采同一岗位（JD 变了/评估重跑）后，既有 material/followUps 是基于旧评估生成的，
   * 可能已经不准——标记，不删除（首席裁定：不许把已生成、已确认的材料清空重来）。
   * 是否需要重新生成由用户决定；界面不得把它当普通材料一样正常展示（视觉归设计域）。
   */
  materialStale: boolean;
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
    factConflicts: [],
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
  return withUpdatedAt({
    ...state,
    factLibrary: [],
    factGroups: [],
    factConflicts: []
  });
}

export function clearJobs(state: CoreState): CoreState {
  return withUpdatedAt({ ...state, jobs: [] });
}

export function deleteFact(state: CoreState, factId: string): CoreState {
  const nextFactLibrary = state.factLibrary.filter((fact) => fact.id !== factId);
  if (nextFactLibrary.length === state.factLibrary.length) return state;

  const liveGroupIds = new Set(
    nextFactLibrary
      .map((fact) => fact.groupId)
      .filter((groupId): groupId is string => groupId !== null)
  );
  const nextFactGroups = state.factGroups.filter((group) => liveGroupIds.has(group.id));

  return withUpdatedAt({
    ...state,
    factLibrary: nextFactLibrary,
    factGroups: nextFactGroups
  });
}

/**
 * 把调和结论落到 factLibrary + factConflicts。
 *
 * merge/supplement：涉及的多条事实收成一条——保留 versionIds[0] 的 id/groupId/sourceRef/status
 * （谁先出现在调和输入里谁当代表，调用方按 precedence 排好序传入），value/label/category
 * 换成 reconstructMergedValue 已经拼好的原文，其余版本从 factLibrary 里移除。
 * 不改 value 措辞——mergedValue 只可能来自 factReconciliation.ts 的机械拼接。
 *
 * conflict：只登记进 factConflicts，不动 factLibrary 一个字——三种归档语义 D036 §四未定，
 * 本函数不许替用户/首席拍板。
 *
 * groupId：groupKey 是模型每次抽取临时生成的，跨次不稳，同一家公司常年被拆成好几个
 * group（首席裁定，撤销 08-06 的"groupKey 已被架空"旧论）。merge/supplement 落库时，
 * 如果被合并的事实分属不同 group，这些 group 必须合成一个——保存活事实的 group，
 * 其余 group 的全部子事实（不止本条被合并的，同组的其它事实也一起）改挂过去，合并
 * 后清空的 group 从 factGroups 删掉。这只是"事实判定为同一件事"这个已有模型判断在
 * 结构上必然的推论（同一事实不能同时挂两个父级），不许反过来用"group 相同/相似"去
 * 推"事实该合并"——本函数从不读 group 去决定 verdict，verdict 完全来自 plan.items。
 * 若存活事实本来没分组而被合并的一方有，借用被合并一方的 group（否则合并后从有分组
 * 退化成无分组）。
 *
 * plan.unusable 为 true 时 items 本就是空的（fail-closed 在模块内已保证），这里原样跳过。
 */
export function applyReconciliationPlan(state: CoreState, plan: ReconciliationPlan): CoreState {
  if (plan.unusable) {
    return state;
  }

  let nextFactLibrary = state.factLibrary;
  let nextFactGroups = state.factGroups;
  for (const item of plan.items) {
    if (item.verdict !== "merge" && item.verdict !== "supplement") {
      continue;
    }
    if (item.mergedValue === undefined) {
      continue;
    }
    // 存活 id 选谁：模型返回的 versionIds 顺序不代表优先级（模型不产出优先级，
    // 见 factReconciliation.ts 的 FactVersion.precedence 注释）。取 nextFactLibrary
    // 里已排在前面的那个存活——库里靠前通常是先入库的既有事实，这样默认保留的是
    // 用户已经做过确认/排除决定的那条 id/groupId/status，不被新抽取的一条覆盖掉。
    const versionIdSet = new Set(item.versionIds);
    const survivor = nextFactLibrary.find((fact) => versionIdSet.has(fact.id));
    if (!survivor) {
      continue;
    }
    const survivorId = survivor.id;
    const absorbedIds = item.versionIds.filter((id) => id !== survivorId);
    const absorbedSet = new Set(absorbedIds);
    const absorbedFacts = nextFactLibrary.filter((fact) => absorbedSet.has(fact.id));

    let survivingGroupId = survivor.groupId;
    if (survivingGroupId === null) {
      const donor = absorbedFacts.find((fact) => fact.groupId !== null);
      survivingGroupId = donor?.groupId ?? null;
    }
    const obsoleteGroupIds = new Set(
      absorbedFacts
        .map((fact) => fact.groupId)
        .filter((groupId): groupId is string => groupId !== null && groupId !== survivingGroupId)
    );

    nextFactLibrary = nextFactLibrary
      .filter((fact) => !absorbedSet.has(fact.id))
      .map((fact) => {
        if (fact.id === survivorId) {
          return {
            ...fact,
            value: item.mergedValue as string,
            label: item.mergedLabel ?? fact.label,
            category: item.mergedCategory ?? fact.category,
            groupId: survivingGroupId
          };
        }
        if (fact.groupId !== null && obsoleteGroupIds.has(fact.groupId)) {
          return { ...fact, groupId: survivingGroupId };
        }
        return fact;
      });

    if (obsoleteGroupIds.size > 0) {
      nextFactGroups = nextFactGroups.filter((group) => !obsoleteGroupIds.has(group.id));
    }
  }

  let nextFactConflicts = state.factConflicts;
  for (const conflict of plan.conflicts) {
    nextFactConflicts = registerFactConflict(nextFactConflicts, conflict.versionIds, conflict.rationale);
  }

  if (
    nextFactLibrary === state.factLibrary &&
    nextFactGroups === state.factGroups &&
    nextFactConflicts === state.factConflicts
  ) {
    return state;
  }
  return withUpdatedAt({
    ...state,
    factLibrary: nextFactLibrary,
    factGroups: nextFactGroups,
    factConflicts: nextFactConflicts
  });
}

function registerFactConflict(conflicts: FactConflict[], factIds: string[], rationale: string): FactConflict[] {
  const id = [...factIds].sort().join("|");
  const existingIndex = conflicts.findIndex((conflict) => conflict.id === id);
  const entry: FactConflict = { id, factIds, rationale, detectedAt: new Date().toISOString() };
  if (existingIndex < 0) {
    return [...conflicts, entry];
  }
  const next = [...conflicts];
  next[existingIndex] = entry;
  return next;
}

/** 首席/用户在三种归档语义定下来之前，至少要能把已登记的冲突撤销（如已经手动处理过）。 */
export function dismissFactConflict(state: CoreState, conflictId: string): CoreState {
  const nextFactConflicts = state.factConflicts.filter((conflict) => conflict.id !== conflictId);
  if (nextFactConflicts.length === state.factConflicts.length) {
    return state;
  }
  return withUpdatedAt({ ...state, factConflicts: nextFactConflicts });
}

/**
 * 用户为一条冲突选定正确版本：保留 winner，删除同组其它版本，并移除这条冲突登记。
 * 被删除事实涉及的其它冲突登记一并撤销（不再可追溯）。保留版本视为用户已确认。
 */
export function resolveFactConflict(state: CoreState, conflictId: string, winnerFactId: string): CoreState {
  const conflict = state.factConflicts.find((entry) => entry.id === conflictId);
  if (!conflict) return state;
  if (!conflict.factIds.includes(winnerFactId)) return state;

  const removedIds = new Set(conflict.factIds.filter((factId) => factId !== winnerFactId));
  const nextFactLibrary = state.factLibrary
    .filter((fact) => !removedIds.has(fact.id))
    .map((fact) => (fact.id === winnerFactId ? { ...fact, status: "confirmed" as const } : fact));

  const liveGroupIds = new Set(
    nextFactLibrary
      .map((fact) => fact.groupId)
      .filter((groupId): groupId is string => groupId !== null)
  );
  const nextFactGroups = state.factGroups.filter((group) => liveGroupIds.has(group.id));
  const nextFactConflicts = state.factConflicts.filter(
    (entry) => entry.id !== conflictId && entry.factIds.every((factId) => !removedIds.has(factId))
  );

  return withUpdatedAt({
    ...state,
    factLibrary: nextFactLibrary,
    factGroups: nextFactGroups,
    factConflicts: nextFactConflicts
  });
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
    (value.factConflicts === undefined || (Array.isArray(value.factConflicts) && value.factConflicts.every(isFactConflict))) &&
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
    (value.materialStale === undefined || typeof value.materialStale === "boolean") &&
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
    factConflicts: state.factConflicts ?? [],
    preferences: state.preferences
      ? {
          ...state.preferences,
          autoReevaluateRecentCount: normalizeAutoReevaluateRecentCount(state.preferences.autoReevaluateRecentCount)
        }
      : null,
    jobs: state.jobs.map((record) => ({
      ...record,
      collectedAt: record.collectedAt ?? record.updatedAt,
      evaluationStale: record.evaluationStale ?? false,
      materialStale: record.materialStale ?? false
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

function isFactConflict(value: unknown): value is FactConflict {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isStringArray(value.factIds) &&
    typeof value.rationale === "string" &&
    typeof value.detectedAt === "string"
  );
}

function isJobPosting(value: unknown): value is JobPosting {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.company === "string" &&
    typeof value.city === "string" &&
    (value.salaryK === null ||
      (Array.isArray(value.salaryK) &&
        value.salaryK.length === 2 &&
        typeof value.salaryK[0] === "number" &&
        typeof value.salaryK[1] === "number")) &&
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
