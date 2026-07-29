import type { ProfileFact } from './types'
import { unwrap } from './coreApiResult'
import type { FollowUpQuestion, WorkflowApi, WorkflowJob } from './workflowApi'

export type FollowUpApi = Pick<WorkflowApi, 'getState' | 'buildFollowUps' | 'applyFollowUpAnswers' | 'reevaluateJob'>

export type { FollowUpQuestion }

export async function reevaluateForWorkflow(api: FollowUpApi, jobId: string): Promise<WorkflowJob | null> {
  return unwrap(await api.reevaluateJob(jobId))
}

export async function submitJobFollowUpsForWorkflow(input: {
  api: FollowUpApi
  jobId: string
  questions: FollowUpQuestion[]
  answers: Record<string, string>
}): Promise<{ newFacts: ProfileFact[]; hadNewFacts: boolean }> {
  const answerList = input.questions.map(question => ({
    questionId: question.id,
    answerText: input.answers[question.id]?.trim() ?? '',
  }))
  const newFacts = answerList.some(item => item.answerText)
    ? unwrap(await input.api.applyFollowUpAnswers(input.jobId, answerList))
    : []
  return { newFacts, hadNewFacts: newFacts.length > 0 }
}
