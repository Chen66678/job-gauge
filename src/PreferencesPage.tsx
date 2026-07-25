import { useEffect, useState } from 'react'
import type { CoreState } from './domain/coreState'
import type { CoreApiResult, WorkflowApi } from './WorkflowPage'
import './OnboardingPage.css'

function unwrap<T>(result: CoreApiResult<T>): T { if (result && typeof result === 'object' && 'error' in result) throw new Error(result.error); return result as T }
function message(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }

export default function PreferencesPage() {
  const api = window.coreApi as unknown as WorkflowApi
  const [state, setState] = useState<CoreState | null>(null)
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'editing' | 'saving' | 'success' | 'failure'>('editing')
  const [error, setError] = useState('')
  const refresh = async () => setState(await api.getState() as CoreState)
  useEffect(() => { void refresh().catch(reason => { setError(message(reason)); setStatus('failure') }) }, [])
  const save = async () => { setStatus('saving'); setError(''); try { unwrap(await api.setPreferencesFromText({ acceptText: text, vetoText: text })); await refresh(); setStatus('success') } catch (reason) { setError(message(reason)); setStatus('failure') } }
  const rules = state?.preferences?.ruleSet
  const vetoes = state?.preferences?.hardVeto.rules ?? []
  return <div className="preferences-page"><div className="preferences-shell"><header className="page-title"><h1>偏好设置</h1><p>保存后作用于所有后续评估。</p></header><div className="info-banner">用自然语言描述求职偏好，系统自动解析为<b>目标城市、最低薪资、排除关键词</b>筛选规则。保存后作用于所有后续评估。</div>
    {status === 'success' ? <><div className="success-copy">✓ 偏好已保存，硬否决规则已更新</div><PreferenceGroups rules={rules} /><button className="primary-button" onClick={() => setStatus('editing')}>重新修改</button></> : <><textarea className="wizard-textarea preferences-input" placeholder="例：想做前端/全栈，北京或上海，底薪不低于 15K，最好是 To B 产品，不要外包、驻场、大小周……" value={text} onChange={event => setText(event.target.value)} />{status === 'saving' && <p className="inline-loading"><span className="spinner" />正在解析并保存偏好…</p>}{status === 'failure' && <div className="error-banner">保存失败：模型服务无响应，请重试{error ? `（${error}）` : ''}</div>}<button className="primary-button" disabled={status === 'saving'} onClick={() => void save()}>{status === 'saving' ? '保存中…' : status === 'failure' ? '重试' : '保存偏好'}</button></>}
    <section className="veto-empty"><h2>{vetoes.length ? '硬否决规则' : '暂无硬否决规则'}</h2><p>{vetoes.length ? vetoes.map(rule => rule.label).join('、') : '在上方偏好描述中填入排除关键词（如“不要外包、驻场”），系统会自动解析为硬否决规则。'}</p></section></div></div>
}
function PreferenceGroups({ rules }: { rules: CoreState['preferences'] extends { ruleSet: infer R } | null ? R | undefined : undefined }) { const value = rules as { targetRoles?: string[]; targetCities?: string[]; minSalaryK?: number | null; excludedKeywords?: string[] } | undefined; const groups = [['🎯 目标方向', value?.targetRoles ?? [], 'role'], ['🏙 目标城市', value?.targetCities?.length ? value.targetCities : ['不限城市'], 'city'], ['💰 最低薪资', value?.minSalaryK ? [`${value.minSalaryK}K`] : ['不限薪资'], 'salary'], ['❌ 排除项（命中即否决）', value?.excludedKeywords ?? [], 'exclude']] as const; return <div className="preference-groups">{groups.map(([label, items, type]) => <div className="pref-group" key={label}><b>{label}</b><div>{items.length ? items.map(item => <span key={item} className={`pref-chip ${type}`}>{item}</span>) : <span className="empty-chip">未设置</span>}</div></div>)}</div> }
