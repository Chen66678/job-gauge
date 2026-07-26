import { sampleJobs, samplePreferences, sampleProfile } from "../sampleData";
import type {
  AcquisitionEvent,
  AppSettings,
  AuditEvent,
  ConfirmedPreferenceRules,
  ImageResumeAttachment,
  JobPosting,
  MaterialChecklistAcknowledgementRecord,
  MaterialVersion,
  PreferenceRuleSet,
  ProfileFact,
  UserProfile,
  WorkbenchData
} from "../types";

export const WORKBENCH_STORAGE_KEY = "boss-local-job-workbench:v0.1";

export interface LocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LoadWorkbenchResult {
  data: WorkbenchData;
  source: "local" | "sample";
  error: string | null;
}

export function createSampleWorkbenchData(updatedAt = "2026-06-25T00:00:00.000Z"): WorkbenchData {
  return {
    version: 3,
    profile: clone(sampleProfile),
    preferences: clone(samplePreferences),
    confirmedPreferenceRules: null,
    jobs: clone(sampleJobs),
    materialVersions: [],
    materialChecklistAcknowledgements: [],
    auditLog: [],
    acquisitionLog: [],
    settings: createDefaultSettings(),
    updatedAt
  };
}

export function loadWorkbenchData(storage: LocalStorageLike): LoadWorkbenchResult {
  const raw = storage.getItem(WORKBENCH_STORAGE_KEY);
  if (!raw) {
    return { data: createSampleWorkbenchData(), source: "sample", error: null };
  }

  const parsed = parseWorkbenchData(raw);
  if (!parsed) {
    return {
      data: createSampleWorkbenchData(),
      source: "sample",
      error: "本地数据无法解析，已回退到安全样例。"
    };
  }

  return { data: parsed, source: "local", error: null };
}

export function saveWorkbenchData(storage: LocalStorageLike, data: WorkbenchData): void {
  storage.setItem(WORKBENCH_STORAGE_KEY, serializeWorkbenchData(withUpdatedAt(data)));
}

export function clearWorkbenchData(storage: LocalStorageLike): void {
  storage.removeItem(WORKBENCH_STORAGE_KEY);
}

export function serializeWorkbenchData(data: WorkbenchData): string {
  return JSON.stringify(data);
}

export function parseWorkbenchData(raw: string): WorkbenchData | null {
  try {
    const value: unknown = JSON.parse(raw);
    return normalizeWorkbenchData(value);
  } catch {
    return null;
  }
}

export function withUpdatedAt(data: WorkbenchData, updatedAt = new Date().toISOString()): WorkbenchData {
  return {
    ...data,
    updatedAt
  };
}

function isWorkbenchData(value: unknown): value is WorkbenchData {
  if (!isRecord(value)) return false;
  return (
    value.version === 3 &&
    typeof value.updatedAt === "string" &&
    isUserProfile(value.profile) &&
    isPreferenceRuleSet(value.preferences) &&
    (value.confirmedPreferenceRules === undefined ||
      value.confirmedPreferenceRules === null ||
      isConfirmedPreferenceRules(value.confirmedPreferenceRules)) &&
    Array.isArray(value.jobs) &&
    value.jobs.every(isJobPosting) &&
    Array.isArray(value.materialVersions) &&
    value.materialVersions.every(isMaterialVersion) &&
    Array.isArray(value.materialChecklistAcknowledgements) &&
    value.materialChecklistAcknowledgements.every(isMaterialChecklistAcknowledgementRecord) &&
    Array.isArray(value.auditLog) &&
    value.auditLog.every(isAuditEvent) &&
    Array.isArray(value.acquisitionLog) &&
    value.acquisitionLog.every(isAcquisitionEvent) &&
    isAppSettings(value.settings)
  );
}

