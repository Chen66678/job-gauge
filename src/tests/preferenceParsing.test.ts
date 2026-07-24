import { describe, expect, it, vi } from "vitest";
import type { OpenAiCompatibleLlmClient } from "../domain/llmClient";
import { findVetoHit, parsePreferences } from "../domain/preferenceParsing";
import type { JobPosting } from "../types";

function createMockClient(response: string): OpenAiCompatibleLlmClient {
  return {
    completeText: vi.fn(async () => response),
    completeVision: vi.fn(async () => {
      throw new Error("completeVision should not be used for preference parsing");
    })
  } as unknown as OpenAiCompatibleLlmClient;
}

function buildJob(overrides: Partial<JobPosting> = {}): JobPosting {
  return {
    id: "job-1",
    title: "前端工程师",
    company: "样例科技",
    city: "上海",
    salaryK: [20, 30],
    companyTags: ["外包"],
    jdText: "负责前端开发。",
    requirements: [],
    risks: [],
    reviewFlags: [],
    pinned: false,
    workAddress: null,
    sourceUrl: null,
    ...overrides
  };
}

describe("parsePreferences", () => {
  it("parses soft preferences from accept text", async () => {
    const client = createMockClient(
      JSON.stringify({
        soft: {
          targetCities: ["杭州", "上海"],
          minSalaryK: 20,
          preferCompanyTags: ["大厂"],
          excludedKeywords: ["外包"],
          riskSensitivity: "mild"
        },
        veto: []
      })
    );

    const result = await parsePreferences({
      acceptText: "想去杭州和上海,薪资20k以上,偏好大厂,别推外包",
      vetoText: "",
      client
    });

    expect(client.completeText).toHaveBeenCalledTimes(1);
    expect(client.completeText).toHaveBeenCalledWith(
      expect.objectContaining({
        responseFormatJson: true
      })
    );
    expect(result.preferences).toEqual({
      targetRoles: [],
      targetCities: ["杭州", "上海"],
      minSalaryK: 20,
      excludedKeywords: ["外包"],
      preferCompanyTags: ["大厂"]
    });
    expect(result.riskSensitivity).toEqual({ low: 3, medium: 8, high: 16 });
    expect(result.hardVeto.rules).toEqual([]);
  });

  it("maps strong risk sensitivity and defaults to mild when not mentioned", async () => {
    const strongClient = createMockClient(
      JSON.stringify({
        soft: {
          targetCities: [],
          minSalaryK: 0,
          preferCompanyTags: [],
          excludedKeywords: [],
          riskSensitivity: "strong"
        },
        veto: []
      })
    );
    const defaultClient = createMockClient(
      JSON.stringify({
        soft: {
          targetCities: [],
          minSalaryK: 0,
          preferCompanyTags: [],
          excludedKeywords: []
        },
        veto: []
      })
    );

    const strongResult = await parsePreferences({
      acceptText: "完全不想加班",
      vetoText: "",
      client: strongClient
    });
    const defaultResult = await parsePreferences({
      acceptText: "想找稳定点的机会",
      vetoText: "",
      client: defaultClient
    });

    expect(strongResult.riskSensitivity).toEqual({ low: 8, medium: 20, high: 40 });
    expect(defaultResult.riskSensitivity).toEqual({ low: 3, medium: 8, high: 16 });
  });

  it("parses veto rules and supports empty veto text", async () => {
    const client = createMockClient(
      JSON.stringify({
        soft: {
          targetCities: [],
          minSalaryK: 0,
          preferCompanyTags: [],
          excludedKeywords: [],
          riskSensitivity: "mild"
        },
        veto: [
          {
            label: "只去北京",
            kind: "city",
            mode: "allowlist",
            matchTerms: ["北京"],
            evidence: "我家在北京,只去北京"
          }
        ]
      })
    );
    const emptyClient = createMockClient(
      JSON.stringify({
        soft: {
          targetCities: [],
          minSalaryK: 0,
          preferCompanyTags: [],
          excludedKeywords: [],
          riskSensitivity: "mild"
        },
        veto: []
      })
    );

    const result = await parsePreferences({
      acceptText: "",
      vetoText: "我家在北京,只去北京",
      client
    });
    const emptyResult = await parsePreferences({
      acceptText: "",
      vetoText: "",
      client: emptyClient
    });

    expect(result.hardVeto.rules).toEqual([
      {
        id: "veto-1-city-只去北京",
        label: "只去北京",
        kind: "city",
        mode: "allowlist",
        matchTerms: ["北京"],
        evidence: "我家在北京,只去北京"
      }
    ]);
    expect(emptyResult.hardVeto.rules).toEqual([]);
  });

  it("finds veto hits for city allowlist, city blocklist, legacy city rules, and keyword blocks", () => {
    const cityVeto = {
      rules: [
        {
          id: "veto-1-city-只去北京",
          label: "只去北京",
          kind: "city" as const,
          mode: "allowlist" as const,
          matchTerms: ["北京"],
          evidence: "我家在北京,只去北京"
        }
      ]
    };
    const cityBlocklistVeto = {
      rules: [
        {
          id: "veto-2-city-绝不去上海",
          label: "绝不去上海",
          kind: "city" as const,
          mode: "blocklist" as const,
          matchTerms: ["上海"],
          evidence: "绝不去上海"
        }
      ]
    };
    const legacyCityVeto = {
      rules: [
        {
          id: "veto-legacy-city-只去北京",
          label: "只去北京",
          kind: "city" as const,
          matchTerms: ["北京"],
          evidence: "我家在北京,只去北京"
        }
      ]
    };
    const keywordVeto = {
      rules: [
        {
          id: "veto-2-keyword-不要外包",
          label: "不要外包",
          kind: "keyword" as const,
          matchTerms: ["外包"],
          evidence: "别推外包"
        }
      ]
    };

    expect(findVetoHit(buildJob({ city: "上海" }), cityVeto)).toEqual(cityVeto.rules[0]);
    expect(findVetoHit(buildJob({ city: "北京" }), cityVeto)).toBeNull();
    expect(findVetoHit(buildJob({ city: "上海" }), cityBlocklistVeto)).toEqual(cityBlocklistVeto.rules[0]);
    expect(findVetoHit(buildJob({ city: "北京" }), cityBlocklistVeto)).toBeNull();
    expect(findVetoHit(buildJob({ city: "上海" }), legacyCityVeto)).toEqual(legacyCityVeto.rules[0]);
    expect(findVetoHit(buildJob({ city: "北京" }), legacyCityVeto)).toBeNull();
    expect(findVetoHit(buildJob({ companyTags: ["外包"] }), keywordVeto)).toEqual(keywordVeto.rules[0]);
    expect(findVetoHit(buildJob({ companyTags: ["SaaS"] }), keywordVeto)).toBeNull();
  });

  it("parses blocklist city veto mode from model output", async () => {
    const client = createMockClient(
      JSON.stringify({
        soft: {
          targetCities: [],
          minSalaryK: 0,
          preferCompanyTags: [],
          excludedKeywords: [],
          riskSensitivity: "mild"
        },
        veto: [
          {
            label: "绝不去上海",
            kind: "city",
            mode: "blocklist",
            matchTerms: ["上海"],
            evidence: "绝不去上海"
          }
        ]
      })
    );

    const result = await parsePreferences({
      acceptText: "",
      vetoText: "绝不去上海",
      client
    });

    expect(result.hardVeto.rules).toEqual([
      {
        id: "veto-1-city-绝不去上海",
        label: "绝不去上海",
        kind: "city",
        mode: "blocklist",
        matchTerms: ["上海"],
        evidence: "绝不去上海"
      }
    ]);
  });

  it("gracefully degrades on garbage or empty json", async () => {
    const garbageClient = createMockClient("not json");
    const emptyClient = createMockClient("");

    const garbageResult = await parsePreferences({
      acceptText: "随便",
      vetoText: "",
      client: garbageClient
    });
    const emptyResult = await parsePreferences({
      acceptText: "随便",
      vetoText: "",
      client: emptyClient
    });

    expect(garbageResult).toEqual({
      preferences: {
        targetRoles: [],
        targetCities: [],
        minSalaryK: 0,
        excludedKeywords: [],
        preferCompanyTags: []
      },
      riskSensitivity: { low: 3, medium: 8, high: 16 },
      hardVeto: { rules: [] }
    });
    expect(emptyResult).toEqual({
      preferences: {
        targetRoles: [],
        targetCities: [],
        minSalaryK: 0,
        excludedKeywords: [],
        preferCompanyTags: []
      },
      riskSensitivity: { low: 3, medium: 8, high: 16 },
      hardVeto: { rules: [] }
    });
  });
});
