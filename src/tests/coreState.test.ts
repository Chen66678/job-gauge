import { describe, expect, it } from "vitest";
import {
  CORE_STATE_STORAGE_KEY,
  clearCoreState,
  createEmptyCoreState,
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
  upsertFacts,
  upsertJobRecord
} from "../domain/coreState";
import type { CoreJobRecord, CorePreferences } from "../domain/coreState";
import type { ProfileFact } from "../types";

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
    confidence: input.confidence ?? 0.9
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
    expect(loaded.preferences).toEqual(state.preferences);
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
