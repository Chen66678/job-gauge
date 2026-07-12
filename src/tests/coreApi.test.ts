import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreJobRecord, CorePreferences } from "../domain/coreState";
import { CORE_STATE_STORAGE_KEY } from "../domain/coreState";
import { createCoreApi } from "../domain/coreApi";
import type { KeywordPreScreenResult } from "../domain/jobPreScreen";
import type { OpenAiCompatibleLlmClient } from "../domain/llmClient";
import type { FollowUpQuestion } from "../domain/followUp";
import type { MaterialPreview, ProfileFact, ScoreResult } from "../types";

const orchestrationMocks = vi.hoisted(() => ({
  ingestResume: vi.fn(),
  ingestPreferences: vi.fn(),
  ingestJd: vi.fn(),
  assembleJobPosting: vi.fn(),
  evaluateJob: vi.fn(),
  buildFollowUps: vi.fn(),
  applyFollowUpAnswers: vi.fn(),
  draftMaterial: vi.fn()
}));

vi.mock("../domain/orchestration", () => orchestrationMocks);

class MemoryStorage {
  readonly getItem = vi.fn((key: string): string | null => this.values.get(key) ?? null);
  readonly setItem = vi.fn((key: string, value: string): void => {
    this.values.set(key, value);
  });
  readonly removeItem = vi.fn((key: string): void => {
    this.values.delete(key);
  });

  private readonly values = new Map<string, string>();
}

function createClient(): OpenAiCompatibleLlmClient {
  return {
    completeText: vi.fn(),
    completeVision: vi.fn()
  } as unknown as OpenAiCompatibleLlmClient;
}

function createTextClient(response: string): OpenAiCompatibleLlmClient {
  return {
    completeText: vi.fn(async () => response),
    completeVision: vi.fn()
  } as unknown as OpenAiCompatibleLlmClient;
}

function buildFact(input: Partial<ProfileFact> & Pick<ProfileFact, "id" | "label" | "value">): ProfileFact {
  return {
    id: input.id,
    category: input.category ?? "技能",
    label: input.label,
    value: input.value,
    sourceType: input.sourceType ?? "resume",
    sourceRef: input.sourceRef ?? "测试事实",
    status: input.status ?? "unconfirmed",
    confidence: input.confidence ?? 0.9
  };
}

function buildPreferences(): CorePreferences {
  return {
    ruleSet: {
      targetRoles: [],
      targetCities: ["上海"],
      minSalaryK: 20,
      excludedKeywords: ["外包"],
      preferCompanyTags: ["SaaS"]
    },
    riskSensitivity: {
      low: 3,
      medium: 8,
      high: 16
    },
    hardVeto: {
      rules: [
        {
          id: "veto-1",
          label: "只去上海",
          kind: "city",
          matchTerms: ["上海"],
          evidence: "只去上海"
        }
      ]
    }
  };
}

function buildRequirement() {
  return {
    id: "req-1",
    kind: "skill" as const,
    label: "React 组件开发",
    evidence: "JD 要求 React 组件开发。",
    requiredFactIds: [],
    weight: 0.8
  };
}

function buildScoreResult(): ScoreResult {
  return {
    total: 76,
    strategy: "review",
    strategyLabel: "需要人工复核",
    summary: "测试总结",
    breakdown: {
      requirements: [
        {
          requirementId: "req-1",
          label: "React 组件开发",
          kind: "skill",
          score: 0.8,
          maxScore: 0.8,
          matchedFactIds: ["fact-1"],
          blockedFactIds: [],
          gap: null,
          evidence: "JD 要求 React 组件开发。"
        }
      ],
      preference: 0,
      riskPenalty: 0,
      reviewPenalty: 0
    },
    gaps: [],
    risks: [],
    reviewFlags: []
  };
}

function buildScoredResult(total: number, strategy: ScoreResult["strategy"]): ScoreResult {
  return {
    ...buildScoreResult(),
    total,
    strategy,
    strategyLabel: strategy,
    gaps: strategy === "review" ? ["React 组件开发: 缺少匹配证据"] : []
  };
}