function isUserProfile(value: unknown): value is UserProfile {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    typeof value.headline === "string" &&
    typeof value.resumeText === "string" &&
    isStringArray(value.targetRoles) &&
    isStringArray(value.targetCities) &&
    Array.isArray(value.facts) &&
    value.facts.every(isProfileFact) &&
    (value.imageResumeAttachment === null || value.imageResumeAttachment === undefined || isImageResumeAttachment(value.imageResumeAttachment))
  );
}

function isImageResumeAttachment(value: unknown): value is ImageResumeAttachment {
  if (!isRecord(value)) return false;
  return (
    value.status === "provided" &&
    typeof value.displayName === "string" &&
    (value.mimeType === "image/jpeg" || value.mimeType === "image/png" || value.mimeType === "image/webp" || value.mimeType === "unknown") &&
    (value.sizeBucket === "under_1mb" || value.sizeBucket === "1mb_to_5mb" || value.sizeBucket === "over_5mb" || value.sizeBucket === "unknown") &&
    typeof value.sizeLabel === "string" &&
    typeof value.updatedAt === "string" &&
    (typeof value.note === "string" || value.note === null)
  );
}

function isProfileFact(value: unknown): value is ProfileFact {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.category === "string" &&
    typeof value.label === "string" &&
    typeof value.value === "string" &&
    (value.sourceType === "resume" || value.sourceType === "user_answer" || value.sourceType === "manual") &&
    typeof value.sourceRef === "string" &&
    (value.status === "confirmed" || value.status === "unconfirmed" || value.status === "rejected") &&
    typeof value.confidence === "number"
  );
}

function isResumeLine(value: unknown): boolean {
  return isRecord(value) && typeof (value as Record<string, unknown>).text === "string" && isStringArray((value as Record<string, unknown>).factIds);
}

function isPreferenceRuleSet(value: unknown): value is PreferenceRuleSet {
  if (!isRecord(value)) return false;
  return (
    isStringArray(value.targetRoles) &&
    isStringArray(value.targetCities) &&
    typeof value.minSalaryK === "number" &&
    isStringArray(value.excludedKeywords) &&
    isStringArray(value.preferCompanyTags) &&
    typeof value.confidence === "number"
  );
}

function isJobPosting(value: unknown): value is JobPosting {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.company === "string" &&
    typeof value.city === "string" &&
    Array.isArray(value.salaryK) &&
    value.salaryK.length === 2 &&
    typeof value.salaryK[0] === "number" &&
    typeof value.salaryK[1] === "number" &&
    isStringArray(value.companyTags) &&
    typeof value.jdText === "string" &&
    Array.isArray(value.requirements) &&
    Array.isArray(value.risks) &&
    isStringArray(value.reviewFlags)
  );
}

function isMaterialVersion(value: unknown): value is MaterialVersion {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.jobId === "string" &&
    typeof value.jobTitle === "string" &&
    typeof value.company === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.strategy === "string" &&
    typeof value.strategyLabel === "string" &&
    typeof value.greeting === "string" &&
    Array.isArray(value.resumeLines) &&
    value.resumeLines.every(isResumeLine) &&
    Array.isArray(value.usedFacts) &&
    Array.isArray(value.blockedFacts) &&
    Array.isArray(value.guardrailNotes) &&
    value.guardrailNotes.every((item) => typeof item === "string") &&
    (value.packageKind === undefined || value.packageKind === "high_value_application_package") &&
    (value.confirmationStatus === undefined ||
      value.confirmationStatus === "draft" ||
      value.confirmationStatus === "needs_review" ||
      value.confirmationStatus === "confirmed_locally") &&
    (value.snapshotLabel === undefined || typeof value.snapshotLabel === "string") &&
    (value.confirmedLocallyAt === undefined || typeof value.confirmedLocallyAt === "string" || value.confirmedLocallyAt === null) &&
    (value.sendingEnabled === undefined || value.sendingEnabled === false) &&
    (value.scoreTotal === undefined || typeof value.scoreTotal === "number") &&
    (value.risks === undefined || isStringArray(value.risks)) &&
    (value.missingItems === undefined || isStringArray(value.missingItems))
  );
}

