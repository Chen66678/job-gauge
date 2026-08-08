import { useEffect, useRef, useState } from 'react'
import type { CoreState } from './domain/coreState'
import { extractPdfResume, isPdfFile } from './domain/pdfResume'
import type { WorkflowApi } from './workflowApi'
import { unwrap, errorText } from './coreApiResult'
import './OnboardingPage.css'

type ResumeInput = { kind: 'text'; resumeText: string }
type Step = 1 | 2 | 3 | 4 | 5
type KeyStatus = 'empty' | 'checking' | 'success' | 'failure'
type ParseStatus = 'idle' | 'parsing' | 'success' | 'failure'
type PreferenceStatus = 'idle' | 'saving' | 'success' | 'failure'

const ONBOARDING_COMPLETE_KEY = 'onboardingCompleted'
const STEPS = ['配 Key', '传简历', '设偏好', '装插件', '导入岗位']

export default function OnboardingPage({ onFinished, onOpenJobs }: { onFinished: () => void; onOpenJobs: () => void }) {
  const api = window.coreApi as unknown as WorkflowApi
  const [step, setStep] = useState<Step>(1)
  const [state, setState] = useState<CoreState | null>(null)
  const [key, setKey] = useState('')
  const [keyStatus, setKeyStatus] = useState<KeyStatus>('empty')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [resumeInput, setResumeInput] = useState<ResumeInput | null>(null)
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const [parseStatus, setParseStatus] = useState<ParseStatus>('idle')
  const [parseElapsedSeconds, setParseElapsedSeconds] = useState(0)
  const [parseCount, setParseCount] = useState(0)
  const [city, setCity] = useState('')
  const [salary, setSalary] = useState('')
  const [exclude, setExclude] = useState('')
  const [preferenceStatus, setPreferenceStatus] = useState<PreferenceStatus>('idle')
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
    if (step !== 5) return
    const baselineJobCount = state?.jobs.length ?? 0
    setJobStatus('waiting')
    const unsubscribe = api.onStateChanged(nextState => {
      setState(nextState as CoreState)
      if (nextState.jobs.length > baselineJobCount) setJobStatus('success')
    })
    return unsubscribe
  }, [step])
  useEffect(() => {
    if (parseStatus !== 'parsing') return
    setParseElapsedSeconds(0)
    const timer = window.setInterval(() => setParseElapsedSeconds(seconds => seconds + 1), 1000)
    return () => window.clearInterval(timer)
  }, [parseStatus])

  const stepClass = (index: number) => {
    if (index + 1 === step) return 'step-current'
    if (index + 1 > step) return 'step-todo'
    const skipped = index === 2 && step > 3 && preferenceStatus !== 'success'
    return skipped ? 'step-skip' : 'step-done'
  }

  const verifyKey = async () => {
    if (!key.trim()) { setKeyStatus('failure'); setKeyError('请输入 API Key。'); return }
    setKeyStatus('checking'); setKeyError(null)
    const result = await api.saveAndVerifyByokKey({ apiKey: key })
    if (result.ok) {
      setKeyStatus('success')
    } else {
      setKeyStatus('failure')
      setKeyError(result.message)
    }
  }

  const fileSelected = async (file?: File) => {
    if (!file) return
    setError(null)
    try {
      if (isPdfFile(file)) {
        setResumeInput({ kind: 'text', resumeText: await extractPdfResume(file) })
      } else {
        setResumeInput({ kind: 'text', resumeText: await file.text() })
      }
      setSelectedFileName(file.name)
    } catch (reason) { setError(errorText(reason)) }
  }

  const parseResume = async () => {
    if (!resumeInput) { setError('请先选择要上传的简历文件。'); setParseStatus('failure'); return }
    setParseStatus('parsing'); setError(null)
    try {
      const facts = unwrap(await api.ingestResume(resumeInput))
      setParseCount(facts.length); setParseStatus('success'); await refresh()
    } catch (reason) { setError(errorText(reason)); setParseStatus('failure') }
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

  const finish = () => { localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true'); onFinished(); onOpenJobs() }
  const preferences = state?.preferences?.ruleSet

  return <div className="onboarding-page">
    <header className="onboarding-progress" aria-label="安装引导进度">
      {STEPS.map((label, index) => <div className={`progress-step ${stepClass(index)}`} key={label}>
        <span className="step-dot">{index + 1 < step ? (stepClass(index) === 'step-skip' ? '⚠' : '✓') : index + 1}</span><span className="step-name">{label}</span>
      </div>)}
    </header>
    <section className="wizard-stage"><div className="step-card">
      {error && <div className="error-banner">操作失败：{error}</div>}
      {step === 1 && <>
        <h1 className="step-card-title">配置模型 Key</h1><p className="step-card-desc">填入你自己的模型服务 Key，用于后续简历解析与岗位评估。Key 仅保存在本地。</p>
        {keyStatus === 'success' && <div className="status-row"><span>✓</span> Key 验证成功，即将进入下一步…</div>}
        {keyStatus === 'failure' && <div className="error-banner">{keyError ?? '验证失败：Key 无效或已过期，请检查后重新填写'}</div>}
        <input className="wizard-input" type="password" value={key} disabled={keyStatus === 'checking' || keyStatus === 'success'} placeholder="输入模型服务 Key" onChange={event => { setKey(event.target.value); setKeyStatus('empty'); setKeyError(null) }} />
        {keyStatus === 'checking' && <p className="inline-loading"><span className="spinner" />正在验证 Key…</p>}
        <div className="step-card-footer"><button className="text-button" disabled={keyStatus === 'checking'} onClick={() => window.open('https://bailian.console.aliyun.com/', '_blank')}>去阿里云获取 Key ↗</button><button className="primary-button" disabled={keyStatus === 'checking'} onClick={() => void verifyKey()}>{keyStatus === 'checking' ? '验证中…' : keyStatus === 'failure' ? '重新填写' : '验证并继续'}</button></div>
      </>}
      {step === 2 && <>
        <h1 className="step-card-title">上传简历</h1><p className="step-card-desc">仅用于提取求职事实，解析结果不会在这里回显简历原文。</p>
        {parseStatus === 'success' ? <><div className="status-row">✓ 解析成功，提取到 {parseCount} 条事实</div><div className="step-card-footer step-card-footer-single"><button className="primary-button" onClick={() => setStep(3)}>下一步：设置偏好 →</button></div></> : <>
          <button className="upload-drop" onClick={() => fileInputRef.current?.click()}><span className="upload-drop-icon">📄</span>拖拽 PDF 或 TXT 简历到此处<br />或点击选择文件</button>
          <input ref={fileInputRef} className="hidden-file-input" type="file" accept=".pdf,.txt" onChange={event => void fileSelected(event.target.files?.[0])} />
          {selectedFileName && <p className="status-row">✓ 已选择文件：{selectedFileName}</p>}
          {parseStatus === 'parsing' && <p className="inline-loading"><span className="spinner" />解析中，勿关窗（已等待 {parseElapsedSeconds} 秒）<span>模型响应较慢，可能需要几分钟</span></p>}
          <div className="step-card-footer step-card-footer-single"><button className="primary-button" disabled={parseStatus === 'parsing'} onClick={() => void parseResume()}>解析简历</button></div>
        </>}
      </>}
      {step === 3 && <>
        <h1 className="step-card-title">设置偏好</h1><p className="step-card-desc">用自然语言偏好生成后续岗位评估的筛选规则。</p>
        {preferenceStatus === 'success' ? <><div className="preference-preview"><PreferenceChips preferences={preferences} /></div><div className="step-card-footer step-card-footer-single"><button className="primary-button" onClick={() => setStep(4)}>下一步：安装插件 →</button></div></> : <>
          <div className="pref-cols"><input className="wizard-input" placeholder="例：北京或上海" value={city} onChange={event => setCity(event.target.value)} /><input className="wizard-input" placeholder="例：底薪不低于 15K" value={salary} onChange={event => setSalary(event.target.value)} /></div>
          <input className="wizard-input" placeholder="例：不要外包、驻场、大小周" value={exclude} onChange={event => setExclude(event.target.value)} />
          <p className="default-hint">留空将使用默认值：不限城市、不限薪资、无排除项。</p>{preferenceStatus === 'saving' && <p className="inline-loading"><span className="spinner" />正在解析并保存偏好…</p>}
          <div className="step-card-footer"><button className="text-button" onClick={() => setStep(4)}>跳过，使用默认</button><button className="primary-button" disabled={preferenceStatus === 'saving'} onClick={() => void savePreferences()}>{preferenceStatus === 'saving' ? '解析中…' : preferenceStatus === 'failure' ? '重试' : '填写 → 解析并保存'}</button></div>
        </>}
      </>}
      {step === 4 && <PluginStep onAdvance={() => setStep(5)} />}
      {step === 5 && <>
        <h1 className="step-card-title">导入第一个岗位</h1>{jobStatus === 'success' ? <><div className="graduation">🎉<h2>第一个岗位已评估完成！</h2><p>你已完成全部安装引导，现在可以在岗位列表中查看评估详情，并继续导入更多岗位。</p></div><div className="step-card-footer step-card-footer-single"><button className="primary-button" onClick={finish}>进入岗位列表</button></div></> : <><div className="job-flow"><span>🌐 在 BOSS 打开岗位</span><span>🧩 点击插件图标</span><span>⏳ 等待评估结果</span></div><p className="inline-loading"><span className="spinner" />等待插件发送岗位数据…</p></>}
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

function PluginStep({ onAdvance }: { onAdvance: () => void }) {
  return <>
    <h1 className="step-card-title">安装浏览器插件</h1>
    <p className="step-card-desc">导入岗位需要浏览器插件把当前岗位信息发送到本地应用。</p>
    <div className="plugin-icon-box">🧩</div>
    <ol className="plugin-setup-list">
      <li><b>安装插件</b><span>当前请在浏览器扩展管理页打开开发者模式并加载插件；后续会在这里提供商店链接。</span></li>
      <li><b>打开插件</b><span>安装完成后，点击浏览器右上角工具栏中的插件图标。</span></li>
      <li><b>复制 token</b><span>回到应用的「设置」，从只读 token 框复制 token。</span></li>
      <li><b>粘贴连接</b><span>把 token 粘贴到插件中，按插件内提示完成连接。</span></li>
    </ol>
    <div className="step-card-footer step-card-footer-single"><button className="primary-button" onClick={onAdvance}>下一步：导入岗位 →</button></div>
  </>
}
