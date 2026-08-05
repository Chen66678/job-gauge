import { describe, expect, it } from "vitest";
import { sanitizeGreeting } from "../domain/greetingGuard";
import type { ProfileFact } from "../types";

const fact = (id: string, value: string, status: ProfileFact["status"] = "confirmed"): ProfileFact => ({
  id, category: "经历", label: value, value, sourceType: "resume", sourceRef: "test", status, confidence: 1, groupId: null, summary: null
});

describe("sanitizeGreeting", () => {
  it("drops whole clauses containing unsupported numbers or experience claims", () => {
    expect(sanitizeGreeting("您好，我有 5 年经验，带来 30% 提升。", [fact("fact-1", "有 3 年经验")])).toBe("您好。");
  });

  it("keeps hard facts supported by confirmed facts only", () => {
    expect(sanitizeGreeting("您好，我有 5 年经验。", [fact("fact-1", "有 5 年经验", "confirmed")])).toBe("您好，我有 5 年经验。");
    expect(sanitizeGreeting("您好，我有 5 年经验。", [fact("fact-1", "有 5 年经验", "unconfirmed")])).toBe("您好。");
  });

  it("allows the current job company as a known hard fact", () => {
    expect(sanitizeGreeting("您好，期待加入样例科技。", [], ["样例科技"])).toBe("您好，期待加入样例科技。");
  });
});
