import { useEffect, useRef, useState } from 'react'
import type { MaterialPreview } from './types'
import type { CoreApiResult } from './coreApiResult'
import { errorText, unwrap } from './coreApiResult'
import { exportToPlainText } from './domain/exportResume'
import './CustomResumePage.css'

type CustomResumeApi = {
  getState?: () => Promise<{ jobs: Array<{ job: { id: string; sourceUrl: string | null }; material: MaterialPreview | null }> }>
  draftMaterial: (jobId: string) => Promise<CoreApiResult<MaterialPreview>>
  renderResumeImage: (jobId: string) => Promise<CoreApiResult<string>>
  copyResumeImage: (jobId: string) => Promise<CoreApiResult<void>>
  openExternalUrl: (url: string) => Promise<CoreApiResult<void>>
}

function summarizeFact(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 96 ? `${normalized.slice(0, 96)}…` : normalized
}

export function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(',', 2)[1]
  if (!base64) throw new Error('简历图片数据无效，无法导出 PDF。')
  const binary = window.atob(base64)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export function buildPdfFromJpeg(jpegDataUrl: string, imageWidth: number, imageHeight: number) {
  const jpegBytes = dataUrlToBytes(jpegDataUrl)
  const pageWidth = (imageWidth * 72) / 96
  const pageHeight = (imageHeight * 72) / 96
  const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/ResumeImage Do\nQ\n`
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const offsets: number[] = [0]
  let length = 0
  const appendText = (text: string) => {
    const bytes = encoder.encode(text)
    chunks.push(bytes)
    length += bytes.length
  }
  const appendBytes = (bytes: Uint8Array) => {
    chunks.push(bytes)
    length += bytes.length
  }
  const appendObject = (objectNumber: number, contentText: string) => {
    offsets[objectNumber] = length
    appendText(`${objectNumber} 0 obj\n${contentText}\nendobj\n`)
  }

  appendText('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n')
  appendObject(1, '<< /Type /Catalog /Pages 2 0 R >>')
  appendObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  appendObject(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /ResumeImage 4 0 R >> >> /Contents 5 0 R >>`)
  offsets[4] = length
  appendText(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`)
  appendBytes(jpegBytes)
  appendText('\nendstream\nendobj\n')
  appendObject(5, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`)
  const crossReferenceOffset = length
  appendText('xref\n0 6\n0000000000 65535 f \n')
  for (let objectNumber = 1; objectNumber <= 5; objectNumber += 1) {
    appendText(`${String(offsets[objectNumber]).padStart(10, '0')} 00000 n \n`)
  }
  appendText(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF`)

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
}

async function renderPdfFromImage(dataUrl: string) {
  const image = new Image()
  const imageLoaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('简历图片无法加载，无法导出 PDF。'))
  })
  image.src = dataUrl
  await imageLoaded
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前环境不支持 PDF 导出。')
  context.drawImage(image, 0, 0)
  return buildPdfFromJpeg(canvas.toDataURL('image/jpeg', 0.92), canvas.width, canvas.height)
}

function downloadFile(url: string, filename: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
}

export default function CustomResumePage({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const api = window.coreApi as unknown as CustomResumeApi
  const [material, setMaterial] = useState<MaterialPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [exportingImage, setExportingImage] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [copyingText, setCopyingText] = useState(false)
  const [copyingImage, setCopyingImage] = useState(false)
  const [openingExternal, setOpeningExternal] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle')
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [expandedFactIds, setExpandedFactIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const activeJobIdRef = useRef(jobId)
  const autoGeneratingJobIdRef = useRef<string | null>(null)

  const generate = async (targetJobId = jobId) => {
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
    autoGeneratingJobIdRef.current = null
    setMaterial(null)
    setSourceUrl(null)
    setLoading(true)
    setError(null)
    void Promise.resolve(api.getState?.()).then(state => {
      if (activeJobIdRef.current !== jobId) return
      const record = state?.jobs.find(item => item.job.id === jobId)
      setSourceUrl(record?.job.sourceUrl ?? null)
      if (record?.material) {
        setMaterial(record.material)
        setLoading(false)
        return
      }
      if (autoGeneratingJobIdRef.current === jobId) return
      autoGeneratingJobIdRef.current = jobId
      void generate(jobId)
    }).catch(() => {
      if (activeJobIdRef.current !== jobId) return
      if (autoGeneratingJobIdRef.current === jobId) return
      autoGeneratingJobIdRef.current = jobId
      void generate(jobId)
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
      downloadFile(dataUrl, '简历图.png')
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setExportingImage(false)
    }
  }

  const exportPdf = async () => {
    setExportingPdf(true)
    setError(null)
    try {
      const dataUrl = unwrap(await api.renderResumeImage(jobId))
      const pdf = await renderPdfFromImage(dataUrl)
      const objectUrl = URL.createObjectURL(pdf)
      downloadFile(objectUrl, '简历.pdf')
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setExportingPdf(false)
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

  const usedFactsById = new Map(material?.usedFacts.map(fact => [fact.factId, fact]))

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
                <button type="button" className="text-button cr-regenerate" disabled={loading} onClick={() => void generate()}>
                  重新生成
                </button>
              </div>
              <article className="cr-document">
                {material.greeting && <p className="cr-greeting">{material.greeting}</p>}
                <div className="cr-resume-lines">
                  {material.resumeLines.map((line, index) => {
                    const lineFacts = line.factIds.map(factId => usedFactsById.get(factId)).filter((fact): fact is NonNullable<typeof fact> => Boolean(fact))
                    return (
                      <div key={`${index}-${line.text}`} className="cr-resume-line">
                        <p>{line.text}</p>
                        {lineFacts.length > 0 && (
                          <div className="cr-line-sources" aria-label={`第 ${index + 1} 行来源事实`}>
                            <span>来源事实</span>
                            {lineFacts.map(fact => <span key={fact.factId} className="cr-line-source" title={fact.value}>{fact.label}：{summarizeFact(fact.value)}</span>)}
                          </div>
                        )}
                      </div>
                    )
                  })}
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
              <button type="button" className="primary-button" disabled={copyingText || copyingImage || exportingImage || exportingPdf || material.status === 'blocked'} onClick={() => void copyPlainText()}>
                {copyingText ? '复制中…' : copyStatus === 'copied' ? '已复制' : '复制正文文字'}
              </button>
              <button type="button" className="primary-button" disabled={copyingText || copyingImage || exportingImage || exportingPdf || material.status === 'blocked'} onClick={() => void copyResumeImage()}>
                {copyingImage ? '复制中…' : '复制简历图片'}
              </button>
              <button type="button" className="primary-button" disabled={copyingText || copyingImage || exportingImage || exportingPdf || material.status === 'blocked'} onClick={() => void exportImage()}>
                {exportingImage ? '导出中…' : '导出图片'}
              </button>
              <button type="button" className="primary-button" disabled={copyingText || copyingImage || exportingImage || exportingPdf || material.status === 'blocked'} onClick={() => void exportPdf()}>
                {exportingPdf ? '导出中…' : '导出 PDF'}
              </button>
              <button type="button" className="primary-button" disabled={!sourceUrl || copyingText || copyingImage || exportingImage || exportingPdf || openingExternal || material.status === 'blocked'} onClick={() => void openExternalUrl()}>
                {openingExternal ? '打开中…' : '去这个岗位 →'}
              </button>
            </div>
          </footer>
        </>
      )}
    </section>
  )
}
