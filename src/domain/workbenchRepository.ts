import type { WorkbenchData } from "../types";
import {
  type LoadWorkbenchResult,
  type LocalStorageLike,
  clearWorkbenchData,
  createSampleWorkbenchData,
  loadWorkbenchData,
  parseWorkbenchData,
  saveWorkbenchData,
  serializeWorkbenchData,
  withUpdatedAt
} from "./storage";

export type WorkbenchRepositoryKind = "local_storage" | "file_backed_json_scaffold";

export interface WorkbenchRepositoryMetadata {
  kind: WorkbenchRepositoryKind;
  schemaVersion: 1;
  storageFormat: "workbench_data_json";
  nativeSqliteDeferred: boolean;
}

export interface WorkbenchRepositoryLoadResult extends LoadWorkbenchResult {
  repository: WorkbenchRepositoryMetadata;
}

export interface WorkbenchRepository {
  readonly metadata: WorkbenchRepositoryMetadata;
  initialize(): Promise<WorkbenchRepositoryMetadata>;
  load(): Promise<WorkbenchRepositoryLoadResult>;
  save(data: WorkbenchData): Promise<void>;
  clear(): Promise<void>;
  exportSnapshot(): Promise<string | null>;
}

export interface WorkbenchRepositoryBlobStore {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}

interface WorkbenchRepositoryEnvelope {
  schemaVersion: 1;
  storageFormat: "workbench_data_json";
  savedAt: string;
  data: WorkbenchData;
}

const FILE_BACKED_METADATA: WorkbenchRepositoryMetadata = {
  kind: "file_backed_json_scaffold",
  schemaVersion: 1,
  storageFormat: "workbench_data_json",
  nativeSqliteDeferred: true
};

const LOCAL_STORAGE_METADATA: WorkbenchRepositoryMetadata = {
  kind: "local_storage",
  schemaVersion: 1,
  storageFormat: "workbench_data_json",
  nativeSqliteDeferred: false
};

const FORBIDDEN_KEYS = [
  "rawhtml",
  "raw_html",
  "rawscreenshot",
  "raw_screenshot",
  "screenshot",
  "cookie",
  "password",
  "authorization",
  "bearer",
  "apikey",
  "api_key",
  "browserprofile",
  "browser_profile",
  "profilepath",
  "profile_path",
  "rawfullpagetext",
  "raw_full_page_text",
  "chatcontent",
  "chat_content",
  "contactcontent",
  "contact_content",
  "accountevidence",
  "account_evidence",
  "platformsafeguarddetails",
  "platform_safeguard_details"
];

const SECRET_VALUE_PATTERNS = [/cookie\s*=/i, /password\s*=/i, /token\s*=/i, /authorization\s*:\s*bearer/i, /\bsk-[A-Za-z0-9_-]{8,}\b/];

export function createLocalStorageWorkbenchRepository(storage: LocalStorageLike): WorkbenchRepository {
  return {
    metadata: LOCAL_STORAGE_METADATA,
    async initialize() {
      return LOCAL_STORAGE_METADATA;
    },
    async load() {
      return { ...loadWorkbenchData(storage), repository: LOCAL_STORAGE_METADATA };
    },
    async save(data) {
      assertSafeWorkbenchRepositoryData(data);
      saveWorkbenchData(storage, data);
    },
    async clear() {
      clearWorkbenchData(storage);
    },
    async exportSnapshot() {
      return storage.getItem("boss-local-job-workbench:v0.1");
    }
  };
}

export function createFileBackedJsonWorkbenchRepository(store: WorkbenchRepositoryBlobStore): WorkbenchRepository {
  return {
    metadata: FILE_BACKED_METADATA,
    async initialize() {
      return FILE_BACKED_METADATA;
    },
    async load() {
      const raw = await store.read();
      if (!raw) {
        return { data: createSampleWorkbenchData(), source: "sample", error: null, repository: FILE_BACKED_METADATA };
      }
      const parsed = parseRepositoryEnvelope(raw);
      if (!parsed) {
        return {
          data: createSampleWorkbenchData(),
          source: "sample",
          error: "Repository data could not be parsed; fell back to safe sample data.",
          repository: FILE_BACKED_METADATA
        };
      }
      return { data: parsed, source: "local", error: null, repository: FILE_BACKED_METADATA };
    },
    async save(data) {
      assertSafeWorkbenchRepositoryData(data);
      const envelope: WorkbenchRepositoryEnvelope = {
        schemaVersion: 1,
        storageFormat: "workbench_data_json",
        savedAt: new Date().toISOString(),
        data: withUpdatedAt(data)
      };
      await store.write(JSON.stringify(envelope));
    },
    async clear() {
      await store.remove();
    },
    async exportSnapshot() {
      return store.read();
    }
  };
}

export function parseRepositoryEnvelope(raw: string): WorkbenchData | null {
  try {
    const value = JSON.parse(raw) as Partial<WorkbenchRepositoryEnvelope> | WorkbenchData;
    if (isRepositoryEnvelope(value)) {
      return parseWorkbenchData(serializeWorkbenchData(value.data));
    }
    return parseWorkbenchData(raw);
  } catch {
    return null;
  }
}

export function assertSafeWorkbenchRepositoryData(data: WorkbenchData): void {
  const findings = collectSensitiveRepositoryFindings(data);
  if (findings.length > 0) {
    throw new Error(`Workbench repository rejected sensitive/raw evidence fields: ${findings.slice(0, 5).join(", ")}`);
  }
}

export function collectSensitiveRepositoryFindings(value: unknown, path = "workbench"): string[] {
  if (typeof value === "string") {
    return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value)) ? [path] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectSensitiveRepositoryFindings(item, `${path}[${index}]`));
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, nested]) => {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
    const keyPath = `${path}.${key}`;
    if (FORBIDDEN_KEYS.includes(normalizedKey)) return [keyPath];
    if ((normalizedKey === "sessionid" || normalizedKey === "session_id") && typeof nested === "string" && nested.trim()) {
      return [keyPath];
    }
    return collectSensitiveRepositoryFindings(nested, keyPath);
  });
}

function isRepositoryEnvelope(value: unknown): value is WorkbenchRepositoryEnvelope {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    value.storageFormat === "workbench_data_json" &&
    typeof value.savedAt === "string" &&
    isRecord(value.data)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
