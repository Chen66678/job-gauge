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
  skills: { label: string; pct: number | null; confident: boolean; question?: string }[]
  jdSummary: string[]
  requirements: string[]
  industry: string
  workAddress: string | null
  sourceUrl: string | null
  evaluationError: string | null
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
    }
  }
}

type FollowUpBadge = {
  text: string
  className: 'b-followup' | 'b-submitted' | 'b-review' | 'b-processing'
  clickable: boolean
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
  const score = evaluation && !evaluation.vetoed ? evaluation.score.total : null
  const scoreResult = evaluation && !evaluation.vetoed ? evaluation.score : null
  const strategy = scoreResult?.strategy
  const strategyClass = strategy === 'personalize' ? 'recommend' : strategy === 'generic_apply' ? 'suggest' : strategy === 'skip' ? 'skip' : 'consider'
  const scoreTier = record.evaluationError ? 'low' : score === null ? (evaluation ? 'low' : 'unevaluated') : score >= 80 ? 'high' : score >= 70 ? 'mid' : 'low'
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
    strategyLabel: record.evaluationError ? '评估失败' : (scoreResult?.strategyLabel ?? '尚未评估'),
    strategyClass,
    pinned: record.job.pinned,
    skills: requirements.map(requirement => {
      const result = requirementResults.find(item => item.label === requirement.label)
      const pct = result && result.maxScore > 0 ? Math.round(result.score / result.maxScore * 100) : null
      return { label: requirement.label, pct, confident: Boolean(result && !result.gap), question: requirement.evidence }
    }),
    jdSummary: record.job.jdText ? [record.job.jdText] : [],
    requirements: requirements.map(requirement => requirement.label),
    industry: '',
    workAddress: record.job.workAddress,
    sourceUrl: record.job.sourceUrl,
    evaluationError: record.evaluationError,
    jdText: record.job.jdText,
    salaryK: record.job.salaryK
  }
}

