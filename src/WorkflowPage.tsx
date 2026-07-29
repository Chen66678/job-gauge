import { useEffect, useMemo, useRef, useState } from 'react'
import type { FactStatus, JobRequirement, MaterialPreview, ProfileFact } from './types'
import { extractPdfResume, isPdfFile } from './domain/pdfResume'
import { unwrap, errorText as formatError, type CoreApiResult } from './coreApiResult'
import type { ByokKeyStatus, ClearByokKeyResult, SaveAndVerifyByokKeyRequest, SaveAndVerifyByokKeyResult } from './domain/byokKeyStore'

export type WorkflowStep =
  | 'UPLOAD_RESUME'
  | 'RESUME_FOLLOW_UP'
  | 'SCORING'
  | 'JOB_FOLLOW_UP'
  | 'GENERATE'
  | 'EXPORT'

export type WorkflowJob = {
  job: { id: string; title: string; company: string; city: string; requirements?: JobRequirement[] }
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
    }
  } | null
  evaluationError: string | null
  followUps: FollowUpQuestion[]
  material: MaterialPreview | null
}

export type FollowUpQuestion = {
  id: string
  requirementId?: string
  kind?: 'probe' | 'explore'
  question: string
  rationale: string
}

export type WorkflowState = {
  factLibrary: ProfileFact[]
  jobs: WorkflowJob[]
}

export type WorkflowApi = {
  getState: () => Promise<WorkflowState>
  onStateChanged: (listener: (state: WorkflowState) => void) => () => void
  ingestResume: (input: { kind: 'text'; resumeText: string }) => Promise<CoreApiResult<ProfileFact[]>>
  setFactStatus: (factId: string, status: FactStatus) => Promise<CoreApiResult<void>>
  setFactStatusBatch: (updates: { factId: string; status: FactStatus }[]) => Promise<CoreApiResult<void>>
  setPreferencesFromText: (input: { acceptText: string; vetoText: string }) => Promise<CoreApiResult<unknown>>
  evaluateJobFromJd: (input: {
    jdText: string
    jobBase: { title: string; company: string; city: string; salaryK: [number, number]; companyTags: string[] }
  }) => Promise<CoreApiResult<WorkflowJob>>
  buildResumeFollowUps: () => Promise<CoreApiResult<FollowUpQuestion[]>>
  applyResumeFollowUpAnswers: (
    questions: FollowUpQuestion[],
    answers: { questionId: string; answerText: string }[]
  ) => Promise<CoreApiResult<ProfileFact[]>>
  buildFollowUps: (jobId: string) => Promise<CoreApiResult<FollowUpQuestion[]>>
  applyFollowUpAnswers: (jobId: string, answers: { questionId: string; answerText: string }[]) => Promise<CoreApiResult<ProfileFact[]>>
  reevaluateJob: (jobId: string) => Promise<CoreApiResult<WorkflowJob | null>>
  draftMaterial: (jobId: string) => Promise<CoreApiResult<MaterialPreview>>
  exportResume: (jobId: string) => Promise<CoreApiResult<string>>
  addManualFact: (input: { content: string; category: string }) => Promise<CoreApiResult<void>>
  clearFactLibrary: () => Promise<CoreApiResult<void>>
  deleteFact: (factId: string) => Promise<CoreApiResult<void>>
  saveAndVerifyByokKey: (request: SaveAndVerifyByokKeyRequest) => Promise<SaveAndVerifyByokKeyResult>
  getByokKeyStatus: () => Promise<ByokKeyStatus>
  clearByokKey: () => Promise<ClearByokKeyResult>
  getLocalApiToken: () => Promise<{ token: string }>
}

const STEPS: Array<{ id: WorkflowStep; label: string }> = [
  { id: 'UPLOAD_RESUME', label: '上传简历' },
  { id: 'RESUME_FOLLOW_UP', label: '简历追问' },
  { id: 'SCORING', label: '岗位评分' },
  { id: 'JOB_FOLLOW_UP', label: '岗位追问' },
  { id: 'GENERATE', label: '生成材料' },
  { id: 'EXPORT', label: '导出' },
]

