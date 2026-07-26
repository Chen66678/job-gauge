export type FactStatus = "confirmed" | "unconfirmed" | "rejected";
export type FactSourceType = "resume" | "user_answer" | "manual";
export type RequirementKind = "skill" | "experience" | "preference" | "risk";
export type Strategy = "personalize" | "generic_apply" | "skip" | "review";
export type RiskSeverity = "low" | "medium" | "high";
export type AuditEventType =
  | "profile_saved"
  | "jobs_imported"
  | "acquisition_previewed"
  | "acquisition_imported"
  | "job_saved"
  | "material_version_saved"
  | "application_package_confirmed"
  | "finished_material_exported"
  | "presend_dry_run_ready"
  | "ordinary_batch_dry_run_frozen"
  | "ordinary_batch_rehearsal_report_saved"
  | "preference_rules_confirmed"
  | "preference_rules_reset"
  | "llm_provider_probe_previewed"
  | "llm_provider_probe_stopped"
  | "sample_restored"
  | "local_data_cleared"
  | "settings_updated"
  | "browser_readonly_preflight"
  | "browser_readonly_imported"
  | "browser_readonly_stopped";
export type LlmProvider = "mock" | "qwen_dashscope" | "deepseek_text_fallback" | "other";
export type LlmKeyState = "not_configured" | "configured_elsewhere" | "configured_for_session" | "placeholder_only";
export type LlmCallType = "jd_profile_text_analysis" | "truthful_material_text_draft";
export type LlmStopReason =
  | "llm_key_missing"
  | "llm_key_not_session_scoped"
  | "llm_disclosure_missing"
  | "llm_disclosure_stale"
  | "llm_timeout"
  | "llm_network_failure"
  | "llm_auth_failed"
  | "llm_provider_rejected"
  | "llm_rate_limited"
  | "llm_schema_invalid"
  | "llm_output_unsafe"
  | "llm_output_contains_unconfirmed_fact"
  | "llm_output_injection_attempt"
  | "llm_user_cancelled"
  | "llm_uncertain_state";
export type JobAcquisitionSourceKind = "fixture" | "capture_file" | "visible_probe" | "boss_visible_readonly";
export type CaptureFormat = "html" | "text" | "json_snapshot" | "mock_session" | "current_page_snapshot";
export type ProbeAuthorizationType =
  | "manual_capture_confirmation"
  | "visible_readonly_probe_consent"
  | "boss_visible_readonly_import_consent";
export type ProbeAuthorizationScope = "single_readonly_session";
export type VisibleProbePageClass =
  | "authorization_gate"
  | "visible_context"
  | "boss_search_results"
  | "boss_job_detail"
  | "job_list"
  | "job_detail"
  | "unknown";
export type StopReason =
  | "login_required"
  | "login_expired"
  | "captcha_or_platform_warning"
  | "selector_ambiguity"
  | "page_shape_changed"
  | "list_detail_mismatch"
  | "capture_file_unsupported"
  | "capture_file_corrupted"
  | "capture_provenance_missing"
  | "capture_authorization_missing"
  | "authorization_missing"
  | "authorization_scope_invalid"
  | "visible_context_unavailable"
  | "page_not_user_visible"
  | "probe_session_expired"
  | "probe_state_unrecognized"
  | "network_failure"
  | "duplicate_import"
  | "extraction_mismatch"
  | "uncertain_state"
  | "user_paused"
  | "user_cancelled";
export type AcquisitionStatus = "preview_ready" | "stopped" | "imported";
export type AcquisitionDecision = "ready" | "review_required" | "duplicate";
export type AcquisitionEventLevel = "info" | "warn" | "error";
export type AcquisitionEventStage = "plan" | "extract" | "dedupe" | "stop" | "import";
export type FixtureScenarioId =
  | "fixture-success-mixed"
  | "fixture-login-stop"
  | "fixture-captcha-stop"
  | "fixture-selector-stop"
  | "fixture-shape-stop"
  | "fixture-mismatch-stop";
