import { describe, expect, it, vi } from "vitest";
import type { OpenAiCompatibleLlmClient } from "../domain/llmClient";
import { generateFollowUpQuestions, ingestFollowUpAnswers } from "../domain/followUp";
import type { JobPosting, RequirementResult, ScoreResult } from "../types";

function createMockClient(response: string): OpenAiCompatibleLlmClient {
  return {
    completeText: vi.fn(async () => response),
    completeVision: vi.fn(async () => {
      throw new Error("completeVision should not be used for follow-up");
    })
  } as unknown as OpenAiCompatibleLlmClient;
}

function buildRequirementResult(overrides: Partial<RequirementResult> = {}): RequirementResult {
  return {
    requirementId: "req-1",
    label: "React 后台项目",
    kind: "experience",
    score: 0,
    maxScore: 0.6,
    matchedFactIds: [],
    blockedFactIds: [],
    gap: "缺少匹配证据",
    evidence: "JD 要求有 React 后台项目经验。",
    ...overrides
  };
}

function buildScoreResult(requirements: RequirementResult[]): ScoreResult {
  return {
    total: 0,
    strategy: "review",
    strategyLabel: "需要人工复核",
    summary: "测试总结",
    breakdown: {
      requirements,
      preference: 0,
      riskPenalty: 0,
      reviewPenalty: 0
    },
    gaps: requirements.filter((item) => item.gap).map((item) => `${item.label}: ${item.gap}`),
    risks: [],
    reviewFlags: []
  };
}

function buildJob(): JobPosting {
  return {
    id: "job-1",
    title: "前端工程师",
    company: "样例科技",
    city: "上海",
    salaryK: [20, 30],
    companyTags: [],
    jdText: "负责 React 和后台系统开发。",
    requirements: [],
    risks: [],
    reviewFlags: []
  };
}

describe("generateFollowUpQuestions", () => {
  it("builds probe and explore questions, enforces real requirement ids, and respects maxQuestions", async () => {
    const scoreResult = buildScoreResult([
      buildRequirementResult({
        requirementId: "req-implied",
        label: "TypeScript 项目经验",
        gap: "疑似具备,建议反问确认"
      }),
      buildRequirementResult({
        requirementId: "req-none",
        label: "React 后台项目",
        gap: "缺少匹配证据"
      })
    ]);
    const client = createMockClient(
      JSON.stringify({
        questions: [
          {
            requirementId: "req-implied",
            kind: "explore",
            question: "你之前做的数据看板项目里，是否实际用过 TypeScript 负责核心页面或组件？",
            rationale: "简历可能已有前端项目线索，适合进一步确认。"
          },
          {
            requirementId: "req-none",
            kind: "probe",
            question: "你有做过基于 React 的后台系统或管理台项目吗？",
            rationale: "当前缺少后台项目证据，需要直接确认。"
          },
          {
            requirementId: "req-fake",
            kind: "probe",
            question: "这条是编造 requirementId。",
            rationale: "应该被丢弃。"
          }
        ]
      })
    );

    const questions = await generateFollowUpQuestions({
      job: buildJob(),
      scoreResult,
      client,
      maxQuestions: 2
    });

    expect(client.completeText).toHaveBeenCalledWith(
      expect.objectContaining({
        responseFormatJson: true
      })
    );
    expect(questions).toEqual([
      {
        id: expect.stringMatching(/^followup-q-1-/),
        requirementId: "req-implied",
        kind: "probe",
        question: "你之前做的数据看板项目里，是否实际用过 TypeScript 负责核心页面或组件？",
        rationale: "简历可能已有前端项目线索，适合进一步确认。"
      },
      {
        id: expect.stringMatching(/^followup-q-2-/),
        requirementId: "req-none",
        kind: "explore",
        question: "你有做过基于 React 的后台系统或管理台项目吗？",
        rationale: "当前缺少后台项目证据，需要直接确认。"
      }
    ]);
  });

  it("returns [] and does not call llm when every requirement is already direct", async () => {
    const scoreResult = buildScoreResult([
      buildRequirementResult({
        requirementId: "req-direct",
        label: "React",
        gap: null,
        score: 0.8,
        maxScore: 0.8
      })
    ]);
    const client = createMockClient("{\"questions\":[]}");

    const questions = await generateFollowUpQuestions({
      job: buildJob(),
      scoreResult,
      client
    });

    expect(questions).toEqual([]);
    expect(client.completeText).not.toHaveBeenCalled();
  });

  it("gracefully returns [] on garbage or empty json", async () => {
    const scoreResult = buildScoreResult([buildRequirementResult()]);
    const garbageClient = createMockClient("not json");
    const emptyClient = createMockClient("");

    await expect(
      generateFollowUpQuestions({
        job: buildJob(),
        scoreResult,
        client: garbageClient
      })
    ).resolves.toEqual([]);
    await expect(
      generateFollowUpQuestions({
        job: buildJob(),
        scoreResult,
        client: emptyClient
      })
    ).resolves.toEqual([]);
  });
});

