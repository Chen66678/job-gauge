import { useState, useRef, useCallback, useEffect } from 'react'
import './JobListPage.css'
import { unwrap, errorText, type CoreApiResult } from './coreApiResult'
import type { CoreState } from './domain/coreState'
import { JobListItem } from './job-list/JobListItem'
import { toDisplayJob, type DisplayJob, type ReevaluationSnapshot } from './job-list/jobListModel'

export { getFollowUpBadge } from './job-list/jobListModel'

// ─── Job List Page ────────────────────────────────────────────────
export default function JobListPage({ onStartWorkflow, onOpenFollowUp, onOpenProfile }: { onStartWorkflow?: (jobId: string) => void; onOpenFollowUp?: (jobId: string) => void; onOpenProfile?: () => void }) {
  const [jobs, setJobs] = useState<DisplayJob[]>([])
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
  const parseSalaryMax = (salary: string) => {
    if (salary === '薪资未披露') return -1
    const m = salary.match(/(\d+)-(\d+)/)
    return m ? parseInt(m[2]) : -1
  }
  const originalIdx = (id: string) => jobs.findIndex(j => j.id === id)
  const collectedAtById = new Map(jobs.map(j => [j.id, j.collectedAt] as const))

  const normal = jobs.filter(j => !j.pinned).sort((a, b) => {
    // Always push pending/queued/unevaluated to bottom
    const aInactive = !a.score && a.score !== 0
    const bInactive = !b.score && b.score !== 0
    if (aInactive && !bInactive) return 1
    if (!aInactive && bInactive) return -1
    if (aInactive && bInactive) return 0

    if (sortBy === 'score') return (b.score ?? 0) - (a.score ?? 0)
    if (sortBy === 'salary') return parseSalaryMax(b.salary) - parseSalaryMax(a.salary)
    if (sortBy === 'time') {
      const collectedCompare = (collectedAtById.get(b.id) ?? '').localeCompare(collectedAtById.get(a.id) ?? '')
      return collectedCompare !== 0 ? collectedCompare : originalIdx(b.id) - originalIdx(a.id)
    }
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
              ? <div className="clear-jobs-confirm">
                  <p>将清空全部 {jobs.length} 条岗位（含置顶）。简历事实库和偏好设置不受影响。确定清空吗？</p>
                  {clearJobsError && <p className="clear-jobs-error">{clearJobsError}</p>}
                  <div className="clear-jobs-confirm-actions">
                    <button type="button" className="btn-danger-solid" onClick={() => void clearAllJobs()}>确认清空</button>
                    <button type="button" className="btn-secondary" onClick={() => { setClearJobsConfirming(false); setClearJobsError(null) }}>取消</button>
                  </div>
                </div>
              : <button type="button" className="btn-danger-ghost" onClick={() => setClearJobsConfirming(true)}>清空岗位列表</button>
          )}
        </div>
      </div>

      {failedJobs.length > 0 && (
        <div className="failure-banner" role="alert">
          <span>有 {failedJobs.length} 个岗位评估失败，请重试。</span>
          <button type="button" className="btn-secondary" onClick={() => failedJobs.forEach(job => handleRetry(job.id))}>全部重试</button>
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
                <JobListItem
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
            <JobListItem
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