export type CaptureScenarioId =
  | "capture-success-html"
  | "capture-stop-unsupported"
  | "capture-stop-corrupted"
  | "capture-stop-provenance-missing"
  | "capture-stop-authorization-missing";
export type BossReadOnlyScenarioId =
  | "boss-readonly-success"
  | "boss-readonly-login-missing"
  | "boss-readonly-login-expired"
  | "boss-readonly-captcha-stop"
  | "boss-readonly-page-shape-stop"
  | "boss-readonly-selector-stop"
  | "boss-readonly-network-stop"
  | "boss-readonly-duplicate-stop"
  | "boss-readonly-extraction-mismatch-stop"
  | "boss-readonly-uncertain-stop"
  | "boss-readonly-user-cancelled"
  | "boss-readonly-user-paused";
export type VisibleProbeScenarioId =
  | "disabled"
  | "design-preview"
  | "authorization-draft"
  | "visible-context-draft"
  | "reading-draft"
  | "preview-draft"
  | "stop-draft"
  | "imported-draft"
  | "browser-boundary-execution-not-approved"
  | "browser-boundary-future-requirements"
  | "browser-boundary-stop-boundary"
  | "visible-readonly-execution-readiness"
  | "visible-readonly-future-requirements"
  | "visible-readonly-stop-and-recovery"
  | "future-permission-package-disabled"
  | "future-permission-package-scope"
  | "future-permission-package-stop-boundary"
  | "user-scope-not-active"
  | "user-scope-check"
  | "user-scope-blocked"
  | "user-scope-summary";

export interface ProbeAuthorization {
  type: "visible_readonly_probe_consent";
  confirmedAt: string;
  scope: "single_readonly_session";
  sourceLabel: "visible_probe" | "boss_visible_readonly";
  isMock: true;
}

export interface ProfileFact {
  id: string;
  category: string;
  label: string;
  value: string;
  sourceType: FactSourceType;
  sourceRef: string;
  status: FactStatus;
  confidence: number;
}

export type ImageResumeAttachmentStatus = "provided";
export type ImageResumeAttachmentKind = "image/jpeg" | "image/png" | "image/webp" | "unknown";
export type ImageResumeAttachmentSizeBucket = "under_1mb" | "1mb_to_5mb" | "over_5mb" | "unknown";

export interface ImageResumeAttachment {
  status: ImageResumeAttachmentStatus;
  displayName: string;
  mimeType: ImageResumeAttachmentKind;
  sizeBucket: ImageResumeAttachmentSizeBucket;
  sizeLabel: string;
  updatedAt: string;
  note: string | null;
}

export interface UserProfile {
  id: string;
  displayName: string;
  headline: string;
  targetRoles: string[];
  targetCities: string[];
  resumeText: string;
  facts: ProfileFact[];
  imageResumeAttachment: ImageResumeAttachment | null;
}

export interface PreferenceRuleSet {
  targetRoles: string[];
  targetCities: string[];
  minSalaryK: number;
  excludedKeywords: string[];
  preferCompanyTags: string[];
  confidence: number;
}

export interface WorkbenchData {
  version: 3;
  profile: UserProfile;
  preferences: PreferenceRuleSet;
  confirmedPreferenceRules?: ConfirmedPreferenceRules | null;
  jobs: JobPosting[];
  materialVersions: MaterialVersion[];
  materialChecklistAcknowledgements: MaterialChecklistAcknowledgementRecord[];
  auditLog: AuditEvent[];
  acquisitionLog: AcquisitionEvent[];
  settings: AppSettings;
  updatedAt: string;
}

export interface SearchPlan {
  id: string;
  source: JobAcquisitionSourceKind;
  fixtureId: FixtureScenarioId | null;
  captureScenarioId: CaptureScenarioId | null;
  visibleProbeScenarioId: VisibleProbeScenarioId | null;
  bossReadOnlyScenarioId: BossReadOnlyScenarioId | null;
  currentPageSnapshotText: string | null;
  keywords: string[];
  city: string;
  maxJobs: number;
  createdAt: string;
  confirmedReadOnly: boolean;
}

