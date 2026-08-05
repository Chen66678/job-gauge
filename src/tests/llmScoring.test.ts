import { describe, expect, it, vi } from "vitest";
import type { OpenAiCompatibleLlmClient } from "../domain/llmClient";
import { DEFAULT_RISK_SENSITIVITY, scoreJobWithLlm } from "../domain/llmScoring";
import type { JobPosting, JobRequirement, JobRisk, ProfileFact, UserProfile } from "../types";

function createMockClient(response: string): OpenAiCompatibleLlmClient {
  return {
    completeText: vi.fn(async () => response),
    completeVision: vi.fn(async () => {
      throw new Error("completeVision should not be used for llm scoring");
    })
  } as unknown as OpenAiCompatibleLlmClient;
}

function buildProfile(facts: ProfileFact[]): UserProfile {
  return {
    id: "profile-1",
    displayName: "测试候选人",
    headline: "前端开发",
    targetRoles: [],
    targetCities: [],
    resumeText: "",
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
    confidence: input.confidence ?? 0.9,
    groupId: input.groupId ?? null,
    summary: input.summary ?? null
  };
}

function buildRequirement(input: Partial<JobRequirement> & Pick<JobRequirement, "id" | "kind" | "label" | "evidence" | "weight">): JobRequirement {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    evidence: input.evidence,
    requiredFactIds: input.requiredFactIds ?? [],
    weight: input.weight
  };
}

function buildRisk(input: Pick<JobRisk, "id" | "label" | "severity" | "evidence">): JobRisk {
  return input;
}

function buildJob(overrides: Partial<JobPosting> = {}): JobPosting {
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
    sourceUrl: null,
    ...overrides
  };
}

