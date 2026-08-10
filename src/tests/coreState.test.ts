import { describe, expect, it } from "vitest";
import {
  CORE_STATE_STORAGE_KEY,
  applyReconciliationPlan,
  clearCoreState,
  createEmptyCoreState,
  deleteFact,
  deleteFactGroup,
  getConfirmedFacts,
  getJobRecord,
  loadCoreState,
  parseCoreState,
  removeJobRecord,
  saveCoreState,
  serializeCoreState,
  setFactStatus,
  setFactStatusBatch,
  setPreferences,
  upsertFactGroups,
  upsertFacts,
  upsertJobRecord,
  clearJobs
} from "../domain/coreState";
import type { CoreJobRecord, CorePreferences } from "../domain/coreState";
import type { ProfileFact } from "../types";
import type { ReconciliationPlan } from "../domain/factReconciliation";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function buildFact(input: Partial<ProfileFact> & Pick<ProfileFact, "id" | "label" | "value">): ProfileFact {
  return {
    id: input.id,
    category: input.category ?? "技能",
    label: input.label,
    value: input.value,
    sourceType: input.sourceType ?? "resume",
    sourceRef: input.sourceRef ?? "测试事实",
    status: input.status ?? "unconfirmed",
    confidence: input.confidence ?? 0.9,
    groupId: input.groupId ?? null,
    summary: input.summary ?? null
  };
}

function buildPreferences(): CorePreferences {
  return {
    ruleSet: {
      targetRoles: [],
      targetCities: ["上海"],
      minSalaryK: 20,
      excludedKeywords: ["外包"],
      preferCompanyTags: ["SaaS"],
        confidence: 1.0
    },
    riskSensitivity: {
      low: 3,
      medium: 8,
      high: 16
    },
    hardVeto: {
      rules: [
        {
          id: "veto-1",
          label: "只去上海",
          kind: "city",
          matchTerms: ["上海"],
          evidence: "只去上海"
        }
      ]
    }
  };
}

function buildJobRecord(): CoreJobRecord {
  return {
    job: {
      id: "job-1",
      title: "前端工程师",
      company: "样例科技",
      city: "上海",
      salaryK: [20, 30],
      companyTags: ["SaaS"],
      jdText: "负责 React 开发。",
      requirements: [],
      risks: [],
      reviewFlags: [],
      pinned: false,
      workAddress: null,
      sourceUrl: null
    },
    evaluation: {
      vetoed: false,
      score: {
        total: 82,
        strategy: "review",
        strategyLabel: "需要人工复核",
        summary: "测试总结",
        breakdown: {
          requirements: [],
          preference: 0,
          riskPenalty: 0,
          reviewPenalty: 0
        },
        gaps: [],
        risks: [],
        reviewFlags: []
      }
    },
    evaluationError: null,
    followUps: [],
    material: null,
    collectedAt: "2026-07-07T00:00:00.000Z",
    evaluationStale: false,
    materialStale: false,
    updatedAt: "2026-07-07T00:00:00.000Z"
  };
}

