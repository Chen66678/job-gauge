import { describe, expect, it } from "vitest";
import { getConfirmedFacts, isFactConfirmed } from "../domain/facts";
import { classifyStrategy, scoreJob } from "../domain/scoring";
import { sampleJobs, samplePreferences, sampleProfile } from "../sampleData";

describe("fact validation", () => {
  it("only treats confirmed facts as usable evidence", () => {
    const confirmedFacts = getConfirmedFacts(sampleProfile);

    expect(confirmedFacts.every((fact) => fact.status === "confirmed")).toBe(true);
    expect(isFactConfirmed(sampleProfile, "fact-react")).toBe(true);
    expect(isFactConfirmed(sampleProfile, "fact-node")).toBe(false);
    expect(isFactConfirmed(sampleProfile, "missing-fact")).toBe(false);
  });
});

describe("scoring classification", () => {
  it("classifies the high-match sample as personalize", () => {
    const result = scoreJob(sampleProfile, sampleJobs[0], samplePreferences);

    expect(result.strategy).toBe("personalize");
    expect(result.total).toBeGreaterThanOrEqual(78);
    expect(result.breakdown.requirements.every((item) => item.gap === null)).toBe(true);
  });

  it("classifies the ordinary sample as generic apply", () => {
    const result = scoreJob(sampleProfile, sampleJobs[1], samplePreferences);

    expect(result.strategy).toBe("generic_apply");
    expect(result.total).toBeGreaterThanOrEqual(58);
    expect(result.total).toBeLessThan(78);
  });

  it("classifies high-risk or very low score jobs as skip", () => {
    const result = scoreJob(sampleProfile, sampleJobs[2], samplePreferences);

    expect(result.strategy).toBe("skip");
    expect(result.risks.some((risk) => risk.includes("疑似培训"))).toBe(true);
    expect(result.risks.some((risk) => risk.includes("排除关键词"))).toBe(true);
  });

  it("classifies evidence gaps as review when risk is not high", () => {
    expect(classifyStrategy(70, 1, false, 0)).toBe("review");
  });
});