export async function reevaluateForWorkflow(api: WorkflowApi, jobId: string): Promise<WorkflowJob | null> {
  return unwrap(await api.reevaluateJob(jobId))
}

export async function prepareScoringAfterConfirmation(input: {
  api: WorkflowApi
  jobId: string | null
  hasExistingEvaluation: boolean
}): Promise<WorkflowJob | null> {
  if (!input.jobId || !input.hasExistingEvaluation) return null
  return reevaluateForWorkflow(input.api, input.jobId)
}

export function getReevaluationWarning(job: WorkflowJob | null): string | null {
  return job?.evaluationError
    ? `重评失败，当前展示的是上一次的分数：${job.evaluationError}`
    : null
}

export async function submitJobFollowUpsForWorkflow(input: {
  api: WorkflowApi
  jobId: string
  questions: FollowUpQuestion[]
  answers: Record<string, string>
}): Promise<{ newFacts: ProfileFact[]; hadNewFacts: boolean }> {
  const answerList = input.questions.map(question => ({
    questionId: question.id,
    answerText: input.answers[question.id]?.trim() ?? '',
  }))
  const newFacts = answerList.some(item => item.answerText)
    ? unwrap(await input.api.applyFollowUpAnswers(input.jobId, answerList))
    : []
  return { newFacts, hadNewFacts: newFacts.length > 0 }
}

