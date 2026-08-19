import type { FactStatus, MaterialPreview, ProfileFact } from './types'
import type { CoreApiResult } from './coreApiResult'
import type { ByokKeyStatus, ClearByokKeyResult, SaveAndVerifyByokKeyRequest, SaveAndVerifyByokKeyResult } from './domain/byokKeyStore'
import type { CoreJobRecord, CoreState } from './domain/coreState'

export type FollowUpQuestion = {
  id: string
  requirementId?: string
  kind?: 'probe' | 'explore'
  question: string
  rationale: string
}

/** 渲染层历史别名；现在直接使用 CoreJobRecord/CoreState，避免两套类型分叉。 */
export type WorkflowJob = CoreJobRecord
export type WorkflowState = CoreState

export type ReevaluationPreview = { jobCount: number; modelCallCount: number }

export type ReconciliationPreview = { modelCallCount: number }

export type WorkflowApi = {
  getState: () => Promise<WorkflowState>
  onStateChanged: (listener: (state: WorkflowState) => void) => () => void
  ingestResume: (input: { kind: 'text'; resumeText: string }) => Promise<CoreApiResult<ProfileFact[]>>
  setFactStatus: (factId: string, status: FactStatus) => Promise<CoreApiResult<void>>
  setFactStatusBatch: (updates: { factId: string; status: FactStatus }[]) => Promise<CoreApiResult<void>>
  setPreferencesFromText: (input: { acceptText: string; vetoText: string }) => Promise<CoreApiResult<unknown>>
  setPreferenceRuleSet: (ruleSet: import('./types').PreferenceRuleSet) => Promise<CoreApiResult<import('./types').PreferenceRuleSet>>
  setAutoReevaluateRecentCount: (count: number) => Promise<CoreApiResult<void>>
  getReevaluationPreview: (scope: 'recent' | 'stale') => Promise<CoreApiResult<ReevaluationPreview>>
  reevaluateJobs: (scope: 'recent' | 'stale') => Promise<CoreApiResult<WorkflowJob[]>>
  setJobPinned: (jobId: string, pinned: boolean) => Promise<CoreApiResult<void>>
  evaluateJobFromJd: (input: {
    jdText: string
    jobBase: {
      title: string
      company: string
      city: string
      salaryK: [number, number] | null
      companyTags: string[]
      workAddress?: string | null
      sourceUrl?: string | null
    }
  }) => Promise<CoreApiResult<WorkflowJob>>
  buildResumeFollowUps: () => Promise<CoreApiResult<FollowUpQuestion[]>>
  applyResumeFollowUpAnswers: (
    questions: FollowUpQuestion[],
    answers: { questionId: string; answerText: string }[]
  ) => Promise<CoreApiResult<ProfileFact[]>>
  buildFollowUps: (jobId: string) => Promise<CoreApiResult<FollowUpQuestion[]>>
  applyFollowUpAnswers: (jobId: string, answers: { questionId: string; answerText: string }[]) => Promise<CoreApiResult<ProfileFact[]>>
  reevaluateJob: (jobId: string) => Promise<CoreApiResult<WorkflowJob | null>>
  draftMaterial: (jobId: string) => Promise<CoreApiResult<MaterialPreview>>
  renderResumeImage: (jobId: string) => Promise<CoreApiResult<string>>
  addManualFact: (input: { content: string; category: string }) => Promise<CoreApiResult<void>>
  clearFactLibrary: () => Promise<CoreApiResult<void>>
  clearJobs: () => Promise<CoreApiResult<void>>
  deleteFact: (factId: string) => Promise<CoreApiResult<void>>
  getReconciliationPreview: () => Promise<CoreApiResult<ReconciliationPreview>>
  dismissFactConflict: (conflictId: string) => Promise<CoreApiResult<void>>
  resolveFactConflict: (conflictId: string, winnerFactId: string) => Promise<CoreApiResult<void>>
  saveAndVerifyByokKey: (request: SaveAndVerifyByokKeyRequest) => Promise<SaveAndVerifyByokKeyResult>
  getByokKeyStatus: () => Promise<ByokKeyStatus>
  clearByokKey: () => Promise<ClearByokKeyResult>
  getLocalApiToken: () => Promise<{ token: string }>
}
