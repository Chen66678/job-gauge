import { describe, expect, it, vi } from "vitest";
import type { OpenAiCompatibleLlmClient } from "../domain/llmClient";
import { draftApplicationMaterial } from "../domain/materialDrafting";
import type { JobPosting, ProfileFact, RequirementResult, ScoreResult, UserProfile } from "../types";

function createMockClient(response: string): OpenAiCompatibleLlmClient {
  return {
    completeText: vi.fn(async () => response),
    completeVision: vi.fn(async () => {
      throw new Error("completeVision should not be used for material drafting");
    })
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
    status: input.status ?? "confirmed",
    confidence: input.confidence ?? 0.9
  };
}

function buildProfile(facts: ProfileFact[]): UserProfile {
  return {
    id: "profile-1",
    displayName: "测试候选人",
    headline: "前端工程师",
    targetRoles: [],
    targetCities: [],
    resumeText: "",
    facts
  };
}

function buildRequirementResult(overrides: Partial<RequirementResult> = {}): RequirementResult {
  return {
    requirementId: "req-1",
    label: "React 组件开发",
    kind: "skill",
    score: 0.8,
    maxScore: 0.8,
    matchedFactIds: ["fact-react"],
    blockedFactIds: [],
    gap: null,
    evidence: "JD 明确要求 React 组件开发。",
    ...overrides
  };
}

function buildScoreResult(requirements: RequirementResult[]): ScoreResult {
  return {
    total: 82,
    strategy: "personalize",
    strategyLabel: "高价值精投",
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
    jdText: "负责 React 和 TypeScript 开发。",
    requirements: [],
    risks: [],
    reviewFlags: [],
    pinned: false,
    workAddress: null,
    sourceUrl: null
  };
}