export interface CaptureProvenance {
  kind: "fixture_capture" | "capture_file" | "visible_readonly_session";
  captureMode: "fixture_mock" | "local_capture_file" | "visible_readonly_session_mock";
  sourceKind: JobAcquisitionSourceKind;
  captureFormat: CaptureFormat;
  captureFilename: string;
  captureDigest: string;
  sourceLabel: "fixture" | "local_capture" | "visible_probe" | "boss_visible_readonly";
  authorizationMode: ProbeAuthorizationType | null;
  authorizationConfirmedAt: string | null;
  sessionId: string | null;
  pageClass: VisibleProbePageClass | null;
  authorizationType: ProbeAuthorizationType | null;
  authorizationRecordedAt: string | null;
}

export interface ImportedJobEnvelope {
  id: string;
  runId: string;
  source: JobAcquisitionSourceKind;
  fixtureId: FixtureScenarioId | null;
  captureScenarioId: CaptureScenarioId | null;
  sourceType:
    | "fixture_list_detail"
    | "fixture_partial"
    | "local_capture_detail"
    | "local_capture_partial"
    | "visible_probe_detail"
    | "visible_probe_partial"
    | "boss_visible_readonly_detail"
    | "boss_visible_readonly_partial";
  sourceLabel: "fixture" | "local_capture" | "visible_probe" | "boss_visible_readonly";
  dedupeKey: string;
  title: string;
  company: string;
  city: string;
  salaryText: string;
  jdPreview: string;
  completenessScore: number;
  missingFields: string[];
  warnings: string[];
  decision: AcquisitionDecision;
  duplicateReason: string | null;
  imported: boolean;
  job: JobPosting | null;
  provenance: CaptureProvenance;
}

export interface AcquisitionEvent {
  id: string;
  runId: string;
  createdAt: string;
  source: JobAcquisitionSourceKind;
  fixtureId: FixtureScenarioId | null;
  captureScenarioId: CaptureScenarioId | null;
  stage: AcquisitionEventStage;
  level: AcquisitionEventLevel;
  message: string;
  stopReason: StopReason | null;
  relatedEnvelopeId: string | null;
  sourceLabel: "fixture" | "local_capture" | "visible_probe" | "boss_visible_readonly";
  sourceKind: JobAcquisitionSourceKind;
  captureDigest: string | null;
  authorizationMode: ProbeAuthorizationType | null;
  authorizationRecordedAt: string | null;
  authorizationType: ProbeAuthorizationType | null;
  sessionId: string | null;
  pageClass: VisibleProbePageClass | null;
  previewOnly: boolean;
}

export interface AcquisitionRunSummary {
  total: number;
  ready: number;
  reviewRequired: number;
  duplicates: number;
  imported: number;
  warnings: number;
  completenessAverage: number;
}

export interface AcquisitionRunResult {
  runId: string;
  source: JobAcquisitionSourceKind;
  plan: SearchPlan;
  status: AcquisitionStatus;
  stopReason: StopReason | null;
  stopMessage: string | null;
  envelopes: ImportedJobEnvelope[];
  events: AcquisitionEvent[];
  summary: AcquisitionRunSummary;
}

export interface JobAcquisitionSource {
  kind: JobAcquisitionSourceKind;
  preview(plan: SearchPlan, existingJobs: JobPosting[]): AcquisitionRunResult;
  run(plan: SearchPlan, existingJobs: JobPosting[]): AcquisitionRunResult;
}

export interface JobRequirement {
  id: string;
  kind: RequirementKind;
  label: string;
  evidence: string;
  requiredFactIds: string[];
  weight: number;
}

export interface JobRisk {
  id: string;
  label: string;
  severity: RiskSeverity;
  evidence: string;
}

export interface JobPosting {
  id: string;
  title: string;
  company: string;
  city: string;
  salaryK: [number, number];
  companyTags: string[];
  jdText: string;
  requirements: JobRequirement[];
  risks: JobRisk[];
  reviewFlags: string[];
  pinned: boolean;
  workAddress: string | null;
  sourceUrl: string | null;
}

