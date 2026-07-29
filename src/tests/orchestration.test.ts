import { describe, expect, it, vi } from "vitest";
import type { OpenAiCompatibleLlmClient } from "../domain/llmClient";
import {
  applyFollowUpAnswers,
  assembleJobPosting,
  buildFollowUps,
  draftMaterial,
  evaluateJob,
  ingestJd,
  ingestPreferences,
  ingestResume,
  runFullChainForDemo
} from "../domain/orchestration";
import type { JobPosting, ProfileFact, ScoreResult, UserProfile } from "../types";

function createMockClient(responses: string[]): OpenAiCompatibleLlmClient {
  const completeText = vi.fn<(_: { system?: string; user: string; responseFormatJson?: boolean }) => Promise<string>>();
  for (const response of responses) {
    completeText.mockResolvedValueOnce(response);
  }
  return {
    completeText,
    completeVision: vi.fn(async () => {
      throw new Error("completeVision should not be used in these orchestration tests");
    })
  } as unknown as OpenAiCompatibleLlmClient;
}

function createDispatchClient(handler: (input: { system?: string; user: string; responseFormatJson?: boolean }) => Promise<string> | string): OpenAiCompatibleLlmClient {
  return {
    completeText: vi.fn(async (input) => handler(input)),
    completeVision: vi.fn(async () => {
      throw new Error("completeVision should not be used in these orchestration tests");
    })
  } as unknown as OpenAiCompatibleLlmClient;
}

function buildProfile(facts: ProfileFact[]): UserProfile {
  return {
    id: "profile-1",
    displayName: "测试候选人",
    headline: "前端工程师",
    targetRoles: [],
    targetCities: [],
    resumeText: "测试简历",
    facts
  };
}

function buildFact(input: Partial<ProfileFact> & Pick<ProfileFact, "id" | "label" | "value">): ProfileFact {
  return {
    id: input.id,
    category: input.category ?? "技能",
    label: input.label,
    value: input.value,
    sourceType: input.sourceType ?? "resume",
    sourceRef: input.sourceRef ?? "测试事实",
    status: input.status ?? "confirmed",
    confidence: input.confidence ?? 0.9
  };
}

function buildJob(overrides: Partial<JobPosting> = {}): JobPosting {
  return {
    id: "job-1",
    title: "前端工程师",
    company: "样例科技",
    city: "上海",
    salaryK: [20, 30],
    companyTags: ["SaaS"],
    jdText: "负责 React 和 TypeScript 开发。",
    requirements: [],
    risks: [],
    reviewFlags: [],
    pinned: false,
    workAddress: null,
    sourceUrl: null,
    ...overrides
  };
}

