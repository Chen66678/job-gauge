import { describe, expect, it, vi } from "vitest";
import type { OpenAiCompatibleLlmClient } from "../domain/llmClient";
import { extractRequirementsFromJd } from "../domain/jdExtraction";

function createMockClient(overrides: Partial<Pick<OpenAiCompatibleLlmClient, "completeText">> = {}): OpenAiCompatibleLlmClient {
  return {
    completeText: vi.fn(async () => "{\"requirements\":[],\"risks\":[]}"),
    completeVision: vi.fn(async () => {
      throw new Error("completeVision should not be used for jd extraction");
    }),
    ...overrides
  } as unknown as OpenAiCompatibleLlmClient;
}

describe("extractRequirementsFromJd", () => {
  it("builds requirements and risks from valid json and keeps requiredFactIds empty", async () => {
    const client = createMockClient({
      completeText: vi.fn(async () =>
        JSON.stringify({
          requirements: [
            {
              kind: "skill",
              label: "React 组件开发",
              evidence: "JD 提到负责组件建设和前端研发。",
              weight: 0.92
            },
            {
              kind: "experience",
              label: "可展示前端项目经验",
              evidence: "JD 要求有可展示的前端项目。",
              weight: 0.76
            }
          ],
          risks: [
            {
              label: "节奏较快",
              severity: "medium",
              evidence: "JD 同时覆盖组件建设、接口联调和体验优化。"
            }
          ]
        })
      )
    });

    const result = await extractRequirementsFromJd({
      jdText: "负责 React 前端研发、组件建设、接口联调，有可展示项目经验。",
      client
    });

    expect(client.completeText).toHaveBeenCalledTimes(1);
    expect(client.completeText).toHaveBeenCalledWith(
      expect.objectContaining({
        responseFormatJson: true
      })
    );
    expect(result.requirements).toEqual([
      {
        id: "req-jd-1-skill-react-组件开发",
        kind: "skill",
        label: "React 组件开发",
        evidence: "JD 提到负责组件建设和前端研发。",
        requiredFactIds: [],
        weight: 0.92
      },
      {
        id: "req-jd-2-experience-可展示前端项目经验",
        kind: "experience",
        label: "可展示前端项目经验",
        evidence: "JD 要求有可展示的前端项目。",
        requiredFactIds: [],
        weight: 0.76
      }
    ]);
    expect(result.risks).toEqual([
      {
        id: "risk-jd-1-节奏较快",
        label: "节奏较快",
        severity: "medium",
        evidence: "JD 同时覆盖组件建设、接口联调和体验优化。"
      }
    ]);
    expect(new Set(result.requirements.map((item) => item.id)).size).toBe(result.requirements.length);
    expect(result.requirements.every((item) => item.requiredFactIds.length === 0)).toBe(true);
    expect(result.requirements.every((item) => ["skill", "experience", "preference", "risk"].includes(item.kind))).toBe(true);
  });

  it("drops invalid kind and severity entries", async () => {
    const client = createMockClient({
      completeText: vi.fn(async () =>
        JSON.stringify({
          requirements: [
            {
              kind: "bana",
              label: "无效 kind",
              evidence: "应该被丢弃",
              weight: 0.7
            },
            {
              kind: "preference",
              label: "Base 上海",
              evidence: "JD 写明工作地点上海。",
              weight: 0.5
            }
          ],
          risks: [
            {
              label: "无效 severity",
              severity: "urgent",
              evidence: "应该被丢弃"
            },
            {
              label: "外包协作复杂度",
              severity: "low",
              evidence: "JD 提到跨团队协作。"
            }
          ]
        })
      )
    });

    const result = await extractRequirementsFromJd({
      jdText: "工作地点上海，涉及跨团队协作。",
      client
    });

    expect(result.requirements).toEqual([
      {
        id: "req-jd-1-preference-base-上海",
        kind: "preference",
        label: "Base 上海",
        evidence: "JD 写明工作地点上海。",
        requiredFactIds: [],
        weight: 0.5
      }
    ]);
    expect(result.risks).toEqual([
      {
        id: "risk-jd-1-外包协作复杂度",
        label: "外包协作复杂度",
        severity: "low",
        evidence: "JD 提到跨团队协作。"
      }
    ]);
  });

  it("clamps out-of-range weight values and strips markdown fences", async () => {
    const client = createMockClient({
      completeText: vi.fn(async () =>
        [
          "```json",
          JSON.stringify({
            requirements: [
              {
                kind: "skill",
                label: "TypeScript",
                evidence: "JD 明确要求 TypeScript。",
                weight: 1.3
              },
              {
                kind: "experience",
                label: "后台经验",
                evidence: "JD 提到接口联调。",
                weight: -0.4
              }
            ],
            risks: []
          }),
          "```"
        ].join("\n")
      )
    });

    const result = await extractRequirementsFromJd({
      jdText: "要求 TypeScript，涉及接口联调。",
      client
    });

    expect(result.requirements).toEqual([
      {
        id: "req-jd-1-skill-typescript",
        kind: "skill",
        label: "TypeScript",
        evidence: "JD 明确要求 TypeScript。",
        requiredFactIds: [],
        weight: 1
      },
      {
        id: "req-jd-2-experience-后台经验",
        kind: "experience",
        label: "后台经验",
        evidence: "JD 提到接口联调。",
        requiredFactIds: [],
        weight: 0
      }
    ]);
  });

  it("returns empty arrays for garbage or empty model output", async () => {
    const garbageClient = createMockClient({
      completeText: vi.fn(async () => "not json at all")
    });
    const emptyClient = createMockClient({
      completeText: vi.fn(async () => "")
    });
    const missingShapeClient = createMockClient({
      completeText: vi.fn(async () => JSON.stringify({ foo: "bar" }))
    });

    await expect(
      extractRequirementsFromJd({
        jdText: "React",
        client: garbageClient
      })
    ).resolves.toEqual({ requirements: [], risks: [] });
    await expect(
      extractRequirementsFromJd({
        jdText: "React",
        client: emptyClient
      })
    ).resolves.toEqual({ requirements: [], risks: [] });
    await expect(
      extractRequirementsFromJd({
        jdText: "React",
        client: missingShapeClient
      })
    ).resolves.toEqual({ requirements: [], risks: [] });
  });
});
