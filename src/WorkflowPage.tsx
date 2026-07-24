import { useEffect, useMemo, useRef, useState } from 'react'
import type { FactStatus, MaterialPreview, ProfileFact } from './types'
import { OUTPUT_GATE_RELEASED } from './outputGateRelease'

export type WorkflowStep =
  | 'UPLOAD_RESUME'
  | 'RESUME_FOLLOW_UP'
  | 'CONFIRM_FACTS'
  | 'SCORING'
  | 'JOB_FOLLOW_UP'
  | 'GENERATE'
  | 'EXPORT'

export type WorkflowJob = {
  job: { id: string; title: string; company: string; city: string }
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
  question: string
  rationale: string
}

export type WorkflowState = {
  factLibrary: ProfileFact[]
  jobs: WorkflowJob[]
}

export type CoreApiResult<T> = T | { error: string }

export type WorkflowApi = {
  getState: () => Promise<WorkflowState>
  ingestResume: (input: { kind: 'text'; resumeText: string } | { kind: 'image'; imageBase64: string; mimeType: string }) => Promise<CoreApiResult<ProfileFact[]>>
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
  addManualFact: (input: { content: string; category: string }) => Promise<void>
}

const STEPS: Array<{ id: WorkflowStep; label: string }> = [
  { id: 'UPLOAD_RESUME', label: '上传简历' },
  { id: 'RESUME_FOLLOW_UP', label: '简历追问' },
  { id: 'CONFIRM_FACTS', label: '确认事实' },
  { id: 'SCORING', label: '岗位评分' },
  { id: 'JOB_FOLLOW_UP', label: '岗位追问' },
  { id: 'GENERATE', label: '生成材料' },
  { id: 'EXPORT', label: '导出' },
]

function unwrap<T>(result: CoreApiResult<T>): T {
  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error(result.error)
  }
  return result as T
}

function formatError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

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

export async function continueAfterFactConfirmationForWorkflow(input: {
  api: WorkflowApi
  jobId: string | null
  nextStep: 'SCORING' | 'GENERATE'
  hasExistingEvaluation: boolean
  hasNewConfirmedFacts: boolean
}): Promise<'SCORING' | 'GENERATE'> {
  if (input.nextStep === 'GENERATE') {
    if (!input.jobId) throw new Error('缺少待重评岗位。')
    if (input.hasNewConfirmedFacts) {
      await reevaluateForWorkflow(input.api, input.jobId)
    }
    return 'GENERATE'
  }
  await prepareScoringAfterConfirmation(input)
  return 'SCORING'
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
}): Promise<{ newFacts: ProfileFact[]; nextStep: 'CONFIRM_FACTS' | 'GENERATE' }> {
  const answerList = input.questions.map(question => ({
    questionId: question.id,
    answerText: input.answers[question.id]?.trim() ?? '',
  }))
  const newFacts = answerList.some(item => item.answerText)
    ? unwrap(await input.api.applyFollowUpAnswers(input.jobId, answerList))
    : []
  return {
    newFacts,
    nextStep: newFacts.length > 0 ? 'CONFIRM_FACTS' : 'GENERATE',
  }
}

