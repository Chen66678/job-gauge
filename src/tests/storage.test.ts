import { describe, expect, it } from "vitest";
import {
  WORKBENCH_STORAGE_KEY,
  clearWorkbenchData,
  createSampleWorkbenchData,
  loadWorkbenchData,
  parseWorkbenchData,
  saveWorkbenchData,
  serializeWorkbenchData
} from "../domain/storage";

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

describe("workbench persistence", () => {
  it("round-trips valid workbench data", () => {
    const data = createSampleWorkbenchData("2026-06-25T01:00:00.000Z");
    const parsed = parseWorkbenchData(serializeWorkbenchData(data));

    expect(parsed?.profile.displayName).toBe("林知远");
    expect(parsed?.jobs).toHaveLength(3);
    expect(parsed?.preferences.excludedKeywords).toContain("培训");
    expect(parsed?.materialVersions).toHaveLength(0);
    expect(parsed?.materialChecklistAcknowledgements).toEqual([]);
    expect(parsed?.auditLog).toHaveLength(0);
    expect(parsed?.acquisitionLog).toHaveLength(0);
    expect(parsed?.settings.localStorageKey).toBe(WORKBENCH_STORAGE_KEY);
    expect(parsed?.profile.imageResumeAttachment).toBeNull();
  });

  it("saves and loads local data without changing sample defaults", () => {
    const storage = new MemoryStorage();
    const data = createSampleWorkbenchData("2026-06-25T01:00:00.000Z");
    data.profile.displayName = "本地用户";

    saveWorkbenchData(storage, data);
    const loaded = loadWorkbenchData(storage);

    expect(loaded.source).toBe("local");
    expect(loaded.error).toBeNull();
    expect(loaded.data.profile.displayName).toBe("本地用户");
  });

  it("falls back to sample data when local data is invalid", () => {
    const storage = new MemoryStorage();
    storage.setItem(WORKBENCH_STORAGE_KEY, "{bad json");

    const loaded = loadWorkbenchData(storage);

    expect(loaded.source).toBe("sample");
    expect(loaded.error).toContain("回退到安全样例");
    expect(loaded.data.profile.displayName).toBe("林知远");
  });

  it("clears local data", () => {
    const storage = new MemoryStorage();
    saveWorkbenchData(storage, createSampleWorkbenchData());

    clearWorkbenchData(storage);

    expect(storage.getItem(WORKBENCH_STORAGE_KEY)).toBeNull();
    expect(loadWorkbenchData(storage).source).toBe("sample");
  });

  it("migrates v1 foundation data into the richer v3 shape", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      WORKBENCH_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        profile: createSampleWorkbenchData().profile,
        preferences: createSampleWorkbenchData().preferences,
        jobs: createSampleWorkbenchData().jobs,
        updatedAt: "2026-06-25T01:00:00.000Z"
      })
    );

    const loaded = loadWorkbenchData(storage);

    expect(loaded.source).toBe("local");
    expect(loaded.data.version).toBe(3);
    expect(loaded.data.materialVersions).toEqual([]);
    expect(loaded.data.materialChecklistAcknowledgements).toEqual([]);
    expect(loaded.data.auditLog).toEqual([]);
    expect(loaded.data.acquisitionLog).toEqual([]);
    expect(loaded.data.settings.llm.provider).toBe("mock");
    expect(loaded.data.settings.llm.keyLabel).toContain("Qwen");
  });

  it("migrates v2 workbench data into the richer v3 shape", () => {
    const storage = new MemoryStorage();
    const sample = createSampleWorkbenchData();
    storage.setItem(
      WORKBENCH_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        profile: sample.profile,
        preferences: sample.preferences,
        jobs: sample.jobs,
        materialVersions: [],
        auditLog: [],
        settings: sample.settings,
        updatedAt: "2026-06-25T02:00:00.000Z"
      })
    );

    const loaded = loadWorkbenchData(storage);

    expect(loaded.source).toBe("local");
    expect(loaded.data.version).toBe(3);
    expect(loaded.data.acquisitionLog).toEqual([]);
    expect(loaded.data.materialChecklistAcknowledgements).toEqual([]);
  });

  it("normalizes legacy provider placeholders without making OpenAI or Anthropic defaults", () => {
    const dashscope = createSampleWorkbenchData();
    dashscope.settings.llm.provider = "dashscope" as typeof dashscope.settings.llm.provider;
    const parsedDashscope = parseWorkbenchData(serializeWorkbenchData(dashscope));
    expect(parsedDashscope?.settings.llm.provider).toBe("qwen_dashscope");

    const legacy = createSampleWorkbenchData();
    legacy.settings.llm.provider = "openai" as typeof legacy.settings.llm.provider;
    const parsedLegacy = parseWorkbenchData(serializeWorkbenchData(legacy));
    expect(parsedLegacy?.settings.llm.provider).toBe("other");
  });

  it("round-trips safe image resume attachment metadata without storing a raw path", () => {
    const data = createSampleWorkbenchData("2026-06-25T01:00:00.000Z");
    data.profile.imageResumeAttachment = {
      status: "provided",
      displayName: "我的图片版简历.jpg",
      mimeType: "image/jpeg",
      sizeBucket: "1mb_to_5mb",
      sizeLabel: "约 2 MB",
      updatedAt: "2026-07-06T09:00:00.000Z",
      note: "仅记录本地关联状态"
    };

    const parsed = parseWorkbenchData(serializeWorkbenchData(data));

    expect(parsed?.profile.imageResumeAttachment).toEqual({
      status: "provided",
      displayName: "我的图片版简历.jpg",
      mimeType: "image/jpeg",
      sizeBucket: "1mb_to_5mb",
      sizeLabel: "约 2 MB",
      updatedAt: "2026-07-06T09:00:00.000Z",
      note: "仅记录本地关联状态"
    });
    expect(JSON.stringify(parsed)).not.toContain("/Users/");
    expect(JSON.stringify(parsed)).not.toContain("\"path\"");
  });

  it("drops invalid image resume attachment objects with raw path-like fields", () => {
    const sample = createSampleWorkbenchData();
    const parsed = parseWorkbenchData(
      JSON.stringify({
        ...sample,
        profile: {
          ...sample.profile,
          imageResumeAttachment: {
            status: "provided",
            displayName: "简历图片.jpg",
            mimeType: "image/jpeg",
            sizeBucket: "unknown",
            sizeLabel: "大小未记录",
            updatedAt: "2026-07-06T09:00:00.000Z",
            note: "测试",
            path: "/Users/private/example.jpg"
          }
        }
      })
    );

    expect(parsed?.profile.imageResumeAttachment).toEqual({
      status: "provided",
      displayName: "简历图片.jpg",
      mimeType: "image/jpeg",
      sizeBucket: "unknown",
      sizeLabel: "大小未记录",
      updatedAt: "2026-07-06T09:00:00.000Z",
      note: "测试"
    });
    expect(JSON.stringify(parsed)).not.toContain("/Users/private/example.jpg");
    expect(JSON.stringify(parsed)).not.toContain("\"path\"");
  });

  it("round-trips material checklist acknowledgements per job", () => {
    const data = createSampleWorkbenchData("2026-06-25T01:00:00.000Z");
    data.materialChecklistAcknowledgements = [
      { jobId: "job-a", itemId: "greeting", checked: true, updatedAt: "2026-07-06T10:00:00.000Z" },
      { jobId: "job-b", itemId: "risks", checked: true, updatedAt: "2026-07-06T10:01:00.000Z" }
    ];

    const parsed = parseWorkbenchData(serializeWorkbenchData(data));

    expect(parsed?.materialChecklistAcknowledgements).toEqual([
      { jobId: "job-a", itemId: "greeting", checked: true, updatedAt: "2026-07-06T10:00:00.000Z" },
      { jobId: "job-b", itemId: "risks", checked: true, updatedAt: "2026-07-06T10:01:00.000Z" }
    ]);
  });
});
