import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { FactStatus, ProfileFact } from './types'
import type { WorkflowApi, WorkflowState } from './workflowApi'
import { unwrap, errorText as formatError } from './coreApiResult'
import { extractPdfResume, isPdfFile } from './domain/pdfResume'
import FollowUpDrawer from './FollowUpDrawer'
import './ProfilePage.css'

type ResumeInput = { kind: 'text'; resumeText: string }
type UndoState = { factId: string; previousStatus: FactStatus } | null
const DEFAULT_FACT_CATEGORIES = ['工作经历', '技能', '教育', '偏好']

function sourceLabel(sourceType: ProfileFact['sourceType']) {
  return sourceType === 'resume' ? '简历解析' : sourceType === 'user_answer' ? '反问补充' : '手动添加'
}

const Icon = ({ children, strokeWidth = 2 }: { children: ReactNode; strokeWidth?: number }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)
const CheckIcon = () => <Icon strokeWidth={2.5}><polyline points="20 6 9 17 4 12" /></Icon>
const ClockIcon = () => <Icon><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></Icon>
const CloseIcon = () => <Icon><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Icon>
const EditIcon = () => <Icon><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z" /></Icon>
const ResumeIcon = () => <Icon><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></Icon>
const UploadIcon = () => <Icon><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></Icon>
const InfoIcon = () => <Icon><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></Icon>
const WarningIcon = () => <Icon><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></Icon>