function buildScoreResult(): ScoreResult {
  return {
    total: 82,
    strategy: "review",
    strategyLabel: "需要人工复核",
    summary: "测试总结",
    breakdown: {
      requirements: [
        {
          requirementId: "req-react",
          label: "React 组件开发",
          kind: "skill",
          score: 0.8,
          maxScore: 0.8,
          matchedFactIds: ["fact-react"],
          blockedFactIds: [],
          gap: null,
          evidence: "JD 明确要求 React。"
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

describe("orchestration", () => {
  it("wires ingestResume to resume extraction", async () => {
    const client = createMockClient([
      JSON.stringify({
        facts: [
          {
            category: "技能",
            label: "React",
            value: "负责 React 组件开发",
            confidence: 0.92
          }
        ]
      })
    ]);

    const facts = await ingestResume({
      resume: { kind: "text", resumeText: "负责 React 组件开发。" },
      client
    });

    expect(facts).toEqual([
      {
        id: "fact-resume-1-技能-react",
        category: "技能",
        label: "React",
        value: "负责 React 组件开发",
        sourceType: "resume",
        sourceRef: "resume_text",
        status: "unconfirmed",
        confidence: 0.92
      }
    ]);
  });

  it("wires ingestJd, ingestPreferences, assembleJobPosting, followUps, and follow-up answer ingestion", async () => {
    const stagedResponses = [
      JSON.stringify({
        requirements: [
          {
            kind: "skill",
            label: "React 组件开发",
            evidence: "JD 明确要求 React。",
            weight: 0.8
          }
        ],
        risks: [
          {
            label: "节奏较快",
            severity: "medium",
            evidence: "JD 同时覆盖多个职责。"
          }
        ]
      }),
      JSON.stringify({
        soft: {
          targetCities: ["上海"],
          minSalaryK: 20,
          preferCompanyTags: ["SaaS"],
          excludedKeywords: [],
          riskSensitivity: "mild"
        },
        veto: []
      }),
      JSON.stringify({
        questions: [
          {
            requirementId: "req-jd-1-skill-react-组件开发",
            kind: "explore",
            question: "你是否主导过 React 组件开发？",
            rationale: "进一步确认真实项目深度。"
          }
        ]
      })
    ];
    let stageIndex = 0;
    const client = createDispatchClient(async (input) => {
      if (stageIndex < stagedResponses.length) {
        return stagedResponses[stageIndex++]!;
      }
      const prompt = JSON.parse(input.user);
      const questionId = prompt.answeredQuestions?.[0]?.questionId;
      return JSON.stringify({
        facts: [
          {
            category: "项目",
            label: "React 组件开发",
            value: "主导过 React 组件开发和页面拆分",
            confidence: 0.9,
            fromQuestionId: questionId
          }
        ]
      });
    });

    const jd = await ingestJd({ jdText: "要求 React 组件开发。", client });
    const preferencesResult = await ingestPreferences({ acceptText: "想去上海,20k以上", vetoText: "", client });
    const job = assembleJobPosting({
      base: {
        title: "前端工程师",
        company: "样例科技",
        city: "上海",
        salaryK: [20, 30],
        companyTags: ["SaaS"],
        jdText: "要求 React 组件开发。"
      },
      requirements: jd.requirements,
      risks: jd.risks
    });
    const questions = await buildFollowUps({
      job,
      scoreResult: {
        total: 60,
        strategy: "review",
        strategyLabel: "需要人工复核",
        summary: "测试",
        breakdown: {
          requirements: [
            {
              requirementId: jd.requirements[0].id,
              label: jd.requirements[0].label,
              kind: jd.requirements[0].kind,
              score: 0,
              maxScore: jd.requirements[0].weight,
              matchedFactIds: [],
              blockedFactIds: [],
              gap: "缺少匹配证据",
              evidence: jd.requirements[0].evidence
            }
          ],
          preference: 0,
          riskPenalty: 0,
          reviewPenalty: 0
        },
        gaps: [],
        risks: [],
        reviewFlags: []
      },
      client
    });
    const parsedFacts = await applyFollowUpAnswers({
      questions,
      answers: [{ questionId: questions[0].id, answerText: "对,我主导过 React 组件开发。" }],
      client
    });

    expect(preferencesResult.preferences.targetCities).toEqual(["上海"]);
    expect(job.requirements).toHaveLength(1);
    expect(job.risks).toHaveLength(1);
    expect(questions).toHaveLength(1);
    expect(parsedFacts).toEqual([
      {
        id: expect.stringMatching(/^fact-followup-1-/),
        category: "项目",
        label: "React 组件开发",
        value: "主导过 React 组件开发和页面拆分",
        sourceType: "user_answer",
        sourceRef: expect.stringMatching(/^反问:/),
        status: "unconfirmed",
        confidence: 0.9
      }
    ]);
  });

  it("short-circuits evaluateJob on hard veto without calling llm scoring", async () => {
    const client = createMockClient([]);
    const result = await evaluateJob({
      profile: buildProfile([buildFact({ id: "fact-react", label: "React", value: "负责 React 开发" })]),
      job: buildJob({ city: "上海" }),
      client,
      hardVeto: {
        rules: [
          {
            id: "veto-1",
            label: "只去北京",
            kind: "city",
            matchTerms: ["北京"],
            evidence: "只去北京"
          }
        ]
      }
    });

    expect(result).toEqual({
      vetoed: true,
      vetoRule: {
        id: "veto-1",
        label: "只去北京",
        kind: "city",
        matchTerms: ["北京"],
        evidence: "只去北京"
      }
    });
    expect(client.completeText).not.toHaveBeenCalled();
  });

  it("calls llm scoring when evaluateJob is not vetoed", async () => {
    const client = createMockClient([
      JSON.stringify({
        matches: [
          {
            requirementId: "req-react",
            matchLevel: "direct",
            factIds: ["fact-react"],
            reason: "confirmed match"
          }
        ]
      })
    ]);
    const result = await evaluateJob({
      profile: buildProfile([buildFact({ id: "fact-react", label: "React", value: "负责 React 开发" })]),
      job: buildJob({
        requirements: [
          {
            id: "req-react",
            kind: "skill",
            label: "React",
            evidence: "JD 要求 React。",
            requiredFactIds: [],
            weight: 0.8
          }
        ]
      }),
      client
    });

    expect(result.vetoed).toBe(false);
    if (result.vetoed) throw new Error("expected non-vetoed result");
    expect(result.score.total).toBe(100);
    expect(client.completeText).toHaveBeenCalledTimes(1);
  });

  it("runs the full demo chain and uses confirmed facts when confirmAllFacts=true", async () => {
    const client = createMockClient([
      JSON.stringify({
        facts: [
          {
            category: "技能",
            label: "React",
            value: "负责 React 组件开发",
            confidence: 0.95
          }
        ]
      }),
      JSON.stringify({
        requirements: [
          {
            kind: "skill",
            label: "React 组件开发",
            evidence: "JD 明确要求 React。",
            weight: 0.8
          }
        ],
        risks: []
      }),
      JSON.stringify({
        soft: {
          targetCities: ["上海"],
          minSalaryK: 20,
          preferCompanyTags: ["SaaS"],
          excludedKeywords: [],
          riskSensitivity: "mild"
        },
        veto: []
      }),
      JSON.stringify({
        matches: [
          {
            requirementId: "req-jd-1-skill-react-组件开发",
            matchLevel: "direct",
            factIds: ["fact-resume-1-技能-react"],
            reason: "confirmed match"
          }
        ]
      }),
      JSON.stringify({
        greeting: "您好，我有 React 组件开发经验，想进一步了解这个岗位。",
        resumeLines: [
          {
            text: "负责 React 组件开发与页面交互实现。",
            factIds: ["fact-resume-1-技能-react"]
          }
        ]
      })
    ]);

    const result = await runFullChainForDemo({
      resume: { kind: "text", resumeText: "负责 React 组件开发。" },
      jdText: "要求 React 组件开发。",
      jobBase: {
        title: "前端工程师",
        company: "样例科技",
        city: "上海",
        salaryK: [20, 30],
        companyTags: ["SaaS"]
      },
      acceptText: "想去上海",
      vetoText: "",
      confirmAllFacts: true,
      client
    });

    expect(result.facts).toHaveLength(1);
    expect(result.requirements).toHaveLength(1);
    expect(result.job.requirements).toHaveLength(1);
    expect(result.evaluation.vetoed).toBe(false);
    if (result.evaluation.vetoed) throw new Error("expected non-vetoed evaluation");
    expect(result.evaluation.score.total).toBe(100);
    expect(result.followUps).toEqual([]);
    expect(result.material).toEqual({
      status: "ready",
      greeting: "您好，我有 React 组件开发经验，想进一步了解这个岗位。",
      resumeLines: [
        { text: "负责 React 组件开发与页面交互实现。", factIds: ["fact-resume-1-技能-react"] }
      ],
      usedFacts: [
        {
          factId: "fact-resume-1-技能-react",
          label: "React",
          value: "负责 React 组件开发",
          source: "简历 - resume_text"
        }
      ],
      blockedFacts: [],
      guardrailNotes: ["打招呼语需用户发送前自查,确认未引入确认事实之外的硬信息。"]
    });
    expect(client.completeText).toHaveBeenCalledTimes(5);
  });

  it("draftMaterial delegates to material drafting", async () => {
    const client = createMockClient([
      JSON.stringify({
        greeting: "您好，我有 React 项目经验。",
        resumeLines: [{ text: "负责 React 组件开发。", factIds: ["fact-react"] }]
      })
    ]);

    const material = await draftMaterial({
      profile: buildProfile([buildFact({ id: "fact-react", label: "React", value: "负责 React 开发" })]),
      job: buildJob(),
      scoreResult: buildScoreResult(),
      client
    });

    expect(material.resumeLines).toEqual([{ text: "负责 React 组件开发。", factIds: ["fact-react"] }]);
  });
});