function buildMaterial(): MaterialPreview {
  return {
    status: "ready",
    greeting: "您好，我有相关经验。",
    resumeLines: ["负责 React 组件开发。"],
    usedFacts: [
      {
        factId: "fact-1",
        label: "React",
        value: "负责 React 组件开发",
        source: "简历 - 测试事实"
      }
    ],
    blockedFacts: [],
    guardrailNotes: []
  };
}

function buildQuestions(): FollowUpQuestion[] {
  return [
    {
      id: "followup-1",
      requirementId: "req-1",
      kind: "explore",
      question: "你是否做过 React 组件开发？",
      rationale: "确认真实项目经历"
    }
  ];
}

beforeEach(() => {
  vi.clearAllMocks();

  orchestrationMocks.ingestResume.mockResolvedValue([]);
  orchestrationMocks.ingestPreferences.mockResolvedValue({
    preferences: buildPreferences().ruleSet,
    riskSensitivity: buildPreferences().riskSensitivity,
    hardVeto: buildPreferences().hardVeto
  });
  orchestrationMocks.ingestJd.mockResolvedValue({
    requirements: [buildRequirement()],
    risks: []
  });
  orchestrationMocks.assembleJobPosting.mockImplementation(({ base, requirements, risks }) => ({
    id: `${base.company}-${base.title}-${base.city}`,
    title: base.title,
    company: base.company,
    city: base.city,
    salaryK: base.salaryK,
    companyTags: base.companyTags,
    jdText: base.jdText,
    requirements,
    risks,
    reviewFlags: []
  }));
  orchestrationMocks.evaluateJob.mockResolvedValue({
    vetoed: false,
    score: buildScoreResult()
  });
  orchestrationMocks.buildFollowUps.mockResolvedValue([]);
  orchestrationMocks.applyFollowUpAnswers.mockResolvedValue([]);
  orchestrationMocks.draftMaterial.mockResolvedValue(buildMaterial());
});

