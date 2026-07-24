import type { FactStatus, MaterialPreview, ProfileFact, ScoreResult, UserProfile } from "../types";
import type { BatchDiagnosis, CoreJobRecord, CorePreferences, CoreState } from "./coreState";
import {
  clearCoreState,
  getConfirmedFacts,
  getJobRecord,
  loadCoreState,
  saveCoreState,
  setFactStatus as setCoreFactStatus,
  setFactStatusBatch as setCoreFactStatusBatch,
  setJobPinned as setCoreJobPinned,
  setPreferences as setCorePreferences,
  upsertFacts,
  upsertJobRecord
} from "./coreState";
import type { FollowUpQuestion } from "./followUp";
import { exportToMarkdown } from "./exportResume";
import { OUTPUT_GATE_RELEASED } from "../outputGateRelease";
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
  ingestResume
} from "./orchestration";
import type { LocalStorageLike } from "./storage";

interface BatchDiagnosisEnvelope {
  patternSummary?: unknown;
  possibleMismatch?: unknown;
  searchSuggestions?: unknown;
}

type ScoredEvaluation = { vetoed: false; score: ScoreResult };

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
  addManualFact(input: { content: string; category: string }): void;
  ingestResume(
    input: { kind: "text"; resumeText: string } | { kind: "image"; imageBase64: string; mimeType: string }
  ): Promise<ProfileFact[]>;
  setFactStatus(factId: string, status: FactStatus): void;
  setFactStatusBatch(updates: { factId: string; status: FactStatus }[]): void;
  setPreferencesFromText(input: { acceptText: string; vetoText: string }): Promise<CorePreferences>;
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
  preScreenJob(jobId: string, keywords: string[]): KeywordPreScreenResult | null;
  diagnoseBatch(client: OpenAiCompatibleLlmClient): Promise<BatchDiagnosis>;
  clear(): void;
}

export function createCoreApi(deps: { client: OpenAiCompatibleLlmClient; storage: LocalStorageLike }): CoreApi {
  let state = loadCoreState(deps.storage);

  function persist(nextState: CoreState): CoreState {
    saveCoreState(deps.storage, nextState);
    state = loadCoreState(deps.storage);
    return state;
  }

  function buildWorkingProfile(): UserProfile {
    return {
      id: "profile-core-api",
      displayName: "",
      headline: "",
      targetRoles: [],
      targetCities: [],
      resumeText: "",
      facts: getConfirmedFacts(state),
      imageResumeAttachment: null
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

  return {
    getState(): CoreState {
      return state;
    },

    addManualFact(input) {
      const content = input.content.trim();
      const category = input.category.trim();
      const factNumber = state.factLibrary.length + 1;
      const fact: ProfileFact = {
        id: `fact-manual-${factNumber}-${slugify(`${category}-${content}`)}`,
        category,
        label: category,
        value: content,
        sourceType: "manual",
        sourceRef: "manual",
        status: "confirmed",
        confidence: 1
      };
      persist(upsertFacts(state, [fact]));
    },

    async ingestResume(input) {
      const facts = await ingestResume({
        resume: input,
        client: deps.client
      });
      persist(upsertFacts(state, facts));
      return facts;
    },

    setFactStatus(factId, status) {
      persist(setCoreFactStatus(state, factId, status));
    },

    setFactStatusBatch(updates) {
      persist(setCoreFactStatusBatch(state, updates));
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
        hardVeto: parsed.hardVeto
      };
      persist(setCorePreferences(state, preferences));
      return preferences;
    },

    async evaluateJobFromJd(input) {
      const baseJob = assembleJobPosting({
        base: {
          title: input.jobBase.title,
          company: input.jobBase.company,
          city: input.jobBase.city,
          salaryK: input.jobBase.salaryK,
          companyTags: input.jobBase.companyTags,
          jdText: input.jdText,
          workAddress: input.jobBase.workAddress,
          sourceUrl: input.jobBase.sourceUrl
        },
        requirements: [],
        risks: []
      });

      try {
        const parsedJd = await ingestJd({
          jdText: input.jdText,
          client: deps.client
        });
        const job = assembleJobPosting({
          base: {
            title: input.jobBase.title,
            company: input.jobBase.company,
            city: input.jobBase.city,
            salaryK: input.jobBase.salaryK,
            companyTags: input.jobBase.companyTags,
            jdText: input.jdText,
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

        const record: CoreJobRecord = {
          job,
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
          followUps: [],
          material: null,
          updatedAt: new Date().toISOString()
        };

        persist(upsertJobRecord(state, record));
        return getJobRecord(state, job.id) ?? record;
      } catch (error) {
        const failedRecord: CoreJobRecord = {
          job: baseJob,
          evaluation: null,
          evaluationError: error instanceof Error ? error.message : String(error),
          followUps: [],
          material: null,
          updatedAt: new Date().toISOString()
        };
        persist(upsertJobRecord(state, failedRecord));
        return getJobRecord(state, baseJob.id) ?? failedRecord;
      }
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
      persist(upsertFacts(state, facts));
      return facts;
    },

    async reevaluateJob(jobId) {
      // 事实/确认状态变更后，用当前 confirmed 事实重跑该岗位评分（修复评分被冻结的缺口）。
      const record = getJobRecord(state, jobId);
      if (!record || record.job.requirements.length === 0) {
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

        persist(
          upsertJobRecord(state, {
            ...record,
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
            evaluationError: null
          })
        );
        return getJobRecord(state, jobId);
      } catch (error) {
        persist(
          upsertJobRecord(state, {
            ...record,
            evaluationError: error instanceof Error ? error.message : String(error)
          })
        );
        return getJobRecord(state, jobId);
      }
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
          ...record,
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
      persist(upsertFacts(state, facts));
      return facts;
    },

    async draftMaterial(jobId) {
      // 官方输出面构建期强制关闭（fail-closed，先于任何生成路径）。
      // 闸门交付物过双审前，绝不进入 orchestrateDraftMaterial / materialDrafting。
      if (!OUTPUT_GATE_RELEASED) {
        return toBlockedMaterial("官方输出能力未解锁：输出忠实性闸门未过审，材料生成已构建期关闭。");
      }
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
          ...record,
          material
        })
      );
      return material;
    },

    exportResume(jobId) {
      // 官方输出面构建期强制关闭（fail-closed，绝不产出 markdown 字节）。
      if (!OUTPUT_GATE_RELEASED) {
        return "";
      }
      const record = getJobRecord(state, jobId);
      if (!record?.material) {
        return "";
      }
      return exportToMarkdown(record.material, record.job.title, record.job.company);
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