export interface RequirementResult {
  requirementId: string;
  label: string;
  kind: RequirementKind;
  score: number;
  maxScore: number;
  matchedFactIds: string[];
  blockedFactIds: string[];
  gap: string | null;
  evidence: string;
}

export interface ScoreBreakdown {
  requirements: RequirementResult[];
  preference: number;
  riskPenalty: number;
  reviewPenalty: number;
}

export interface ScoreResult {
  total: number;
  strategy: Strategy;
  strategyLabel: string;
  summary: string;
  breakdown: ScoreBreakdown;
  gaps: string[];
  risks: string[];
  reviewFlags: string[];
}

export interface FactTrace {
  factId: string;
  label: string;
  value: string;
  source: string;
}

export interface ResumeLine {
  text: string;
  factIds: string[];
}

export interface MaterialPreview {
  status: "ready" | "needs_review" | "blocked";
  greeting: string;
  resumeLines: ResumeLine[];
  usedFacts: FactTrace[];
  blockedFacts: FactTrace[];
  guardrailNotes: string[];
}

export type ApplicationPackageConfirmationStatus = "draft" | "needs_review" | "confirmed_locally";

export interface ApplicationPackageFactCheck {
  factId: string;
  label: string;
  value: string;
  source: string;
  status: FactStatus;
  availability: "usable_confirmed" | "unavailable";
  reason: string;
}

export interface ApplicationPackageSnapshot {
  id: string;
  label: string;
  createdAt: string | null;
  jobId: string;
  jobTitle: string;
  company: string;
  scoreTotal: number;
  strategyLabel: string;
  materialStatus: MaterialPreview["status"];
  confirmationStatus: ApplicationPackageConfirmationStatus;
  sendingEnabled: false;
}

export interface ImageResumeArtifact {
  status: "provided" | "missing" | "blocked";
  title: string;
  summary: string;
  sourceLabel: string;
  assetLabel: string | null;
}

export interface MaterialPackageChecklistItem {
  id: "greeting" | "image_resume" | "confirmed_facts" | "risks" | "missing_items" | "local_export";
  title: string;
  statusLabel: string;
  summary: string;
  tone: "ok" | "warn" | "danger";
}

export interface MaterialChecklistAcknowledgementRecord {
  jobId: string;
  itemId: MaterialPackageChecklistItem["id"];
  checked: boolean;
  updatedAt: string;
}

export interface HighValueApplicationPackage {
  status: ApplicationPackageConfirmationStatus;
  packageLabel: string;
  greetingDraft: string;
  structuredResumeLines: string[];
  imageResumeArtifact: ImageResumeArtifact;
  scoreSummary: string;
  scoreTotal: number;
  strategyLabel: string;
  confirmedFactChecks: ApplicationPackageFactCheck[];
  unavailableFactChecks: ApplicationPackageFactCheck[];
  risks: string[];
  missingItems: string[];
  reviewItems: string[];
  localNotes: string[];
  snapshot: ApplicationPackageSnapshot;
  sendingEnabled: false;
  futureGateRequired: true;
  externalActionControls: [];
}

export interface FinishedMaterialExportMetadata {
  artifactId: string;
  artifactName: string;
  artifactFormat: "html";
  jobId: string;
  jobTitle: string;
  company: string;
  scoreTotal: number;
  strategyLabel: string;
  materialVersionId: string;
  snapshotLabel: string;
  confirmedFactCount: number;
  unavailableFactCount: number;
  generatedAt: string;
  localOnly: true;
  sendingEnabled: false;
}

export interface FinishedMaterialExportPackage {
  greetingText: string;
  resumeArtifactLines: string[];
  imageResumeArtifact: ImageResumeArtifact;
  checklist: MaterialPackageChecklistItem[];
  metadata: FinishedMaterialExportMetadata;
  localExportActions: Array<"download_html" | "print_ready_preview">;
  factChecks: ApplicationPackageFactCheck[];
  unavailableFacts: ApplicationPackageFactCheck[];
  sendingEnabled: false;
  externalActionControls: [];
}

