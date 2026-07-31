import { describe, expect, it } from "vitest";
import { buildResumeImageHtml, buildResumeImageRenderInput } from "../domain/resumeImage";
import type { MaterialPreview } from "../types";

function buildMaterial(text: string, factIds: string[]): MaterialPreview {
  return {
    status: "ready",
    greeting: "这段问候语没有逐行 factIds，不应进入图片。",
    resumeLines: [{ text, factIds }],
    usedFacts: factIds
      .filter((factId) => factId.trim().length > 0 && factId !== "fact-missing")
      .map((factId) => ({ factId, label: factId, value: text, source: "test" })),
    blockedFacts: [],
    guardrailNotes: []
  };
}

describe("resumeImage", () => {
  it("只渲染 resumeLines 并保持文本字符不变", () => {
    const text = "  React <组件> & TypeScript  ";
    const input = buildResumeImageRenderInput(buildMaterial(text, ["fact-1"]));
    const html = buildResumeImageHtml(input);

    expect(input.resumeLines[0].text).toBe(text);
    expect(html).toContain("  React \\u003c组件> & TypeScript  ");
    expect(html).not.toContain("这段问候语没有逐行 factIds");
  });

  it("拒绝空白 factId", () => {
    expect(() => buildResumeImageRenderInput(buildMaterial("事实行", [" "]))).toThrow("缺少有效 factIds");
  });

  it("拒绝 usedFacts 中不存在的 factId", () => {
    expect(() => buildResumeImageRenderInput(buildMaterial("事实行", ["fact-missing"]))).toThrow("无法追溯的 factIds");
  });
});
