import type { ProfileFact } from './types'
import type { FollowUpQuestion } from './workflowApi'

const STORAGE_KEY = 'boss-local-resume-followups:v1'

interface ResumeFollowUpCacheEntry {
  fingerprint: string
  questions: FollowUpQuestion[]
  savedAt: string
}

export function computeResumeFollowUpFingerprint(facts: ProfileFact[]): string {
  return facts
    .filter(fact => fact.status !== 'rejected')
    .map(fact => `${fact.id}\u001f${fact.status}\u001f${fact.value}`)
    .join('\n')
}

export function readCachedResumeFollowUps(facts: ProfileFact[]): FollowUpQuestion[] | null {
  const fingerprint = computeResumeFollowUpFingerprint(facts)
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const entry = JSON.parse(raw) as Partial<ResumeFollowUpCacheEntry>
    if (entry.fingerprint !== fingerprint || !Array.isArray(entry.questions)) return null
    if (!entry.questions.every(isFollowUpQuestion)) return null
    return entry.questions
  } catch {
    return null
  }
}

export function writeCachedResumeFollowUps(facts: ProfileFact[], questions: FollowUpQuestion[]): void {
  if (!Array.isArray(questions) || !questions.every(isFollowUpQuestion)) return
  const entry: ResumeFollowUpCacheEntry = {
    fingerprint: computeResumeFollowUpFingerprint(facts),
    questions,
    savedAt: new Date().toISOString()
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entry))
  } catch {
    // localStorage 不可用时只放弃缓存，不能影响追问流程。
  }
}

function isFollowUpQuestion(value: unknown): value is FollowUpQuestion {
  if (typeof value !== 'object' || value === null) return false
  const question = value as Partial<FollowUpQuestion>
  return (
    typeof question.id === 'string' &&
    typeof question.requirementId === 'string' &&
    (question.kind === 'probe' || question.kind === 'explore') &&
    typeof question.question === 'string' &&
    typeof question.rationale === 'string'
  )
}