export type PreSendDryRunStatus = "not_ready" | "ready_locally" | "blocked";

export interface PreSendAcknowledgement {
  visibleContext: boolean;
  perJobConfirmation: boolean;
  stopConditions: boolean;
  noRetryHiddenBatch: boolean;
  notExecutionAuthorization: boolean;
}

export interface PreSendDryRunContract {
  status: PreSendDryRunStatus;
  reason: string;
  jobId: string;
  jobTitle: string;
  company: string;
  scoreTotal: number;
  strategyLabel: string;
  greetingSummary: string;
  exportArtifactName: string;
  materialVersionId: string;
  snapshotLabel: string;
  confirmedFactCount: number;
  unavailableFactCount: number;
  localOnly: true;
  sendingEnabled: false;
  futureActionContract: string[];
  stopConditions: string[];
  acknowledgement: PreSendAcknowledgement;
  missingAcknowledgements: Array<keyof PreSendAcknowledgement>;
  dryRunRecord: {
    id: string;
    createdAt: string;
    status: PreSendDryRunStatus;
    reason: string;
  };
  externalActionControls: [];
}

export type OrdinaryBatchDryRunStatus = "not_ready" | "frozen_locally" | "blocked";

export interface OrdinaryBatchAcknowledgement {
  frozenRange: boolean;
  highValueExcluded: boolean;
  conservativeLimits: boolean;
  stopContract: boolean;
  notExecutionAuthorization: boolean;
}

export interface OrdinaryBatchJobItem {
  jobId: string;
  title: string;
  company: string;
  city: string;
  scoreTotal: number;
  strategy: Strategy;
  strategyLabel: string;
  reason: string;
}

export interface OrdinaryBatchDryRunPlan {
  status: OrdinaryBatchDryRunStatus;
  reason: string;
  candidates: OrdinaryBatchJobItem[];
  exclusions: OrdinaryBatchJobItem[];
  ruleSummary: string[];
  limits: {
    defaultMaxCandidates: number;
    intervalRangeSeconds: [number, number];
    pauseCancelAvailable: true;
    noRangeExpansion: true;
    noRetryLoop: true;
  };
  stopConditions: string[];
  materialStrategyPreview: {
    summary: string;
    confirmedFactLabels: string[];
    unavailableFactCount: number;
  };
  acknowledgement: OrdinaryBatchAcknowledgement;
  missingAcknowledgements: Array<keyof OrdinaryBatchAcknowledgement>;
  dryRunRecord: {
    id: string;
    createdAt: string;
    status: OrdinaryBatchDryRunStatus;
    candidateCount: number;
    excludedCount: number;
    reason: string;
  };
  localOnly: true;
  batchSendingEnabled: false;
  externalActionControls: [];
}

export type OrdinaryBatchRunRehearsalStatus =
  | "preview_only"
  | "running_locally"
  | "paused_locally"
  | "cancelled_locally"
  | "stopped_locally"
  | "completed_locally";

export type OrdinaryBatchRunStopReason =
  | "captcha_or_safeguard_warning"
  | "login_or_session_expiry"
  | "selector_ambiguity"
  | "upload_send_uncertainty"
  | "page_mismatch"
  | "user_cancel"
  | "platform_warning";

export interface OrdinaryBatchRunQueueItem {
  queueIndex: number;
  jobId: string;
  title: string;
  company: string;
  city: string;
  scoreTotal: number;
  strategyLabel: string;
  includedReason: string;
  intervalBeforeSeconds: number;
  materialStrategyLabel: string;
  simulatedResult: "pending_local" | "completed_local" | "skipped_after_stop_local";
}