describe("coreApi", () => {
  it("ingestResume stores new facts in memory and persists state", async () => {
    const storage = new MemoryStorage();
    const facts = [buildFact({ id: "fact-1", label: "React", value: "负责 React 组件开发" })];
    orchestrationMocks.ingestResume.mockResolvedValueOnce(facts);
    const api = createCoreApi({ client: createClient(), storage });

    const result = await api.ingestResume({ kind: "text", resumeText: "负责 React 组件开发。" });

    expect(result).toEqual(facts);
    expect(api.getState().factLibrary).toEqual(facts);
    expect(storage.setItem).toHaveBeenCalled();
    expect(storage.getItem(CORE_STATE_STORAGE_KEY)).toContain("\"factLibrary\"");
  });

  it("setFactStatus marks a stored fact as confirmed", async () => {
    const storage = new MemoryStorage();
    const fact = buildFact({ id: "fact-1", label: "React", value: "负责 React 组件开发" });
    orchestrationMocks.ingestResume.mockResolvedValueOnce([fact]);
    const api = createCoreApi({ client: createClient(), storage });

    await api.ingestResume({ kind: "text", resumeText: "负责 React 组件开发。" });
    api.setFactStatus("fact-1", "confirmed");

    expect(api.getState().factLibrary).toEqual([{ ...fact, status: "confirmed" }]);
  });

  it("only passes confirmed facts into downstream evaluation", async () => {
    const storage = new MemoryStorage();
    const api = createCoreApi({ client: createClient(), storage });
    const fact = buildFact({ id: "fact-1", label: "React", value: "负责 React 组件开发", status: "unconfirmed" });
    orchestrationMocks.ingestResume.mockResolvedValueOnce([fact]);

    await api.ingestResume({ kind: "text", resumeText: "负责 React 组件开发。" });
    await api.evaluateJobFromJd({
      jdText: "要求 React 组件开发。",
      jobBase: {
        title: "前端工程师",
        company: "样例科技",
        city: "上海",
        salaryK: [20, 30],
        companyTags: ["SaaS"]
      }
    });

    api.setFactStatus("fact-1", "confirmed");

    await api.evaluateJobFromJd({
      jdText: "要求 React 组件开发。",
      jobBase: {
        title: "前端工程师",
        company: "样例科技",
        city: "上海",
        salaryK: [20, 30],
        companyTags: ["SaaS"]
      }
    });

    expect(orchestrationMocks.evaluateJob).toHaveBeenCalledTimes(2);
    expect(orchestrationMocks.evaluateJob.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        profile: expect.objectContaining({
          facts: []
        }),
        riskSensitivity: undefined,
        hardVeto: undefined
      })
    );
    expect(orchestrationMocks.evaluateJob.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        profile: expect.objectContaining({
          facts: [{ ...fact, status: "confirmed" }]
        })
      })
    );
  });

  it("stores vetoed job evaluations without followUps or material", async () => {
    const storage = new MemoryStorage();
    const api = createCoreApi({ client: createClient(), storage });
    orchestrationMocks.evaluateJob.mockResolvedValueOnce({
      vetoed: true,
      vetoRule: {
        id: "veto-9",
        label: "只去北京",
        kind: "city",
        matchTerms: ["北京"],
        evidence: "只去北京"
      }
    });

    const result = await api.evaluateJobFromJd({
      jdText: "要求 React 组件开发。",
      jobBase: {
        title: "前端工程师",
        company: "样例科技",
        city: "上海",
        salaryK: [20, 30],
        companyTags: ["SaaS"]
      }
    });

    expect(result.evaluation).toEqual({
      vetoed: true,
      vetoRuleId: "veto-9",
      vetoRuleLabel: "只去北京"
    });
    expect(result.followUps).toEqual([]);
    expect(result.material).toBeNull();
  });

  it("applies follow-up answers as unconfirmed facts and persists them", async () => {
    const storage = new MemoryStorage();
    const api = createCoreApi({ client: createClient(), storage });
    const questions = buildQuestions();
    const newFacts = [
      buildFact({
        id: "fact-followup-1",
        label: "React 后台开发",
        value: "用 React 做过后台页面",
        sourceType: "user_answer",
        sourceRef: "反问:你是否做过 React 组件开",
        status: "unconfirmed"
      })
    ];
    orchestrationMocks.buildFollowUps.mockResolvedValueOnce(questions);
    orchestrationMocks.applyFollowUpAnswers.mockResolvedValueOnce(newFacts);

    const record = await api.evaluateJobFromJd({
      jdText: "要求 React 组件开发。",
      jobBase: {
        title: "前端工程师",
        company: "样例科技",
        city: "上海",
        salaryK: [20, 30],
        companyTags: ["SaaS"]
      }
    });

    await api.buildFollowUps(record.job.id);
    const result = await api.applyFollowUpAnswers(record.job.id, [
      {
        questionId: questions[0].id,
        answerText: "对，我用 React 做过后台页面。"
      }
    ]);

    expect(result).toEqual(newFacts);
    expect(api.getState().factLibrary).toEqual(newFacts);
    expect(api.getState().factLibrary.every((fact) => fact.status === "unconfirmed")).toBe(true);
    expect(storage.setItem).toHaveBeenCalled();
  });

  it("persists preferences and facts across api instances backed by the same storage", async () => {
    const storage = new MemoryStorage();
    const fact = buildFact({ id: "fact-1", label: "React", value: "负责 React 组件开发" });
    const preferences = buildPreferences();
    orchestrationMocks.ingestResume.mockResolvedValueOnce([fact]);
    orchestrationMocks.ingestPreferences.mockResolvedValueOnce({
      preferences: preferences.ruleSet,
      riskSensitivity: preferences.riskSensitivity,
      hardVeto: preferences.hardVeto
    });

    const api1 = createCoreApi({ client: createClient(), storage });
    await api1.ingestResume({ kind: "text", resumeText: "负责 React 组件开发。" });
    api1.setFactStatus("fact-1", "confirmed");
    await api1.setPreferencesFromText({ acceptText: "想去上海", vetoText: "" });

    const api2 = createCoreApi({ client: createClient(), storage });

    expect(api2.getState().factLibrary).toEqual([{ ...fact, status: "confirmed" }]);
    expect(api2.getState().preferences).toEqual(preferences);
  });

  it("draftMaterial stores the generated preview on the job record", async () => {
    const storage = new MemoryStorage();
    const api = createCoreApi({ client: createClient(), storage });
    const record = await api.evaluateJobFromJd({
      jdText: "要求 React 组件开发。",
      jobBase: {
        title: "前端工程师",
        company: "样例科技",
        city: "上海",
        salaryK: [20, 30],
        companyTags: ["SaaS"]
      }
    });

    const material = await api.draftMaterial(record.job.id);
    const savedRecord = api.getState().jobs[0] as CoreJobRecord;

    expect(material).toEqual(buildMaterial());
    expect(savedRecord.material).toEqual(buildMaterial());
    expect(orchestrationMocks.draftMaterial).toHaveBeenCalledWith(
      expect.objectContaining({
        job: expect.objectContaining({ id: record.job.id })
      })
    );
  });

  it("preScreenJob stores preScreenResult on the job record and persists it", async () => {
    const storage = new MemoryStorage();
    const api = createCoreApi({ client: createClient(), storage });
    const record = await api.evaluateJobFromJd({
      jdText: "要求 React 组件开发，并配合 TypeScript 开发。",
      jobBase: {
        title: "前端工程师",
        company: "样例科技",
        city: "上海",
        salaryK: [20, 30],
        companyTags: ["SaaS"]
      }
    });

    const result = api.preScreenJob(record.job.id, ["React", "TypeScript", "Kubernetes"]);

    expect(result).toEqual<KeywordPreScreenResult>({
      matchedKeywords: ["React", "TypeScript"],
      missedKeywords: ["Kubernetes"],
      matchCount: 2,
      totalKeywords: 3,
      matchRatio: 0.667,
      quickVerdict: "likely_match"
    });
    expect(api.getState().jobs[0]?.preScreenResult).toEqual(result);
    expect(storage.setItem).toHaveBeenCalled();
  });

  it("diagnoseBatch returns zero metrics and skips llm when there are no evaluated jobs", async () => {
    const storage = new MemoryStorage();
    const llmClient = createTextClient("{\"patternSummary\":\"unused\",\"possibleMismatch\":null,\"searchSuggestions\":[]}");
    const api = createCoreApi({ client: createClient(), storage });

    const result = await api.diagnoseBatch(llmClient);

    expect(result).toEqual({
      totalJobsInLibrary: 0,
      evaluatedCount: 0,
      vetoedCount: 0,
      scoredCount: 0,
      strategyBreakdown: {},
      matchRate: 0,
      averageScore: 0,
      llmAnalysis: null,
      diagnosedAt: result.diagnosedAt
    });
    expect(llmClient.completeText).not.toHaveBeenCalled();
  });

  it("diagnoseBatch skips llm when scoredCount is below 3", async () => {
    const storage = new MemoryStorage();
    const llmClient = createTextClient("{\"patternSummary\":\"unused\",\"possibleMismatch\":null,\"searchSuggestions\":[]}");
    const api = createCoreApi({ client: createClient(), storage });

    orchestrationMocks.evaluateJob
      .mockResolvedValueOnce({ vetoed: false, score: buildScoredResult(80, "personalize") })
      .mockResolvedValueOnce({ vetoed: false, score: buildScoredResult(62, "review") });

    await api.evaluateJobFromJd({
      jdText: "JD 1",
      jobBase: { title: "前端1", company: "公司1", city: "上海", salaryK: [20, 30], companyTags: [] }
    });
    await api.evaluateJobFromJd({
      jdText: "JD 2",
      jobBase: { title: "前端2", company: "公司2", city: "杭州", salaryK: [20, 30], companyTags: [] }
    });

    const result = await api.diagnoseBatch(llmClient);

    expect(result.scoredCount).toBe(2);
    expect(result.matchRate).toBe(0.5);
    expect(result.averageScore).toBe(71);
    expect(result.llmAnalysis).toBeNull();
    expect(llmClient.completeText).not.toHaveBeenCalled();
  });

  it("diagnoseBatch calls llm once and parses llmAnalysis when scoredCount reaches 3", async () => {
    const storage = new MemoryStorage();
    const llmClient = createTextClient(
      JSON.stringify({
        patternSummary: "大多数岗位集中在前端通用开发，城市主要在上海和杭州。",
        possibleMismatch: "高分岗位偏业务前端，和用户若偏平台方向可能有轻微错位。",
        searchSuggestions: ["补充平台前端关键词", "增加 TypeScript 工程化岗位", "扩大杭州周边城市"]
      })
    );
    const api = createCoreApi({ client: createClient(), storage });

    orchestrationMocks.evaluateJob
      .mockResolvedValueOnce({ vetoed: false, score: buildScoredResult(88, "personalize") })
      .mockResolvedValueOnce({ vetoed: false, score: buildScoredResult(74, "generic_apply") })
      .mockResolvedValueOnce({ vetoed: false, score: buildScoredResult(51, "review") });

    await api.evaluateJobFromJd({
      jdText: "JD 1",
      jobBase: { title: "前端1", company: "公司1", city: "上海", salaryK: [20, 30], companyTags: [] }
    });
    await api.evaluateJobFromJd({
      jdText: "JD 2",
      jobBase: { title: "前端2", company: "公司2", city: "杭州", salaryK: [20, 30], companyTags: [] }
    });
    await api.evaluateJobFromJd({
      jdText: "JD 3",
      jobBase: { title: "前端3", company: "公司3", city: "苏州", salaryK: [20, 30], companyTags: [] }
    });

    const result = await api.diagnoseBatch(llmClient);

    expect(llmClient.completeText).toHaveBeenCalledTimes(1);
    expect(result.totalJobsInLibrary).toBe(3);
    expect(result.evaluatedCount).toBe(3);
    expect(result.scoredCount).toBe(3);
    expect(result.vetoedCount).toBe(0);
    expect(result.strategyBreakdown).toEqual({
      personalize: 1,
      generic_apply: 1,
      review: 1
    });
    expect(result.matchRate).toBe(0.667);
    expect(result.averageScore).toBe(71);
    expect(result.llmAnalysis).toEqual({
      patternSummary: "大多数岗位集中在前端通用开发，城市主要在上海和杭州。",
      possibleMismatch: "高分岗位偏业务前端，和用户若偏平台方向可能有轻微错位。",
      searchSuggestions: ["补充平台前端关键词", "增加 TypeScript 工程化岗位", "扩大杭州周边城市"]
    });
  });

  it("diagnoseBatch degrades to null llmAnalysis on invalid llm json without throwing", async () => {
    const storage = new MemoryStorage();
    const llmClient = createTextClient("not json");
    const api = createCoreApi({ client: createClient(), storage });

    orchestrationMocks.evaluateJob
      .mockResolvedValueOnce({ vetoed: false, score: buildScoredResult(88, "personalize") })
      .mockResolvedValueOnce({ vetoed: false, score: buildScoredResult(74, "generic_apply") })
      .mockResolvedValueOnce({ vetoed: false, score: buildScoredResult(51, "review") });

    await api.evaluateJobFromJd({
      jdText: "JD 1",
      jobBase: { title: "前端1", company: "公司1", city: "上海", salaryK: [20, 30], companyTags: [] }
    });
    await api.evaluateJobFromJd({
      jdText: "JD 2",
      jobBase: { title: "前端2", company: "公司2", city: "杭州", salaryK: [20, 30], companyTags: [] }
    });
    await api.evaluateJobFromJd({
      jdText: "JD 3",
      jobBase: { title: "前端3", company: "公司3", city: "苏州", salaryK: [20, 30], companyTags: [] }
    });

    const result = await api.diagnoseBatch(llmClient);

    expect(result.llmAnalysis).toBeNull();
    expect(llmClient.completeText).toHaveBeenCalledTimes(1);
  });
});