function isAuditEvent(value: unknown): value is AuditEvent {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.message === "string" &&
    typeof value.detail === "string"
  );
}

function isMaterialChecklistAcknowledgementRecord(value: unknown): value is MaterialChecklistAcknowledgementRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.jobId === "string" &&
    typeof value.itemId === "string" &&
    typeof value.checked === "boolean" &&
    typeof value.updatedAt === "string"
  );
}

function isAcquisitionEvent(value: unknown): value is AcquisitionEvent {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.runId === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.source === "string" &&
    (typeof value.fixtureId === "string" || value.fixtureId === null) &&
    (typeof value.captureScenarioId === "string" || value.captureScenarioId === null) &&
    typeof value.stage === "string" &&
    typeof value.level === "string" &&
    typeof value.message === "string" &&
    (typeof value.stopReason === "string" || value.stopReason === null) &&
    (typeof value.relatedEnvelopeId === "string" || value.relatedEnvelopeId === null) &&
    (value.sourceLabel === "fixture" ||
      value.sourceLabel === "local_capture" ||
      value.sourceLabel === "visible_probe" ||
      value.sourceLabel === "boss_visible_readonly") &&
    typeof value.sourceKind === "string" &&
    (typeof value.captureDigest === "string" || value.captureDigest === null) &&
    (value.authorizationMode === "manual_capture_confirmation" || value.authorizationMode === "visible_readonly_probe_consent" || value.authorizationMode === null) &&
    (typeof value.authorizationRecordedAt === "string" || value.authorizationRecordedAt === null) &&
    (value.authorizationType === "manual_capture_confirmation" || value.authorizationType === "visible_readonly_probe_consent" || value.authorizationType === null) &&
    (typeof value.sessionId === "string" || value.sessionId === null) &&
    (typeof value.pageClass === "string" || value.pageClass === null) &&
    typeof value.previewOnly === "boolean"
  );
}

function isConfirmedPreferenceRules(value: unknown): value is ConfirmedPreferenceRules {
  if (!isRecord(value)) return false;
  return (
    typeof value.version === "string" &&
    typeof value.confirmedAt === "string" &&
    typeof value.sourceText === "string" &&
    value.parser === "local_deterministic_mock" &&
    Array.isArray(value.signals) &&
    Array.isArray(value.adjustments) &&
    isStringArray(value.activeSummary) &&
    isRecord(value.ordinaryBatchImpact) &&
    (typeof value.resetAcknowledgedAt === "string" || value.resetAcknowledgedAt === null) &&
    value.localOnly === true &&
    value.externalLlmCall === false &&
    value.batchSendingEnabled === false
  );
}

function isAppSettings(value: unknown): value is AppSettings {
  if (!isRecord(value) || !isRecord(value.llm)) return false;
  return (
    typeof value.localStorageKey === "string" &&
    value.exportMode === "placeholder_only" &&
    typeof value.llm.provider === "string" &&
    typeof value.llm.keyState === "string" &&
    typeof value.llm.keyLabel === "string" &&
    typeof value.llm.disclosureAccepted === "boolean"
  );
}