describe("draftApplicationMaterial", () => {
  it("keeps traced resume lines and builds usedFacts from confirmed facts", async () => {
    const profile = buildProfile([
      buildFact({ id: "fact-react", label: "React", value: "负责 React 组件开发" }),
      buildFact({ id: "fact-ts", label: "TypeScript", value: "使用 TypeScript 开发数据看板" })
    ]);
    const scoreResult = buildScoreResult([
      buildRequirementResult({
        requirementId: "req-react",
        label: "React 组件开发",
        matchedFactIds: ["fact-react"]
      }),
      buildRequirementResult({
        requirementId: "req-ts",
        label: "TypeScript 项目经验",
        matchedFactIds: ["fact-ts"],
        evidence: "JD 要求 TypeScript 项目经验。"
      })
    ]);
    const client = createMockClient(
      JSON.stringify({
        greeting: "您好，我有 React 和 TypeScript 项目经验，想进一步了解这个岗位。",
        resumeLines: [
          {
            text: "负责 React 组件开发与页面交互实现。",
            factIds: ["fact-react"]
          },
          {
            text: "使用 TypeScript 开发数据看板并整理页面逻辑。",
            factIds: ["fact-ts"]
          }
        ]
      })
    );

    const result = await draftApplicationMaterial({
      profile,
      job: buildJob(),
      scoreResult,
      client
    });

    expect(client.completeText).toHaveBeenCalledWith(
      expect.objectContaining({
        responseFormatJson: true
      })
    );
    expect(result.status).toBe("ready");
    expect(result.resumeLines).toEqual([
      { text: "负责 React 组件开发与页面交互实现。", factIds: ["fact-react"] },
      { text: "使用 TypeScript 开发数据看板并整理页面逻辑。", factIds: ["fact-ts"] }
    ]);
    expect(result.usedFacts).toEqual([
      {
        factId: "fact-react",
        label: "React",
        value: "负责 React 组件开发",
        source: "简历 - 测试事实"
      },
      {
        factId: "fact-ts",
        label: "TypeScript",
        value: "使用 TypeScript 开发数据看板",
        source: "简历 - 测试事实"
      }
    ]);
    expect(result.guardrailNotes).toEqual(["打招呼语需用户发送前自查,确认未引入确认事实之外的硬信息。"]);
  });

  it("drops untraceable lines for nonexistent or unconfirmed fact ids", async () => {
    const profile = buildProfile([
      buildFact({ id: "fact-react", label: "React", value: "负责 React 组件开发", status: "confirmed" }),
      buildFact({ id: "fact-node", label: "Node", value: "做过 Node 服务开发", status: "unconfirmed" })
    ]);
    const scoreResult = buildScoreResult([
      buildRequirementResult({
        requirementId: "req-react",
        matchedFactIds: ["fact-react"]
      })
    ]);
    const client = createMockClient(
      JSON.stringify({
        greeting: "您好，我有相关项目经验。",
        resumeLines: [
          {
            text: "负责 React 组件开发。",
            factIds: ["fact-react"]
          },
          {
            text: "做过 Node 服务端开发。",
            factIds: ["fact-node"]
          },
          {
            text: "带领跨团队项目。",
            factIds: ["fact-missing"]
          }
        ]
      })
    );

    const result = await draftApplicationMaterial({
      profile,
      job: buildJob(),
      scoreResult,
      client
    });

    expect(result.resumeLines).toEqual([{ text: "负责 React 组件开发。", factIds: ["fact-react"] }]);
    expect(result.usedFacts).toEqual([
      {
        factId: "fact-react",
        label: "React",
        value: "负责 React 组件开发",
        source: "简历 - 测试事实"
      }
    ]);
    expect(result.status).toBe("needs_review");
    expect(result.guardrailNotes).toContain("已丢弃 2 行无溯源材料表达。");
  });

  it("blocks without confirmed facts and skips llm", async () => {
    const profile = buildProfile([
      buildFact({ id: "fact-node", label: "Node", value: "做过 Node 服务开发", status: "unconfirmed" })
    ]);
    const client = createMockClient("{\"greeting\":\"\",\"resumeLines\":[]}");

    const result = await draftApplicationMaterial({
      profile,
      job: buildJob(),
      scoreResult: buildScoreResult([]),
      client
    });

    expect(result).toEqual({
      status: "blocked",
      greeting: "",
      resumeLines: [],
      usedFacts: [],
      blockedFacts: [],
      guardrailNotes: ["无已确认事实,无法生成材料。"]
    });
    expect(client.completeText).not.toHaveBeenCalled();
  });

  it("marks unsupported requirements in guardrail notes and needs review", async () => {
    const profile = buildProfile([buildFact({ id: "fact-react", label: "React", value: "负责 React 组件开发" })]);
    const scoreResult = buildScoreResult([
      buildRequirementResult({
        requirementId: "req-react",
        label: "React 组件开发",
        matchedFactIds: ["fact-react"],
        gap: null
      }),
      buildRequirementResult({
        requirementId: "req-ts",
        label: "TypeScript 项目经验",
        matchedFactIds: [],
        gap: "缺少匹配证据",
        evidence: "JD 要求 TypeScript 项目经验。"
      })
    ]);
    const client = createMockClient(
      JSON.stringify({
        greeting: "您好，我有 React 项目经验。",
        resumeLines: [
          {
            text: "负责 React 组件开发。",
            factIds: ["fact-react"]
          }
        ]
      })
    );

    const result = await draftApplicationMaterial({
      profile,
      job: buildJob(),
      scoreResult,
      client
    });

    expect(result.status).toBe("needs_review");
    expect(result.guardrailNotes).toContain("TypeScript 项目经验无确认事实支撑,未纳入材料。");
  });

  it("D032：机制层不再做字面词匹配丢行，只要 factIds 可溯源就保留（强度判断交给 prompt，不在机制层）", async () => {
    // 这条曾断言机制层会拦"精通/主导"等词（AMPLIFICATION_PATTERNS）。D032 已裁定删除该正则：
    // 它与 D005"换专业术语命名真做过的事"结构性冲突，且丢弃是静默的。
    // 现在机制层只负责 factId 溯源，强度判断完全交给 prompt + 用户输出侧过目。
    const profile = buildProfile([
      buildFact({ id: "fact-react", label: "React", value: "用过 React 写过一个页面" })
    ]);
    const scoreResult = buildScoreResult([
      buildRequirementResult({ requirementId: "req-react", matchedFactIds: ["fact-react"] })
    ]);
    const client = createMockClient(
      JSON.stringify({
        greeting: "您好。",
        resumeLines: [{ text: "精通 React，主导过多个项目架构设计。", factIds: ["fact-react"] }]
      })
    );

    const result = await draftApplicationMaterial({ profile, job: buildJob(), scoreResult, client });

    expect(result.resumeLines).toEqual([{ text: "精通 React，主导过多个项目架构设计。", factIds: ["fact-react"] }]);
  });

  it("D032：机制层不再检查限定词是否被丢弃，只要 factIds 可溯源就保留", async () => {
    const profile = buildProfile([
      buildFact({ id: "fact-course", label: "算法", value: "在课程项目里实现过排序算法" })
    ]);
    const scoreResult = buildScoreResult([
      buildRequirementResult({ requirementId: "req-algo", matchedFactIds: ["fact-course"] })
    ]);

    const amplifiedClient = createMockClient(
      JSON.stringify({
        greeting: "您好。",
        resumeLines: [{ text: "资深算法工程师，精通排序算法架构设计。", factIds: ["fact-course"] }]
      })
    );
    const amplifiedResult = await draftApplicationMaterial({
      profile,
      job: buildJob(),
      scoreResult,
      client: amplifiedClient
    });
    expect(amplifiedResult.resumeLines).toEqual([
      { text: "资深算法工程师，精通排序算法架构设计。", factIds: ["fact-course"] }
    ]);
  });

  it("gracefully blocks on garbage or empty json", async () => {
    const profile = buildProfile([buildFact({ id: "fact-react", label: "React", value: "负责 React 组件开发" })]);
    const scoreResult = buildScoreResult([buildRequirementResult()]);
    const garbageClient = createMockClient("not json");
    const emptyClient = createMockClient("");

    await expect(
      draftApplicationMaterial({
        profile,
        job: buildJob(),
        scoreResult,
        client: garbageClient
      })
    ).resolves.toEqual({
      status: "blocked",
      greeting: "",
      resumeLines: [],
      usedFacts: [],
      blockedFacts: [],
      guardrailNotes: ["材料生成失败: 模型返回无法解析,请稍后重试。"]
    });
    await expect(
      draftApplicationMaterial({
        profile,
        job: buildJob(),
        scoreResult,
        client: emptyClient
      })
    ).resolves.toEqual({
      status: "blocked",
      greeting: "",
      resumeLines: [],
      usedFacts: [],
      blockedFacts: [],
      guardrailNotes: ["材料生成失败: 模型返回无法解析,请稍后重试。"]
    });
  });
});
