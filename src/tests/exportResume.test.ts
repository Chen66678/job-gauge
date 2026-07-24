import { describe, expect, it } from "vitest";
import { exportToMarkdown } from "../domain/exportResume";
import type { MaterialPreview } from "../types";

describe("exportToMarkdown", () => {
  it("拼出包含标题、问候语、简历行的 Markdown", () => {
    const material: MaterialPreview = {
      status: "ready",
      greeting: "您好，我对这个岗位很感兴趣。",
      resumeLines: [
        { text: "负责 React 组件开发。", factIds: [] },
        { text: "使用 TypeScript 开发数据看板。", factIds: [] }
      ],
      usedFacts: [],
      blockedFacts: [],
      guardrailNotes: []
    };
    const result = exportToMarkdown(material, "前端工程师", "样例科技");
    expect(result).toContain("前端工程师 - 样例科技");
    expect(result).toContain("您好，我对这个岗位很感兴趣。");
    expect(result).toContain("- 负责 React 组件开发。");
  });
});