// ─── Score Number ─────────────────────────────────────────────────
function ScoreNum({ score }: { score: number | null }) {
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
function ExpandPanel({ job, open, onStartWorkflow, onRetry }: { job: MockJob; open: boolean; onStartWorkflow?: (jobId: string) => void; onRetry?: (jobId: string) => void }) {
  const pendingCount = job.skills.filter(skill => !skill.confident).length
  const confirmedEvidence = job.skills.filter(skill => skill.confident && (skill.pct ?? 0) >= 70)

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
            {confirmedEvidence.length > 0 && (
              <div className="fact-chip-list" aria-label="已确认依据">
                {confirmedEvidence.map(skill => <span className="fact-chip" key={skill.label}>✓ 已确认 {skill.label}</span>)}
              </div>
            )}
            <div className="decision-list">
              {confirmedEvidence.map(s => (
                <div key={s.label} className="evidence-item">
                  <div className="evidence-line">
                    <span className="evidence-name">{s.label}</span>
                    <div className="evidence-bar" aria-hidden="true">
                      <div className="evidence-bar-fill" style={{ width: `${s.pct}%` }} />
                    </div>
                    <span className="evidence-score">{s.pct}%</span>
                  </div>
                  <div className="evidence-note">已有经历覆盖这项核心要求</div>
                </div>
              ))}
              {confirmedEvidence.length === 0 && (
                <div className="empty-evidence">目前没有明显的优势项</div>
              )}
            </div>
          </section>

          {(job.risks.length > 0 || job.gaps.length > 0 || pendingCount > 0) && (
            <section className="decision-column considerations">
              <div className="decision-section-title">值得再确认</div>
              <div className="decision-list">
                {job.risks.map(r => (
                  <div key={r} className="consideration-item">
                    <span className="consideration-name">{r}</span>
                    <span className="consideration-note">可能影响你的工作体验</span>
                  </div>
                ))}
                {job.gaps.map(g => (
                  <div key={g} className="consideration-item">
                    <span className="consideration-name">{g}</span>
                    <span className="consideration-note">当前经历与要求仍有距离</span>
                  </div>
                ))}
                {job.skills.filter(skill => !skill.confident).map(skill => (
                  <div key={skill.label} className="consideration-item pending">
                    <div className="consideration-copy">
                      <span className="consideration-name">{skill.label}：经历尚未确认</span>
                      <span className="consideration-note">简历中暂时没有这部分信息</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* ── Section 3: 岗位详情 ── */}
        <div className="decision-section job-detail-section">
          <div className="decision-section-title">岗位详情</div>

          <div className="detail-grid">
            {job.skills.some(skill => !skill.confident) && (
              <div className="skill-matrix">
                <div className="detail-jd-col-label">尚未确认的经历</div>
                {job.skills
                  .filter(skill => !skill.confident)
                  .map(skill => (
                    <div key={skill.label} className="skill-row">
                      <span className="skill-label">{skill.label}</span>
                      <span className="skill-value unknown">未确认</span>
                    </div>
                  ))}
              </div>
            )}

            {(job.jdSummary.length > 0 || job.requirements.length > 0) && (
              <div className="detail-jd-cols">
              {job.jdSummary.length > 0 && (
                <div className="detail-jd-col">
                  <div className="detail-jd-col-label">岗位职责</div>
                  <ul className="detail-jd-list">
                    {job.jdSummary.map((item, i) => <li key={i}>{item}</li>)}
                  </ul>
                </div>
              )}
              {job.requirements.length > 0 && (
                <div className="detail-jd-col">
                  <div className="detail-jd-col-label">任职要求</div>
                  <ul className="detail-jd-list">
                    {job.requirements.map((item, i) => <li key={i}>{item}</li>)}
                  </ul>
                </div>
              )}
              </div>
            )}
          </div>

          {/* Meta */}
          <div className="meta-row" style={{ marginTop: 10 }}>
            {job.industry && <span style={{ color: 'var(--text-muted)' }}>{job.industry}</span>}
            {job.commute && <span>通勤 {job.commute}</span>}
            <span>{job.salary}</span>
            {job.workAddress && <span>{job.workAddress}</span>}
            {job.sourceUrl ? (
              <a
                className="meta-link"
                href={job.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                查看原岗位 ↗
              </a>
            ) : (
              <span className="meta-link disabled" title="当前岗位没有保存来源链接">
                原岗位链接未保存
              </span>
            )}
          </div>
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
  job, record, factLibrary, deferredReevaluation, reevaluating, expanded, onToggle, onPin, onStartWorkflow, onOpenFollowUp, onOpenProfile, onRetry, onReevaluate, onDeferReevaluation
}: {
  job: MockJob
  record: CoreState['jobs'][number]
  factLibrary: CoreState['factLibrary']
  deferredReevaluation: boolean
  reevaluating: boolean
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
  const matchEvidence = job.skills.find(skill => skill.confident && (skill.pct ?? 0) >= 70)
  const matchedRequirements = job.skills.filter(skill => skill.confident).length

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
          ) : job.score !== null || job.scoreTier === 'unevaluated' ? <ScoreNum score={job.score} /> : (
            <div className="score-pending">
            {job.scoreTier === 'pending' && <div className="spinner" />}
            {job.scoreTier === 'queued' && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>排队</span>
            )}
            </div>
          )}
        </div>

        <div className="r1-badge">
          <StrategyBadge job={job} />
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
          {matchEvidence && <span className="match-chip" title={`匹配依据：${matchEvidence.label}`}>✓ {matchEvidence.label}</span>}
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

      <ExpandPanel job={job} open={expanded} onStartWorkflow={onStartWorkflow} onRetry={onRetry} />
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>('1')
  const [sortBy, setSortBy] = useState<'score' | 'time' | 'salary'>('score')
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    let active = true
    window.coreApi.getState()
      .then(state => {
        if (!active) return
        setJobs(state.jobs.map(toDisplayJob))
        setRecords(state.jobs)
        setFactLibrary(state.factLibrary)
        setLoading(false)
      })
      .catch(reason => {
        if (!active) return
        setError(reason instanceof Error ? reason.message : String(reason))
        setLoading(false)
      })

    const unsubscribe = window.coreApi.onStateChanged(state => {
      if (!active) return
      setJobs(state.jobs.map(toDisplayJob))
      setRecords(state.jobs)
      setFactLibrary(state.factLibrary)
      setLoading(false)
    })

    return () => { active = false; unsubscribe() }
  }, [])

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
    setReevaluatingJobIds(previous => new Set(previous).add(id))
    window.coreApi.reevaluateJob(id)
      .then(unwrap)
      .then(() => setDeferredReevalJobIds(previous => {
        const next = new Set(previous)
        next.delete(id)
        return next
      }))
      .catch(reason => setError(errorText(reason)))
      .finally(() => setReevaluatingJobIds(previous => {
        const next = new Set(previous)
        next.delete(id)
        return next
      }))
  }, [])

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
        <div className="control-bar-right">
          {evaluatingCount > 0 && (
            <>
              <div className="spinner" />
              正在评估 {evaluatingCount} 个岗位…
            </>
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