export default function WorkflowPage({ selectedJobId: propJobId }: { selectedJobId?: string | null }) {
  const api = window.coreApi as unknown as WorkflowApi
  const [step, setStep] = useState<WorkflowStep>('UPLOAD_RESUME')
  const [state, setState] = useState<WorkflowState | null>(null)
  const [resumeText, setResumeText] = useState('')
  const [resumeImage, setResumeImage] = useState<{ base64: string; mimeType: string } | null>(null)
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
  const [manualFactContent, setManualFactContent] = useState('')
  const [manualFactCategory, setManualFactCategory] = useState('skill')
  const [activeJobId, setActiveJobId] = useState<string | null>(propJobId ?? null)
  const activeJobIdRef = useRef<string | null>(propJobId ?? null)
  const previousPropJobIdRef = useRef(propJobId)
  const [confirmationNextStep, setConfirmationNextStep] = useState<'SCORING' | 'GENERATE'>('SCORING')
  const [pendingReevaluationJobId, setPendingReevaluationJobId] = useState<string | null>(null)
  const [generationJobId, setGenerationJobId] = useState<string | null>(null)
  const confirmedFactIdsAtConfirmEntryRef = useRef<Set<string>>(new Set())

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
    setPendingReevaluationJobId(null)
    setGenerationJobId(null)
  }, [propJobId])

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
    if (!resumeText.trim() && !resumeImage) {
      throw new Error('请先输入简历文本或选择简历图片。')
    }
    const input = resumeText.trim()
      ? { kind: 'text' as const, resumeText: resumeText.trim() }
      : { kind: 'image' as const, imageBase64: resumeImage!.base64, mimeType: resumeImage!.mimeType }
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
    const next = await refreshState()
    confirmedFactIdsAtConfirmEntryRef.current = new Set(
      next.factLibrary.filter(fact => fact.status === 'confirmed').map(fact => fact.id),
    )
    setConfirmationNextStep('SCORING')
    setPendingReevaluationJobId(null)
    setStep('CONFIRM_FACTS')
  })

  const continueAfterFactConfirmation = () => run(async () => {
    if (unconfirmedFacts.length > 0) {
      throw new Error('请先确认或否掉全部待确认事实。')
    }
    const targetJobId = confirmationNextStep === 'GENERATE' ? pendingReevaluationJobId : jobId
    const hasNewConfirmedFacts = (state?.factLibrary ?? []).some(
      fact => fact.status === 'confirmed' && !confirmedFactIdsAtConfirmEntryRef.current.has(fact.id),
    )
    const nextStep = await continueAfterFactConfirmationForWorkflow({
      api,
      jobId: targetJobId,
      nextStep: confirmationNextStep,
      hasExistingEvaluation: Boolean(currentJob?.evaluation),
      hasNewConfirmedFacts,
    })
    await refreshState()
    if (!targetJobId || activeJobIdRef.current !== targetJobId) return
    setGenerationJobId(nextStep === 'GENERATE' ? targetJobId : null)
    setPendingReevaluationJobId(null)
    setStep(nextStep)
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
    setStep('JOB_FOLLOW_UP')
  })

  const submitJobFollowUps = () => run(async () => {
    if (!jobId) throw new Error('岗位尚未完成评分。')
    const targetJobId = jobId
    const result = await submitJobFollowUpsForWorkflow({ api, jobId: targetJobId, questions, answers })
    const next = await refreshState()
    if (activeJobIdRef.current !== targetJobId) return
    if (result.nextStep === 'CONFIRM_FACTS') {
      confirmedFactIdsAtConfirmEntryRef.current = new Set(
        next.factLibrary.filter(fact => fact.status === 'confirmed').map(fact => fact.id),
      )
      setConfirmationNextStep('GENERATE')
      setPendingReevaluationJobId(targetJobId)
      setGenerationJobId(null)
    } else {
      setPendingReevaluationJobId(null)
      setGenerationJobId(targetJobId)
    }
    setStep(result.nextStep)
  })

  const updateFact = (factId: string, status: FactStatus) => run(async () => {
    unwrap(await api.setFactStatus(factId, status))
    await refreshState()
  })

  const confirmAllFacts = () => run(async () => {
    if (unconfirmedFacts.length === 0) return
    const updates = unconfirmedFacts.map(fact => ({ factId: fact.id, status: 'confirmed' as FactStatus }))
    unwrap(await api.setFactStatusBatch(updates))
    await refreshState()
  })

  const addManualFact = () => run(async () => {
    if (!manualFactContent.trim()) throw new Error('请输入事实内容。')
    await api.addManualFact({ content: manualFactContent.trim(), category: manualFactCategory })
    setManualFactContent('')
    await refreshState()
  })

  const loadFollowUps = () => run(async () => {
    const targetJobId = activeJobIdRef.current ?? jobId
    if (!targetJobId) throw new Error('岗位未选择。')
    const nextQuestions = unwrap(await api.buildFollowUps(targetJobId))
    if (activeJobIdRef.current !== targetJobId) return
    setQuestions(nextQuestions)
    setAnswers({})
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

  const fileSelected = (file: File | undefined) => {
    if (!file) return
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = String(reader.result ?? '')
        const [, base64 = ''] = dataUrl.split(',', 2)
        setResumeImage({ base64, mimeType: file.type })
      }
      reader.readAsDataURL(file)
      return
    }
    file.text().then(text => setResumeText(text)).catch(reason => setError(formatError(reason)))
  }

  const stepIndex = STEPS.findIndex(item => item.id === step)

  if (!propJobId) {
    return (
      <section className="workflow-page" aria-label="前端流程编排">
        <h1>申请材料流程</h1>
        <p style={{ padding: '40px 0', color: 'var(--color-text-2)' }}>请先从岗位列表选择一个岗位，然后点击"定制简历"进入此流程。</p>
      </section>
    )
  }

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
          <textarea value={resumeText} onChange={event => setResumeText(event.target.value)} placeholder="粘贴简历文本" rows={12} />
          <input type="file" accept=".txt,.md,.pdf,image/*" onChange={event => fileSelected(event.target.files?.[0])} />
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

      {step === 'SCORING' && (
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

      {step === 'JOB_FOLLOW_UP' && (
        <div className="workflow-panel">
          <h2>岗位追问</h2>
          <p>针对该岗位评分时缺证据的点，模型再问你几个问题。回答后会重新评分。</p>
          {questions.length === 0 && <p>没有需要补充的问题。</p>}
          {questions.map(question => (
            <label key={question.id} className="workflow-question">
              <span>{question.question}</span>
              <small>{question.rationale}</small>
              <textarea value={answers[question.id] ?? ''} onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))} rows={3} placeholder="如实填写；不确定可以留空" />
            </label>
          ))}
          <button onClick={submitJobFollowUps} disabled={loading}>下一步</button>
        </div>
      )}

      {step === 'CONFIRM_FACTS' && (
        <div className="workflow-panel">
          <h2>确认事实</h2>
          <p>以下事实来自简历或追问，逐条确认后再去岗位评分——只有已确认的事实才参与匹配。</p>
          {unconfirmedFacts.length > 0 && (
            <button onClick={confirmAllFacts} disabled={loading} style={{ marginBottom: 8 }}>全部确认</button>
          )}
          {unconfirmedFacts.length === 0 && (
            <p>{confirmationNextStep === 'SCORING' ? '没有待确认事实，可以进入岗位评分。' : '待确认事实已处理，可以重评并进入生成步骤。'}</p>
          )}
          {unconfirmedFacts.map(fact => (
            <div key={fact.id} className="workflow-fact">
              <span><strong>{fact.label}</strong>：{fact.value}</span>
              <span className="workflow-fact-actions">
                <button onClick={() => updateFact(fact.id, 'confirmed')} disabled={loading}>确认</button>
                <button onClick={() => updateFact(fact.id, 'rejected')} disabled={loading}>否掉</button>
              </span>
            </div>
          ))}
          <div className="workflow-add-fact" style={{ marginTop: 16, borderTop: '1px solid var(--color-border, #eee)', paddingTop: 12 }}>
            <strong>手动添加事实</strong>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <input
                value={manualFactContent}
                onChange={event => setManualFactContent(event.target.value)}
                placeholder="事实内容"
                style={{ flex: 1, minWidth: 160 }}
              />
              <select value={manualFactCategory} onChange={event => setManualFactCategory(event.target.value)}>
                <option value="skill">技能</option>
                <option value="work">工作经历</option>
                <option value="education">教育</option>
                <option value="achievement">成就</option>
                <option value="certification">证书</option>
              </select>
              <button onClick={addManualFact} disabled={loading || !manualFactContent.trim()}>添加</button>
            </div>
          </div>
          <button onClick={continueAfterFactConfirmation} disabled={loading || unconfirmedFacts.length > 0} style={{ marginTop: 12 }}>
            {confirmationNextStep === 'SCORING' ? '下一步：岗位评分' : '下一步：重评并生成'}
          </button>
        </div>
      )}

      {step === 'GENERATE' && (
        <div className="workflow-panel">
          <h2>生成材料</h2>
          {OUTPUT_GATE_RELEASED ? (
            <>
              <p>确认事实后生成定制简历。</p>
              <button onClick={generateMaterial} disabled={loading || unconfirmedFacts.length > 0}>生成</button>
            </>
          ) : (
            <>
              <p role="note" className="workflow-gate-locked">生成功能待开启（形式规范过审后激活）</p>
              <button onClick={() => setStep('EXPORT')} disabled={loading}>下一步</button>
            </>
          )}
        </div>
      )}

      {step === 'EXPORT' && (
        <div className="workflow-panel">
          <h2>导出</h2>
          {OUTPUT_GATE_RELEASED ? (
            <>
              {material?.status === 'blocked' && <p>材料生成被阻止。</p>}
              {material && <pre className="workflow-material">{[material.greeting, ...material.resumeLines.map((line) => line.text)].filter(Boolean).join('\n')}</pre>}
              <button onClick={exportMaterial} disabled={!material || material.status === 'blocked'}>导出文本</button>
            </>
          ) : (
            <p role="note" className="workflow-gate-locked">导出功能待开启（形式规范过审后激活）</p>
          )}
        </div>
      )}
    </section>
  )
}
