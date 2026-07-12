import { describe, expect, it } from "vitest";
import { preScreenJob } from "../domain/jobPreScreen";

describe("jobPreScreen", () => {
  it("returns likely_skip for empty keywords", () => {
    expect(preScreenJob("React TypeScript", [])).toEqual({
      matchedKeywords: [],
      missedKeywords: [],
      matchCount: 0,
      totalKeywords: 0,
      matchRatio: 0,
      quickVerdict: "likely_skip"
    });
  });

  it("returns likely_match when all keywords match", () => {
    const result = preScreenJob("React TypeScript Python Git Docker", ["React", "TypeScript", "Python", "Git", "Docker"]);

    expect(result.matchRatio).toBe(1);
    expect(result.quickVerdict).toBe("likely_match");
    expect(result.matchCount).toBe(5);
  });

  it("returns likely_skip when only 2 out of 5 keywords match", () => {
    const result = preScreenJob("React TypeScript", ["React", "TypeScript", "Python", "Git", "Docker"]);

    expect(result.matchRatio).toBe(0.4);
    expect(result.quickVerdict).toBe("possible_match");
  });

  it("returns possible_match when 3 out of 5 keywords match", () => {
    const result = preScreenJob("React TypeScript Python", ["React", "TypeScript", "Python", "Git", "Docker"]);

    expect(result.matchRatio).toBe(0.6);
    expect(result.quickVerdict).toBe("likely_match");
  });

  it("matches keywords case-insensitively", () => {
    const result = preScreenJob("react TYPESCRIPT", ["React", "TypeScript", "Docker"]);

    expect(result.matchedKeywords).toEqual(["React", "TypeScript"]);
    expect(result.missedKeywords).toEqual(["Docker"]);
  });
});
