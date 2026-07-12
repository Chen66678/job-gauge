import { useState, useRef, useCallback } from 'react'
import { Button, Popover, Input, Tooltip } from 'antd'
import { MOCK_JOBS, MockJob } from './mockData'

// ─── Strategy Slider ─────────────────────────────────────────────
const STRATEGIES = ['全量打分', '只评命中', '手动打分'] as const

function StrategySlider({
  value, onChange
}: { value: number; onChange: (v: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const grabOffset = useRef(7)
  const [dragX, setDragX] = useState<number | null>(null)

  // Three detents, 14px apart. The handle moves through a monotonic eased
  // curve between adjacent detents: slight resistance when leaving a stop,
  // free movement in the middle, and a soft approach to the next stop.
  const STOPS = [3, 17, 31]
  const LOCK_RADIUS = 1.6

  const clampRaw = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect()
    return Math.max(STOPS[0], Math.min(STOPS[2], clientX - rect.left - grabOffset.current))
  }

  const applyDetents = (rawX: number): number => {
    const lockedStop = STOPS.find(stop => Math.abs(rawX - stop) <= LOCK_RADIUS)
    if (lockedStop !== undefined) return lockedStop

    const segment = rawX < STOPS[1] ? 0 : 1
    const start = STOPS[segment]
    const end = STOPS[segment + 1]
    const travelStart = start + LOCK_RADIUS
    const travelEnd = end - LOCK_RADIUS
    const t = Math.max(0, Math.min(1, (rawX - travelStart) / (travelEnd - travelStart)))
    // Smootherstep draws the handle into the lock plateau continuously. The
    // short plateau makes the detent physically legible: the pointer keeps
    // moving for a moment while the handle stays seated in the stop.
    const eased = t * t * t * (t * (t * 6 - 15) + 10)
    return start + (end - start) * eased
  }

  const nearestIdx = (px: number) =>
    STOPS.reduce((b, _, i) =>
      Math.abs(STOPS[i] - px) < Math.abs(STOPS[b] - px) ? i : b, 0)

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true
    const handle = trackRef.current?.querySelector('.strategy-slider-handle')
    if (handle && handle.contains(e.target as Node)) {
      grabOffset.current = e.clientX - handle.getBoundingClientRect().left
    } else {
      grabOffset.current = 7
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    const rawX = clampRaw(e.clientX)
    setDragX(applyDetents(rawX))
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return
    const rawX = clampRaw(e.clientX)
    setDragX(applyDetents(rawX))
  }

  const release = (e: React.PointerEvent) => {
    if (!dragging.current) return
    dragging.current = false
    const nearest = nearestIdx(clampRaw(e.clientX))
    setDragX(null)
    onChange(nearest)
  }

  const handleLeft = dragX !== null ? dragX : STOPS[value]
  const draggingNow = dragX !== null

  return (
    <div className="strategy-slider-wrap">
      <span className="strategy-current">{STRATEGIES[value]}</span>
      <div
        ref={trackRef}
        className={`strategy-slider-track ${draggingNow ? 'dragging' : ''}`}
        role="slider"
        tabIndex={0}
        aria-label="评估策略"
        aria-valuemin={0}
        aria-valuemax={STRATEGIES.length - 1}
        aria-valuenow={value}
        aria-valuetext={STRATEGIES[value]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={e => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault()
            onChange(Math.max(0, value - 1))
          }
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault()
            onChange(Math.min(STRATEGIES.length - 1, value + 1))
          }
          if (e.key === 'Home') {
            e.preventDefault()
            onChange(0)
          }
          if (e.key === 'End') {
            e.preventDefault()
            onChange(STRATEGIES.length - 1)
          }
        }}
      >
        <div
          className="strategy-slider-handle"
          style={{ left: handleLeft }}
        />
      </div>
    </div>
  )
}

