import { useEffect, useRef, useState } from 'react'
import type { MaterialPreview } from './types'
import type { CoreApiResult } from './coreApiResult'
import { errorText, unwrap } from './coreApiResult'
import './CustomResumePage.css'

type CustomResumeApi = {
  draftMaterial: (jobId: string) => Promise<CoreApiResult<MaterialPreview>>
  exportResume: (jobId: string) => Promise<CoreApiResult<string>>
}

export default function CustomResumePage({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const api = window.coreApi as unknown as CustomResumeApi
  const [material, setMaterial] = useState<MaterialPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeJobIdRef = useRef(jobId)

  const generate = async () => {
    const targetJobId = jobId
    setLoading(true)
    setError(null)
    try {
      const nextMaterial = unwrap(await api.draftMaterial(targetJobId))
      if (activeJobIdRef.current === targetJobId) setMaterial(nextMaterial)
    } catch (reason) {
      if (activeJobIdRef.current === targetJobId) setError(errorText(reason))
    } finally {
      if (activeJobIdRef.current === targetJobId) setLoading(false)
    }
  }

  useEffect(() => {
    activeJobIdRef.current = jobId
    setMaterial(null)
    void generate()
  }, [jobId])

  const exportMaterial = async () => {
    setExporting(true)
    setError(null)
    try {
      const markdown = unwrap(await api.exportResume(jobId))
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = '定制简历.md'
      link.click()
      URL.revokeObjectURL(url)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setExporting(false)
    }
  }

  const statusContent = material ? {
    ready: {
      title: '已生成，可导出',
      detail: '正文已根据已确认事实生成，你可以继续核对或直接导出。',
    },
    needs_review: {
      title: '这份材料有需要你复核的地方',
      detail: '导出前请核对正文，确认措辞和事实表达符合你的实际经历。',
    },
    blocked: {
      title: '部分关键事实无法安全写入',
      detail: '请补充或确认相关资料后，再重新生成这份定制简历。',
    },
  }[material.status] : null

  return (
    <section className="custom-resume-page" aria-label="定制简历">
      <header className="cr-header">
        <button type="button" className="text-button cr-back" onClick={onBack}>← 返回岗位列表</button>
        <div>
          <p className="cr-eyebrow">求职材料</p>
          <h1>定制简历</h1>
        </div>
      </header>

      {loading && (
        <div className="cr-state-card cr-loading" aria-live="polite">
          <span className="spinner" />
          <div><strong>正在生成定制简历</strong><p>正在整理正文与事实来源。</p></div>
        </div>
      )}

      {!loading && error && !material && (
        <div className="cr-state-card cr-tech-fail" role="alert">
          <div><strong>暂时无法生成</strong><p>{error}</p></div>
          <button type="button" className="primary-button" onClick={() => void generate()}>重试</button>
        </div>
      )}

      {!loading && material && statusContent && (
        <>
          <div className={`cr-status-banner cr-status-${material.status}`} role="status">
            <div>
              <strong>{statusContent.title}</strong>
              <p>{statusContent.detail}</p>
              {material.status === 'blocked' && material.blockedFacts.length > 0 && (
                <ul className="cr-blocked-summary">
                  {material.blockedFacts.map(fact => <li key={fact.factId}>{fact.label}</li>)}
                </ul>
              )}
            </div>
            {material.status === 'blocked' && (
              <button type="button" className="text-button cr-recovery-link" onClick={onBack}>返回并补充资料 →</button>
            )}
          </div>

          {error && <p className="cr-inline-error" role="alert">{error}</p>}

          <div className="cr-workspace">
            <main className="cr-preview" aria-labelledby="cr-preview-title">
              <div className="cr-panel-heading">
                <div><p className="cr-eyebrow">正文预览</p><h2 id="cr-preview-title">简历正文</h2></div>
              </div>
              <article className="cr-document">
                {material.greeting && <p className="cr-greeting">{material.greeting}</p>}
                <div className="cr-resume-lines">
                  {material.resumeLines.map((line, index) => <p key={`${index}-${line.text}`}>{line.text}</p>)}
                </div>
              </article>
            </main>

            <aside className="cr-evidence-panel" aria-label="材料依据">
              <section className="cr-evidence-section">
                <p className="cr-eyebrow">材料依据</p>
                <h2>本次用到的事实</h2>
                {material.usedFacts.length > 0 ? (
                  <ul className="cr-fact-list">
                    {material.usedFacts.map(fact => (
                      <li key={fact.factId} className="cr-fact-item">
                        <div><strong>{fact.label}</strong><p>{fact.value}</p></div>
                        <span className="cr-source-badge">{fact.source}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="cr-empty-copy">本次正文没有引用已记录事实。</p>
                )}
              </section>

              {material.status === 'blocked' && material.blockedFacts.length > 0 && (
                <section className="cr-evidence-section cr-blocked-facts">
                  <h2>无法写入的事实</h2>
                  <ul className="cr-simple-list">
                    {material.blockedFacts.map(fact => <li key={fact.factId}>{fact.label}</li>)}
                  </ul>
                </section>
              )}
            </aside>
          </div>

          <footer className="cr-actions">
            <p>{material.status === 'blocked' ? '补充资料后可重新生成并导出。' : '导出前建议最后通读一遍正文。'}</p>
            <button type="button" className="primary-button" disabled={exporting || material.status === 'blocked'} onClick={() => void exportMaterial()}>
              {exporting ? '导出中…' : '导出 Markdown'}
            </button>
          </footer>
        </>
      )}
    </section>
  )
}
