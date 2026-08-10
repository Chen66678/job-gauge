import type { FactStatus, MaterialPreview, ProfileFact, ScoreResult, UserProfile } from "../types";
import { normalizeAutoReevaluateRecentCount, type BatchDiagnosis, type CoreJobRecord, type CorePreferences, type CoreState, type FactConflict } from "./coreState";
export type { FactConflict } from "./coreState";
import {
  applyReconciliationPlan,
  clearCoreState,
  clearFactLibrary as clearCoreFactLibrary,
  computeConfirmedFactsFingerprint,
  deleteFact as deleteCoreFactById,
  deleteFactGroup as deleteCoreFactGroup,
  dismissFactConflict as dismissCoreFactConflict,
  getConfirmedFacts,
  getJobRecord,
  loadCoreState,
  saveCoreState,
  setFactStatus as setCoreFactStatus,
  setFactStatusBatch as setCoreFactStatusBatch,
  setJobPinned as setCoreJobPinned,
  setPreferences as setCorePreferences,
  upsertFacts,
  upsertFactGroups,
  upsertJobRecord
} from "./coreState";
import { reconcileFactVersions, toFactVersion } from "./factReconciliation";
import type { FollowUpQuestion } from "./followUp";
import { exportToMarkdown } from "./exportResume";
import { buildResumeImageRenderInput, type ResumeImageRenderInput } from "./resumeImage";
import { preScreenJob as runKeywordPreScreen, type KeywordPreScreenResult } from "./jobPreScreen";
import type { OpenAiCompatibleLlmClient } from "./llmClient";
import {
  applyFollowUpAnswers as orchestrateFollowUpAnswers,
  assembleJobPosting,
  buildFollowUps as orchestrateBuildFollowUps,
  buildResumeFollowUps as orchestrateBuildResumeFollowUps,
  draftMaterial as orchestrateDraftMaterial,
  evaluateJob,
  ingestJd,
  ingestPreferences,
  ingestResumeWithGroups
} from "./orchestration";
import type { LocalStorageLike } from "./storage";
import { redactSecretValues } from "./workbenchRepository";
import { findVetoHit } from "./preferenceParsing";

interface BatchDiagnosisEnvelope {
  patternSummary?: unknown;
  possibleMismatch?: unknown;
  searchSuggestions?: unknown;
}

type ScoredEvaluation = { vetoed: false; score: ScoreResult };
export type ReevaluationScope = "recent" | "stale";
export interface ReevaluationPreview {
  jobCount: number;
  modelCallCount: number;
}
/**
 * 调和只在事实库已有 ≥1 条时才会触发（少于两个版本无从调和，见
 * factReconciliation.ts 的 reconcileFactVersions 自身短路）。一次上传最多触发
 * 一次调和模型调用——versions 一次性整批送进单次 completeText，不是逐对调用。
 */
export interface ReconciliationPreview {
  modelCallCount: number;
}

const BATCH_DIAGNOSIS_SYSTEM_PROMPT = [
  "You analyze a batch of scored job recommendations and return json.",
  "You may only summarize the supplied batch evidence.",
  "Do not invent missing patterns, job details, user preferences, or scores.",
  "Do not calculate metrics yourself. All metrics are already computed in code.",
  "Focus on pattern summary, possible mismatch between the batch and the user's direction, and search suggestions.",
  'Return json with exactly this shape: {"patternSummary":"...","possibleMismatch":"..."|null,"searchSuggestions":["..."]}',
  "Keep searchSuggestions between 0 and 5 concise items.",
  "Do not return markdown. Do not return prose. Return json only."
].join("\n");

