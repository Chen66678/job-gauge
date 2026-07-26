import { describe, expect, it } from "vitest";
import {
  type WorkbenchRepositoryBlobStore,
  assertSafeWorkbenchRepositoryData,
  collectSensitiveRepositoryFindings,
  redactSecretValues,
  createFileBackedJsonWorkbenchRepository,
  createLocalStorageWorkbenchRepository,
  parseRepositoryEnvelope
} from "../domain/workbenchRepository";
import { WORKBENCH_STORAGE_KEY, createSampleWorkbenchData } from "../domain/storage";

class MemoryBlobStore implements WorkbenchRepositoryBlobStore {
  value: string | null = null;

  async read(): Promise<string | null> {
    return this.value;
  }

  async write(value: string): Promise<void> {
    this.value = value;
  }

  async remove(): Promise<void> {
    this.value = null;
  }
}

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

describe("workbench repository scaffold", () => {
  it("round-trips current WorkbenchData through the file-backed JSON scaffold", async () => {
    const store = new MemoryBlobStore();
    const repository = createFileBackedJsonWorkbenchRepository(store);
    const data = createSampleWorkbenchData("2026-06-28T20:00:00.000Z");
    data.profile.displayName = "Repository User";

    await repository.initialize();
    await repository.save(data);
    const loaded = await repository.load();

    expect(loaded.repository.kind).toBe("file_backed_json_scaffold");
    expect(loaded.repository.nativeSqliteDeferred).toBe(true);
    expect(loaded.source).toBe("local");
    expect(loaded.error).toBeNull();
    expect(loaded.data.profile.displayName).toBe("Repository User");
    expect(loaded.data.version).toBe(3);
  });

  it("creates a schema envelope and supports export-like readback", async () => {
    const store = new MemoryBlobStore();
    const repository = createFileBackedJsonWorkbenchRepository(store);

    await repository.save(createSampleWorkbenchData("2026-06-28T20:05:00.000Z"));
    const snapshot = await repository.exportSnapshot();

    expect(snapshot).toContain('"schemaVersion":1');
    expect(snapshot).toContain('"storageFormat":"workbench_data_json"');
    expect(parseRepositoryEnvelope(snapshot ?? "")?.jobs).toHaveLength(3);
  });

  it("clears the scaffold store and falls back to safe sample data", async () => {
    const store = new MemoryBlobStore();
    const repository = createFileBackedJsonWorkbenchRepository(store);

    await repository.save(createSampleWorkbenchData());
    await repository.clear();
    const loaded = await repository.load();

    expect(await repository.exportSnapshot()).toBeNull();
    expect(loaded.source).toBe("sample");
    expect(loaded.error).toBeNull();
    expect(loaded.data.profile.displayName).toBe("林知远");
  });

  it("fails closed to sample data when repository payload is malformed", async () => {
    const store = new MemoryBlobStore();
    store.value = "{bad json";
    const repository = createFileBackedJsonWorkbenchRepository(store);

    const loaded = await repository.load();

    expect(loaded.source).toBe("sample");
    expect(loaded.error).toContain("fell back to safe sample data");
  });

  it("wraps the existing localStorage behavior without changing the renderer storage shape", async () => {
    const storage = new MemoryStorage();
    const repository = createLocalStorageWorkbenchRepository(storage);
    const data = createSampleWorkbenchData();
    data.profile.displayName = "LocalStorage Repository User";

    await repository.save(data);
    const loaded = await repository.load();

    expect(loaded.repository.kind).toBe("local_storage");
    expect(storage.getItem(WORKBENCH_STORAGE_KEY)).toContain("LocalStorage Repository User");
    expect(loaded.data.profile.displayName).toBe("LocalStorage Repository User");
  });

  it("rejects raw evidence and sensitive/session-like fields before repository save", async () => {
    const store = new MemoryBlobStore();
    const repository = createFileBackedJsonWorkbenchRepository(store);
    const unsafe = createSampleWorkbenchData();
    const unsafeRecord = unsafe as unknown as Record<string, unknown>;
    unsafeRecord.rawHtml = "<html>platform page</html>";

    await expect(repository.save(unsafe)).rejects.toThrow("sensitive/raw evidence");
    expect(collectSensitiveRepositoryFindings(unsafe)).toContain("workbench.rawHtml");
  });

  it("detects credential-like strings in nested repository data", () => {
    const unsafe = createSampleWorkbenchData();
    unsafe.auditLog.push({
      id: "audit-secret",
      type: "settings_updated",
      createdAt: "2026-06-28T20:10:00.000Z",
      message: "bad",
      detail: "Authorization: Bearer sk-secret-value"
    });

    expect(() => assertSafeWorkbenchRepositoryData(unsafe)).toThrow("sensitive/raw evidence");
  });

  it("redactSecretValues strips secret-looking fragments so the text passes the sensitive scan", () => {
    const text = "岗位职责\ntoken = abc123 secret\n要求 React，密钥形如 sk-abcdefgh1234。";
    const redacted = redactSecretValues(text);

    expect(collectSensitiveRepositoryFindings(redacted)).toEqual([]);
    expect(redacted).toContain("岗位职责");
    expect(redacted).toContain("要求 React");
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("sk-abcdefgh1234");
  });
});