function normalizeWorkbenchData(value: unknown): WorkbenchData | null {
  if (!isRecord(value)) return null;

  if (isWorkbenchData(value)) {
    return {
      ...value,
      profile: normalizeUserProfile(value.profile),
      materialChecklistAcknowledgements: normalizeMaterialChecklistAcknowledgements(value.materialChecklistAcknowledgements),
      settings: normalizeAppSettings(value.settings)
    };
  }

  // Migrate TEAM-011 v0.1 data into the richer v3 shape.
  if (
    value.version === 2 &&
    typeof value.updatedAt === "string" &&
    isUserProfile(value.profile) &&
    isPreferenceRuleSet(value.preferences) &&
    Array.isArray(value.jobs) &&
    value.jobs.every(isJobPosting) &&
    Array.isArray(value.materialVersions) &&
    value.materialVersions.every(isMaterialVersion) &&
    Array.isArray(value.auditLog) &&
    value.auditLog.every(isAuditEvent) &&
    isAppSettings(value.settings)
  ) {
    return {
      version: 3,
      profile: normalizeUserProfile(value.profile),
      preferences: value.preferences,
      confirmedPreferenceRules: null,
      jobs: value.jobs,
      materialVersions: value.materialVersions,
      materialChecklistAcknowledgements: [],
      auditLog: value.auditLog,
      acquisitionLog: [],
      settings: normalizeAppSettings(value.settings),
      updatedAt: value.updatedAt
    };
  }

  // Migrate TEAM-009 foundation data into the richer v3 shape.
  if (
    value.version === 1 &&
    typeof value.updatedAt === "string" &&
    isUserProfile(value.profile) &&
    isPreferenceRuleSet(value.preferences) &&
    Array.isArray(value.jobs) &&
    value.jobs.every(isJobPosting)
  ) {
    return {
      version: 3,
      profile: normalizeUserProfile(value.profile),
      preferences: value.preferences,
      confirmedPreferenceRules: null,
      jobs: value.jobs,
      materialVersions: [],
      materialChecklistAcknowledgements: [],
      auditLog: [],
      acquisitionLog: [],
      settings: createDefaultSettings(),
      updatedAt: value.updatedAt
    };
  }

  return null;
}

function normalizeUserProfile(profile: UserProfile): UserProfile {
  return {
    ...profile,
    imageResumeAttachment: normalizeImageResumeAttachment(profile.imageResumeAttachment)
  };
}

function normalizeImageResumeAttachment(value: unknown): ImageResumeAttachment | null {
  if (!isImageResumeAttachment(value)) return null;
  return {
    status: "provided",
    displayName: sanitizeAttachmentLabel(value.displayName),
    mimeType: value.mimeType,
    sizeBucket: value.sizeBucket,
    sizeLabel: sanitizeSizeLabel(value.sizeLabel),
    updatedAt: value.updatedAt,
    note: sanitizeAttachmentNote(value.note)
  };
}

function normalizeMaterialChecklistAcknowledgements(value: MaterialChecklistAcknowledgementRecord[]): MaterialChecklistAcknowledgementRecord[] {
  return value
    .filter((item) => item.checked === true)
    .map((item) => ({
      jobId: item.jobId,
      itemId: item.itemId,
      checked: true,
      updatedAt: item.updatedAt
    }));
}

function sanitizeAttachmentLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "未命名图片简历";
  if (trimmed.length > 80) return `${trimmed.slice(0, 77)}...`;
  return trimmed;
}

function sanitizeSizeLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "大小未记录";
  if (trimmed.length > 32) return `${trimmed.slice(0, 29)}...`;
  return trimmed;
}

function sanitizeAttachmentNote(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 120) return `${trimmed.slice(0, 117)}...`;
  return trimmed;
}

function createDefaultSettings(): AppSettings {
  return {
    llm: {
      provider: "mock",
      keyState: "not_configured",
      keyLabel: "未配置真实 API key；首个计划 provider 为 Qwen / DashScope / 阿里云百炼",
      disclosureAccepted: false
    },
    localStorageKey: WORKBENCH_STORAGE_KEY,
    exportMode: "placeholder_only"
  };
}

function normalizeAppSettings(settings: AppSettings): AppSettings {
  const provider = normalizeLlmProvider(settings.llm.provider);
  return {
    ...settings,
    llm: {
      ...settings.llm,
      provider,
      keyLabel:
        settings.llm.keyLabel.trim() ||
        "未配置真实 API key；首个计划 provider 为 Qwen / DashScope / 阿里云百炼"
    }
  };
}

function normalizeLlmProvider(provider: string): AppSettings["llm"]["provider"] {
  if (provider === "mock") return "mock";
  if (provider === "qwen_dashscope" || provider === "dashscope") return "qwen_dashscope";
  if (provider === "deepseek_text_fallback") return "deepseek_text_fallback";
  return "other";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
