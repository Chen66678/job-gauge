import { useEffect, useRef, useState } from 'react'
import type { MaterialPreview } from './types'
import type { CoreApiResult } from './coreApiResult'
import { errorText, unwrap } from './coreApiResult'

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

  return (
    <section className="wizard-stage" aria-label="定制简历">
      <div className="step-card">
        <button className="text-button" onClick={onBack}>← 返回岗位列表</button>
        <h1 className="step-card-title">定制简历</h1>
        {loading && <div className="followup-state"><span className="spinner" /><p>正在生成定制简历</p></div>}
        {!loading && error && !material && <div role="alert"><p>{error}</p><button className="primary-button" onClick={() => void generate()}>重试</button></div>}
        {!loading && material && <>
          {error && <p role="alert">{error}</p>}
          {material.status === 'blocked' && <p>材料生成被阻止。</p>}
          <pre className="workflow-material">{[material.greeting, ...material.resumeLines.map(line => line.text)].filter(Boolean).join('\n')}</pre>
          <button className="primary-button" disabled={exporting || material.status === 'blocked'} onClick={() => void exportMaterial()}>{exporting ? '导出中…' : '导出 Markdown'}</button>
        </>}
      </div>
    </section>
  )
}