export interface CoreApi {
  getState(): CoreState;
  addManualFact(input: { content: string; category: string }): Promise<void>;
  ingestResume(input: { kind: "text"; resumeText: string }): Promise<ProfileFact[]>;
  setFactStatus(factId: string, status: FactStatus): void;
  setFactStatusBatch(updates: { factId: string; status: FactStatus }[]): Promise<void>;
  setPreferencesFromText(input: { acceptText: string; vetoText: string }): Promise<CorePreferences>;
  setAutoReevaluateRecentCount(count: number): void;
  getReevaluationPreview(scope: ReevaluationScope): ReevaluationPreview;
  /**
   * 上传简历前的成本预告（任务①交付物②）。extraction 本身已经是 1 次必经模型调用，
   * 不在这个数里；这个数只算「调和」会追加的调用次数上限。
   * 调和按 category 分批送模型（同一 category 一批一次调用，见 ingestResume 里的
   * buildReconciliationCallsByCategory）——上限 = 当前库里已有事实覆盖的 category 种数
   * （新抽取的事实只可能落进已有 category 之一，不会凑出更多批次）。真实触发数可能更少
   * （某 category 本次没抽出新事实，或该 category 原本就只有 1 条，凑不成两个版本），
   * 但不会更多。展示上限而非精确值，因为精确值要等 extraction 跑完才知道，那时模型
   * 调用已经花出去了，达不到"花之前先亮成本"。
   */
  getReconciliationPreview(): ReconciliationPreview;
  reevaluateJobs(scope: ReevaluationScope): Promise<CoreJobRecord[]>;
  evaluateJobFromJd(input: {
    jdText: string;
    jobBase: {
      title: string;
      company: string;
      city: string;
      salaryK: [number, number];
      companyTags: string[];
      workAddress?: string | null;
      sourceUrl?: string | null;
    };
  }): Promise<CoreJobRecord>;
  setJobPinned(jobId: string, pinned: boolean): void;
  buildResumeFollowUps(): Promise<FollowUpQuestion[]>;
  applyResumeFollowUpAnswers(
    questions: FollowUpQuestion[],
    answers: { questionId: string; answerText: string }[]
  ): Promise<ProfileFact[]>;
  buildFollowUps(jobId: string): Promise<FollowUpQuestion[]>;
  applyFollowUpAnswers(jobId: string, answers: { questionId: string; answerText: string }[]): Promise<ProfileFact[]>;
  reevaluateJob(jobId: string): Promise<CoreJobRecord | null>;
  draftMaterial(jobId: string): Promise<MaterialPreview>;
  exportResume(jobId: string): string;
  renderResumeImage(jobId: string): Promise<string>;
  preScreenJob(jobId: string, keywords: string[]): KeywordPreScreenResult | null;
  diagnoseBatch(client: OpenAiCompatibleLlmClient): Promise<BatchDiagnosis>;
  clearFactLibrary(): void;
  deleteFact(factId: string): Promise<void>;
  /** 删父级：分组连同其下全部子事实一并删除（首席裁定）。 */
  deleteFactGroup(groupId: string): Promise<void>;
  /** 撤销一条已登记的调和冲突（如用户已手动处理过）。三种归档语义仍未定，这里不做任何裁决。 */
  dismissFactConflict(conflictId: string): void;
  clear(): void;
}

