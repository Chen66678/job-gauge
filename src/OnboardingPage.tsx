import { useEffect, useRef, useState } from 'react'
import type { CoreState } from './domain/coreState'
import { extractPdfResume, isPdfFile } from './domain/pdfResume'
import type { FactStatus, ProfileFact } from './types'
import type { CoreApiResult, WorkflowApi } from './WorkflowPage'
import './OnboardingPage.css'

type ResumeInput = { kind: 'text'; resumeText: string } | { kind: 'image'; imageBase64: string; mimeType: string }
type Step = 1 | 2 | 3 | 4 | 5 | 6
type KeyStatus = 'empty' | 'checking' | 'success' | 'failure'
type ParseStatus = 'idle' | 'parsing' | 'success' | 'failure'
type PreferenceStatus = 'idle' | 'saving' | 'success' | 'failure'
type PluginStatus = 'missing' | 'disabled' | 'unauthorized' | 'ready'

const ONBOARDING_COMPLETE_KEY = 'onboardingCompleted'
const STEPS = ['配 Key', '传简历', '确认事实', '设偏好', '检查插件', '导入岗位']

function unwrap<T>(result: CoreApiResult<T>): T {
  if (result && typeof result === 'object' && 'error' in result) throw new Error(result.error)
  return result as T
}

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason)
}