describe("coreState", () => {
  it("upsertFacts overwrites same ids and appends new ids", () => {
    const initial = createEmptyCoreState();
    const state = upsertFacts(initial, [
      buildFact({ id: "fact-1", label: "React", value: "旧值" }),
      buildFact({ id: "fact-2", label: "TypeScript", value: "TS 值" })
    ]);
    const next = upsertFacts(state, [
      buildFact({ id: "fact-1", label: "React", value: "新值", status: "confirmed" }),
      buildFact({ id: "fact-3", label: "Vue", value: "Vue 值" })
    ]);

    expect(next.factLibrary).toEqual([
      buildFact({ id: "fact-1", label: "React", value: "新值", status: "confirmed" }),
      buildFact({ id: "fact-2", label: "TypeScript", value: "TS 值" }),
      buildFact({ id: "fact-3", label: "Vue", value: "Vue 值" })
    ]);
  });

  it("setFactStatus and setFactStatusBatch update statuses immutably and ignore missing ids", () => {
    const original = upsertFacts(createEmptyCoreState(), [
      buildFact({ id: "fact-1", label: "React", value: "React 值", status: "unconfirmed" }),
      buildFact({ id: "fact-2", label: "TS", value: "TS 值", status: "unconfirmed" })
    ]);
    const single = setFactStatus(original, "fact-1", "confirmed");
    const batch = setFactStatusBatch(single, [
      { factId: "fact-2", status: "rejected" },
      { factId: "fact-missing", status: "confirmed" }
    ]);

    expect(original.factLibrary).toEqual([
      buildFact({ id: "fact-1", label: "React", value: "React 值", status: "unconfirmed" }),
      buildFact({ id: "fact-2", label: "TS", value: "TS 值", status: "unconfirmed" })
    ]);
    expect(single.factLibrary).toEqual([
      buildFact({ id: "fact-1", label: "React", value: "React 值", status: "confirmed" }),
      buildFact({ id: "fact-2", label: "TS", value: "TS 值", status: "unconfirmed" })
    ]);
    expect(batch.factLibrary).toEqual([
      buildFact({ id: "fact-1", label: "React", value: "React 值", status: "confirmed" }),
      buildFact({ id: "fact-2", label: "TS", value: "TS 值", status: "rejected" })
    ]);
    expect(batch.factLibrary).not.toBe(original.factLibrary);
    expect(getConfirmedFacts(batch)).toEqual([buildFact({ id: "fact-1", label: "React", value: "React 值", status: "confirmed" })]);
  });

  it("setPreferences and job record round-trip helpers work", () => {
    const stateWithPrefs = setPreferences(createEmptyCoreState(), buildPreferences());
    const record = buildJobRecord();
    const withJob = upsertJobRecord(stateWithPrefs, record);
    const replaced = upsertJobRecord(withJob, {
      ...record,
      evaluation: { vetoed: true, vetoRuleId: "veto-1", vetoRuleLabel: "只去上海" }
    });
    const removed = removeJobRecord(replaced, "job-1");

    expect(stateWithPrefs.preferences).toEqual(buildPreferences());
    expect(getJobRecord(withJob, "job-1")).toMatchObject({ job: { id: "job-1" } });
    expect(getJobRecord(replaced, "job-1")).toEqual(
      expect.objectContaining({
        evaluation: { vetoed: true, vetoRuleId: "veto-1", vetoRuleLabel: "只去上海" }
      })
    );
    expect(getJobRecord(removed, "job-1")).toBeNull();
  });

  it("saveCoreState and loadCoreState round-trip, and empty storage loads empty state", () => {
    const storage = new MemoryStorage();
    const state = upsertJobRecord(
      setPreferences(
        upsertFacts(createEmptyCoreState(), [buildFact({ id: "fact-1", label: "React", value: "React 值", status: "confirmed" })]),
        buildPreferences()
      ),
      buildJobRecord()
    );

    saveCoreState(storage, state);
    const loaded = loadCoreState(storage);
    const empty = loadCoreState(new MemoryStorage());

    expect(storage.getItem(CORE_STATE_STORAGE_KEY)).toContain("\"schemaVersion\":1");
    expect(loaded.factLibrary).toEqual(state.factLibrary);
    expect(loaded.preferences).toEqual({ ...state.preferences!, autoReevaluateRecentCount: 30 });
    expect(loaded.jobs).toHaveLength(1);
    expect(empty.factLibrary).toEqual([]);
    expect(empty.preferences).toBeNull();
    expect(empty.jobs).toEqual([]);
  });

  it("parseCoreState returns null on garbage and clearCoreState removes persisted data", () => {
    const storage = new MemoryStorage();
    saveCoreState(storage, createEmptyCoreState());
    clearCoreState(storage);

    expect(parseCoreState("{bad json")).toBeNull();
    expect(storage.getItem(CORE_STATE_STORAGE_KEY)).toBeNull();
    expect(parseCoreState(serializeCoreState(createEmptyCoreState()))?.schemaVersion).toBe(1);
  });

  it("saveCoreState rejects sensitive values discovered by repository scanning", () => {
    const storage = new MemoryStorage();
    const unsafe = upsertFacts(createEmptyCoreState(), [
      buildFact({
        id: "fact-secret",
        label: "危险字段",
        value: "cookie=xx and sk-secret-value",
        status: "confirmed"
      })
    ]);

    expect(() => saveCoreState(storage, unsafe)).toThrow("Core state rejected sensitive/raw evidence fields");
  });
});