// ─── Score Number ─────────────────────────────────────────────────
function ScoreNum({ score }: { score: number | null }) {
  if (score === null) return null
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

// ─── Expanded Detail Panel ───────────────────────────────────────
function ExpandPanel({ job, open }: { job: MockJob; open: boolean }) {
  const [pendingAnswers, setPendingAnswers] = useState<Record<string, string>>({})
  const [answeredSkills, setAnsweredSkills] = useState<Record<string, number>>({})
  const [popoverOpen, setPopoverOpen] = useState<string | null>(null)

  const pendingCount = job.skills.filter(s => !s.confident && !answeredSkills[s.label]).length

  const handleAnswer = (label: string) => {
    if (!pendingAnswers[label]?.trim()) return
    // Simulate: answer gives a score between 45-80
    const fakeScore = Math.floor(Math.random() * 35) + 45
    setAnsweredSkills(prev => ({ ...prev, [label]: fakeScore }))
    setPopoverOpen(null)
  }

  return (
    <div className={`expand-panel ${open ? 'open' : ''}`}>
      <div className="expand-inner">

        <div className="decision-overview">
          {/* Evidence first: the score should read like a grounded explanation,
              not a machine-generated checklist. */}
          <section className="decision-column">
            <div className="decision-section-title">匹配依据</div>
            <div className="decision-list">
              {job.skills.filter(s => s.confident && (s.pct ?? 0) >= 70).map(s => (
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
              {job.skills.filter(s => s.confident && (s.pct ?? 0) >= 70).length === 0 && (
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
                {job.skills.filter(s => !s.confident && !answeredSkills[s.label]).map(s => (
                  <div key={s.label} className="consideration-item pending">
                    <div className="consideration-copy">
                      <span className="consideration-name">{s.label}：经历尚未确认</span>
                      <span className="consideration-note">简历中暂时没有这部分信息</span>
                    </div>
                    <Popover
                      open={popoverOpen === s.label}
                      onOpenChange={v => setPopoverOpen(v ? s.label : null)}
                      trigger="click"
                      placement="topLeft"
                      content={
                        <div style={{ width: 240 }}>
                          <p style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 10, lineHeight: 1.5 }}>
                            {s.question}
                          </p>
                          <Input.TextArea
                            rows={2}
                            placeholder="简要描述你的经验…"
                            value={pendingAnswers[s.label] ?? ''}
                            onChange={e => setPendingAnswers(prev => ({ ...prev, [s.label]: e.target.value }))}
                            style={{ fontSize: 12, marginBottom: 8 }}
                          />
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <Button size="small" onClick={() => setPopoverOpen(null)}>跳过</Button>
                            <Button size="small" type="primary"
                              onClick={() => handleAnswer(s.label)}
                              disabled={!pendingAnswers[s.label]?.trim()}>确认</Button>
                          </div>
                        </div>
                      }
                    >
                      <button className="experience-link">补充经历</button>
                    </Popover>
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
            {job.skills.some(skill => !skill.confident && answeredSkills[skill.label] === undefined) && (
              <div className="skill-matrix">
                <div className="detail-jd-col-label">尚未确认的经历</div>
                {job.skills
                  .filter(skill => !skill.confident && answeredSkills[skill.label] === undefined)
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
            style={{ background: 'var(--accent)', borderColor: 'var(--accent)' }}>
            定制简历
          </Button>
        </div>

      </div>
    </div>
  )
}

// ─── Job Row ──────────────────────────────────────────────────────
function JobRow({
  job, expanded, onToggle, onPin
}: {
  job: MockJob
  expanded: boolean
  onToggle: () => void
  onPin: () => void
}) {
  const isPending = job.scoreTier === 'pending' || job.scoreTier === 'queued'

  // Max 1 risk + 1 gap in collapsed row
  const visibleRisks = job.risks.slice(0, 1)
  const visibleGaps = job.gaps.slice(0, 1)

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
        {/* Score */}
        {job.score !== null ? (
          <ScoreNum score={job.score} />
        ) : (
          <div className="score-pending">
            {job.scoreTier === 'pending' && <div className="spinner" />}
            {job.scoreTier === 'queued' && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>排队</span>
            )}
          </div>
        )}

        {/* Title + company stacked */}
        <div className="job-title-stack">
          <div className="job-name">{job.title}</div>
          <div className="job-company-line">
            {job.company} · {job.city}{job.commute ? ` · 通勤 ${job.commute}` : ''}
          </div>
        </div>

        {/* Salary */}
        <div className="job-salary">{job.salary}</div>

        {/* A quiet text summary scans faster than a row of colored chips. */}
        <div className="job-signals">
          {visibleRisks.map(r => (
            <span key={r} className="signal-text risk" title={`风险：${r}`} aria-label={`风险：${r}`}>{r}</span>
          ))}
          {visibleGaps.map(g => (
            <span key={g} className="signal-text gap" title={`缺口：${g}`} aria-label={`缺口：${g}`}>{g}</span>
          ))}
        </div>

        {/* Strategy label */}
        <span className={`strategy-label ${job.strategyClass}`}>
          {job.strategyLabel}
        </span>

        {/* Pin */}
        <Tooltip title={job.pinned ? '取消置顶' : '置顶'} placement="left">
          <button
            className={`pin-btn ${job.pinned ? 'pinned' : ''}`}
            aria-label={job.pinned ? '取消置顶' : '置顶'}
            onClick={e => { e.stopPropagation(); onPin() }}
          >
            <PinIcon filled={job.pinned} />
          </button>
        </Tooltip>

        {!isPending && <ChevronIcon open={expanded} />}
      </div>

      <ExpandPanel job={job} open={expanded} />
    </div>
  )
}

// ─── Job List Page ────────────────────────────────────────────────
export default function JobListPage() {
  const [jobs, setJobs] = useState<MockJob[]>(MOCK_JOBS)
  const [expandedId, setExpandedId] = useState<string | null>('1')
  const [strategy, setStrategy] = useState(1) // 0=全量, 1=只评命中, 2=手动
  const [sortBy, setSortBy] = useState<'score' | 'time' | 'salary'>('score')
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

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
    setJobs(prev => prev.map(j => j.id === id ? { ...j, pinned: !j.pinned } : j))
  }, [])

  // Split pinned / normal
  const pinned = jobs.filter(j => j.pinned)

  // Helpers for sort
  const parseSalaryMax = (s: string) => {
    const m = s.match(/(\d+)-(\d+)/)
    return m ? parseInt(m[2]) : 0
  }
  const originalIdx = (id: string) => MOCK_JOBS.findIndex(j => j.id === id)

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Control bar */}
      <div className="control-bar">
        <div className="control-bar-left">
          <span className="control-bar-label">评估策略</span>
          <StrategySlider value={strategy} onChange={setStrategy} />
        </div>
        <div className="control-bar-right">
          {evaluatingCount > 0 && (
            <>
              <div className="spinner" />
              正在评估 {evaluatingCount} 个岗位…
            </>
          )}
        </div>
      </div>

      {/* List */}
      <div className="job-list-container">

        {/* ── Pinned section ── */}
        {pinned.length > 0 && (
          <>
            <div className="list-section-label">
              <span>已置顶</span>
              <div className="list-section-line" />
            </div>
            {pinned.map(job => (
              <div key={job.id} ref={el => { rowRefs.current[job.id] = el }}>
                <JobRow
                  job={job}
                  expanded={expandedId === job.id}
                  onToggle={() => toggleExpand(job.id)}
                  onPin={() => togglePin(job.id)}
                />
              </div>
            ))}
            <div className="list-section-label">
              <div className="list-section-line" />
            </div>
          </>
        )}

        {/* ── Sort bar ── */}
        <div className="sort-bar">
          <span style={{ color: 'var(--color-text-3)', marginRight: 4 }}>排序</span>
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
        {normal.map(job => (
          <div key={job.id} ref={el => { rowRefs.current[job.id] = el }}>
            <JobRow
              job={job}
              expanded={expandedId === job.id}
              onToggle={() => toggleExpand(job.id)}
              onPin={() => togglePin(job.id)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