export function createCoreApi(deps: {
  client: OpenAiCompatibleLlmClient;
  storage: LocalStorageLike;
  renderResumeImage?: (input: ResumeImageRenderInput) => Promise<string>;
}): CoreApi {
  let state = loadCoreState(deps.storage);

  function persist(nextState: CoreState): CoreState {
    saveCoreState(deps.storage, nextState);
    state = loadCoreState(deps.storage);
    return state;
  }

  // D026：新抽取的事实默认自动确认，但重复抽取（重传简历/重复追问）不得
  // 推翻用户已做过的明确决定：内容未变时保留原状态（confirmed/rejected），
  // 内容变了或全新事实才标 confirmed。
  function preserveUserDecidedStatus(facts: ProfileFact[]): ProfileFact[] {
    const existingById = new Map(state.factLibrary.map((fact) => [fact.id, fact] as const));
    return facts.map((fact) => {
      const existing = existingById.get(fact.id);
      const contentUnchanged = existing?.value === fact.value && existing?.category === fact.category;
      const userDecided = existing?.status === "rejected" || existing?.status === "confirmed";
      if (contentUnchanged && userDecided) {
        return { ...fact, status: existing!.status };
      }
      return { ...fact, status: "confirmed" as const };
    });
  }

  function buildWorkingProfile(): UserProfile {
    return {
      id: "profile-core-api",
      displayName: "",
      headline: "",
      targetRoles: [],
      targetCities: [],
      resumeText: "",
      facts: getConfirmedFacts(state)
    };
  }

  function toBlockedMaterial(note: string): MaterialPreview {
    return {
      status: "blocked",
      greeting: "",
      resumeLines: [],
      usedFacts: [],
      blockedFacts: [],
      guardrailNotes: [note]
    };
  }

  function getRecentReevaluationRecords(): CoreJobRecord[] {
    const count = normalizeAutoReevaluateRecentCount(state.preferences?.autoReevaluateRecentCount);
    const recentNonPinned = state.jobs
      .filter((record) => !record.job.pinned)
      .sort((left, right) => right.collectedAt.localeCompare(left.collectedAt))
      .slice(0, count);
    const pinned = state.jobs.filter((record) => record.job.pinned);
    return [...new Map([...pinned, ...recentNonPinned].map((record) => [record.job.id, record])).values()];
  }

  function getRecordsForReevaluation(scope: ReevaluationScope): CoreJobRecord[] {
    return scope === "recent"
      ? getRecentReevaluationRecords()
      : state.jobs.filter((record) => record.evaluationStale);
  }

  function getReevaluationPreview(scope: ReevaluationScope): ReevaluationPreview {
    const records = getRecordsForReevaluation(scope);
    return {
      jobCount: records.length,
      modelCallCount: records.filter((record) => (
        record.job.requirements.length > 0 && !findVetoHit(record.job, state.preferences?.hardVeto ?? { rules: [] })
      )).length
    };
  }

  function getReconciliationPreview(): ReconciliationPreview {
    const categories = new Set(state.factLibrary.map((fact) => fact.category));
    return { modelCallCount: categories.size };
  }

  /**
   * 调和的比对范围：按 category 分批，同一批里既有事实 + 本次新抽取事实一起送模型。
   * 只按 category 分批（不按 groupId）——groupKey 本身跨次不稳（backlog 260-279 行），
   * 拿它当调和范围的边界会把"一个真实项目在两次上传里 groupKey 不同"的情形提前切开，
   * 调和永远看不到该合的两条在同一批里，等于让调和被 groupKey 的病连坐。
   * category 稳定得多（模型不太会把"工作经历"抽成别的类），代价是同 category 下
   * 不同工作/项目的事实会被送进同一批比对——由调和模型自己的 SAMENESS 判据分开
   * （"两个不同雇主/项目永远不是同一件事"，见 factReconciliation.ts 的系统提示词），
   * 不是本层需要额外做的事。
   */
  function buildReconciliationBatches(
    existingFacts: ProfileFact[],
    incomingFacts: ProfileFact[]
  ): { category: string; versions: import("./factReconciliation").FactVersion[] }[] {
    const categories = new Set([...existingFacts, ...incomingFacts].map((fact) => fact.category));
    const batches: { category: string; versions: import("./factReconciliation").FactVersion[] }[] = [];
    for (const category of categories) {
      const existingInCategory = existingFacts.filter((fact) => fact.category === category);
      const incomingInCategory = incomingFacts.filter((fact) => fact.category === category);
      if (existingInCategory.length === 0 || incomingInCategory.length === 0) {
        // 只有既有事实、或只有新抽取事实，同一批里凑不出两个可比的版本来源。
        continue;
      }
      const versions = [
        ...existingInCategory.map((fact) => toFactVersion(fact, 1)),
        ...incomingInCategory.map((fact) => toFactVersion(fact, 0))
      ];
      if (versions.length >= 2) {
        batches.push({ category, versions });
      }
    }
    return batches;
  }

  async function reconcileIncomingFacts(incomingFacts: ProfileFact[]): Promise<void> {
    const incomingIds = new Set(incomingFacts.map((fact) => fact.id));
    const existingFacts = state.factLibrary.filter((fact) => !incomingIds.has(fact.id));
    const batches = buildReconciliationBatches(existingFacts, incomingFacts);
    for (const batch of batches) {
      const plan = await reconcileFactVersions({ versions: batch.versions, client: deps.client });
      persist(applyReconciliationPlan(state, plan));
    }
  }

  function markJobsOutsideRecentScopeStale(): void {
    const recentIds = new Set(getRecentReevaluationRecords().map((record) => record.job.id));
    let changed = false;
    const jobs = state.jobs.map((record) => {
      const evaluationStale = !recentIds.has(record.job.id);
      if (record.evaluationStale === evaluationStale) return record;
      changed = true;
      return { ...record, evaluationStale };
    });
    if (changed) persist({ ...state, jobs });
  }

  async function automaticallyReevaluateRecentJobs(): Promise<void> {
    markJobsOutsideRecentScopeStale();
    await Promise.all(getRecentReevaluationRecords().map((record) => reevaluateRecord(record.job.id)));
  }

  function markJobsWithStaleFacts(): void {
    const currentFingerprint = computeConfirmedFactsFingerprint(state);
    let changed = false;
    const jobs = state.jobs.map((record) => {
      if (record.evaluationStale) return record;
      if (record.evaluatedFactFingerprint === currentFingerprint) return record;
      changed = true;
      return { ...record, evaluationStale: true };
    });
    if (changed) persist({ ...state, jobs });
  }

  async function automaticallyReevaluateAfterFactChange(): Promise<void> {
    markJobsWithStaleFacts();
    await automaticallyReevaluateRecentJobs();
  }

  async function reevaluateRecord(jobId: string): Promise<CoreJobRecord | null> {
    const record = getJobRecord(state, jobId);
    if (!record || record.job.requirements.length === 0) {
      if (record?.evaluationStale) persist(upsertJobRecord(state, { ...record, evaluationStale: false }));
      return record;
    }

    try {
      const evaluation = await evaluateJob({
        profile: buildWorkingProfile(),
        job: record.job,
        client: deps.client,
        riskSensitivity: state.preferences?.riskSensitivity,
        hardVeto: state.preferences?.hardVeto
      });
      const fresh = getJobRecord(state, jobId) ?? record;
      persist(upsertJobRecord(state, {
        ...fresh,
        evaluation: evaluation.vetoed
          ? { vetoed: true, vetoRuleId: evaluation.vetoRule.id, vetoRuleLabel: evaluation.vetoRule.label }
          : { vetoed: false, score: evaluation.score },
        evaluationError: null,
        evaluationStale: false,
        evaluatedFactFingerprint: computeConfirmedFactsFingerprint(state)
      }));
      return getJobRecord(state, jobId);
    } catch (error) {
      const fresh = getJobRecord(state, jobId) ?? record;
      persist(upsertJobRecord(state, {
        ...fresh,
        evaluationError: error instanceof Error ? error.message : String(error),
        evaluationStale: true
      }));
      return getJobRecord(state, jobId);
    }
  }

  return {
    getState(): CoreState {
      return state;
    },

    async addManualFact(input) {
      const content = input.content.trim();
      const category = input.category.trim();
      // length + 1 会在删过事实后与既有 id 撞号，需查重递增。
      const existingIds = new Set(state.factLibrary.map((fact) => fact.id));
      let factNumber = state.factLibrary.length + 1;
      let id = `fact-manual-${factNumber}-${slugify(`${category}-${content}`)}`;
      while (existingIds.has(id)) {
        factNumber += 1;
        id = `fact-manual-${factNumber}-${slugify(`${category}-${content}`)}`;
      }
      const fact: ProfileFact = {
        id,
        category,
        label: category,
        value: content,
        sourceType: "manual",
        sourceRef: `manual:${new Date().toISOString()}`,
        status: "confirmed",
        confidence: 1,
        groupId: null,
        summary: null
      };
      persist(upsertFacts(state, [fact]));
      await automaticallyReevaluateAfterFactChange();
    },

    async ingestResume(input) {
      const { facts, groups } = await ingestResumeWithGroups({
        resume: input,
        client: deps.client
      });
      const confirmedFacts = preserveUserDecidedStatus(facts);
      persist(upsertFactGroups(state, groups));
      persist(upsertFacts(state, confirmedFacts));
      // 任务①：两份简历重叠时同一件事进库变多版本——在事实写库之后、
      // 重评之前跑调和，合并/补充结论直接改库，conflict 只登记不裁决（D036 §四未定）。
      await reconcileIncomingFacts(confirmedFacts);
      await automaticallyReevaluateAfterFactChange();
      return confirmedFacts;
    },

    getReconciliationPreview,

    setFactStatus(factId, status) {
      persist(setCoreFactStatus(state, factId, status));
    },

    async setFactStatusBatch(updates) {
      persist(setCoreFactStatusBatch(state, updates));
      await automaticallyReevaluateAfterFactChange();
    },

    async setPreferencesFromText(input) {
      const parsed = await ingestPreferences({
        acceptText: input.acceptText,
        vetoText: input.vetoText,
        client: deps.client
      });
      const preferences: CorePreferences = {
        ruleSet: parsed.preferences,
        riskSensitivity: parsed.riskSensitivity,
        hardVeto: parsed.hardVeto,
        autoReevaluateRecentCount: normalizeAutoReevaluateRecentCount(state.preferences?.autoReevaluateRecentCount)
      };
      persist(setCorePreferences(state, preferences));
      await automaticallyReevaluateRecentJobs();
      return preferences;
    },

    setAutoReevaluateRecentCount(count) {
      const preferences = state.preferences;
      if (!preferences) return;
      persist(setCorePreferences(state, {
        ...preferences,
        autoReevaluateRecentCount: normalizeAutoReevaluateRecentCount(count)
      }));
    },

    getReevaluationPreview,

    async reevaluateJobs(scope) {
      const records = getRecordsForReevaluation(scope);
      const results: CoreJobRecord[] = [];
      for (const record of records) {
        const updated = await reevaluateRecord(record.job.id);
        if (updated) results.push(updated);
      }
      return results;
    },

    evaluateJobFromJd(input) {
      const jdText = redactSecretValues(input.jdText);
      const baseJob = assembleJobPosting({
        base: {
          title: input.jobBase.title,
          company: input.jobBase.company,
          city: input.jobBase.city,
          salaryK: input.jobBase.salaryK,
          companyTags: input.jobBase.companyTags,
          jdText,
          workAddress: input.jobBase.workAddress,
          sourceUrl: input.jobBase.sourceUrl
        },
        requirements: [],
        risks: []
      });
      const previous = getJobRecord(state, baseJob.id);
      // 重采同一岗位时不清空既有 followUps/material —— 这两个字段只在评估
      // 真正跑完（成功路径）时才应被覆盖；异步窗口内若失败，catch 分支会
      // 直接基于这条基础记录合并，若这里先清空就无从恢复。
      const baseRecord: CoreJobRecord = {
        job: previous ? { ...baseJob, pinned: previous.job.pinned } : baseJob,
        evaluation: null,
        evaluationError: null,
        followUps: previous?.followUps ?? [],
        material: previous?.material ?? null,
        updatedAt: new Date().toISOString(),
        collectedAt: previous?.collectedAt ?? new Date().toISOString(),
        evaluationStale: false,
        materialStale: previous?.materialStale ?? false
      };
      persist(upsertJobRecord(state, baseRecord));

      return (async () => {
        try {
          const parsedJd = await ingestJd({
            jdText,
            client: deps.client
          });
          const job = assembleJobPosting({
            base: {
              title: input.jobBase.title,
              company: input.jobBase.company,
              city: input.jobBase.city,
              salaryK: input.jobBase.salaryK,
              companyTags: input.jobBase.companyTags,
              jdText,
              workAddress: input.jobBase.workAddress,
              sourceUrl: input.jobBase.sourceUrl
            },
            requirements: parsedJd.requirements,
            risks: parsedJd.risks
          });
          const evaluation = await evaluateJob({
            profile: buildWorkingProfile(),
            job,
            client: deps.client,
            riskSensitivity: state.preferences?.riskSensitivity,
            hardVeto: state.preferences?.hardVeto
          });

          // await 之后必须基于当前 state 重取记录再合并，否则并发写入（置顶、
          // 反问等）会被本次 await 前的旧快照覆盖。下同。
          const previous = getJobRecord(state, job.id);
          const record: CoreJobRecord = {
            job: previous ? { ...job, pinned: previous.job.pinned } : job,
            evaluation: evaluation.vetoed
              ? {
                  vetoed: true,
                  vetoRuleId: evaluation.vetoRule.id,
                  vetoRuleLabel: evaluation.vetoRule.label
                }
              : {
                  vetoed: false,
                  score: evaluation.score
                },
            evaluationError: null,
            followUps: previous?.followUps ?? [],
            material: previous?.material ?? null,
            updatedAt: new Date().toISOString(),
            collectedAt: previous?.collectedAt ?? new Date().toISOString(),
            evaluationStale: false,
            materialStale: previous?.material != null || (previous?.followUps?.length ?? 0) > 0,
            evaluatedFactFingerprint: computeConfirmedFactsFingerprint(state)
          };

          persist(upsertJobRecord(state, record));
          return getJobRecord(state, job.id) ?? record;
        } catch (error) {
          const evaluationError = error instanceof Error ? error.message : String(error);
          const current = getJobRecord(state, baseJob.id);
          const failedRecord: CoreJobRecord = current
            ? { ...current, evaluationError, updatedAt: new Date().toISOString() }
            : {
                job: baseJob,
                evaluation: null,
                evaluationError,
                followUps: [],
                material: null,
                updatedAt: new Date().toISOString(),
                collectedAt: new Date().toISOString(),
                evaluationStale: false,
                materialStale: false
              };
          persist(upsertJobRecord(state, failedRecord));
          return getJobRecord(state, baseJob.id) ?? failedRecord;
        }
      })();
    },

    setJobPinned(jobId, pinned) {
      persist(setCoreJobPinned(state, jobId, pinned));
    },

    async buildResumeFollowUps() {
      // 简历阶段反问：针对整个已抽取的事实库（未确认），不绑定任何岗位。
      return orchestrateBuildResumeFollowUps({
        facts: state.factLibrary,
        client: deps.client
      });
    },

    async applyResumeFollowUpAnswers(questions, answers) {
      if (questions.length === 0 || answers.length === 0) {
        return [];
      }
      const facts = await orchestrateFollowUpAnswers({
        questions,
        answers,
        client: deps.client
      });
      const confirmedFacts = preserveUserDecidedStatus(facts);
      persist(upsertFacts(state, confirmedFacts));
      return confirmedFacts;
    },

    async reevaluateJob(jobId) {
      return reevaluateRecord(jobId);
    },

    async buildFollowUps(jobId) {
      const record = getJobRecord(state, jobId);
      if (!record || !record.evaluation || record.evaluation.vetoed) {
        return [];
      }

      const questions = await orchestrateBuildFollowUps({
        job: record.job,
        scoreResult: record.evaluation.score,
        client: deps.client
      });
      persist(
        upsertJobRecord(state, {
          ...(getJobRecord(state, jobId) ?? record),
          followUps: questions
        })
      );
      return questions;
    },

    async applyFollowUpAnswers(jobId, answers) {
      const record = getJobRecord(state, jobId);
      if (!record || record.followUps.length === 0) {
        return [];
      }

      const facts = await orchestrateFollowUpAnswers({
        questions: record.followUps,
        answers,
        client: deps.client
      });
      const confirmedFacts = preserveUserDecidedStatus(facts);
      persist(upsertFacts(state, confirmedFacts));
      return confirmedFacts;
    },

    async draftMaterial(jobId) {
      const record = getJobRecord(state, jobId);
      if (!record) {
        return toBlockedMaterial("岗位不存在,无法生成材料。");
      }
      if (!record.evaluation) {
        const blocked = toBlockedMaterial("岗位尚未完成评估,暂无法生成材料。");
        persist(
          upsertJobRecord(state, {
            ...record,
            material: blocked
          })
        );
        return blocked;
      }
      if (record.evaluation.vetoed) {
        const blocked = toBlockedMaterial("岗位命中硬红线,不生成材料。");
        persist(
          upsertJobRecord(state, {
            ...record,
            material: blocked
          })
        );
        return blocked;
      }

      const material = await orchestrateDraftMaterial({
        profile: buildWorkingProfile(),
        job: record.job,
        scoreResult: record.evaluation.score,
        client: deps.client
      });
      persist(
        upsertJobRecord(state, {
          ...(getJobRecord(state, jobId) ?? record),
          material
        })
      );
      return material;
    },

    exportResume(jobId) {
      const record = getJobRecord(state, jobId);
      if (!record?.material) {
        return "";
      }
      return exportToMarkdown(record.material, record.job.title, record.job.company);
    },

    async renderResumeImage(jobId) {
      const record = getJobRecord(state, jobId);
      if (!record?.material) {
        throw new Error("岗位尚未生成定制材料，无法渲染图片。");
      }
      if (!deps.renderResumeImage) {
        throw new Error("当前运行环境不支持简历图片渲染。");
      }
      return deps.renderResumeImage(buildResumeImageRenderInput(record.material));
    },

    preScreenJob(jobId, keywords) {
      const record = getJobRecord(state, jobId);
      if (!record) {
        return null;
      }

      const preScreenResult = runKeywordPreScreen(record.job.jdText, keywords);
      persist(
        upsertJobRecord(state, {
          ...record,
          preScreenResult
        })
      );
      return preScreenResult;
    },

    async diagnoseBatch(client) {
      const totalJobsInLibrary = state.jobs.length;
      const evaluatedRecords = state.jobs.filter((record) => record.evaluation !== null);
      const vetoedRecords = evaluatedRecords.filter((record) => record.evaluation?.vetoed === true);
      const scoredRecords = evaluatedRecords.filter(
        (record): record is CoreJobRecord & { evaluation: ScoredEvaluation } =>
          record.evaluation !== null && record.evaluation.vetoed === false
      );

      const strategyBreakdown = scoredRecords.reduce<Record<string, number>>((acc, record) => {
        const strategy = record.evaluation.score.strategy;
        acc[strategy] = (acc[strategy] ?? 0) + 1;
        return acc;
      }, {});

      const scoredCount = scoredRecords.length;
      const positiveStrategyCount = (strategyBreakdown.personalize ?? 0) + (strategyBreakdown.generic_apply ?? 0);
      const averageScore =
        scoredCount === 0
          ? 0
          : Number((scoredRecords.reduce((sum, record) => sum + record.evaluation.score.total, 0) / scoredCount).toFixed(3));
      const matchRate = scoredCount === 0 ? 0 : Number((positiveStrategyCount / scoredCount).toFixed(3));

      const diagnosis: BatchDiagnosis = {
        totalJobsInLibrary,
        evaluatedCount: evaluatedRecords.length,
        vetoedCount: vetoedRecords.length,
        scoredCount,
        strategyBreakdown,
        matchRate,
        averageScore,
        llmAnalysis: null,
        diagnosedAt: new Date().toISOString()
      };

      if (scoredCount < 3) {
        return diagnosis;
      }

      try {
        const raw = await client.completeText({
          system: BATCH_DIAGNOSIS_SYSTEM_PROMPT,
          user: JSON.stringify(
            {
              computedMetrics: {
                totalJobsInLibrary,
                evaluatedCount: evaluatedRecords.length,
                vetoedCount: vetoedRecords.length,
                scoredCount,
                strategyBreakdown,
                matchRate,
                averageScore
              },
              scoredJobs: scoredRecords.map((record) => ({
                title: record.job.title,
                company: record.job.company,
                city: record.job.city,
                scoreTotal: record.evaluation.score.total,
                strategy: record.evaluation.score.strategy,
                gaps: record.evaluation.score.gaps
              }))
            },
            null,
            2
          ),
          responseFormatJson: true
        });

        diagnosis.llmAnalysis = parseBatchDiagnosisAnalysis(raw);
      } catch {
        diagnosis.llmAnalysis = null;
      }

      return diagnosis;
    },

    clearFactLibrary() {
      persist(clearCoreFactLibrary(state));
      markJobsWithStaleFacts();
    },

    async deleteFact(factId) {
      persist(deleteCoreFactById(state, factId));
      await automaticallyReevaluateAfterFactChange();
    },

    async deleteFactGroup(groupId) {
      persist(deleteCoreFactGroup(state, groupId));
      await automaticallyReevaluateAfterFactChange();
    },

    dismissFactConflict(conflictId) {
      persist(dismissCoreFactConflict(state, conflictId));
    },

    clear() {
      clearCoreState(deps.storage);
      state = loadCoreState(deps.storage);
    }
  };
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "") || "fact";
}

function parseBatchDiagnosisAnalysis(
  raw: string
): {
  patternSummary: string;
  possibleMismatch: string | null;
  searchSuggestions: string[];
} | null {
  const normalized = raw.trim();
  if (!normalized) {
    return null;
  }

  const withoutFence = normalized.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1").trim();

  let value: BatchDiagnosisEnvelope;
  try {
    value = JSON.parse(withoutFence) as BatchDiagnosisEnvelope;
  } catch {
    return null;
  }

  if (typeof value.patternSummary !== "string") {
    return null;
  }

  const searchSuggestions = Array.isArray(value.searchSuggestions)
    ? value.searchSuggestions.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 5)
    : [];

  return {
    patternSummary: value.patternSummary.trim(),
    possibleMismatch: typeof value.possibleMismatch === "string" ? value.possibleMismatch.trim() || null : null,
    searchSuggestions
  };
}
