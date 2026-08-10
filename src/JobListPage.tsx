import { useState, useRef, useCallback, useEffect } from 'react'
import { Button, Tooltip } from 'antd'
import { unwrap, errorText, type CoreApiResult } from './coreApiResult'

type MockJob = {
  id: string
  title: string
  company: string
  city: string
  salary: string
  commute?: string
  companyTags: string[]
  coreMatch?: { label: string; pct: number }
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
  industry: string
  workAddress: string | null
  sourceUrl: string | null
  evaluationError: string | null
  evaluationStale: boolean
  jdText: string
  salaryK: [number, number]
}

type CoreState = {
  jobs: Array<{
    job: {
      id: string
      title: string
      company: string
      city: string
      salaryK: [number, number]
      companyTags: string[]
      jdText: string
      requirements: Array<{ label: string; evidence: string; requiredFactIds: string[] }>
      risks: Array<{ label: string; evidence: string }>
      pinned: boolean
      workAddress: string | null
      sourceUrl: string | null
    }
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
        breakdown: { requirements: Array<{ label: string; score: number; maxScore: number; gap: string | null }> }
      }
    } | null
    evaluationError: string | null
    evaluationStale?: boolean
    followUps: Array<{
      id: string
      requirementId: string
      kind: 'probe' | 'explore'
      question: string
      rationale: string
    }>
  }>
  factLibrary: Array<{
    id: string
    sourceType: string
    sourceRef: string
    status: 'confirmed' | 'unconfirmed' | 'rejected'
  }>
}

declare global {
  interface Window {
    coreApi: {
      getState: () => Promise<CoreState>
      setJobPinned: (jobId: string, pinned: boolean) => Promise<CoreApiResult<void>>
      onStateChanged: (listener: (state: CoreState) => void) => () => void
      reevaluateJob: (jobId: string) => Promise<CoreApiResult<unknown>>
      getReevaluationPreview: (scope: 'recent' | 'stale') => Promise<CoreApiResult<{ jobCount: number; modelCallCount: number }>>
      reevaluateJobs: (scope: 'recent' | 'stale') => Promise<CoreApiResult<unknown>>
      evaluateJobFromJd: (input: {
        jdText: string
        jobBase: {
          title: string
          company: string
          city: string
          salaryK: [number, number]
          companyTags: string[]
          workAddress?: string | null
          sourceUrl?: string | null
        }
      }) => Promise<CoreApiResult<unknown>>
      saveAndVerifyByokKey: (request: { apiKey: string }) => Promise<CoreApiResult<unknown> | { ok: boolean; [key: string]: unknown }>
      getByokKeyStatus: () => Promise<{ configured: boolean; source: 'keychain' | 'environment' | 'none' }>
      clearByokKey: () => Promise<CoreApiResult<unknown> | { ok: boolean; [key: string]: unknown }>
      getLocalApiToken: () => Promise<{ token: string }>
      renderResumeImage: (jobId: string) => Promise<CoreApiResult<string>>
      openExternalUrl: (url: string) => Promise<CoreApiResult<void>>
      clearJobs: () => Promise<CoreApiResult<void>>
    }
  }
}

type FollowUpBadge = {
  text: string
  className: 'b-followup' | 'b-submitted' | 'b-review' | 'b-processing'
  clickable: boolean
}

type ReevaluationSnapshot = {
  before: number | null
  at: number
}

