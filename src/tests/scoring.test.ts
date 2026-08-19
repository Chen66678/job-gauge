import { describe, expect, it } from "vitest";
import { getConfirmedFacts, isFactConfirmed } from "../domain/facts";
import { classifyStrategy, scoreJob, scorePreference } from "../domain/scoring";
import type { JobPosting, PreferenceRuleSet, UserProfile } from "../types";

const sampleProfile: UserProfile = {
  id: "profile-test",
  displayName: "测试候选人",
  headline: "前端工程师",
  targetRoles: [],
  targetCities: [],
  resumeText: "",
  facts: [
    {
      id: "fact-react",
      category: "技能",
      label: "React",
      value: "负责 React 组件开发",
      sourceType: "resume",
      sourceRef: "test",
      status: "confirmed",
      confidence: 0.9,
      groupId: null,
      summary: null
    },
    {
      id: "fact-node",
      category: "技能",
      label: "Node",
      value: "做过 Node 服务",
      sourceType: "resume",
      sourceRef: "test",
      status: "unconfirmed",
      confidence: 0.7,
      groupId: null,
      summary: null
    }
  ]
};

const samplePreferences: PreferenceRuleSet = {
  targetRoles: ["前端"],
  targetCities: ["上海"],
  minSalaryK: 20,
  excludedKeywords: ["外包"],
  preferCompanyTags: ["SaaS"],
  confidence: 1
};

const sampleJobs: JobPosting[] = [
  {
    id: "job-high",
    title: "前端工程师",
    company: "样例科技",
    city: "上海",
    salaryK: [20, 30],
    companyTags: ["SaaS"],
    jdText: "负责 React 开发。",
    requirements: [
      {
        id: "req-react",
        kind: "skill",
        label: "React 开发",
        evidence: "JD 要求 React。",
        requiredFactIds: ["fact-react"],
        weight: 80
      }
    ],
    risks: [],
    reviewFlags: [],
    pinned: false,
    workAddress: null,
    sourceUrl: null
  },
  {
    id: "job-ordinary",
    title: "后端工程师",
    company: "样例科技",
    city: "北京",
    salaryK: [10, 15],
    companyTags: [],
    jdText: "负责后端服务开发。",
    requirements: [
      {
        id: "req-react-ordinary",
        kind: "skill",
        label: "React 开发",
        evidence: "JD 要求 React。",
        requiredFactIds: ["fact-react"],
        weight: 70
      }
    ],
    risks: [],
    reviewFlags: [],
    pinned: false,
    workAddress: null,
    sourceUrl: null
  },
  {
    id: "job-skip",
    title: "前端工程师",
    company: "外包公司",
    city: "上海",
    salaryK: [20, 30],
    companyTags: ["外包"],
    jdText: "负责前端开发，外包岗位。",
    requirements: [
      {
        id: "req-react-skip",
        kind: "skill",
        label: "React 开发",
        evidence: "JD 要求 React。",
        requiredFactIds: ["fact-react"],
        weight: 70
      }
    ],
    risks: [
      {
        id: "risk-training",
        label: "疑似培训贷",
        severity: "high",
        evidence: "JD 出现疑似培训贷款描述"
      }
    ],
    reviewFlags: [],
    pinned: false,
    workAddress: null,
    sourceUrl: null
  }
];

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

  it("does not force skip for a high-risk tag when risk sensitivity is ignore", () => {
    expect(classifyStrategy(86, 0, true, 0, { high: 0 })).toBe("personalize");
    expect(classifyStrategy(86, 0, true, 0, { high: 28 })).toBe("skip");
  });

  it("does not award salary preference when salary is undisclosed", () => {
    const known = scorePreference(sampleJobs[0], samplePreferences);
    const unknown = scorePreference({ ...sampleJobs[0], salaryK: null }, samplePreferences);
    const legacyZero = scorePreference({ ...sampleJobs[0], salaryK: [0, 0] }, samplePreferences);
    expect(known - unknown).toBe(5);
    expect(legacyZero).toBe(unknown);
  });
});