export default function OnboardingPage({ onFinished, onOpenJobs }: { onFinished: () => void; onOpenJobs: () => void }) {
  const api = window.coreApi as unknown as WorkflowApi
  const [step, setStep] = useState<Step>(1)
  const [state, setState] = useState<CoreState | null>(null)
  const [key, setKey] = useState('')
  const [keyStatus, setKeyStatus] = useState<KeyStatus>('empty')
  const [resumeText, setResumeText] = useState('')
  const [resumeInput, setResumeInput] = useState<ResumeInput | null>(null)
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const [parseStatus, setParseStatus] = useState<ParseStatus>('idle')
  const [parseCount, setParseCount] = useState(0)
  const [city, setCity] = useState('')
  const [salary, setSalary] = useState('')
  const [exclude, setExclude] = useState('')
  const [preferenceStatus, setPreferenceStatus] = useState<PreferenceStatus>('idle')
  const [pluginStatus, setPluginStatus] = useState<PluginStatus>('missing')
  const [jobStatus, setJobStatus] = useState<'waiting' | 'evaluating' | 'success' | 'failure'>('waiting')
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = async () => setState(await api.getState() as CoreState)
  useEffect(() => { void refresh().catch(reason => setError(errorText(reason))) }, [])
  useEffect(() => {
    if (keyStatus !== 'success') return
    const timer = window.setTimeout(() => setStep(2), 500)
    return () => window.clearTimeout(timer)
  }, [keyStatus])
  useEffect(() => {
    if (pluginStatus !== 'ready') return
    const timer = window.setTimeout(() => setStep(6), 500)
    return () => window.clearTimeout(timer)
  }, [pluginStatus])

  const stepClass = (index: number) => {
    if (index + 1 === step) return 'step-current'
    if (index + 1 > step) return 'step-todo'
    const skipped = (index === 2 && step > 3 && state?.factLibrary.some(fact => fact.status === 'unconfirmed')) || (index === 3 && step > 4 && preferenceStatus !== 'success')
    return skipped ? 'step-skip' : 'step-done'
  }

  const verifyKey = () => {
    if (!key.trim()) { setKeyStatus('failure'); return }
    setKeyStatus('checking')
    window.setTimeout(() => setKeyStatus(key.trim().toLowerCase() === 'invalid' ? 'failure' : 'success'), 900)
  }

  const fileSelected = async (file?: File) => {
    if (!file) return
    setError(null)
    try {
      if (isPdfFile(file)) {
        const extracted = await extractPdfResume(file)
        if (extracted.kind === 'text') setResumeInput({ kind: 'text', resumeText: extracted.resumeText })
        else setResumeInput({ kind: 'image', imageBase64: extracted.imageBase64, mimeType: extracted.mimeType })
      } else {
        setResumeInput({ kind: 'text', resumeText: await file.text() })
      }
      setSelectedFileName(file.name)
    } catch (reason) { setError(errorText(reason)) }
  }

  const parseResume = async () => {
    const input = resumeInput ?? (resumeText.trim() ? { kind: 'text' as const, resumeText: resumeText.trim() } : null)
    if (!input) { setParseStatus('failure'); return }
    setParseStatus('parsing'); setError(null)
    try {
      const facts = unwrap(await api.ingestResume(input))
      setParseCount(facts.length); setParseStatus('success'); await refresh()
    } catch (reason) { setError(errorText(reason)); setParseStatus('failure') }
  }

  const setFactStatus = async (factId: string, status: FactStatus) => {
    try { unwrap(await api.setFactStatus(factId, status)); await refresh() } catch (reason) { setError(errorText(reason)) }
  }

  const savePreferences = async () => {
    setPreferenceStatus('saving'); setError(null)
    try {
      unwrap(await api.setPreferencesFromText({
        acceptText: [city && `目标城市：${city}`, salary && `最低薪资：${salary}`].filter(Boolean).join('，'),
        vetoText: exclude,
      }))
      setPreferenceStatus('success'); await refresh()
    } catch (reason) { setError(errorText(reason)); setPreferenceStatus('failure') }
  }

  const simulateJob = () => {
    setJobStatus('evaluating')
    window.setTimeout(() => setJobStatus('success'), 900)
  }

  const finish = () => { localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true'); onFinished(); onOpenJobs() }
  const unconfirmed = (state?.factLibrary ?? []).filter(fact => fact.status === 'unconfirmed')
  const preferences = state?.preferences?.ruleSet

  return <div className="onboarding-page">
    <header className="onboarding-progress" aria-label="安装引导进度">
      {STEPS.map((label, index) => <div className={`progress-step ${stepClass(index)}`} key={label}>
        <span className="step-dot">{index + 1 < step ? (stepClass(index) === 'step-skip' ? '⚠' : '✓') : index + 1}</span><span className="step-name">{label}</span>
      </div>)}
    </header>
    <section className="wizard-stage"><div className="step-card">
      {error && <div className="error-banner">{step === 2 ? '解析失败：文件格式无法识别或内容为空，请重新上传' : `操作失败：${error}`}</div>}
      {step === 1 && <>
        <h1 className="step-card-title">配置模型 Key</h1><p className="step-card-desc">填入你自己的模型服务 Key，用于后续简历解析与岗位评估。Key 仅保存在本地。</p>
        {keyStatus === 'success' && <div className="status-row"><span>✓</span> Key 验证成功，即将进入下一步…</div>}
        {keyStatus === 'failure' && <div className="error-banner">验证失败：Key 无效或已过期，请检查后重新填写</div>}
        <input className="wizard-input" type="password" value={key} disabled={keyStatus === 'checking' || keyStatus === 'success'} placeholder="输入模型服务 Key" onChange={event => { setKey(event.target.value); setKeyStatus('empty') }} />
        {keyStatus === 'checking' && <p className="inline-loading"><span className="spinner" />正在验证 Key…</p>}
        <div className="step-card-footer"><button className="text-button" disabled={keyStatus === 'checking'} onClick={() => window.open('https://bailian.console.aliyun.com/', '_blank')}>去阿里云获取 Key ↗</button><button className="primary-button" disabled={keyStatus === 'checking'} onClick={verifyKey}>{keyStatus === 'checking' ? '验证中…' : keyStatus === 'failure' ? '重新填写' : '验证并继续'}</button></div>
      </>}
      {step === 2 && <>
        <h1 className="step-card-title">上传简历</h1><p className="step-card-desc">仅用于提取求职事实，解析结果不会在这里回显简历原文。</p>
        {parseStatus === 'success' ? <><div className="status-row">✓ 解析成功，提取到 {parseCount} 条事实</div><div className="step-card-footer step-card-footer-single"><button className="primary-button" onClick={() => setStep(3)}>下一步：确认事实 →</button></div></> : <>
          <button className="upload-drop" onClick={() => fileInputRef.current?.click()}><span className="upload-drop-icon">📄</span>拖拽 PDF、图片或 TXT 简历到此处<br />或点击选择文件</button>
          <input ref={fileInputRef} className="hidden-file-input" type="file" accept=".pdf,.txt,image/*" onChange={event => void fileSelected(event.target.files?.[0])} />
          {selectedFileName && <p className="status-row">✓ 已选择文件：{selectedFileName}</p>}
          <textarea className="wizard-textarea compact" placeholder="也可以粘贴简历文本" value={resumeText} onChange={event => { setResumeText(event.target.value); setResumeInput(null); setSelectedFileName(null) }} />
          {parseStatus === 'parsing' && <p className="inline-loading"><span className="spinner" />解析中，勿关窗</p>}
          <div className="step-card-footer step-card-footer-single"><button className="primary-button" disabled={parseStatus === 'parsing'} onClick={() => void parseResume()}>解析简历</button></div>
        </>}
      </>}
      {step === 3 && <>
        <h1 className="step-card-title">确认事实</h1><p className="step-card-desc">只确认简历解析出的信息，之后可在“我的资料”继续维护。</p>
        {unconfirmed.length ? <><div className="fact-list">{unconfirmed.map((fact: ProfileFact) => <div className="wizard-fact" key={fact.id}><div><b>{fact.label}</b><span>{fact.value}</span></div><div><button onClick={() => void setFactStatus(fact.id, 'confirmed')}>✓</button><button onClick={() => void setFactStatus(fact.id, 'rejected')}>✕</button></div></div>)}</div><button className="text-button centered" onClick={() => setStep(4)}>跳过，稍后在我的资料确认</button></> : <><div className="status-row">✓ 已确认 {(state?.factLibrary ?? []).filter(fact => fact.status === 'confirmed').length} 条</div><div className="step-card-footer step-card-footer-single"><button className="primary-button" onClick={() => setStep(4)}>继续下一步</button></div></>}
      </>}
      {step === 4 && <>
        <h1 className="step-card-title">设置偏好</h1><p className="step-card-desc">用自然语言偏好生成后续岗位评估的筛选规则。</p>
        {preferenceStatus === 'success' ? <><div className="preference-preview"><PreferenceChips preferences={preferences} /></div><div className="step-card-footer step-card-footer-single"><button className="primary-button" onClick={() => setStep(5)}>下一步：检查插件 →</button></div></> : <>
          <div className="pref-cols"><input className="wizard-input" placeholder="例：北京或上海" value={city} onChange={event => setCity(event.target.value)} /><input className="wizard-input" placeholder="例：底薪不低于 15K" value={salary} onChange={event => setSalary(event.target.value)} /></div>
          <input className="wizard-input" placeholder="例：不要外包、驻场、大小周" value={exclude} onChange={event => setExclude(event.target.value)} />
          <p className="default-hint">留空将使用默认值：不限城市、不限薪资、无排除项。</p>{preferenceStatus === 'saving' && <p className="inline-loading"><span className="spinner" />正在解析并保存偏好…</p>}
          <div className="step-card-footer"><button className="text-button" onClick={() => setStep(5)}>跳过，使用默认</button><button className="primary-button" disabled={preferenceStatus === 'saving'} onClick={() => void savePreferences()}>{preferenceStatus === 'saving' ? '解析中…' : preferenceStatus === 'failure' ? '重试' : '填写 → 解析并保存'}</button></div>
        </>}
      </>}
      {step === 5 && <PluginStep status={pluginStatus} onAdvance={() => setPluginStatus(current => current === 'missing' ? 'disabled' : current === 'disabled' ? 'unauthorized' : 'ready')} />}
      {step === 6 && <>
        <h1 className="step-card-title">导入第一个岗位</h1>{jobStatus === 'success' ? <><div className="graduation">🎉<h2>第一个岗位已评估完成！</h2><p>你已完成全部安装引导，现在可以在岗位列表中查看评估详情，并继续导入更多岗位。</p></div><div className="step-card-footer step-card-footer-single"><button className="primary-button" onClick={finish}>进入岗位列表</button></div></> : <><div className="job-flow"><span>🌐 在 BOSS 打开岗位</span><span>🧩 点击插件图标</span><span>⏳ 等待评估结果</span></div>{jobStatus === 'evaluating' && <p className="inline-loading"><span className="spinner" />评估中，约 30–90 秒</p>}{jobStatus === 'failure' && <div className="error-banner">岗位发送失败：模型服务无响应，请重试</div>}<div className="step-card-footer step-card-footer-single"><button className="primary-button" disabled={jobStatus === 'evaluating'} onClick={simulateJob}>{jobStatus === 'evaluating' ? '等待岗位数据…' : jobStatus === 'failure' ? '重试' : '模拟收到岗位数据'}</button></div></>}
      </>}
    </div></section>
  </div>
}

function PreferenceChips({ preferences }: { preferences: CoreState['preferences'] extends { ruleSet: infer R } | null ? R | undefined : undefined }) {
  const value = preferences as { targetRoles?: string[]; targetCities?: string[]; minSalaryK?: number | null; excludedKeywords?: string[] } | undefined
  const groups = [
    ['目标方向', value?.targetRoles ?? [], 'role'], ['目标城市', value?.targetCities?.length ? value.targetCities : ['不限城市'], 'city'], ['最低薪资', value?.minSalaryK ? [`${value.minSalaryK}K`] : ['不限薪资'], 'salary'], ['排除项', value?.excludedKeywords ?? [], 'exclude'],
  ] as const
  return <>{groups.map(([label, entries, kind]) => entries.length ? <div className="pref-group" key={label}><b>{label}</b><div>{entries.map(entry => <span className={`pref-chip ${kind}`} key={entry}>{entry}</span>)}</div></div> : null)}</>
}

function PluginStep({ status, onAdvance }: { status: PluginStatus; onAdvance: () => void }) {
  const content = status === 'missing' ? ['请先安装浏览器插件', '安装完成后将自动检测并继续', '安装插件'] : status === 'disabled' ? ['插件已安装，请启用', '插件当前处于停用状态，启用后将自动继续', '去启用'] : status === 'unauthorized' ? ['需要授权插件连接本地应用', '按示意图操作：先点插件图标，再点弹窗中的「授权连接」', '我已点击插件授权'] : ['✓ 插件已就绪', '即将进入最后一步：导入岗位', '']
  return <><h1 className="step-card-title">检查插件</h1><div className={`plugin-icon-box ${status === 'ready' ? 'done' : ''}`}>{status === 'unauthorized' ? '🧩 → ✓' : '🧩'}</div><h2 className="plugin-title">{content[0]}</h2><p className="step-card-desc centered">{content[1]}</p>{status !== 'ready' && <div className="step-card-footer step-card-footer-single"><button className="primary-button" onClick={onAdvance}>{content[2]}</button></div>}</>
}