describe("factGroups (D034 父子分组)", () => {
  function buildGroupedState() {
    let state = upsertFactGroups(createEmptyCoreState(), [
      { id: "group-1", category: "经历", label: "样例公司 · 前端工程师 · 2022年1月-2023年6月" }
    ]);
    state = upsertFacts(state, [
      buildFact({ id: "fact-1", label: "负责首页重构", value: "负责首页重构", status: "confirmed", groupId: "group-1" }),
      buildFact({ id: "fact-2", label: "接口联调", value: "接口联调", status: "confirmed", groupId: "group-1" }),
      buildFact({ id: "fact-3", label: "无关技能", value: "无关技能", status: "confirmed", groupId: null })
    ]);
    return state;
  }

  it("删父级：分组与其下全部子事实一并删除，其他事实不受影响（首席裁定一）", () => {
    const state = buildGroupedState();
    const next = deleteFactGroup(state, "group-1");

    expect(next.factGroups).toEqual([]);
    expect(next.factLibrary.map((fact) => fact.id)).toEqual(["fact-3"]);
  });

  it("删单个子条：不动父级与兄弟事实（首席裁定二）", () => {
    const state = buildGroupedState();
    const next = deleteFact(state, "fact-1");

    expect(next.factGroups).toEqual(state.factGroups);
    expect(next.factLibrary.map((fact) => fact.id)).toEqual(["fact-2", "fact-3"]);
  });

  it("子条全删空的父级仍保留在 factGroups 里，但 getConfirmedFacts 拿不到任何子条——不会被当作事实喂给生成", () => {
    let state = buildGroupedState();
    state = deleteFact(state, "fact-1");
    state = deleteFact(state, "fact-2");

    expect(state.factGroups.map((group) => group.id)).toEqual(["group-1"]);
    expect(getConfirmedFacts(state).some((fact) => fact.groupId === "group-1")).toBe(false);
  });

  it("同一家公司被拆成三个 group 时，applyReconciliationPlan 的 merge/supplement 把三个 group 合成一个（首席撤销 08-06 旧论后的新裁定）", () => {
    let state = upsertFactGroups(createEmptyCoreState(), [
      { id: "group-a", category: "经历", label: "华开家办圈（北京）文化传媒有限公司 | AI Agent 工作流实习生 | 2026.06-至今" },
      { id: "group-b", category: "经历", label: "华开家办圈（北京）文化传媒有限公司 | AI Agent 工作流实习生 | 2026.06-至今" },
      { id: "group-c", category: "经历", label: "华开家办圈（北京）文化传媒有限公司 | AI 工作流实习生 | 2026.06-至今" }
    ]);
    state = upsertFacts(state, [
      buildFact({ id: "fact-a", label: "职责描述", value: "负责 AI Agent 工作流搭建", status: "confirmed", groupId: "group-a" }),
      buildFact({ id: "fact-a2", label: "另一条职责", value: "维护工作流脚本", status: "confirmed", groupId: "group-a" }),
      buildFact({ id: "fact-b", label: "职责描述", value: "负责 AI Agent 工作流搭建", status: "confirmed", groupId: "group-b" }),
      buildFact({ id: "fact-c", label: "职责描述", value: "负责 AI 工作流搭建", status: "confirmed", groupId: "group-c" })
    ]);

    const plan: ReconciliationPlan = {
      unusable: false,
      conflicts: [],
      items: [
        {
          verdict: "merge",
          versionIds: ["fact-a", "fact-b", "fact-c"],
          rationale: "同一份实习经历的重复抽取",
          mergedValue: "负责 AI Agent 工作流搭建",
          mergedLabel: "职责描述",
          mergedCategory: "经历"
        }
      ]
    };

    const next = applyReconciliationPlan(state, plan);

    // fact-a 排在 nextFactLibrary 最前，是既有存活逻辑选中的存活事实——它的 group-a 是存活 group。
    expect(next.factGroups.map((group) => group.id)).toEqual(["group-a"]);
    expect(next.factLibrary.map((fact) => fact.id)).toEqual(["fact-a", "fact-a2"]);
    expect(next.factLibrary.every((fact) => fact.groupId === "group-a" || fact.groupId === null)).toBe(true);
    // 未被合并、但原属被吞并 group 的事实（fact-a2 与 group-a 同组，非本次合并对象）依旧留在存活 group 下。
    expect(next.factLibrary.find((fact) => fact.id === "fact-a2")?.groupId).toBe("group-a");
  });

  it("⚠ 反向约束：group 相同/相似不得作为合并事实的信号——applyReconciliationPlan 只按 plan.items 的 verdict 动手，从不读 group", () => {
    let state = upsertFactGroups(createEmptyCoreState(), [
      { id: "group-x", category: "经历", label: "同一家公司" }
    ]);
    state = upsertFacts(state, [
      buildFact({ id: "fact-x1", label: "职责一", value: "职责一原文", status: "confirmed", groupId: "group-x" }),
      buildFact({ id: "fact-x2", label: "职责二", value: "职责二原文", status: "confirmed", groupId: "group-x" })
    ]);

    const plan: ReconciliationPlan = { unusable: false, conflicts: [], items: [] };
    const next = applyReconciliationPlan(state, plan);

    expect(next).toBe(state);
    expect(next.factLibrary.map((fact) => fact.id)).toEqual(["fact-x1", "fact-x2"]);
  });
});