function getFollowUpFacts(record: CoreState['jobs'][number], factLibrary: CoreState['factLibrary']) {
  const questionPrefixes = record.followUps.map(followUp => `反问:${followUp.question.slice(0, 20)}`)
  return factLibrary.filter(fact => (
    fact.sourceType === 'user_answer' && questionPrefixes.some(prefix => fact.sourceRef.includes(prefix))
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

function toDisplayJob(record: CoreState['jobs'][number]): MockJob {
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
    salary: `${record.job.salaryK[0]}-${record.job.salaryK[1]}k`,
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
    industry: '',
    workAddress: record.job.workAddress,
    sourceUrl: record.job.sourceUrl,
    evaluationError: record.evaluationError,
    evaluationStale: record.evaluationStale ?? false,
    jdText: record.job.jdText,
    salaryK: record.job.salaryK
  }
}

// ─── Score Number ─────────────────────────────────────────────────
function ScoreNum({ score, stale }: { score: number | null; stale?: boolean }) {
  if (stale) return <div className="score-num stale" aria-label="评分已过期">过期</div>
  if (score === null) return <div className="score-num empty">—</div>
  const tier = score >= 80 ? 'high' : score >= 70 ? 'medium' : score >= 60 ? 'fair' : 'low'
  return <div className={`score-num ${tier}`}>{score}</div>
}

const PinIcon = ({ filled }: { filled: boolean }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14.7 4.1c.7-.7 1.8-.7 2.5 0l2.7 2.7c.7.7.7 1.8 0 2.5l-2 2-1.1 4.4-2.1 2.1-3.8-3.8-5.8 5.8-.9-.9 5.8-5.8-3.8-3.8 2.1-2.1 4.4-1.1 2-2Z"/>
    {!filled && <path d="m12.7 6.1 5.2 5.2" />}
  </svg>
)

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg className={`row-chevron ${open ? 'open' : ''}`} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="m7.5 5 5 5-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

function StrategyBadge({ job }: { job: MockJob }) {
  const badgeClass = job.strategyClass === 'recommend'
    ? 'b-high'
    : job.strategyClass === 'suggest'
      ? 'b-normal'
      : job.strategyClass === 'consider'
        ? 'b-review'
        : job.strategyLabel === '评估失败'
          ? 'b-fail'
          : 'b-skip'
  return <span className={`badge ${badgeClass}`}>{job.strategyLabel}</span>
}

// ─── Expanded Detail Panel ───────────────────────────────────────
const EVIDENCE_DISPLAY_LIMIT = 4

function ExpandPanel({ job, open, onStartWorkflow, onOpenFollowUp, onRetry }: { job: MockJob; open: boolean; onStartWorkflow?: (jobId: string) => void; onOpenFollowUp?: (jobId: string) => void; onRetry?: (jobId: string) => void }) {
  const pendingCount = job.skills.filter(skill => !skill.measured).length
  const confirmedEvidence = job.skills
    .filter(skill => skill.measured)
    .sort((left, right) => (right.pct ?? 0) - (left.pct ?? 0))
    .slice(0, EVIDENCE_DISPLAY_LIMIT)

  const considerationItems: Array<{ key: string; text: string; note: string; pending?: boolean }> = [
    ...job.risks.map(r => ({ key: r, text: r, note: '可能影响你的工作体验' })),
    ...job.gaps.map(g => ({ key: g, text: g, note: '当前经历与要求仍有距离' })),
    ...job.skills
      .filter(skill => !skill.measured)
      .map(skill => ({ key: skill.label, text: `${skill.label}：经历尚未确认`, note: '简历中暂时没有这部分信息', pending: true })),
  ].slice(0, EVIDENCE_DISPLAY_LIMIT)

  return (
    <div className={`expand-panel ${open ? 'open' : ''}`}>
      <div className="expand-inner">

        {job.evaluationError && (
          <div className="evaluation-error-banner">
            <span>评估失败：{job.evaluationError}</span>
            <Button size="small" onClick={() => onRetry?.(job.id)}>重试</Button>
          </div>
        )}

        <div className="decision-overview">
          {/* Evidence first: the score should read like a grounded explanation,
              not a machine-generated checklist. */}
          <section className="decision-column">
            <div className="decision-section-title">匹配依据</div>
            <div className="decision-list">
              {confirmedEvidence.map(s => (
                <div key={s.label} className="evidence-item">
                  <div className="evidence-line">
                    <div className="evidence-name-wrap">
                      <span className={`tier-badge tier-${s.tier}`}>{s.tier === 'strong' ? '符合' : s.tier === 'partial' ? '部分符合' : '匹配较弱'}</span>
                      <span className="evidence-name" title={s.label}>{s.label}</span>
                    </div>
                    <div className="evidence-bar" aria-hidden="true">
                      <div className={`evidence-bar-fill tier-${s.tier}`} style={{ width: `${s.pct}%` }} />
                    </div>
                    <span className={`evidence-score tier-${s.tier}`}>{s.pct}%</span>
                  </div>
                  <div className="evidence-note">
                    {s.gap ?? (s.tier === 'strong' ? '已有经历覆盖这项核心要求' : s.tier === 'partial' ? '部分匹配该要求' : '与要求有距离')}
                  </div>
                </div>
              ))}
              {confirmedEvidence.length === 0 && (
                <div className="empty-evidence">目前没有明显的优势项</div>
              )}
            </div>
          </section>

          {considerationItems.length > 0 && (
            <section className="decision-column considerations">
              <div className="decision-section-title">值得再确认</div>
              <div className="decision-list">
                {considerationItems.map(item => (
                  <div key={item.key} className={`consideration-item ${item.pending ? 'pending' : ''}`}>
                    <div className="consideration-copy">
                      <span className="consideration-name" title={item.text}>{item.text}</span>
                      <span className="consideration-note">{item.note}</span>
                    </div>
                  </div>
                ))}
                {pendingCount > 0 && (
                  <div className="consideration-followup">
                    <button type="button" onClick={() => onOpenFollowUp?.(job.id)}>补一下这些信息 →</button>
                    <span>补充后可重新评估，并更新这里的分数。</span>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="meta-row">
          {job.industry && <span style={{ color: 'var(--text-muted)' }}>{job.industry}</span>}
          {job.commute && <span>通勤 {job.commute}</span>}
          <span>{job.salary}</span>
          {job.workAddress && <span>{job.workAddress}</span>}
          {job.sourceUrl ? (
            <button
              type="button"
              className="meta-link meta-link-button"
              onClick={() => {
                const url = `${job.sourceUrl}${job.sourceUrl!.includes('?') ? '&' : '?'}jobId=${encodeURIComponent(job.id)}`
                void window.coreApi.openExternalUrl(url)
              }}
            >
              查看原岗位 ↗
            </button>
          ) : (
            <span className="meta-link disabled" title="当前岗位没有保存来源链接">原岗位链接未保存</span>
          )}
        </div>

        {/* ── Actions ── */}
        <div className="expand-actions">
          <Button size="small">暂不考虑</Button>
          <Button size="small" type="primary"
            style={{ background: 'var(--indigo)', borderColor: 'var(--indigo)' }}
            onClick={() => onStartWorkflow?.(job.id)}>
            定制简历
          </Button>
        </div>

      </div>
    </div>
  )
}

// ─── Job Row ──────────────────────────────────────────────────────
function JobRow({
  job, record, factLibrary, deferredReevaluation, reevaluating, reevaluationSnapshot, expanded, onToggle, onPin, onStartWorkflow, onOpenFollowUp, onOpenProfile, onRetry, onReevaluate, onDeferReevaluation
}: {
  job: MockJob
  record: CoreState['jobs'][number]
  factLibrary: CoreState['factLibrary']
  deferredReevaluation: boolean
  reevaluating: boolean
  reevaluationSnapshot?: ReevaluationSnapshot
  expanded: boolean
  onToggle: () => void
  onPin: () => void
  onStartWorkflow?: (jobId: string) => void
  onOpenFollowUp?: (jobId: string) => void
  onOpenProfile?: () => void
  onRetry?: (jobId: string) => void
  onReevaluate: (jobId: string) => void
  onDeferReevaluation: (jobId: string) => void
}) {
  const isPending = job.scoreTier === 'pending' || job.scoreTier === 'queued'
  const followUpBadge = getFollowUpBadge(record, factLibrary, deferredReevaluation, reevaluating)
  const followUpFacts = getFollowUpFacts(record, factLibrary)
  const canPromptReevaluation = record.followUps.length > 0 && followUpFacts.length > 0 && !followUpFacts.some(fact => fact.status === 'unconfirmed') && !deferredReevaluation && !reevaluating

  // Max 1 risk + 1 gap in collapsed row
  const visibleRisks = job.risks.slice(0, 1)
  const visibleGaps = job.gaps.slice(0, 1)
  const sortedMeasuredSkills = job.skills
    .filter(skill => skill.measured)
    .sort((left, right) => (right.pct ?? 0) - (left.pct ?? 0))[0]
  const strongMatchEvidence = job.skills
    .filter(skill => skill.tier === 'strong')
    .sort((left, right) => (right.pct ?? 0) - (left.pct ?? 0))[0]
  const partialMatchEvidence = sortedMeasuredSkills?.tier === 'partial' ? sortedMeasuredSkills : undefined
  const matchEvidence = strongMatchEvidence ?? partialMatchEvidence
  const matchedRequirements = job.skills.filter(skill => skill.tier === 'strong').length

  return (
    <div className="job-row-wrap">
      <div
        className={`job-row ${expanded ? 'expanded' : ''} ${isPending ? 'dim' : ''}`}
        onClick={!isPending ? onToggle : undefined}
        role={!isPending ? 'button' : undefined}
        tabIndex={!isPending ? 0 : -1}
        aria-expanded={!isPending ? expanded : undefined}
        onKeyDown={e => {
          if (!isPending && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            onToggle()
          }
        }}
      >
        <div className="r1-score">
          {job.evaluationError ? (
            <div className="failure-score">
              <span className="failure-icon" aria-label="评估失败">!</span>
              <button type="button" onClick={event => { event.stopPropagation(); onRetry?.(job.id) }}>重试</button>
            </div>
          ) : job.score !== null || job.scoreTier === 'unevaluated' ? <ScoreNum score={job.score} stale={job.evaluationStale} /> : (
            <div className="score-pending">
            {job.scoreTier === 'pending' && <div className="spinner" />}
            {job.scoreTier === 'queued' && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>排队</span>
            )}
            </div>
          )}
          {!isPending && !reevaluating && reevaluationSnapshot && job.score !== null && (
            <span className={`score-change-badge ${reevaluationSnapshot.before === job.score ? 'unchanged' : 'changed'}`} role="status">
              {reevaluationSnapshot.before === job.score ? '分数未变' : `${reevaluationSnapshot.before ?? '—'} → ${job.score}`}
            </span>
          )}
        </div>

        <div className="r1-badge">
          <StrategyBadge job={job} />
          {job.evaluationStale && <span className="badge b-stale">评分已过期</span>}
          {followUpBadge && (
            <span className={`badge ${followUpBadge.className}`}>
              {reevaluating && <span className="spinner" />}
              {followUpBadge.clickable ? (
                <button
                  type="button"
                  onClick={event => { event.stopPropagation(); onOpenFollowUp?.(job.id) }}
                  style={{ border: 0, padding: 0, background: 'none', color: 'inherit', cursor: 'pointer', font: 'inherit' }}
                >
                  {followUpBadge.text}
                </button>
              ) : (
                followUpBadge.text
              )}
              {followUpBadge.className === 'b-submitted' && (
                <button
                  type="button"
                  className="badge-link"
                  onClick={event => { event.stopPropagation(); onOpenProfile?.() }}
                >
                  → 去资料库
                </button>
              )}
            </span>
          )}
        </div>
        <div className="r1-title job-name">{job.title}</div>

        <div className="r1-reason job-signals">
          {matchEvidence && (
            <span className="match-chip" title={`匹配依据：${matchEvidence.label}`}>
              {matchEvidence.tier === 'strong' ? `✓ ${matchEvidence.label}` : `部分符合 ${matchEvidence.label}`}
            </span>
          )}
          {visibleRisks.map(r => (
            <span key={r} className="signal-text risk" title={`风险：${r}`} aria-label={`风险：${r}`}>{r}</span>
          ))}
          {visibleGaps.map(g => (
            <span key={g} className="signal-text gap" title={`缺口：${g}`} aria-label={`缺口：${g}`}>{g}</span>
          ))}
        </div>

        <div className="r1-salary job-salary">{job.salary}</div>
        <div className="r1-pin">
          <Tooltip title={job.pinned ? '取消置顶' : '置顶'} placement="left">
            <button
              className={`pin-btn ${job.pinned ? 'pinned' : ''}`}
              aria-label={job.pinned ? '取消置顶' : '置顶'}
              onClick={e => { e.stopPropagation(); onPin() }}
            >
              <PinIcon filled={job.pinned} />
            </button>
          </Tooltip>
        </div>

        <div className="r1-chevron">{!isPending && <ChevronIcon open={expanded} />}</div>
        <div className="r2-info job-company-line">
          <span>{job.company} · {job.city}</span>
          {job.commute && <span>通勤 {job.commute}</span>}
          {job.requirements.length > 0 && <span className="kw-chip">关键词命中 {matchedRequirements}/{job.requirements.length}</span>}
        </div>
      </div>

      {canPromptReevaluation && (
        <div style={{ margin: '8px 0 0', padding: '10px 12px', border: '1px solid var(--green-border)', borderRadius: 6, background: 'var(--green-bg)', color: 'var(--green-text)', fontSize: 13 }}>
          ✓ 已确认来自「{job.title}」的 {followUpFacts.length} 条新事实，是否重新评估该岗位？
          <button type="button" onClick={() => onReevaluate(job.id)} style={{ marginLeft: 10 }}>立刻重评</button>
          <button type="button" onClick={() => onDeferReevaluation(job.id)} style={{ marginLeft: 8 }}>稍后再说</button>
        </div>
      )}

      <ExpandPanel job={job} open={expanded} onStartWorkflow={onStartWorkflow} onOpenFollowUp={onOpenFollowUp} onRetry={onRetry} />
    </div>
  )
}

// ─── Job List Page ────────────────────────────────────────────────
export default function JobListPage({ onStartWorkflow, onOpenFollowUp, onOpenProfile }: { onStartWorkflow?: (jobId: string) => void; onOpenFollowUp?: (jobId: string) => void; onOpenProfile?: () => void }) {
  const [jobs, setJobs] = useState<MockJob[]>([])
  const [records, setRecords] = useState<CoreState['jobs']>([])
  const [factLibrary, setFactLibrary] = useState<CoreState['factLibrary']>([])
  const [deferredReevalJobIds, setDeferredReevalJobIds] = useState<Set<string>>(new Set())
  const [reevaluatingJobIds, setReevaluatingJobIds] = useState<Set<string>>(new Set())
  const [reevaluateSnapshots, setReevaluateSnapshots] = useState<Map<string, ReevaluationSnapshot>>(new Map())
  const [completedReevaluationJobIds, setCompletedReevaluationJobIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>('1')
  const [sortBy, setSortBy] = useState<'score' | 'time' | 'salary'>('score')
  const [stalePreview, setStalePreview] = useState<{ jobCount: number; modelCallCount: number } | null>(null)
  const [batchReevaluating, setBatchReevaluating] = useState(false)
  const [clearJobsConfirming, setClearJobsConfirming] = useState(false)
  const [clearJobsError, setClearJobsError] = useState<string | null>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const reevaluationPendingSeenRef = useRef<Set<string>>(new Set())

  const loadStalePreview = useCallback(() => {
    const previewApi = window.coreApi as Partial<Pick<Window['coreApi'], 'getReevaluationPreview'>>
    if (!previewApi.getReevaluationPreview) return
    previewApi.getReevaluationPreview('stale')
      .then(unwrap)
      .then(setStalePreview)
      .catch(reason => setError(errorText(reason)))
  }, [])

  const clearAllJobs = async () => {
    setClearJobsError(null)
    try {
      unwrap(await window.coreApi.clearJobs())
      setClearJobsConfirming(false)
    } catch (reason) {
      setClearJobsError(errorText(reason))
    }
  }

  const handleReevaluateRemaining = useCallback(() => {
    if (!stalePreview || stalePreview.jobCount === 0) return
    if (!window.confirm(`将重评剩下 ${stalePreview.jobCount} 条岗位，预计消耗 ${stalePreview.modelCallCount} 次模型调用。继续吗？`)) return
    setBatchReevaluating(true)
    window.coreApi.reevaluateJobs('stale')
      .then(unwrap)
      .then(loadStalePreview)
      .catch(reason => setError(errorText(reason)))
      .finally(() => setBatchReevaluating(false))
  }, [loadStalePreview, stalePreview])

  useEffect(() => {
    const completedSnapshots = [...reevaluateSnapshots.entries()].filter(([jobId]) => completedReevaluationJobIds.has(jobId))
    if (completedSnapshots.length === 0) return

    const timers = completedSnapshots.map(([jobId, snapshot]) => window.setTimeout(() => {
      setReevaluateSnapshots(previous => {
        if (previous.get(jobId)?.at !== snapshot.at) return previous
        const next = new Map(previous)
        next.delete(jobId)
        return next
      })
      setCompletedReevaluationJobIds(previous => {
        const next = new Set(previous)
        next.delete(jobId)
        return next
      })
      reevaluationPendingSeenRef.current.delete(jobId)
    }, 4500))

    return () => timers.forEach(timer => window.clearTimeout(timer))
  }, [completedReevaluationJobIds, reevaluateSnapshots])

  useEffect(() => {
    let active = true
    window.coreApi.getState()
      .then(state => {
        if (!active) return
        setJobs(state.jobs.map(toDisplayJob))
        setRecords(state.jobs)
        setFactLibrary(state.factLibrary)
        loadStalePreview()
        setLoading(false)
      })
      .catch(reason => {
        if (!active) return
        setError(reason instanceof Error ? reason.message : String(reason))
        setLoading(false)
      })

    const unsubscribe = window.coreApi.onStateChanged(state => {
      if (!active) return
      const nextJobs = state.jobs.map(toDisplayJob)
      setJobs(nextJobs)
      setRecords(state.jobs)
      setFactLibrary(state.factLibrary)
      loadStalePreview()
      setReevaluateSnapshots(currentSnapshots => {
        const completedIds = [...currentSnapshots.keys()].filter(jobId => {
          const nextJob = nextJobs.find(job => job.id === jobId)
          if (nextJob?.score === null) {
            reevaluationPendingSeenRef.current.add(jobId)
            return false
          }
          return nextJob && reevaluationPendingSeenRef.current.has(jobId)
        })
        if (completedIds.length > 0) {
          setCompletedReevaluationJobIds(previous => new Set([...previous, ...completedIds]))
        }
        return currentSnapshots
      })
      setLoading(false)
    })

    return () => { active = false; unsubscribe() }
  }, [loadStalePreview])

  const toggleExpand = useCallback((id: string) => {
    setExpandedId(prev => {
      const next = prev === id ? null : id
      if (next) {
        // Smooth scroll to bring row near top (20% from top)
        setTimeout(() => {
          const el = rowRefs.current[id]
          if (!el) return
          const container = el.closest('.job-list-container') as HTMLElement
          if (!container) return
          const containerRect = container.getBoundingClientRect()
          const elRect = el.getBoundingClientRect()
          const targetScrollTop = container.scrollTop + (elRect.top - containerRect.top) - containerRect.height * 0.2
          container.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' })
        }, 30)
      }
      return next
    })
  }, [])

  const togglePin = useCallback((id: string) => {
    setJobs(prev => {
      const target = prev.find(j => j.id === id)
      if (!target) return prev
      const nextPinned = !target.pinned
      window.coreApi.setJobPinned(id, nextPinned).then(unwrap).catch(reason => {
        setError(errorText(reason))
      })
      return prev.map(j => j.id === id ? { ...j, pinned: nextPinned } : j)
    })
  }, [])

  const handleRetry = useCallback((id: string) => {
    setJobs(prev => {
      const target = prev.find(j => j.id === id)
      if (!target) return prev
      window.coreApi.evaluateJobFromJd({
        jdText: target.jdText,
        jobBase: {
          title: target.title,
          company: target.company,
          city: target.city,
          salaryK: target.salaryK,
          companyTags: target.companyTags,
          workAddress: target.workAddress,
          sourceUrl: target.sourceUrl
        }
      }).then(unwrap).catch(reason => {
        setError(errorText(reason))
      })
      return prev
    })
  }, [])

  const handleReevaluate = useCallback((id: string) => {
    const before = jobs.find(job => job.id === id)?.score ?? null
    setReevaluateSnapshots(previous => new Map(previous).set(id, { before, at: Date.now() }))
    setCompletedReevaluationJobIds(previous => {
      const next = new Set(previous)
      next.delete(id)
      return next
    })
    reevaluationPendingSeenRef.current.delete(id)
    setReevaluatingJobIds(previous => new Set(previous).add(id))
    window.coreApi.reevaluateJob(id)
      .then(unwrap)
      .then(() => setDeferredReevalJobIds(previous => {
        const next = new Set(previous)
        next.delete(id)
        return next
      }))
      .catch(reason => {
        setError(errorText(reason))
        setReevaluateSnapshots(previous => {
          const next = new Map(previous)
          next.delete(id)
          return next
        })
        setCompletedReevaluationJobIds(previous => {
          const next = new Set(previous)
          next.delete(id)
          return next
        })
        reevaluationPendingSeenRef.current.delete(id)
      })
      .finally(() => setReevaluatingJobIds(previous => {
        const next = new Set(previous)
        next.delete(id)
        return next
      }))
  }, [jobs])

  const handleDeferReevaluation = useCallback((id: string) => {
    setDeferredReevalJobIds(previous => new Set(previous).add(id))
  }, [])

  // Split pinned / normal
  const pinned = jobs.filter(j => j.pinned)

  // Helpers for sort
  const parseSalaryMax = (s: string) => {
    const m = s.match(/(\d+)-(\d+)/)
    return m ? parseInt(m[2]) : 0
  }
  const originalIdx = (id: string) => jobs.findIndex(j => j.id === id)

  const normal = jobs.filter(j => !j.pinned).sort((a, b) => {
    // Always push pending/queued/unevaluated to bottom
    const aInactive = !a.score && a.score !== 0
    const bInactive = !b.score && b.score !== 0
    if (aInactive && !bInactive) return 1
    if (!aInactive && bInactive) return -1
    if (aInactive && bInactive) return 0

    if (sortBy === 'score') return (b.score ?? 0) - (a.score ?? 0)
    if (sortBy === 'salary') return parseSalaryMax(b.salary) - parseSalaryMax(a.salary)
    if (sortBy === 'time') return originalIdx(b.id) - originalIdx(a.id) // newest (highest idx) first
    return 0
  })

  const evaluatingCount = jobs.filter(j => j.scoreTier === 'pending').length
  const failedJobs = jobs.filter(job => Boolean(job.evaluationError))

  if (loading) return <div>加载中...</div>
  if (error) return <div className="failure-banner" role="alert">加载失败：{error}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Control bar */}
      <div className="control-bar">
        <div>
          {stalePreview && stalePreview.jobCount > 0 && (
            <button type="button" className="stale-reevaluate-button" disabled={batchReevaluating} onClick={handleReevaluateRemaining}>
              {batchReevaluating ? '正在重评…' : `把剩下 ${stalePreview.jobCount} 条也重评（预计 ${stalePreview.modelCallCount} 次模型调用）`}
            </button>
          )}
        </div>
        <div className="control-bar-right">
          {evaluatingCount > 0 && (
            <>
              <div className="spinner" />
              正在评估 {evaluatingCount} 个岗位…
            </>
          )}
          {jobs.length > 0 && (
            clearJobsConfirming
              ? <div style={{ padding: '8px 12px', border: '1px solid var(--red-border)', borderRadius: 8, background: 'var(--red-bg)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <p style={{ color: 'var(--red-deep)', margin: 0 }}>将清空全部 {jobs.length} 条岗位（含置顶）。简历事实库和偏好设置不受影响。确定清空吗？</p>
                  {clearJobsError && <p style={{ color: 'var(--red-deep)', margin: 0, fontSize: 12 }}>{clearJobsError}</p>}
                  <div>
                    <button type="button" onClick={() => void clearAllJobs()}>确认清空</button>
                    <button type="button" style={{ marginLeft: 8 }} onClick={() => { setClearJobsConfirming(false); setClearJobsError(null) }}>取消</button>
                  </div>
                </div>
              : <button type="button" onClick={() => setClearJobsConfirming(true)}>清空岗位列表</button>
          )}
        </div>
      </div>

      {failedJobs.length > 0 && (
        <div className="failure-banner" role="alert">
          <span>有 {failedJobs.length} 个岗位评估失败，请重试。</span>
          <button type="button" onClick={() => failedJobs.forEach(job => handleRetry(job.id))}>全部重试</button>
        </div>
      )}

      {/* List */}
      <div className="job-list-container">

        {/* ── Pinned section ── */}
        {pinned.length > 0 && (
          <>
            <div className="list-section-label">
              <span>已置顶</span>
              <div className="list-section-line" />
            </div>
            {pinned.map(job => {
              const record = records.find(item => item.job.id === job.id)
              if (!record) return null
              return (
              <div key={job.id} ref={el => { rowRefs.current[job.id] = el }}>
                <JobRow
                  job={job}
                  record={record}
                  factLibrary={factLibrary}
                  deferredReevaluation={deferredReevalJobIds.has(job.id)}
                  reevaluating={reevaluatingJobIds.has(job.id)}
                  reevaluationSnapshot={completedReevaluationJobIds.has(job.id) ? reevaluateSnapshots.get(job.id) : undefined}
                  expanded={expandedId === job.id}
                  onToggle={() => toggleExpand(job.id)}
                  onPin={() => togglePin(job.id)}
                  onStartWorkflow={onStartWorkflow}
                  onOpenFollowUp={onOpenFollowUp}
                  onOpenProfile={onOpenProfile}
                  onRetry={handleRetry}
                  onReevaluate={handleReevaluate}
                  onDeferReevaluation={handleDeferReevaluation}
                />
              </div>
              )
            })}
            <div className="list-section-label">
              <div className="list-section-line" />
            </div>
          </>
        )}

        {/* ── Sort bar ── */}
        <div className="sort-bar">
          <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>排序</span>
          {(['score', 'salary', 'time'] as const).map(s => (
            <button
              key={s}
              className={`sort-btn ${sortBy === s ? 'active' : ''}`}
              onClick={() => setSortBy(s)}
            >
              {{ score: '评分 ↓', salary: '薪资 ↓', time: '时间 ↓' }[s]}
            </button>
          ))}
        </div>

        {/* ── Normal section ── */}
        {normal.length === 0 && pinned.length === 0 && (
          <div className="job-list-empty">
            <div className="job-list-empty-icon" aria-hidden="true">⌕</div>
            <h2>还没有岗位</h2>
            <p>通过插件发送岗位后，会在这里生成匹配评估和行动建议。</p>
            <button type="button" className="job-list-empty-action" onClick={onOpenProfile}>先完善我的资料</button>
          </div>
        )}
        {normal.map(job => {
          const record = records.find(item => item.job.id === job.id)
          if (!record) return null
          return (
          <div key={job.id} ref={el => { rowRefs.current[job.id] = el }}>
            <JobRow
              job={job}
              record={record}
              factLibrary={factLibrary}
              deferredReevaluation={deferredReevalJobIds.has(job.id)}
              reevaluating={reevaluatingJobIds.has(job.id)}
              reevaluationSnapshot={completedReevaluationJobIds.has(job.id) ? reevaluateSnapshots.get(job.id) : undefined}
              expanded={expandedId === job.id}
              onToggle={() => toggleExpand(job.id)}
              onPin={() => togglePin(job.id)}
              onStartWorkflow={onStartWorkflow}
              onOpenFollowUp={onOpenFollowUp}
              onOpenProfile={onOpenProfile}
              onRetry={handleRetry}
              onReevaluate={handleReevaluate}
              onDeferReevaluation={handleDeferReevaluation}
            />
          </div>
          )
        })}
      </div>
    </div>
  )
}