export default function WorkflowPage({ selectedJobId: propJobId, initialStep, onOpenProfile }: { selectedJobId?: string | null; initialStep?: WorkflowStep; onOpenProfile?: () => void }) {
  const api = window.coreApi as unknown as WorkflowApi
  const [step, setStep] = useState<WorkflowStep>('UPLOAD_RESUME')
  const [state, setState] = useState<WorkflowState | null>(null)
  const [resumeText, setResumeText] = useState('')
  const [resumeFileText, setResumeFileText] = useState<string | null>(null)
  const [selectedResumeFileName, setSelectedResumeFileName] = useState<string | null>(null)
  const [jdText, setJdText] = useState('')
  const [jobTitle, setJobTitle] = useState('产品经理')
  const [company, setCompany] = useState('目标公司')
  const [city, setCity] = useState('')
  const [salaryMin, setSalaryMin] = useState('0')
  const [salaryMax, setSalaryMax] = useState('0')
  const [acceptText, setAcceptText] = useState('')
  const [vetoText, setVetoText] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [questions, setQuestions] = useState<FollowUpQuestion[]>([])
  const [material, setMaterial] = useState<MaterialPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeJobId, setActiveJobId] = useState<string | null>(propJobId ?? null)
  const activeJobIdRef = useRef<string | null>(propJobId ?? null)
  const previousPropJobIdRef = useRef(propJobId)
  const [generationJobId, setGenerationJobId] = useState<string | null>(null)
  const [followUpIndex, setFollowUpIndex] = useState(0)
  const [followUpSubmitting, setFollowUpSubmitting] = useState(false)
  const [followUpSubmitError, setFollowUpSubmitError] = useState<string | null>(null)
  const [followUpSuccess, setFollowUpSuccess] = useState(false)

  if (previousPropJobIdRef.current !== propJobId) {
    previousPropJobIdRef.current = propJobId
    activeJobIdRef.current = propJobId ?? null
  }

  const refreshState = async () => {
    const next = await api.getState()
    setState(next)
    return next
  }

  useEffect(() => {
    refreshState().catch(reason => setError(formatError(reason)))
  }, [])

  useEffect(() => {
    activeJobIdRef.current = propJobId ?? null
    setActiveJobId(propJobId ?? null)
    setGenerationJobId(null)
  }, [propJobId])

  useEffect(() => {
    if (initialStep !== 'JOB_FOLLOW_UP' || !propJobId) return
    const record = state?.jobs.find(job => job.job.id === propJobId)
    if (!record || record.followUps.length === 0) return
    setQuestions(record.followUps)
    setAnswers({})
    setFollowUpIndex(0)
    setFollowUpSubmitError(null)
    setFollowUpSuccess(false)
    setStep('JOB_FOLLOW_UP')
  }, [initialStep, propJobId, state])

  const jobId = activeJobId ?? propJobId ?? state?.jobs[state.jobs.length - 1]?.job.id ?? null
  const currentJob = state?.jobs.find(record => record.job.id === jobId) ?? null
  const reevaluationWarning = getReevaluationWarning(currentJob)
  const unconfirmedFacts = useMemo(
    () => (state?.factLibrary ?? []).filter(fact => fact.status === 'unconfirmed'),
    [state],
  )

  const run = async (action: () => Promise<void>) => {
    setLoading(true)
    setError(null)
    try {
      await action()
    } catch (reason) {
      setError(formatError(reason))
    } finally {
      setLoading(false)
    }
  }

  const uploadResume = () => run(async () => {
    const typedText = resumeText.trim()
    const fileText = resumeFileText?.trim()
    if (!typedText && !fileText) {
      throw new Error('请先输入简历文本或选择简历文件。')
    }
    const input = { kind: 'text' as const, resumeText: typedText || fileText! }
    unwrap(await api.ingestResume(input))
    // 简历阶段追问：针对刚抽取的整个事实库，不绑定岗位。
    const resumeQuestions = unwrap(await api.buildResumeFollowUps())
    setQuestions(resumeQuestions)
    setAnswers({})
    await refreshState()
    setStep('RESUME_FOLLOW_UP')
  })

  const submitResumeFollowUps = () => run(async () => {
    const answerList = questions.map(question => ({
      questionId: question.id,
      answerText: answers[question.id]?.trim() ?? '',
    }))
    if (answerList.some(item => item.answerText)) {
      unwrap(await api.applyResumeFollowUpAnswers(questions, answerList))
    }
    await refreshState()
    await prepareScoringAfterConfirmation({ api, jobId, hasExistingEvaluation: Boolean(currentJob?.evaluation) })
    await refreshState()
    setStep('SCORING')
  })

  const scoreJob = () => run(async () => {
    if (!jdText.trim()) throw new Error('请先输入岗位描述。')
    const targetJobId = activeJobIdRef.current ?? jobId
    if (acceptText.trim() || vetoText.trim()) {
      unwrap(await api.setPreferencesFromText({ acceptText, vetoText }))
      if (!targetJobId || activeJobIdRef.current !== targetJobId) {
        await refreshState()
        return
      }
    }
    const record = unwrap(await api.evaluateJobFromJd({
      jdText: jdText.trim(),
      jobBase: {
        title: jobTitle.trim() || '未命名岗位',
        company: company.trim() || '未命名公司',
        city: city.trim(),
        salaryK: [Number(salaryMin) || 0, Number(salaryMax) || 0],
        companyTags: [],
      },
    }))
    if (!targetJobId || activeJobIdRef.current !== targetJobId) {
      await refreshState()
      return
    }
    const nextJobId = record.job.id
    activeJobIdRef.current = nextJobId
    setActiveJobId(nextJobId)
    const nextQuestions = unwrap(await api.buildFollowUps(nextJobId))
    await refreshState()
    if (activeJobIdRef.current !== nextJobId) return
    setQuestions(nextQuestions)
    setAnswers({})
    setFollowUpIndex(0)
    setFollowUpSubmitError(null)
    setFollowUpSuccess(false)
    setStep('JOB_FOLLOW_UP')
  })

  const submitJobFollowUps = async () => {
    if (!jobId) { setFollowUpSubmitError('岗位尚未完成评分。'); return }
    setFollowUpSubmitting(true)
    setFollowUpSubmitError(null)
    try {
      const targetJobId = jobId
      const result = await submitJobFollowUpsForWorkflow({ api, jobId: targetJobId, questions, answers })
      if (result.hadNewFacts && activeJobIdRef.current === targetJobId) {
        await reevaluateForWorkflow(api, targetJobId)
      }
      await refreshState()
      if (activeJobIdRef.current !== targetJobId) return
      setGenerationJobId(targetJobId)
      setFollowUpSuccess(true)
    } catch (reason) {
      setFollowUpSubmitError(formatError(reason))
    } finally {
      setFollowUpSubmitting(false)
    }
  }

  const loadFollowUps = () => run(async () => {
    const targetJobId = activeJobIdRef.current ?? jobId
    if (!targetJobId) throw new Error('岗位未选择。')
    const nextQuestions = unwrap(await api.buildFollowUps(targetJobId))
    if (activeJobIdRef.current !== targetJobId) return
    setQuestions(nextQuestions)
    setAnswers({})
    setFollowUpIndex(0)
    setFollowUpSubmitError(null)
    setFollowUpSuccess(false)
    setStep('JOB_FOLLOW_UP')
  })

  const retryReevaluation = () => run(async () => {
    if (!jobId) throw new Error('岗位未选择。')
    await reevaluateForWorkflow(api, jobId)
    await refreshState()
  })

  const generateMaterial = () => run(async () => {
    const targetJobId = generationJobId ?? jobId
    if (!targetJobId) throw new Error('岗位尚未完成评分。')
    if (unconfirmedFacts.length > 0) {
      throw new Error('请先处理全部待确认事实。')
    }
    const nextMaterial = unwrap(await api.draftMaterial(targetJobId))
    await refreshState()
    if (activeJobIdRef.current !== targetJobId) return
    setMaterial(nextMaterial)
    setStep('EXPORT')
  })

  const exportMaterial = () => run(async () => {
    if (!jobId) throw new Error('岗位尚未完成评分。')
    const markdown = unwrap(await api.exportResume(jobId))
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = '定制简历.md'
    link.click()
    URL.revokeObjectURL(url)
  })

  const fileSelected = async (file: File | undefined) => {
    if (!file) return
    try {
      if (isPdfFile(file)) {
        setResumeFileText(await extractPdfResume(file))
        setSelectedResumeFileName(file.name)
        return
      }
      setResumeFileText(await file.text())
      setSelectedResumeFileName(file.name)
    } catch (reason) {
      setError(formatError(reason))
    }
  }

  const stepIndex = STEPS.findIndex(item => item.id === step)
  const requiresSelectedJob = ['SCORING', 'JOB_FOLLOW_UP', 'GENERATE', 'EXPORT'].includes(step)

  return (
    <section className="workflow-page" aria-label="前端流程编排">
      <h1>申请材料流程</h1>
      <div className="workflow-steps" aria-label="流程步骤">
        {STEPS.map((item, index) => (
          <div key={item.id} className={index <= stepIndex ? 'workflow-step active' : 'workflow-step'}>
            {index + 1}. {item.label}
          </div>
        ))}
      </div>

      {loading && (
        <p role="status">
          {step === 'GENERATE' || step === 'SCORING'
            ? '正在分析，模型较慢约需 30s–1.5min，请稍候'
            : '处理中...'}
        </p>
      )}
      {error && <p role="alert" className="workflow-error">{error}</p>}
      {reevaluationWarning && (
        <div role="alert" className="workflow-error">
          <p>{reevaluationWarning}</p>
          <button onClick={retryReevaluation} disabled={loading}>重试重评</button>
        </div>
      )}

      {step === 'UPLOAD_RESUME' && (
        <div className="workflow-panel">
          <h2>上传简历</h2>
          <p>仅用于提取求职事实，解析结果不会在这里回显简历原文。</p>
          {selectedResumeFileName && <p role="status">✓ 已选择文件：{selectedResumeFileName}</p>}
          <textarea value={resumeText} onChange={event => { setResumeText(event.target.value); setResumeFileText(null); setSelectedResumeFileName(null) }} placeholder="粘贴简历文本" rows={12} />
          <input type="file" accept=".txt,.md,.pdf" onChange={event => fileSelected(event.target.files?.[0])} />
          <button onClick={uploadResume} disabled={loading}>下一步</button>
        </div>
      )}

      {step === 'RESUME_FOLLOW_UP' && (
        <div className="workflow-panel">
          <h2>简历追问</h2>
          <p>模型根据简历挑出可以细化的地方，如实回答以建立更完整的事实库。不确定的可以留空。</p>
          {questions.length === 0 && <p>没有需要补充的问题，可以直接进入下一步。</p>}
          {questions.map(question => (
            <label key={question.id} className="workflow-question">
              <span>{question.question}</span>
              <small>{question.rationale}</small>
              <textarea value={answers[question.id] ?? ''} onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))} rows={3} placeholder="如实填写；不确定可以留空" />
            </label>
          ))}
          <button onClick={submitResumeFollowUps} disabled={loading}>下一步</button>
        </div>
      )}

      {requiresSelectedJob && !propJobId ? (
        <div className="workflow-panel">
          <h2>{STEPS.find(item => item.id === step)?.label}</h2>
          <p style={{ padding: '24px 0', color: 'var(--text-secondary)' }}>请先从岗位列表选择一个岗位，然后点击“定制简历”继续此步骤。</p>
        </div>
      ) : step === 'SCORING' && (
        <div className="workflow-panel">
          <h2>岗位评分</h2>
          {currentJob?.evaluation ? (
            <div>
              {currentJob.evaluation.vetoed ? (
                <p>该岗位已被否决：{currentJob.evaluation.vetoRuleLabel}</p>
              ) : (
                <div>
                  <p>评分：<strong>{currentJob.evaluation.score.total}</strong> — {currentJob.evaluation.score.strategyLabel}</p>
                  {currentJob.evaluation.score.gaps.length > 0 && (
                    <p>缺口：{currentJob.evaluation.score.gaps.join('、')}</p>
                  )}
                  {currentJob.evaluation.score.risks.length > 0 && (
                    <p>风险：{currentJob.evaluation.score.risks.join('、')}</p>
                  )}
                </div>
              )}
              <button onClick={loadFollowUps} disabled={loading}>下一步</button>
            </div>
          ) : (
            <div>
              <p>该岗位尚未评分，请粘贴岗位描述后评分。</p>
              <input value={jobTitle} onChange={event => setJobTitle(event.target.value)} placeholder="岗位名称" />
              <input value={company} onChange={event => setCompany(event.target.value)} placeholder="公司" />
              <input value={city} onChange={event => setCity(event.target.value)} placeholder="城市" />
              <div className="workflow-inline-fields">
                <input value={salaryMin} onChange={event => setSalaryMin(event.target.value)} inputMode="numeric" placeholder="最低薪资 k" />
                <input value={salaryMax} onChange={event => setSalaryMax(event.target.value)} inputMode="numeric" placeholder="最高薪资 k" />
              </div>
              <textarea value={jdText} onChange={event => setJdText(event.target.value)} placeholder="粘贴岗位描述" rows={10} />
              <input value={acceptText} onChange={event => setAcceptText(event.target.value)} placeholder="偏好（可选）" />
              <input value={vetoText} onChange={event => setVetoText(event.target.value)} placeholder="红线（可选）" />
              <button onClick={scoreJob} disabled={loading}>下一步</button>
            </div>
          )}
        </div>
      )}

      {step === 'JOB_FOLLOW_UP' && currentJob && (
        <FollowUpDrawer
          jobTitle={currentJob.job.title}
          requirements={currentJob.job.requirements ?? []}
          questions={questions}
          answers={answers}
          index={followUpIndex}
          submitting={followUpSubmitting}
          submitError={followUpSubmitError}
          success={followUpSuccess}
          onAnswer={(questionId, answerText) => setAnswers(current => ({ ...current, [questionId]: answerText }))}
          onPrevious={() => setFollowUpIndex(index => Math.max(0, index - 1))}
          onNext={() => setFollowUpIndex(index => Math.min(questions.length - 1, index + 1))}
          onSkip={() => setFollowUpIndex(index => index < questions.length - 1 ? index + 1 : index)}
          onSubmit={() => void submitJobFollowUps()}
          onClose={() => setStep(followUpSuccess ? 'GENERATE' : 'SCORING')}
          onOpenProfile={() => { setStep('GENERATE'); onOpenProfile?.() }}
        />
      )}

      {step === 'GENERATE' && (
        <div className="workflow-panel">
          <h2>生成材料</h2>
          <p>确认事实后生成定制简历。</p>
          <button onClick={generateMaterial} disabled={loading || unconfirmedFacts.length > 0}>生成</button>
        </div>
      )}

      {step === 'EXPORT' && (
        <div className="workflow-panel">
          <h2>导出</h2>
          {material?.status === 'blocked' && <p>材料生成被阻止。</p>}
          {material && <pre className="workflow-material">{[material.greeting, ...material.resumeLines.map((line) => line.text)].filter(Boolean).join('\n')}</pre>}
          <button onClick={exportMaterial} disabled={!material || material.status === 'blocked'}>导出文本</button>
        </div>
      )}
    </section>
  )
}