describe("ingestFollowUpAnswers", () => {
  it("extracts user_answer facts from explicit positive answers only", async () => {
    const questions = [
      {
        id: "q-1",
        requirementId: "req-react-admin",
        kind: "explore" as const,
        question: "你有做过基于 React 的后台系统或管理台项目吗？",
        rationale: "当前缺少后台项目证据，需要直接确认。"
      },
      {
        id: "q-2",
        requirementId: "req-node",
        kind: "explore" as const,
        question: "你做过 Node 服务端开发吗？",
        rationale: "确认是否具备服务端经验。"
      }
    ];
    const client = createMockClient(
      JSON.stringify({
        facts: [
          {
            category: "项目",
            label: "React 后台项目",
            value: "用 React 做过后台管理系统页面开发",
            confidence: 0.91,
            fromQuestionId: "q-1"
          }
        ]
      })
    );

    const facts = await ingestFollowUpAnswers({
      questions,
      answers: [
        { questionId: "q-1", answerText: "对,我用React做过后台管理系统页面。" },
        { questionId: "q-2", answerText: "没有,这个我没做过。" }
      ],
      client
    });

    expect(client.completeText).toHaveBeenCalledWith(
      expect.objectContaining({
        responseFormatJson: true
      })
    );
    expect(facts).toEqual([
      {
        id: expect.stringMatching(/^fact-followup-1-/),
        category: "项目",
        label: "React 后台项目",
        value: "用 React 做过后台管理系统页面开发",
        sourceType: "user_answer",
        sourceRef: expect.stringMatching(/^反问:你有做过基于 React 的后台系统/),
        status: "unconfirmed",
        confidence: 0.91
      }
    ]);
  });

  it("drops facts whose fromQuestionId does not match a real input question and handles garbage output", async () => {
    const questions = [
      {
        id: "q-1",
        requirementId: "req-ts",
        kind: "probe" as const,
        question: "你之前项目里是否实际用过 TypeScript？",
        rationale: "进一步确认 TypeScript 线索。"
      }
    ];
    const mismatchClient = createMockClient(
      JSON.stringify({
        facts: [
          {
            category: "技能",
            label: "TypeScript",
            value: "做过 TypeScript 项目",
            confidence: 0.88,
            fromQuestionId: "q-missing"
          }
        ]
      })
    );
    const garbageClient = createMockClient("not json");

    await expect(
      ingestFollowUpAnswers({
        questions,
        answers: [{ questionId: "q-1", answerText: "我不记得了。" }],
        client: mismatchClient
      })
    ).resolves.toEqual([]);
    await expect(
      ingestFollowUpAnswers({
        questions,
        answers: [{ questionId: "q-1", answerText: "对,我用过。" }],
        client: garbageClient
      })
    ).resolves.toEqual([]);
  });
});