export default function ProfilePage() {
  const api = window.coreApi as unknown as WorkflowApi
  const [state, setState] = useState<WorkflowState | null>(null)
  const [resumeText, setResumeText] = useState('')
  const [resumeInput, setResumeInput] = useState<ResumeInput | null>(null)
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseElapsedSeconds, setParseElapsedSeconds] = useState(0)
  const [parseError, setParseError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [processedOpen, setProcessedOpen] = useState(false)
  const [editingFactId, setEditingFactId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [undo, setUndo] = useState<UndoState>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [manualAddOpen, setManualAddOpen] = useState(false)
  const [manualContent, setManualContent] = useState('')
  const [manualCategory, setManualCategory] = useState('')
  const [manualSubmitting, setManualSubmitting] = useState(false)
  const [resumeFollowUpCount, setResumeFollowUpCount] = useState(0)
  const [resumeFollowUpOpen, setResumeFollowUpOpen] = useState(false)
  const undoTimerRef = useRef<number | null>(null)
  const saveMessageTimerRef = useRef<number | null>(null)
  const resumeFollowUpsCheckedRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refreshState = async () => {
    const next = await api.getState()
    setState(next)
  }

  useEffect(() => {
    refreshState().catch(reason => setError(formatError(reason)))
    return () => {
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current)
      if (saveMessageTimerRef.current !== null) window.clearTimeout(saveMessageTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!parsing) return
    setParseElapsedSeconds(0)
    const timer = window.setInterval(() => setParseElapsedSeconds(seconds => seconds + 1), 1000)
    return () => window.clearInterval(timer)
  }, [parsing])

  useEffect(() => {
    if (!state?.factLibrary.some(fact => fact.sourceType === 'resume') || resumeFollowUpsCheckedRef.current) return
    resumeFollowUpsCheckedRef.current = true
    api.buildResumeFollowUps()
      .then(result => setResumeFollowUpCount(unwrap(result).length))
      .catch(reason => {
        setError(formatError(reason))
        setResumeFollowUpCount(0)
      })
  }, [api, state])

  const run = async (action: () => Promise<void>) => {
    setError(null)
    try { await action() } catch (reason) { setError(formatError(reason)) }
  }

  const uploadResume = async (input: ResumeInput) => {
    const reconciliationPreviewApi = api as Partial<Pick<WorkflowApi, 'getReconciliationPreview'>>
    if (reconciliationPreviewApi.getReconciliationPreview) {
      const preview = unwrap(await reconciliationPreviewApi.getReconciliationPreview())
      if (preview.modelCallCount > 0 && !window.confirm(`已有事实库将与本次简历比对调和，预计额外消耗 ${preview.modelCallCount} 次模型调用。继续吗？`)) return
    }
    const previewApi = api as Partial<Pick<WorkflowApi, 'getReevaluationPreview'>>
    if (previewApi.getReevaluationPreview) {
      const preview = unwrap(await previewApi.getReevaluationPreview('recent'))
      if (preview.jobCount > 0 && !window.confirm(`保存简历后将自动重评 ${preview.jobCount} 条岗位，预计消耗 ${preview.modelCallCount} 次模型调用。继续吗？`)) return
    }
    setParsing(true)
    setParseError(null)
    setResumeFollowUpCount(0)
    resumeFollowUpsCheckedRef.current = false
    try {
      unwrap(await api.ingestResume(input))
      setResumeInput(null)
      setResumeText('')
      setSelectedFileName(null)
      await refreshState()
    } catch (reason) {
      setParseError(formatError(reason))
    } finally {
      setParsing(false)
    }
  }

  const parseTypedResume = () => {
    const input = resumeInput ?? (resumeText.trim() ? { kind: 'text' as const, resumeText: resumeText.trim() } : null)
    if (!input) { setParseError('请先粘贴简历文本或选择简历文件。'); return }
    void uploadResume(input)
  }

  const fileSelected = async (file?: File) => {
    if (!file) return
    setParseError(null)
    try {
      if (isPdfFile(file)) {
        setResumeInput({ kind: 'text', resumeText: await extractPdfResume(file) })
      } else {
        setResumeInput({ kind: 'text', resumeText: await file.text() })
      }
      setSelectedFileName(file.name)
    } catch (reason) { setParseError(formatError(reason)) }
  }

  const changeFactStatus = (factId: string, status: FactStatus, previousStatus?: FactStatus) => {
    void run(async () => {
      unwrap(await api.setFactStatus(factId, status))
      await refreshState()
      if (status !== 'rejected' || !previousStatus) return
      setUndo({ factId, previousStatus })
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current)
      undoTimerRef.current = window.setTimeout(() => setUndo(null), 3000)
    })
  }

  const undoReject = () => {
    if (!undo) return
    const pendingUndo = undo
    setUndo(null)
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current)
    changeFactStatus(pendingUndo.factId, pendingUndo.previousStatus)
  }

  const confirmAll = () => {
    const updates = (state?.factLibrary ?? []).filter(fact => fact.status === 'unconfirmed').map(fact => ({ factId: fact.id, status: 'confirmed' as const }))
    if (!updates.length) return
    void run(async () => { unwrap(await api.setFactStatusBatch(updates)); await refreshState() })
  }

  const saveEdit = (fact: ProfileFact) => {
    const content = editingValue.trim()
    if (!content) return
    void run(async () => {
      unwrap(await api.setFactStatus(fact.id, 'rejected'))
      unwrap(await api.addManualFact({ content, category: fact.category }))
      await refreshState()
      setEditingFactId(null)
      setEditingValue('')
      setSaveMessage('修改已保存（排除原条 + 新增修正版）')
      if (saveMessageTimerRef.current !== null) window.clearTimeout(saveMessageTimerRef.current)
      saveMessageTimerRef.current = window.setTimeout(() => setSaveMessage(null), 3000)
    })
  }

  const showSaveMessage = (message: string) => {
    setSaveMessage(message)
    if (saveMessageTimerRef.current !== null) window.clearTimeout(saveMessageTimerRef.current)
    saveMessageTimerRef.current = window.setTimeout(() => setSaveMessage(null), 3000)
  }

  const submitManualFact = () => {
    const content = manualContent.trim()
    if (!content || !manualCategory) return
    void run(async () => {
      setManualSubmitting(true)
      try {
        unwrap(await api.addManualFact({ content, category: manualCategory }))
        await refreshState()
        setManualContent('')
        setManualAddOpen(false)
        showSaveMessage('事实已添加并标记为已确认')
      } finally {
        setManualSubmitting(false)
      }
    })
  }

  const dismissConflict = (conflictId: string) => {
    void run(async () => {
      unwrap(await api.dismissFactConflict(conflictId))
      await refreshState()
    })
  }

  const facts = state?.factLibrary ?? []
  const factConflicts = state?.factConflicts ?? []
  const factsById = new Map(facts.map(fact => [fact.id, fact] as const))
  const factGroupsById = new Map((state?.factGroups ?? []).map(group => [group.id, group] as const))
  const unconfirmedFacts = facts.filter(fact => fact.status === 'unconfirmed')
  const processedFacts = facts.filter(fact => fact.status !== 'unconfirmed')
  const groupedFacts = unconfirmedFacts.reduce<Record<string, ProfileFact[]>>((groups, fact) => {
    groups[fact.category] = [...(groups[fact.category] ?? []), fact]
    return groups
  }, {})
  const categoryOptions = Object.keys(groupedFacts)
  const availableCategories = categoryOptions.length ? categoryOptions : DEFAULT_FACT_CATEGORIES
  const selectedManualCategory = manualCategory || availableCategories[0]
  const confirmedCount = facts.filter(fact => fact.status === 'confirmed').length

  const factCard = (fact: ProfileFact, processed = false) => (
    <div className={`fact-card ${processed ? 'done-card is-processed' : ''}`} key={fact.id}>
      <div className="fact-main">
        {fact.groupId && factGroupsById.get(fact.groupId) && (
          <div className="fact-group-tag">{factGroupsById.get(fact.groupId)!.label}</div>
        )}
        <div className="fact-top">
          <span className="fact-label">{fact.label}</span>
          <span className={`src-badge src-${fact.sourceType}`}>{sourceLabel(fact.sourceType)}</span>
          {fact.confidence < 0.7 && <span className="low-conf"><WarningIcon />提取可信度较低，请仔细确认</span>}
        </div>
        {fact.summary && <div className="fact-summary">{fact.summary}</div>}
        <div className="fact-value">{fact.value}</div>
        <div className="fact-foot">
          <span className="source-ref"><InfoIcon />来源：{fact.sourceRef}</span><span className="edit-sep">·</span>
          <button className="edit-link" onClick={() => { setEditingFactId(fact.id); setEditingValue(fact.value) }}><EditIcon />修改</button>
        </div>
        {editingFactId === fact.id && <div className="edit-panel">
          <textarea className="edit-textarea" value={editingValue} onChange={event => setEditingValue(event.target.value)} aria-label={`修改${fact.label}`} />
          <div className="edit-actions"><button className="btn-edit-save" onClick={() => saveEdit(fact)}>保存修改</button><button className="btn-edit-cancel" onClick={() => setEditingFactId(null)}>取消</button><span className="edit-note">将排除原事实并加入修正内容</span></div>
        </div>}
      </div>
      {processed ? <div className="fact-actions processed-actions"><span>{fact.status === 'confirmed' ? '已确认' : '已排除'}</span><button className="rs-btn" onClick={() => changeFactStatus(fact.id, 'unconfirmed')}>重新确认</button></div> : <div className="fact-actions"><button className="act-btn act-confirm" onClick={() => changeFactStatus(fact.id, 'confirmed')}><CheckIcon />确认</button><button className="act-btn act-reject" onClick={() => changeFactStatus(fact.id, 'rejected', fact.status)}><CloseIcon />排除</button></div>}
    </div>
  )

  return <section className="profile-page" aria-label="我的资料">
    <div className="page-header"><h1>我的资料</h1><div className="meta">共 {facts.length} 条事实 · 已确认 {confirmedCount} 条</div></div>
    <div className="section-head profile-section-first"><span className="dot d-indigo" /><span className="section-title">简历</span></div>
    {parsing ? <div className="parsing"><span className="p-spin">◌</span><div><div className="p-txt">正在解析简历…（已等待 {parseElapsedSeconds} 秒）</div><div className="p-warn">模型响应较慢，可能需要几分钟。解析期间请勿关闭窗口，关闭后需重新上传。</div></div></div> : parseError ? <div className="parse-fail"><div className="pf-title">简历解析失败</div><div className="pf-sub">{parseError}</div><div className="pf-actions"><button className="btn-retry" onClick={() => { setParseError(null); fileInputRef.current?.click() }}><UploadIcon />重新上传</button></div></div> : facts.length ? <div className="resume-card"><div className="resume-row"><div className="resume-icon"><ResumeIcon /></div><div className="resume-body"><div className="resume-title"><span className="ok-dot"><CheckIcon /></span>简历已解析，提取出 <b>{facts.length}</b> 条事实</div><div className="resume-sub">如需更新简历，可重新上传 PDF 或粘贴文字——原有已确认事实不会自动覆盖</div></div><div className="resume-actions">{resumeFollowUpCount > 0 && <button className="primary-button" onClick={() => setResumeFollowUpOpen(true)}>完善简历信息（{resumeFollowUpCount} 问）</button>}<button className="btn" onClick={() => fileInputRef.current?.click()}><UploadIcon />重新上传</button></div></div></div> : <div className="empty-state"><div className="empty-icon"><ResumeIcon /></div><div className="empty-title">上传简历，建立你的事实库</div><div className="empty-sub">解析后可逐条确认工作经历、技能与偏好，为岗位评估提供依据。</div></div>}
    <div className="drop-zone"><div className="dz-icon"><UploadIcon /></div><div className="dz-title">上传 PDF、文本简历或粘贴简历内容</div><div className="dz-sub">支持 PDF、TXT、Markdown 格式</div><div className="dz-actions"><button className="btn" onClick={() => fileInputRef.current?.click()}><UploadIcon />选择文件</button><button className="btn btn-primary" onClick={parseTypedResume} disabled={parsing}>解析简历</button></div>{selectedFileName && <p className="resume-title"><span className="ok-dot"><CheckIcon /></span>已选择文件：{selectedFileName}</p>}<textarea value={resumeText} onChange={event => { setResumeText(event.target.value); setResumeInput(null); setSelectedFileName(null) }} placeholder="粘贴简历文本" aria-label="粘贴简历文本" rows={4} /><input ref={fileInputRef} className="profile-file-input" type="file" accept=".txt,.md,.pdf" onChange={event => void fileSelected(event.target.files?.[0])} /></div>
    {error && <p role="alert" className="profile-error">{error}</p>}
    <div className="section-head"><span className="dot d-indigo" /><span className="section-title">事实库</span></div>
    {factConflicts.length > 0 && <div className="conflict-section">{factConflicts.map(conflict => <div className="conflict-card" key={conflict.id}>
      <div className="conflict-title"><WarningIcon />检测到同一事实的多个版本存在差异，需要你确认</div>
      <div className="conflict-rationale">{conflict.rationale}</div>
      <div className="conflict-versions">{conflict.factIds.map(factId => factsById.get(factId)).filter((fact): fact is ProfileFact => !!fact).map(fact => <div className="conflict-version" key={fact.id}>{fact.value}</div>)}</div>
      <div className="conflict-actions"><button className="text-button" onClick={() => dismissConflict(conflict.id)}>已手动处理，移除提示</button></div>
    </div>)}</div>}
    {unconfirmedFacts.length > 0 && <div className="status-bar"><div className="sb-icon"><ClockIcon /></div><div className="sb-text"><div className="sb-count">待确认 <b>{unconfirmedFacts.length}</b> 条事实</div><div className="sb-hint">确认完成后评估更准确——无需全部确认，随时可继续</div></div><button className="btn-batch" onClick={confirmAll}><CheckIcon />全部确认</button></div>}
    {Object.entries(groupedFacts).map(([category, categoryFacts]) => <div key={category}><div className="section-head fact-group-head"><span className="dot" /><span className="section-title">{category}</span><span className="section-count">{categoryFacts.length} 条待确认</span></div>{categoryFacts.map(fact => factCard(fact))}</div>)}
    {facts.length === 0 && !parsing && !parseError && <div className="empty-state facts-empty"><div className="empty-title">还没有可确认的事实</div><div className="empty-sub">上传并解析简历后，事实会按类别展示在这里。</div></div>}
    {!manualAddOpen ? <button className="manual-add" type="button" onClick={() => { setManualCategory(selectedManualCategory); setManualAddOpen(true) }}><span className="ma-icon">+</span><span className="ma-body"><span className="ma-title">手动添加事实</span><span className="ma-sub">手动录入的事实直接标记为已确认，参与后续评估</span></span></button> : <form className="manual-add manual-add-form" onSubmit={event => { event.preventDefault(); submitManualFact() }}><div className="manual-field"><label htmlFor="manual-fact-content">事实内容</label><textarea id="manual-fact-content" className="manual-control manual-textarea" value={manualContent} onChange={event => setManualContent(event.target.value)} placeholder="例如：主导过日活百万级产品的性能优化" /></div><div className="manual-field"><label htmlFor="manual-fact-category">类别</label><select id="manual-fact-category" className="manual-control" value={selectedManualCategory} onChange={event => setManualCategory(event.target.value)}>{availableCategories.map(category => <option key={category} value={category}>{category}</option>)}</select></div><div className="manual-actions"><button className="primary-button" type="submit" disabled={!manualContent.trim() || manualSubmitting}>{manualSubmitting ? '添加中…' : '添加'}</button><button className="text-button" type="button" onClick={() => { setManualAddOpen(false); setManualContent('') }} disabled={manualSubmitting}>取消</button></div></form>}
    {processedFacts.length > 0 && <div className="processed-section"><button className="processed-toggle" onClick={() => setProcessedOpen(open => !open)}>{processedOpen ? '⌄' : '›'} 已处理事实（{processedFacts.length}）</button>{processedOpen && <div className="processed-list">{processedFacts.map(fact => factCard(fact, true))}</div>}</div>}
    {undo && <div className="undo-toast" role="status"><CloseIcon /><span>已排除该事实</span><button className="ut-undo" onClick={undoReject}>撤销</button></div>}
    {saveMessage && <div className="undo-toast" role="status"><span>{saveMessage}</span></div>}
    {resumeFollowUpOpen && <FollowUpDrawer mode="resume" onClose={() => setResumeFollowUpOpen(false)} onOpenProfile={() => setResumeFollowUpOpen(false)} onSubmitted={() => { setResumeFollowUpCount(0); void refreshState() }} />}
  </section>
}
