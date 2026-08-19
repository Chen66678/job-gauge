import { useEffect, useRef, useState } from 'react'
import type { JobRequirement } from './types'
import { errorText, unwrap } from './coreApiResult'
import {
  reevaluateForWorkflow,
  submitJobFollowUpsForWorkflow,
  type FollowUpQuestion,
} from './followUpActions'
import type { WorkflowApi } from './workflowApi'
import { readCachedResumeFollowUps, writeCachedResumeFollowUps } from './resumeFollowUpCache'

type CommonProps = {
  onClose: () => void
  onOpenProfile: () => void
  onSubmitted?: () => void
}

type FollowUpDrawerProps = CommonProps & (
  | { mode?: 'job'; jobId: string | null }
  | { mode: 'resume'; jobId?: never }
)

export default function FollowUpDrawer(props: FollowUpDrawerProps) {
  const { onClose, onOpenProfile, onSubmitted } = props
  const mode = props.mode ?? 'job'
  const jobId = mode === 'job' ? props.jobId : null
  const api = window.coreApi
  const [jobTitle, setJobTitle] = useState('岗位')
  const [requirements, setRequirements] = useState<JobRequirement[]>([])
  const [questions, setQuestions] = useState<FollowUpQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [followUpIndex, setFollowUpIndex] = useState(0)
  const [followUpSubmitting, setFollowUpSubmitting] = useState(false)
  const [followUpSubmitError, setFollowUpSubmitError] = useState<string | null>(null)
  const [followUpSuccess, setFollowUpSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const activeRequestRef = useRef<string | null>(mode === 'resume' ? 'resume' : jobId)

  useEffect(() => {
    const requestKey = mode === 'resume' ? 'resume' : jobId
    activeRequestRef.current = requestKey
    if (!requestKey) return

    const loadFollowUps = async () => {
      setLoading(true)
      setLoadError(null)
      setQuestions([])
      setAnswers({})
      setFollowUpIndex(0)
      setFollowUpSubmitError(null)
      setFollowUpSuccess(false)
      try {
        if (mode === 'resume') {
          const state = await api.getState()
          const facts = state.factLibrary ?? []
          let nextQuestions = readCachedResumeFollowUps(facts)
          if (!nextQuestions) {
            nextQuestions = unwrap(await api.buildResumeFollowUps())
            writeCachedResumeFollowUps(facts, nextQuestions)
          }
          if (activeRequestRef.current !== requestKey) return
          setJobTitle('简历')
          setRequirements([])
          setQuestions(nextQuestions)
        } else {
          const state = await api.getState()
          const record = state.jobs.find(item => item.job.id === jobId)
          const nextQuestions = unwrap(await api.buildFollowUps(requestKey))
          if (activeRequestRef.current !== requestKey) return
          setJobTitle(record?.job.title ?? '岗位')
          setRequirements(record?.job.requirements ?? [])
          setQuestions(nextQuestions)
        }
      } catch (reason) {
        if (activeRequestRef.current === requestKey) setLoadError(errorText(reason))
      } finally {
        if (activeRequestRef.current === requestKey) setLoading(false)
      }
    }

    void loadFollowUps()
  }, [api, jobId, mode])

  if (mode === 'job' && !jobId) return null

  const submitFollowUps = async () => {
    const requestKey = activeRequestRef.current
    if (!requestKey) return
    setFollowUpSubmitting(true)
    setFollowUpSubmitError(null)
    try {
      if (mode === 'resume') {
        const answerList = questions
          .map(question => ({ questionId: question.id, answerText: answers[question.id]?.trim() ?? '' }))
          .filter(answer => answer.answerText)
        unwrap(await api.applyResumeFollowUpAnswers(questions, answerList))
      } else if (jobId) {
        const result = await submitJobFollowUpsForWorkflow({ api, jobId, questions, answers })
        if (result.hadNewFacts && activeRequestRef.current === requestKey) {
          await reevaluateForWorkflow(api, jobId)
        }
      }
      await api.getState()
      if (activeRequestRef.current === requestKey) {
        setFollowUpSuccess(true)
        onSubmitted?.()
      }
    } catch (reason) {
      if (activeRequestRef.current === requestKey) setFollowUpSubmitError(errorText(reason))
    } finally {
      if (activeRequestRef.current === requestKey) setFollowUpSubmitting(false)
    }
  }

  return (
    <FollowUpDrawerView
      mode={mode}
      jobTitle={jobTitle}
      requirements={requirements}
      questions={questions}
      answers={answers}
      index={followUpIndex}
      loading={loading}
      loadError={loadError}
      submitting={followUpSubmitting}
      submitError={followUpSubmitError}
      success={followUpSuccess}
      onAnswer={(questionId, answerText) => setAnswers(current => ({ ...current, [questionId]: answerText }))}
      onPrevious={() => setFollowUpIndex(index => Math.max(0, index - 1))}
      onNext={() => setFollowUpIndex(index => Math.min(questions.length - 1, index + 1))}
      onSkip={() => setFollowUpIndex(index => index < questions.length - 1 ? index + 1 : index)}
      onSubmit={() => void submitFollowUps()}
      onClose={onClose}
      onOpenProfile={onOpenProfile}
    />
  )
}

function FollowUpDrawerView({
  mode, jobTitle, requirements, questions, answers, index, loading, loadError, submitting, submitError, success, onAnswer, onPrevious, onNext, onSkip, onSubmit, onClose, onOpenProfile,
}: {
  mode: 'job' | 'resume'
  jobTitle: string
  requirements: JobRequirement[]
  questions: FollowUpQuestion[]
  answers: Record<string, string>
  index: number
  loading: boolean
  loadError: string | null
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
  const requirementLabel = mode === 'resume'
    ? '完善简历事实'
    : requirements.find(item => item.id === question?.requirementId)?.label ?? '整体经历匹配度'
  const drawerTitle = mode === 'resume' ? '简历补充' : `${jobTitle} · 补充信息`
  const loadingText = mode === 'resume' ? '正在加载简历补充问题' : '正在加载岗位补充问题'

  return <><div className="followup-drawer-scrim" /><aside className="followup-drawer" aria-label={drawerTitle}>
    <header className="followup-drawer-header"><h2>{drawerTitle}</h2><button className="followup-drawer-close" onClick={onClose}>✕ 关闭</button></header>
    {!success && !loading && !loadError && <div className="followup-question-bar"><span>第 {questions.length ? index + 1 : 0}/{questions.length} 题</span><span className="followup-dots">{questions.map((item, itemIndex) => <i className={itemIndex === index ? 'active' : ''} key={item.id} />)}</span></div>}
    {loading ? <div className="followup-state"><span className="spinner" /><p>{loadingText}</p></div> : loadError ? <div className="followup-state"><h3>加载失败</h3><p>{loadError}</p><button className="primary-button" onClick={onClose}>关闭</button></div> : submitting ? <div className="followup-state"><span className="spinner" /><p>提交中，约 10–30 秒</p></div> : success ? <div className="followup-state"><span className="success-icon" aria-hidden="true">✓</span><h3>提交成功</h3><p>已收到 {answeredCount} 条回答，系统正在提炼事实</p><div><button className="primary-button" onClick={onOpenProfile}>去我的资料 →</button><button className="text-button" onClick={onClose}>关闭</button></div></div> : question ? <><div className="followup-drawer-content">{submitError && <div className="followup-error">提交失败，请重试</div>}<article className="followup-card"><div className="followup-card-top"><span className="followup-kind-badge">{question.kind === 'explore' ? '探索' : '深挖'}</span><span className="followup-requirement">{mode === 'resume' ? requirementLabel : `针对要求：${requirementLabel}`}</span></div><p className="followup-question-text">{question.question}</p><button className="followup-why" onClick={() => setWhyOpen(value => !value)}>为什么问这个 {whyOpen ? '▾' : '▸'}</button>{whyOpen && <p className="followup-rationale">{question.rationale}</p>}<textarea className="followup-answer" value={answers[question.id] ?? ''} onChange={event => onAnswer(question.id, event.target.value)} placeholder="如实填写；不确定可以留空" aria-label="补充回答" /></article></div><footer className="followup-drawer-footer"><button className="text-button" disabled={index === 0} onClick={onPrevious}>← 上一题</button><div className="followup-footer-actions"><button className="followup-link" onClick={onSkip}>跳过本题</button><button className={submitError ? 'btn-danger' : 'primary-button'} onClick={isLast ? onSubmit : onNext}>{submitError ? '重试' : isLast ? '提交全部' : '下一题 →'}</button></div></footer></> : <div className="followup-state"><h3>没有需要补充的问题</h3><button className="primary-button" onClick={onClose}>关闭</button></div>}
  </aside></>
}
