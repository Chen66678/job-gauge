import { useEffect, useRef, useState } from 'react'
import type { MaterialPreview } from './types'
import type { CoreApiResult } from './coreApiResult'
import { errorText, unwrap } from './coreApiResult'
import { exportToPlainText } from './domain/exportResume'
import './CustomResumePage.css'

type CustomResumeApi = {
  draftMaterial: (jobId: string) => Promise<CoreApiResult<MaterialPreview>>
  renderResumeImage: (jobId: string) => Promise<CoreApiResult<string>>
  copyResumeImage: (jobId: string) => Promise<CoreApiResult<void>>
  openExternalUrl: (url: string) => Promise<CoreApiResult<void>>
}

export default function CustomResumePage({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const api = window.coreApi as unknown as CustomResumeApi
  const [material, setMaterial] = useState<MaterialPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [exportingImage, setExportingImage] = useState(false)
  const [copyingText, setCopyingText] = useState(false)
  const [copyingImage, setCopyingImage] = useState(false)
  const [openingExternal, setOpeningExternal] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle')
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [expandedFactIds, setExpandedFactIds] = useState<Set<string>>(new Set())
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
    setSourceUrl(null)
    void generate()
    void Promise.resolve((window.coreApi as { getState?: () => Promise<{ jobs: Array<{ job: { id: string; sourceUrl: string | null } }> }> }).getState?.()).then(state => {
      if (activeJobIdRef.current !== jobId) return
      setSourceUrl(state?.jobs.find(record => record.job.id === jobId)?.job.sourceUrl ?? null)
    }).catch(() => {
      if (activeJobIdRef.current === jobId) setSourceUrl(null)
    })
  }, [jobId])

  const copyPlainText = async () => {
    if (!material) return
    setCopyingText(true)
    setError(null)
    try {
      await navigator.clipboard.writeText(exportToPlainText(material))
      setCopyStatus('copied')
      window.setTimeout(() => setCopyStatus('idle'), 1500)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setCopyingText(false)
    }
  }

  const copyResumeImage = async () => {
    setCopyingImage(true)
    setError(null)
    try {
      unwrap(await api.copyResumeImage(jobId))
      setCopyStatus('copied')
      window.setTimeout(() => setCopyStatus('idle'), 1500)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setCopyingImage(false)
    }
  }

  const openExternalUrl = async () => {
    if (!sourceUrl) return
    setOpeningExternal(true)
    setError(null)
    try {
      unwrap(await api.openExternalUrl(sourceUrl))
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setOpeningExternal(false)
    }
  }

  const exportImage = async () => {
    setExportingImage(true)
    setError(null)
    try {
      const dataUrl = unwrap(await api.renderResumeImage(jobId))
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = '简历图.png'
      link.click()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setExportingImage(false)
    }
  }

  const toggleFact = (factId: string) => {
    setExpandedFactIds(current => {
      const next = new Set(current)
      if (next.has(factId)) next.delete(factId)
      else next.add(factId)
      return next
    })
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
                        <div>
                          <strong>{fact.label}</strong>
                          <p className={expandedFactIds.has(fact.factId) ? 'cr-fact-value' : 'cr-fact-value cr-fact-value--collapsed'}>{fact.value}</p>
                          <button type="button" className="text-button cr-fact-toggle" aria-expanded={expandedFactIds.has(fact.factId)} onClick={() => toggleFact(fact.factId)}>
                            {expandedFactIds.has(fact.factId) ? '收起' : '展开'}
                          </button>
                        </div>
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
            <div className="cr-export-buttons">
              <button type="button" className="primary-button" disabled={copyingText || copyingImage || exportingImage || material.status === 'blocked'} onClick={() => void copyPlainText()}>
                {copyingText ? '复制中…' : copyStatus === 'copied' ? '已复制' : '复制正文文字'}
              </button>
              <button type="button" className="primary-button" disabled={copyingText || copyingImage || exportingImage || material.status === 'blocked'} onClick={() => void copyResumeImage()}>
                {copyingImage ? '复制中…' : '复制简历图片'}
              </button>
              <button type="button" className="primary-button" disabled={copyingText || copyingImage || exportingImage || material.status === 'blocked'} onClick={() => void exportImage()}>
                {exportingImage ? '导出中…' : '导出图片'}
              </button>
              <button type="button" className="primary-button" disabled={!sourceUrl || copyingText || copyingImage || openingExternal || material.status === 'blocked'} onClick={() => void openExternalUrl()}>
                {openingExternal ? '打开中…' : '去这个岗位 →'}
              </button>
            </div>
          </footer>
        </>
      )}
    </section>
  )
}
