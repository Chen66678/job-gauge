import { Button, Tooltip } from 'antd'
import type { CoreState } from '../domain/coreState'
import {
  getFollowUpBadge,
  getFollowUpFacts,
  type DisplayJob,
  type ReevaluationSnapshot,
} from './jobListModel'

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

function StrategyBadge({ job }: { job: DisplayJob }) {
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

function ExpandPanel({ job, open, onStartWorkflow, onOpenFollowUp, onRetry }: { job: DisplayJob; open: boolean; onStartWorkflow?: (jobId: string) => void; onOpenFollowUp?: (jobId: string) => void; onRetry?: (jobId: string) => void }) {
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
              {confirmedEvidence.map((s, index) => (
                <div key={`${s.label}-${index}`} className="evidence-item">
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
                {considerationItems.map((item, index) => (
                  <div key={`${item.key}-${index}`} className={`consideration-item ${item.pending ? 'pending' : ''}`}>
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
export function JobListItem({
  job, record, factLibrary, deferredReevaluation, reevaluating, reevaluationSnapshot, expanded, onToggle, onPin, onStartWorkflow, onOpenFollowUp, onOpenProfile, onRetry, onReevaluate, onDeferReevaluation
}: {
  job: DisplayJob
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
          <span>{job.city ? `${job.company} · ${job.city}` : job.company}</span>
          {job.requirements.length > 0 && <span className="kw-chip">关键词命中 {matchedRequirements}/{job.requirements.length}</span>}
        </div>
      </div>

      {canPromptReevaluation && (
        <div className="reevaluation-prompt" role="status">
          <div className="reevaluation-prompt-copy">
            <span className="reevaluation-prompt-icon" aria-hidden="true">✓</span>
            <span>已确认来自「{job.title}」的 {followUpFacts.length} 条新事实，是否重新评估该岗位？</span>
          </div>
          <div className="reevaluation-prompt-actions">
            <button type="button" className="primary-button" onClick={() => onReevaluate(job.id)}>立刻重评</button>
            <button type="button" className="btn-secondary" onClick={() => onDeferReevaluation(job.id)}>稍后再说</button>
          </div>
        </div>
      )}

      <ExpandPanel job={job} open={expanded} onStartWorkflow={onStartWorkflow} onOpenFollowUp={onOpenFollowUp} onRetry={onRetry} />
    </div>
  )
}

