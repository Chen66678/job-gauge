import type { FactStatus, JobRequirement, MaterialPreview, ProfileFact } from './types'
import type { CoreApiResult } from './coreApiResult'
import type { ByokKeyStatus, ClearByokKeyResult, SaveAndVerifyByokKeyRequest, SaveAndVerifyByokKeyResult } from './domain/byokKeyStore'

export type FollowUpQuestion = {
  id: string
  requirementId?: string
  kind?: 'probe' | 'explore'
  question: string
  rationale: string
}

export type WorkflowJob = {
  job: { id: string; title: string; company: string; city: string; requirements?: JobRequirement[] }
  evaluation: {
    vetoed: true
    vetoRuleLabel: string
  } | {
    vetoed: false
    score: {
      total: number
      strategyLabel: string
      strategy: string
      gaps: string[]
      risks: string[]
    }
  } | null
  evaluationError: string | null
  followUps: FollowUpQuestion[]
  material: MaterialPreview | null
}

export type WorkflowState = {
  factLibrary: ProfileFact[]
  jobs: WorkflowJob[]
}

export type WorkflowApi = {
  getState: () => Promise<WorkflowState>
  onStateChanged: (listener: (state: WorkflowState) => void) => () => void
  ingestResume: (input: { kind: 'text'; resumeText: string }) => Promise<CoreApiResult<ProfileFact[]>>
  setFactStatus: (factId: string, status: FactStatus) => Promise<CoreApiResult<void>>
  setFactStatusBatch: (updates: { factId: string; status: FactStatus }[]) => Promise<CoreApiResult<void>>
  setPreferencesFromText: (input: { acceptText: string; vetoText: string }) => Promise<CoreApiResult<unknown>>
  evaluateJobFromJd: (input: {
    jdText: string
    jobBase: { title: string; company: string; city: string; salaryK: [number, number]; companyTags: string[] }
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
  exportResume: (jobId: string) => Promise<CoreApiResult<string>>
  addManualFact: (input: { content: string; category: string }) => Promise<CoreApiResult<void>>
  clearFactLibrary: () => Promise<CoreApiResult<void>>
  deleteFact: (factId: string) => Promise<CoreApiResult<void>>
  saveAndVerifyByokKey: (request: SaveAndVerifyByokKeyRequest) => Promise<SaveAndVerifyByokKeyResult>
  getByokKeyStatus: () => Promise<ByokKeyStatus>
  clearByokKey: () => Promise<ClearByokKeyResult>
  getLocalApiToken: () => Promise<{ token: string }>
}
