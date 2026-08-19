import { useEffect, useRef, useState } from 'react'
import type { CoreState } from './domain/coreState'
import type { PreferenceRuleSet } from './types'
import type { WorkflowApi } from './workflowApi'
import { unwrap, errorText as message } from './coreApiResult'
import './OnboardingPage.css'

type PreferenceCategory = 'role' | 'city' | 'salary' | 'exclude'
type EditablePreferences = Record<PreferenceCategory, string[]>

function toEditablePreferences(rules?: PreferenceRuleSet): EditablePreferences {
  return {
    role: rules?.targetRoles ?? [],
    city: rules?.targetCities ?? [],
    salary: rules?.minSalaryK ? [`${rules.minSalaryK}K`] : [],
    exclude: rules?.excludedKeywords ?? [],
  }
}

function toRuleSetFromEditable(editable: EditablePreferences, current: PreferenceRuleSet): PreferenceRuleSet {
  const salaryText = editable.salary[0] ?? ''
  const salaryNumber = Number.parseInt(salaryText.replace(/[^\d.]/g, ''), 10)
  return {
    targetRoles: editable.role,
    targetCities: editable.city,
    minSalaryK: Number.isFinite(salaryNumber) && salaryNumber > 0 ? salaryNumber : 0,
    excludedKeywords: editable.exclude,
    preferCompanyTags: current.preferCompanyTags,
    confidence: current.confidence,
  }
}

const SWITCH_TARGETS: Partial<Record<PreferenceCategory, PreferenceCategory>> = {
  role: 'city',
  city: 'exclude',
  exclude: 'role',
}

