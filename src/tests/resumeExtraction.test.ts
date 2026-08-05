import { describe, expect, it, vi } from "vitest";
import { extractFactsFromResume } from "../domain/resumeExtraction";
import type { OpenAiCompatibleLlmClient } from "../domain/llmClient";

function createMockClient(overrides: Partial<Pick<OpenAiCompatibleLlmClient, "completeText" | "completeVision">> = {}): OpenAiCompatibleLlmClient {
  return {
    completeText: vi.fn(async () => "{\"facts\":[]}"),
    completeVision: vi.fn(async () => {
      throw new Error("completeVision should not be used for resume extraction");
    }),
    ...overrides
  } as OpenAiCompatibleLlmClient;
}

describe("extractFactsFromResume", () => {
  it("builds unconfirmed resume facts from valid text json", async () => {
    const client = createMockClient({
      completeText: vi.fn(async () =>
        JSON.stringify({
          facts: [
            {
              category: "技能",
              label: "TypeScript",
              value: "使用 TypeScript 开发数据看板",
              confidence: 0.93
            },
            {
              category: "项目",
              label: "数据看板项目",
              value: "负责课程数据可视化看板",
              confidence: 0.81
            }
          ]
        })
      )
    });

    const facts = await extractFactsFromResume({
      kind: "text",
      resumeText: "使用 TypeScript 开发数据看板。",
      sourceRef: "测试文本简历",
      client
    });

    expect(client.completeText).toHaveBeenCalledTimes(1);
    expect(client.completeVision).not.toHaveBeenCalled();
    expect(client.completeText).toHaveBeenCalledWith(
      expect.objectContaining({
        responseFormatJson: true
      })
    );
    expect(facts).toHaveLength(2);
    expect(facts).toEqual([
      {
        id: "fact-resume-1-技能-typescript",
        category: "技能",
        label: "TypeScript",
        value: "使用 TypeScript 开发数据看板",
        sourceType: "resume",
        sourceRef: expect.stringMatching(/^测试文本简历#/),
        status: "unconfirmed",
        confidence: 0.93,
        groupId: null,
        summary: null
      },
      {
        id: "fact-resume-2-项目-数据看板项目",
        category: "项目",
        label: "数据看板项目",
        value: "负责课程数据可视化看板",
        sourceType: "resume",
        sourceRef: expect.stringMatching(/^测试文本简历#/),
        status: "unconfirmed",
        confidence: 0.81,
        groupId: null,
        summary: null
      }
    ]);
  });

  it("[D034] groupKey 相同的多条事实映射到同一个 groupId，并生成对应的 ProfileFactGroup；summary 原样落到 fact.summary", async () => {
    const client = createMockClient({
      completeText: vi.fn(async () =>
        JSON.stringify({
          facts: [
            {
              category: "experience",
              label: "负责后端接口开发",
              value: "在某某科技有限公司负责后端接口开发",
              confidence: 0.9,
              groupKey: "某某科技",
              groupLabel: "某某科技有限公司 · 后端工程师 · 2021年3月-2023年6月",
              summary: "后端接口开发"
            },
            {
              category: "experience",
              label: "推动接口响应耗时下降40%",
              value: "推动核心接口响应耗时下降40%",
              confidence: 0.88,
              groupKey: "某某科技",
              groupLabel: null,
              summary: "接口性能优化"
            },
            {
              category: "skill",
              label: "TypeScript",
              value: "熟练使用 TypeScript",
              confidence: 0.95
            }
          ]
        })
      )
    });

    const { extractFactsAndGroupsFromResume } = await import("../domain/resumeExtraction");
    const { facts, groups } = await extractFactsAndGroupsFromResume({
      kind: "text",
      resumeText: "占位简历文本",
      sourceRef: "测试简历",
      client
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("某某科技有限公司 · 后端工程师 · 2021年3月-2023年6月");

    const grouped = facts.filter((fact) => fact.groupId !== null);
    expect(grouped).toHaveLength(2);
    expect(new Set(grouped.map((fact) => fact.groupId)).size).toBe(1);
    expect(grouped[0].groupId).toBe(groups[0].id);
    expect(grouped.map((fact) => fact.summary)).toEqual(["后端接口开发", "接口性能优化"]);

    const skillFact = facts.find((fact) => fact.category === "skill");
    expect(skillFact?.groupId).toBeNull();
    expect(skillFact?.summary).toBeNull();
  });

  it("[D025 回归锁] 从不调用 completeVision：图片简历入口已砍，只走文本路径", async () => {
    const client = createMockClient();

    await extractFactsFromResume({
      kind: "text",
      resumeText: "使用 TypeScript 开发数据看板。",
      sourceRef: "测试文本简历",
      client
    });

    expect(client.completeVision).not.toHaveBeenCalled();
  });

  it("[D034 回归锁] 粒度规则改为按「一条事实=一件可独立陈述的事」拆细同一工作/项目，且禁止压缩改写；不写死拆分数量", async () => {
    const client = createMockClient();

    await extractFactsFromResume({
      kind: "text",
      resumeText: "占位简历文本",
      sourceRef: "测试简历",
      client
    });

    const call = (client.completeText as unknown as { mock: { calls: Array<[{ system?: string }]> } }).mock.calls[0][0];
    expect(call.system).toContain("one fact item per independently statable thing");
    expect(call.system).toContain("Do not force a fixed number of fact items and do not pad or force-fit");
    expect(call.system).toContain("Do not paraphrase, compress, summarize, or rewrite");
  });

  it("[D025 回归锁] 不同工作/不同项目绝不合并；拆细规则与短字段合并规则结构上完全分离，互相不覆盖对方边界", async () => {
    const client = createMockClient();

    await extractFactsFromResume({
      kind: "text",
      resumeText: "占位简历文本",
      sourceRef: "测试简历",
      client
    });

    const call = (client.completeText as unknown as { mock: { calls: Array<[{ system?: string }]> } }).mock.calls[0][0];
    expect(call.system).toContain("THIS RULE NEVER APPLIES TO merging or comparing across two different jobs or two different projects");
    expect(call.system).toContain("this rule never causes two distinct jobs or two distinct projects to share fact items");
    expect(call.system).toContain("THIS RULE NEVER APPLIES TO jobs, projects, or any experience narrative");
  });

  it("[D034 回归锁] 公司/项目名不得在 label/value/groupLabel 中被缩写，用于阻断向生成层泄露简称", async () => {
    const client = createMockClient();

    await extractFactsFromResume({
      kind: "text",
      resumeText: "占位简历文本",
      sourceRef: "测试简历",
      client
    });

    const call = (client.completeText as unknown as { mock: { calls: Array<[{ system?: string }]> } }).mock.calls[0][0];
    expect(call.system).toContain("NEVER abbreviate, shorten, or use a nickname for a company name or project name inside the label or value field");
    expect(call.system).toContain("NEVER abbreviate, shorten, or use a nickname for the company or project name in groupLabel");
  });

  it("[D034 回归锁] 摘要规则要求与 value 分开生成、允许比 value 更凝练，但不得替代 value 或引入新信息", async () => {
    const client = createMockClient();

    await extractFactsFromResume({
      kind: "text",
      resumeText: "占位简历文本",
      sourceRef: "测试简历",
      client
    });

    const call = (client.completeText as unknown as { mock: { calls: Array<[{ system?: string }]> } }).mock.calls[0][0];
    expect(call.system).toContain("must never be used as a substitute for the value");
    expect(call.system).toContain("must never add information absent from the value");
  });

  it("[D025 第一批补刀 回归锁] 粒度规则要求 personal/job_search 各合并为一张卡、education 按学校合并，且不得为了压数字把不同工作/项目/学校糊在一起", async () => {
    const client = createMockClient();

    await extractFactsFromResume({
      kind: "text",
      resumeText: "占位简历文本",
      sourceRef: "测试简历",
      client
    });

    const call = (client.completeText as unknown as { mock: { calls: Array<[{ system?: string }]> } }).mock.calls[0][0];
    expect(call.system).toContain('Merge ALL personal contact fields');
    expect(call.system).toContain('Merge ALL job-search intent fields');
    expect(call.system).toContain("Merge one school's institution + major + degree + duration into ONE");
    expect(call.system).toContain("THIS RULE NEVER APPLIES TO merging or comparing across two different jobs or two different projects");
    expect(call.system).toContain("THIS RULE NEVER APPLIES TO jobs, projects, or any experience narrative");
  });

  it("returns an empty array for invalid or empty model output", async () => {
    const garbageClient = createMockClient({
      completeText: vi.fn(async () => "not json at all")
    });
    const missingFieldsClient = createMockClient({
      completeText: vi.fn(async () => JSON.stringify({ facts: [{ category: "技能" }] }))
    });
    const emptyClient = createMockClient({
      completeText: vi.fn(async () => "")
    });

    await expect(
      extractFactsFromResume({
        kind: "text",
        resumeText: "React",
        sourceRef: "垃圾输出",
        client: garbageClient
      })
    ).resolves.toEqual([]);
    await expect(
      extractFactsFromResume({
        kind: "text",
        resumeText: "React",
        sourceRef: "缺字段输出",
        client: missingFieldsClient
      })
    ).resolves.toEqual([]);
    await expect(
      extractFactsFromResume({
        kind: "text",
        resumeText: "React",
        sourceRef: "空输出",
        client: emptyClient
      })
    ).resolves.toEqual([]);
  });

  it("filters malformed items, clamps confidence, and keeps valid ones", async () => {
    const client = createMockClient({
      completeText: vi.fn(async () =>
        JSON.stringify({
          facts: [
            {
              category: "技能",
              label: "React",
              value: "参与 React 组件整理",
              confidence: 1.4
            },
            {
              category: "项目",
              label: " ",
              value: "空标签应该被丢弃",
              confidence: 0.6
            }
          ]
        })
      )
    });

    const facts = await extractFactsFromResume({
      kind: "text",
      resumeText: "参与 React 组件整理。",
      sourceRef: "测试简历",
      client
    });

    expect(facts).toEqual([
      {
        id: "fact-resume-1-技能-react",
        category: "技能",
        label: "React",
        value: "参与 React 组件整理",
        sourceType: "resume",
        sourceRef: expect.stringMatching(/^测试简历#/),
        status: "unconfirmed",
        confidence: 1,
        groupId: null,
        summary: null
      }
    ]);
  });
});
