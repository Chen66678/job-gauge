import { describe, expect, it, vi } from "vitest";
import { extractFactsFromResume } from "../domain/resumeExtraction";
import type { OpenAiCompatibleLlmClient } from "../domain/llmClient";

function createMockClient(overrides: Partial<Pick<OpenAiCompatibleLlmClient, "completeText" | "completeVision">> = {}): OpenAiCompatibleLlmClient {
  return {
    completeText: vi.fn(async () => "{\"facts\":[]}"),
    completeVision: vi.fn(async () => "{\"facts\":[]}"),
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
        sourceRef: "测试文本简历",
        status: "unconfirmed",
        confidence: 0.93
      },
      {
        id: "fact-resume-2-项目-数据看板项目",
        category: "项目",
        label: "数据看板项目",
        value: "负责课程数据可视化看板",
        sourceType: "resume",
        sourceRef: "测试文本简历",
        status: "unconfirmed",
        confidence: 0.81
      }
    ]);
    expect(new Set(facts.map((fact) => fact.id)).size).toBe(facts.length);
    expect(facts.every((fact) => fact.status === "unconfirmed")).toBe(true);
    expect(facts.every((fact) => fact.sourceType === "resume")).toBe(true);
  });

  it("uses completeVision for image input and passes json mode", async () => {
    const client = createMockClient({
      completeVision: vi.fn(async () =>
        JSON.stringify({
          facts: [
            {
              category: "教育",
              label: "本科",
              value: "软件工程本科",
              confidence: 0.88
            }
          ]
        })
      )
    });

    const facts = await extractFactsFromResume({
      kind: "image",
      imageBase64: "abc123",
      mimeType: "image/png",
      sourceRef: "测试图片简历",
      client
    });

    expect(client.completeVision).toHaveBeenCalledTimes(1);
    expect(client.completeText).not.toHaveBeenCalled();
    expect(client.completeVision).toHaveBeenCalledWith({
      system: expect.stringContaining("json"),
      user: expect.any(String),
      imageBase64: "abc123",
      mimeType: "image/png",
      responseFormatJson: true
    });
    expect(facts).toEqual([
      {
        id: "fact-resume-1-教育-本科",
        category: "教育",
        label: "本科",
        value: "软件工程本科",
        sourceType: "resume",
        sourceRef: "测试图片简历",
        status: "unconfirmed",
        confidence: 0.88
      }
    ]);
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
        sourceRef: "测试简历",
        status: "unconfirmed",
        confidence: 1
      }
    ]);
  });
});