function FollowUpDrawer({
  jobTitle, requirements, questions, answers, index, submitting, submitError, success, onAnswer, onPrevious, onNext, onSkip, onSubmit, onClose, onOpenProfile,
}: {
  jobTitle: string
  requirements: JobRequirement[]
  questions: FollowUpQuestion[]
  answers: Record<string, string>
  index: number
  submitting: boolean
  submitError: string | null
  success: boolean
  onAnswer: (questionId: string, answerText: string) => void
  onPrevious: () => void
  onNext: () => void
  onSkip: () => void
  onSubmit: () => void
  onClose: () => void
  onOpenProfile: () => void
}) {
  const [whyOpen, setWhyOpen] = useState(false)
  const question = questions[index]
  const isLast = index >= questions.length - 1
  const answeredCount = questions.filter(item => answers[item.id]?.trim()).length
  const requirementLabel = requirements?.find(item => item.id === question?.requirementId)?.label ?? '整体经历匹配度'
  return <><div className="followup-drawer-scrim" /><aside className="followup-drawer" aria-label="岗位补充信息">
    <header className="followup-drawer-header"><h2>{jobTitle} · 补充信息</h2><button className="followup-drawer-close" onClick={onClose}>✕ 关闭</button></header>
    {!success && <div className="followup-question-bar"><span>第 {questions.length ? index + 1 : 0}/{questions.length} 题</span><span className="followup-dots">{questions.map((item, itemIndex) => <i className={itemIndex === index ? 'active' : ''} key={item.id} />)}</span></div>}
    {submitting ? <div className="followup-state"><span className="spinner" /><p>提交中，约 10–30 秒</p></div> : success ? <div className="followup-state"><span className="success-icon" aria-hidden="true">✓</span><h3>提交成功</h3><p>已收到 {answeredCount} 条回答，系统正在提炼事实</p><p>前往「我的资料」确认新增事实，然后可重新评估此岗位</p><div><button className="primary-button" onClick={onOpenProfile}>去我的资料确认 →</button><button className="text-button" onClick={onClose}>关闭</button></div></div> : question ? <><div className="followup-drawer-content">{submitError && <div className="followup-error">提交失败，请重试</div>}<article className="followup-card"><div className="followup-card-top"><span className="followup-kind-badge">{question.kind === 'explore' ? '探索' : '深挖'}</span><span className="followup-requirement">针对要求：{requirementLabel}</span></div><p className="followup-question-text">{question.question}</p><button className="followup-why" onClick={() => setWhyOpen(value => !value)}>为什么问这个 {whyOpen ? '▾' : '▸'}</button>{whyOpen && <p className="followup-rationale">{question.rationale}</p>}<textarea className="followup-answer" value={answers[question.id] ?? ''} onChange={event => onAnswer(question.id, event.target.value)} placeholder="如实填写；不确定可以留空" /></article></div><footer className="followup-drawer-footer"><button className="text-button" disabled={index === 0} onClick={onPrevious}>← 上一题</button><div className="followup-footer-actions"><button className="followup-link" onClick={onSkip}>跳过本题</button><button className={submitError ? 'btn-danger' : 'primary-button'} onClick={isLast ? onSubmit : onNext}>{submitError ? '重试' : isLast ? '提交全部' : '下一题 →'}</button></div></footer></> : <div className="followup-state"><h3>没有需要补充的问题</h3><button className="primary-button" onClick={onClose}>继续</button></div>}
  </aside></>
}