export default function PreferencesPage({ onBack }: { onBack?: () => void }) {
  const api = window.coreApi
  const [state, setState] = useState<CoreState | null>(null)
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'editing' | 'saving' | 'success' | 'failure'>('editing')
  const [error, setError] = useState('')
  const [editablePreferences, setEditablePreferences] = useState<EditablePreferences>(() => toEditablePreferences())
  // Once the user touches a chip (delete/switch) or a fresh save lands, no
  // later state hydration is allowed to overwrite editablePreferences again —
  // otherwise a stale in-flight getState() resolving after an edit silently
  // reverts the user's correction.
  const editsLocked = useRef(false)
  const refresh = async () => setState(await api.getState() as CoreState)
  useEffect(() => {
    void (async () => {
      try {
        const loaded = await api.getState() as CoreState
        setState(loaded)
        if (!editsLocked.current) setEditablePreferences(toEditablePreferences(loaded.preferences?.ruleSet))
      } catch (reason) {
        setError(message(reason))
        setStatus('failure')
      }
    })()
  }, [])
  const save = async () => {
    setStatus('saving'); setError('')
    try {
      const previewApi = api as Partial<Pick<WorkflowApi, 'getReevaluationPreview'>>
      if (previewApi.getReevaluationPreview) {
        const preview = unwrap(await previewApi.getReevaluationPreview('recent'))
        if (preview.jobCount > 0 && !window.confirm(`保存偏好后将自动重评 ${preview.jobCount} 条岗位，预计消耗 ${preview.modelCallCount} 次模型调用。继续吗？`)) {
          setStatus('editing')
          return
        }
      }
      const savedPreferences = unwrap(await api.setPreferencesFromText({ acceptText: text, vetoText: text })) as { ruleSet: PreferenceRuleSet }
      editsLocked.current = true
      setEditablePreferences(toEditablePreferences(savedPreferences.ruleSet))
      await refresh()
      setStatus('success')
    } catch (reason) { setError(message(reason)); setStatus('failure') }
  }
  const rules = state?.preferences?.ruleSet
  const vetoes = state?.preferences?.hardVeto.rules ?? []

  const persistEditablePreferences = async (next: EditablePreferences) => {
    const currentRules = state?.preferences?.ruleSet
    if (!currentRules) {
      setError('尚未保存过偏好设置，无法直接修改规则。')
      setStatus('failure')
      return
    }
    setError('')
    try {
      const savedRuleSet = unwrap(await api.setPreferenceRuleSet(toRuleSetFromEditable(next, currentRules)))
      editsLocked.current = true
      setEditablePreferences(toEditablePreferences(savedRuleSet))
      await refresh()
    } catch (reason) {
      setError(message(reason))
      setStatus('failure')
    }
  }

  const deletePreference = (category: PreferenceCategory, item: string) => {
    editsLocked.current = true
    const next: EditablePreferences = {
      ...editablePreferences,
      [category]: editablePreferences[category].filter(value => value !== item),
    }
    setEditablePreferences(next)
    void persistEditablePreferences(next)
  }

  const switchPreferenceCategory = (category: PreferenceCategory, item: string) => {
    const nextCategory = SWITCH_TARGETS[category]
    if (!nextCategory) return
    editsLocked.current = true
    const next: EditablePreferences = {
      ...editablePreferences,
      [category]: editablePreferences[category].filter(value => value !== item),
      [nextCategory]: [...editablePreferences[nextCategory], item],
    }
    setEditablePreferences(next)
    void persistEditablePreferences(next)
  }
  return <div className="preferences-page"><div className="preferences-shell"><header className="page-title"><button type="button" className="preferences-back" onClick={onBack}>← 返回设置</button><h1>偏好设置</h1><p>保存后作用于所有后续评估。</p></header><div className="info-banner">用自然语言描述求职偏好，系统自动解析为<b>目标城市、最低薪资、排除关键词</b>筛选规则。保存后作用于所有后续评估。</div>
    {status === 'success' ? <><div className="success-copy">✓ 偏好已保存，硬否决规则已更新</div><PreferenceGroups preferences={editablePreferences} confidence={rules?.confidence ?? 1.0} onDelete={deletePreference} onSwitchCategory={switchPreferenceCategory} /><button className="primary-button" onClick={() => setStatus('editing')}>重新修改</button></> : <><textarea className="wizard-textarea preferences-input" placeholder="例：想做前端/全栈，北京或上海，底薪不低于 15K，最好是 To B 产品，不要外包、驻场、大小周……" value={text} onChange={event => setText(event.target.value)} />{status === 'saving' && <p className="inline-loading"><span className="spinner" />正在解析并保存偏好…</p>}{status === 'failure' && <div className="error-banner">保存失败：模型服务无响应，请重试{error ? `（${error}）` : ''}</div>}<button className="primary-button" disabled={status === 'saving'} onClick={() => void save()}>{status === 'saving' ? '保存中…' : status === 'failure' ? '重试' : '保存偏好'}</button></>}
    <section className="veto-empty"><h2>{vetoes.length ? '硬否决规则' : '暂无硬否决规则'}</h2><p>{vetoes.length ? vetoes.map(rule => rule.label).join('、') : '在上方偏好描述中填入排除关键词（如“不要外包、驻场”），系统会自动解析为硬否决规则。'}</p></section></div></div>
}
function PreferenceGroups({ preferences, confidence, onDelete, onSwitchCategory }: { preferences: EditablePreferences; confidence: number; onDelete: (category: PreferenceCategory, item: string) => void; onSwitchCategory: (category: PreferenceCategory, item: string) => void }) {
  const groups = [{ label: '🎯 目标方向', items: preferences.role, type: 'role' }, { label: '🏙 目标城市', items: preferences.city, type: 'city' }, { label: '💰 最低薪资', items: preferences.salary, type: 'salary' }, { label: '❌ 排除项（命中即否决）', items: preferences.exclude, type: 'exclude' }] satisfies { label: string; items: string[]; type: PreferenceCategory }[]
  return (
    <div className="preference-groups">
      {groups.filter(group => group.items.length > 0).map(({ label, items, type }) => (
        <div className="pref-group" key={type}>
          <b>{label}</b>
          <div>
            {items.map(item => (
              <span key={item} className={`pref-chip ${type} ${confidence < 0.7 ? 'low-confidence' : ''}`}>
                {item}
                {confidence < 0.7 && <span className="pref-chip-confidence" title="该偏好置信度较低">？</span>}
                {type !== 'salary' && (
                  <button className="chip-switch" type="button" aria-label={`切换类别：${item}`} onClick={() => onSwitchCategory(type, item)}>切换类别</button>
                )}
                <button className="chip-del" type="button" aria-label={`删除：${item}`} onClick={() => onDelete(type, item)}>删除</button>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
