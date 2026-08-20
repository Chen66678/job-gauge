import type { CoreState } from '../domain/coreState'

export type DisplayJob = {
  id: string
  title: string
  company: string
  city: string
  salary: string
  companyTags: string[]
  risks: string[]
  gaps: string[]
  score: number | null
  scoreTier: 'high' | 'mid' | 'low' | 'pending' | 'queued' | 'unevaluated'
  strategyLabel: string
  strategyClass: 'recommend' | 'suggest' | 'consider' | 'skip'
  pinned: boolean
  skills: {
    label: string
    pct: number | null
    gap: string | null
    measured: boolean
    tier: 'strong' | 'partial' | 'weak' | 'unmeasured'
    question?: string
  }[]
  requirements: string[]
  workAddress: string | null
  sourceUrl: string | null
  evaluationError: string | null
  evaluationStale: boolean
  jdText: string
  salaryK: [number, number] | null
  collectedAt: string
}

export type FollowUpBadge = {
  text: string
  className: 'b-followup' | 'b-submitted' | 'b-review' | 'b-processing'
  clickable: boolean
}

export type ReevaluationSnapshot = {
  before: number | null
  at: number
}

export function getFollowUpFacts(record: CoreState['jobs'][number], factLibrary: CoreState['factLibrary']) {
  // followUp.ts 写入 sourceRef 的格式是 `反问:${question.id}:${question.question.slice(0, 20)}`。
  // 这里必须按完整格式精确匹配；旧实现漏掉了 question.id，导致已提交的追问事实永远匹配不到，
  // 岗位列表会一直显示“待回答 N 问”。
  const questionSourceRefs = new Set(
    record.followUps.map(followUp => `反问:${followUp.id}:${followUp.question.slice(0, 20)}`)
  )
  return factLibrary.filter(fact => (
    fact.sourceType === 'user_answer' && questionSourceRefs.has(fact.sourceRef)
  ))
}

export function getFollowUpBadge(
  record: CoreState['jobs'][number],
  factLibrary: CoreState['factLibrary'],
  deferredReevaluation: boolean,
  reevaluating: boolean,
): FollowUpBadge | null {
  if (record.followUps.length === 0) return null
  if (reevaluating) return { text: '重新评估中…', className: 'b-processing', clickable: false }

  const followUpFacts = getFollowUpFacts(record, factLibrary)
  if (followUpFacts.length === 0) {
    return { text: `待回答 ${record.followUps.length} 问`, className: 'b-followup', clickable: true }
  }
  if (followUpFacts.some(fact => fact.status === 'unconfirmed')) {
    return { text: '已提交，待确认', className: 'b-submitted', clickable: false }
  }
  if (deferredReevaluation) return { text: '待重评', className: 'b-review', clickable: false }
  return null
}

export function toDisplayJob(record: CoreState['jobs'][number]): DisplayJob {
  const evaluation = record.evaluation
  const score = record.evaluationStale ? null : evaluation && !evaluation.vetoed ? evaluation.score.total : null
  const scoreResult = evaluation && !evaluation.vetoed ? evaluation.score : null
  const strategy = scoreResult?.strategy
  const strategyClass = strategy === 'personalize' ? 'recommend' : strategy === 'generic_apply' ? 'suggest' : strategy === 'skip' ? 'skip' : 'consider'
  const scoreTier = record.evaluationStale ? 'unevaluated' : evaluation === null && record.evaluationError === null
    ? 'pending'
    : record.evaluationError ? 'low' : score === null ? (evaluation ? 'low' : 'unevaluated') : score >= 80 ? 'high' : score >= 70 ? 'mid' : 'low'
  const requirements = record.job.requirements
  const requirementResults = scoreResult?.breakdown.requirements ?? []

  return {
    id: record.job.id,
    title: record.job.title,
    company: record.job.company,
    city: record.job.city,
    salary: record.job.salaryK && (record.job.salaryK[0] > 0 || record.job.salaryK[1] > 0) ? `${record.job.salaryK[0]}-${record.job.salaryK[1]}k` : '薪资未披露',
    companyTags: record.job.companyTags,
    risks: scoreResult?.risks ?? record.job.risks.map(risk => risk.label),
    gaps: scoreResult?.gaps ?? [],
    score,
    scoreTier,
    strategyLabel: record.evaluationStale ? '评分已过期' : record.evaluationError ? '评估失败' : (scoreResult?.strategyLabel ?? '尚未评估'),
    strategyClass,
    pinned: record.job.pinned,
    skills: requirements.map(requirement => {
      const result = requirementResults.find(item => item.label === requirement.label)
      const pct = result && result.maxScore > 0 ? Math.round(result.score / result.maxScore * 100) : null
      const gap = result?.gap ?? null
      const measured = pct !== null
      const tier = pct === null ? 'unmeasured' : pct >= 75 ? 'strong' : pct >= 40 ? 'partial' : 'weak'
      return { label: requirement.label, pct, gap, measured, tier, question: requirement.evidence }
    }),
    requirements: requirements.map(requirement => requirement.label),
    workAddress: record.job.workAddress,
    sourceUrl: record.job.sourceUrl,
    evaluationError: record.evaluationError,
    evaluationStale: record.evaluationStale ?? false,
    jdText: record.job.jdText,
    salaryK: record.job.salaryK,
    collectedAt: record.collectedAt ?? ''
  }
}