describe("scoreJobWithLlm", () => {
  it("scores direct and implied matches with explainable weighted arithmetic", async () => {
    const profile = buildProfile([
      buildFact({ id: "fact-react", label: "React", value: "负责 React 组件开发" }),
      buildFact({ id: "fact-ts", label: "TypeScript", value: "使用 TypeScript 开发数据看板" })
    ]);
    const job = buildJob({
      requirements: [
        buildRequirement({
          id: "req-react",
          kind: "skill",
          label: "React 组件开发",
          evidence: "JD 明确要求 React 组件开发。",
          weight: 0.8
        }),
        buildRequirement({
          id: "req-ts",
          kind: "experience",
          label: "TypeScript 项目经验",
          evidence: "JD 要求 TypeScript 项目经验。",
          weight: 0.5
        })
      ]
    });
    const client = createMockClient(
      JSON.stringify({
        matches: [
          {
            requirementId: "req-react",
            matchLevel: "direct",
            factIds: ["fact-react"],
            reason: "事实明确提到 React 组件开发。"
          },
          {
            requirementId: "req-ts",
            matchLevel: "implied",
            factIds: ["fact-ts"],
            reason: "事实说明使用 TypeScript 做过项目。"
          }
        ]
      })
    );

    const result = await scoreJobWithLlm({ profile, job, client });

    expect(client.completeText).toHaveBeenCalledTimes(1);
    expect(client.completeText).toHaveBeenCalledWith(
      expect.objectContaining({
        responseFormatJson: true
      })
    );
    expect(result.total).toBe(85);
    expect(result.breakdown.requirements).toEqual([
      {
        requirementId: "req-react",
        label: "React 组件开发",
        kind: "skill",
        score: 0.8,
        maxScore: 0.8,
        matchedFactIds: ["fact-react"],
        blockedFactIds: [],
        gap: null,
        evidence: "JD 明确要求 React 组件开发。"
      },
      {
        requirementId: "req-ts",
        label: "TypeScript 项目经验",
        kind: "experience",
        score: 0.3,
        maxScore: 0.5,
        matchedFactIds: ["fact-ts"],
        blockedFactIds: [],
        gap: "疑似具备,建议反问确认",
        evidence: "JD 要求 TypeScript 项目经验。"
      }
    ]);
    expect(result.breakdown.preference).toBe(0);
    expect(result.breakdown.riskPenalty).toBe(0);
    expect(result.breakdown.reviewPenalty).toBe(0);
    expect(result.gaps).toEqual(["TypeScript 项目经验: 疑似具备,建议反问确认"]);
    expect(result.strategy).toBe("review");
  });

  it("enforces integrity locks by filtering nonexistent and unconfirmed fact ids and downgrading unsupported matches", async () => {
    const profile = buildProfile([
      buildFact({ id: "fact-confirmed", label: "React", value: "负责 React 开发", status: "confirmed" }),
      buildFact({ id: "fact-unconfirmed", label: "Node", value: "做过 Node 服务", status: "unconfirmed" })
    ]);
    const job = buildJob({
      requirements: [
        buildRequirement({
          id: "req-a",
          kind: "skill",
          label: "React",
          evidence: "JD 要求 React。",
          weight: 0.7
        }),
        buildRequirement({
          id: "req-b",
          kind: "experience",
          label: "Node 服务经验",
          evidence: "JD 要求 Node 服务经验。",
          weight: 0.4
        }),
        buildRequirement({
          id: "req-c",
          kind: "skill",
          label: "可用确认事实",
          evidence: "JD 要求真实确认事实支撑。",
          weight: 0.3
        })
      ]
    });
    const client = createMockClient(
      JSON.stringify({
        matches: [
          {
            requirementId: "req-a",
            matchLevel: "direct",
            factIds: ["fact-missing"],
            reason: "错误引用不存在的 fact。"
          },
          {
            requirementId: "req-b",
            matchLevel: "direct",
            factIds: ["fact-unconfirmed"],
            reason: "错误引用未确认事实。"
          },
          {
            requirementId: "req-c",
            matchLevel: "direct",
            factIds: ["fact-confirmed", "fact-missing"],
            reason: "部分引用有效。"
          }
        ]
      })
    );

    const result = await scoreJobWithLlm({ profile, job, client });
    const promptPayload = JSON.parse(String((client.completeText as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.user));

    expect(promptPayload.confirmedFacts).toEqual([
      {
        id: "fact-confirmed",
        category: "技能",
        label: "React",
        value: "负责 React 开发"
      }
    ]);
    expect(result.breakdown.requirements).toEqual([
      {
        requirementId: "req-a",
        label: "React",
        kind: "skill",
        score: 0,
        maxScore: 0.7,
        matchedFactIds: [],
        blockedFactIds: [],
        gap: "缺少匹配证据",
        evidence: "JD 要求 React。"
      },
      {
        requirementId: "req-b",
        label: "Node 服务经验",
        kind: "experience",
        score: 0,
        maxScore: 0.4,
        matchedFactIds: [],
        blockedFactIds: [],
        gap: "缺少匹配证据",
        evidence: "JD 要求 Node 服务经验。"
      },
      {
        requirementId: "req-c",
        label: "可用确认事实",
        kind: "skill",
        score: 0.3,
        maxScore: 0.3,
        matchedFactIds: ["fact-confirmed"],
        blockedFactIds: [],
        gap: null,
        evidence: "JD 要求真实确认事实支撑。"
      }
    ]);
  });

  it("defaults missing requirements to none with gaps when the llm omits them", async () => {
    const profile = buildProfile([buildFact({ id: "fact-react", label: "React", value: "React 组件开发" })]);
    const job = buildJob({
      requirements: [
        buildRequirement({
          id: "req-a",
          kind: "skill",
          label: "React",
          evidence: "JD 要求 React。",
          weight: 0.6
        }),
        buildRequirement({
          id: "req-b",
          kind: "experience",
          label: "性能优化",
          evidence: "JD 要求性能优化经验。",
          weight: 0.4
        })
      ]
    });
    const client = createMockClient(
      JSON.stringify({
        matches: [
          {
            requirementId: "req-a",
            matchLevel: "direct",
            factIds: ["fact-react"],
            reason: "React 明确满足。"
          }
        ]
      })
    );

    const result = await scoreJobWithLlm({ profile, job, client });

    expect(result.breakdown.requirements[1]).toEqual({
      requirementId: "req-b",
      label: "性能优化",
      kind: "experience",
      score: 0,
      maxScore: 0.4,
      matchedFactIds: [],
      blockedFactIds: [],
      gap: "缺少匹配证据",
      evidence: "JD 要求性能优化经验。"
    });
    expect(result.gaps).toContain("性能优化: 缺少匹配证据");
  });

  it("gracefully handles garbage model output and returns a legal all-none score result", async () => {
    const profile = buildProfile([buildFact({ id: "fact-react", label: "React", value: "React 组件开发" })]);
    const job = buildJob({
      requirements: [
        buildRequirement({
          id: "req-a",
          kind: "skill",
          label: "React",
          evidence: "JD 要求 React。",
          weight: 1
        })
      ]
    });
    const client = createMockClient("not json");

    const result = await scoreJobWithLlm({ profile, job, client });

    expect(result.total).toBe(0);
    expect(result.breakdown.requirements).toEqual([
      {
        requirementId: "req-a",
        label: "React",
        kind: "skill",
        score: 0,
        maxScore: 1,
        matchedFactIds: [],
        blockedFactIds: [],
        gap: "缺少匹配证据",
        evidence: "JD 要求 React。"
      }
    ]);
    expect(result.strategy).toBe("skip");
  });

  it("returns a legal zero-weight score and default high-risk penalty when requirements are empty", async () => {
    const profile = buildProfile([buildFact({ id: "fact-react", label: "React", value: "React 组件开发" })]);
    const job = buildJob({
      requirements: [],
      risks: [
        buildRisk({
          id: "risk-1",
          label: "高强度加班",
          severity: "high",
          evidence: "JD 提到高强度支持。"
        })
      ]
    });
    const client = createMockClient("{\"matches\":[]}");

    const result = await scoreJobWithLlm({ profile, job, client });

    expect(client.completeText).not.toHaveBeenCalled();
    expect(result.total).toBe(0);
    expect(result.breakdown.requirements).toEqual([]);
    expect(result.breakdown.riskPenalty).toBe(DEFAULT_RISK_SENSITIVITY.high);
    expect(result.breakdown.reviewPenalty).toBe(0);
    expect(result.risks).toEqual(["高强度加班: JD 提到高强度支持。"]);
  });
});