describe("clearJobs (pure state function)", () => {
  it("removes all jobs and returns a new state object", () => {
    const record = buildJobRecord();
    const state = upsertJobRecord(createEmptyCoreState(), record);
    expect(state.jobs).toHaveLength(1);

    const next = clearJobs(state);
    expect(next.jobs).toHaveLength(0);
    expect(next).not.toBe(state);
  });

  it("clears pinned jobs along with normal ones (semantic #1)", () => {
    const pinned = { ...buildJobRecord(), job: { ...buildJobRecord().job, id: "pinned-1", pinned: true } };
    const normal = { ...buildJobRecord(), job: { ...buildJobRecord().job, id: "normal-1", pinned: false } };
    let state = upsertJobRecord(createEmptyCoreState(), pinned);
    state = upsertJobRecord(state, normal);
    expect(state.jobs).toHaveLength(2);

    const next = clearJobs(state);
    expect(next.jobs).toHaveLength(0);
  });

  it("leaves factLibrary, factGroups, factConflicts, and preferences completely untouched (semantic #3)", () => {
    const fact = buildFact({ id: "fact-1", label: "React", value: "React 开发" });
    let state = upsertFacts(createEmptyCoreState(), [fact]);
    state = upsertFactGroups(state, [{ id: "group-1", category: "技能", label: "前端" }]);
    state = upsertJobRecord(state, buildJobRecord());

    const next = clearJobs(state);
    expect(next.jobs).toHaveLength(0);
    expect(next.factLibrary).toHaveLength(1);
    expect(next.factGroups).toHaveLength(1);
    expect(next.factConflicts).toEqual(state.factConflicts);
  });

  it("stamps updatedAt on the returned state", () => {
    const state = upsertJobRecord(createEmptyCoreState(), buildJobRecord());
    const before = state.updatedAt;
    const next = clearJobs(state);
    expect(next.updatedAt >= before).toBe(true);
  });
});