export interface OrdinaryBatchRunAuditReport {
  reportId: string;
  createdAt: string;
  status: OrdinaryBatchRunRehearsalStatus;
  queuedCount: number;
  simulatedCompletedCount: number;
  skippedOrStoppedCount: number;
  stopReason: OrdinaryBatchRunStopReason | null;
  intervalPolicy: string;
  confirmedRuleVersion: string | null;
  materialStrategy: string;
  boundaryStatement: string;
  sentRecordCreated: false;
  platformOutcomeRepresented: false;
  localOnly: true;
  batchSendingEnabled: false;
  externalLlmCall: false;
  externalActionControls: [];
}

export interface OrdinaryBatchRunRehearsal {
  status: OrdinaryBatchRunRehearsalStatus;
  statusLabel: string;
  reason: string;
  queue: OrdinaryBatchRunQueueItem[];
  exclusions: OrdinaryBatchJobItem[];
  maxCandidateLimit: number;
  intervalPolicy: {
    rangeSeconds: [number, number];
    label: string;
  };
  stopReason: OrdinaryBatchRunStopReason | null;
  stopReasonLabel: string | null;
  stopOptions: Array<{ value: OrdinaryBatchRunStopReason; label: string }>;
  confirmedRuleVersion: string | null;
  materialStrategyLabel: string;
  auditReport: OrdinaryBatchRunAuditReport;
  localOnly: true;
  batchSendingEnabled: false;
  sentRecordCreated: false;
  platformOutcomeRepresented: false;
  externalLlmCall: false;
  externalActionControls: [];
}

export type PreferenceSignalKind =
  | "commute"
  | "company_size"
  | "salary"
  | "early_career"
  | "risk_avoidance"
  | "high_value_personalization";

export interface PreferenceSignal {
  kind: PreferenceSignalKind;
  label: string;
  evidence: string;
}

export interface PreferenceRuleAdjustment {
  field: "targetCities" | "minSalaryK" | "excludedKeywords" | "preferCompanyTags";
  label: string;
  before: string;
  after: string;
}

export interface PreferenceRuleDraft {
  id: string;
  sourceText: string;
  parser: "local_deterministic_mock";
  createdAt: string;
  status: "draft_unconfirmed";
  signals: PreferenceSignal[];
  adjustments: PreferenceRuleAdjustment[];
  proposedPreferences: PreferenceRuleSet;
  ordinaryBatchImpact: {
    beforeCandidateCount: number;
    afterCandidateCount: number;
    beforeExcludedCount: number;
    afterExcludedCount: number;
    summary: string;
  };
  highValueImpact: string;
  warnings: string[];
  requiresConfirmation: true;
  localOnly: true;
  externalLlmCall: false;
  batchSendingEnabled: false;
}

export interface ConfirmedPreferenceRules {
  version: string;
  confirmedAt: string;
  sourceText: string;
  parser: "local_deterministic_mock";
  signals: PreferenceSignal[];
  adjustments: PreferenceRuleAdjustment[];
  activeSummary: string[];
  ordinaryBatchImpact: PreferenceRuleDraft["ordinaryBatchImpact"];
  resetAcknowledgedAt: string | null;
  localOnly: true;
  externalLlmCall: false;
  batchSendingEnabled: false;
}

export interface MaterialVersion {
  id: string;
  jobId: string;
  jobTitle: string;
  company: string;
  createdAt: string;
  status: MaterialPreview["status"];
  strategy: Strategy;
  strategyLabel: string;
  greeting: string;
  resumeLines: ResumeLine[];
  usedFacts: FactTrace[];
  blockedFacts: FactTrace[];
  guardrailNotes: string[];
  packageKind?: "high_value_application_package";
  confirmationStatus?: ApplicationPackageConfirmationStatus;
  snapshotLabel?: string;
  confirmedLocallyAt?: string | null;
  sendingEnabled?: false;
  scoreTotal?: number;
  risks?: string[];
  missingItems?: string[];
}

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  createdAt: string;
  message: string;
  detail: string;
}

export interface LlmSettings {
  provider: LlmProvider;
  keyState: LlmKeyState;
  keyLabel: string;
  disclosureAccepted: boolean;
}

export interface AppSettings {
  llm: LlmSettings;
  localStorageKey: string;
  exportMode: "placeholder_only";
}
