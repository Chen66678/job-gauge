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
    expect(new Set(facts.map((fact) => fact.id)).size).toBe(facts.length);
    expect(facts.every((fact) => fact.status === "unconfirmed")).toBe(true);
    expect(facts.every((fact) => fact.sourceType === "resume")).toBe(true);
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

  it("[D025 回归锁] 粒度规则要求按语境合并同一项目/工作的多条 bullet 为一张完整卡片，且禁止压缩改写；不得残留旧的逐条硬拆规则", async () => {
    const client = createMockClient();

    await extractFactsFromResume({
      kind: "text",
      resumeText: "占位简历文本",
      sourceRef: "测试简历",
      client
    });

    const call = (client.completeText as unknown as { mock: { calls: Array<[{ system?: string }]> } }).mock.calls[0][0];
    expect(call.system).toContain("merge them into ONE fact item");
    expect(call.system).toContain("Do not paraphrase, compress, summarize, or rewrite");
    expect(call.system).not.toContain("extract EACH bullet as its own separate fact item");
    expect(call.system).not.toContain("Never merge two or more bullets");
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
    expect(call.system).toContain("NEVER apply it across two different jobs or two different projects");
    expect(call.system).toContain("This rule never applies to jobs, projects, skills, or any experience narrative");
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
