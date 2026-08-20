import { useEffect, useState } from 'react'
import type { FactStatus, ProfileFact } from './types'
import { unwrap, errorText as formatError } from './coreApiResult'
import { displayFactCategory, displayFactLabel } from './factPresentation'
import './SettingsPage.css'

const FACT_STATUS_LABEL: Record<FactStatus, string> = {
  confirmed: '已确认',
  rejected: '已排除',
  unconfirmed: '待确认'
}

// 唯一清除入口（首席裁定五）：只此一处，文案「清除本地 API Key」。
export default function SettingsPage({ onOpenPreferences, onOpenOnboarding }: { onOpenPreferences: () => void; onOpenOnboarding: () => void }) {
  const api = window.coreApi
  const [clearing, setClearing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [localApiToken, setLocalApiToken] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle')
  const [facts, setFacts] = useState<ProfileFact[]>([])
  const [factError, setFactError] = useState<string | null>(null)
  const [editingFactId, setEditingFactId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [clearConfirming, setClearConfirming] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [autoReevaluateCount, setAutoReevaluateCount] = useState(30)
  const [reevaluationPreview, setReevaluationPreview] = useState<{ jobCount: number; modelCallCount: number } | null>(null)

  const [factGroups, setFactGroups] = useState<{ id: string; category: string; label: string }[]>([])

  const refreshFacts = () => api.getState().then(state => {
    setFacts(state.factLibrary ?? [])
    setFactGroups(state.factGroups ?? [])
    setAutoReevaluateCount(state.preferences?.autoReevaluateRecentCount ?? 30)
  })

  useEffect(() => {
    void api.getLocalApiToken().then(result => setLocalApiToken(result.token))
    void refreshFacts()
  }, [])

  const deleteFact = async (factId: string) => {
    setFactError(null)
    try {
      unwrap(await api.deleteFact(factId))
      await refreshFacts()
    } catch (reason) {
      setFactError(formatError(reason))
    }
  }

  const saveEdit = async (fact: ProfileFact) => {
    const content = editingValue.trim()
    if (!content) return
    setFactError(null)
    try {
      unwrap(await api.deleteFact(fact.id))
      unwrap(await api.addManualFact({ content, category: fact.category }))
      await refreshFacts()
      setEditingFactId(null)
      setEditingValue('')
    } catch (reason) {
      setFactError(formatError(reason))
    }
  }

  const clearAllFacts = async () => {
    setFactError(null)
    try {
      unwrap(await api.clearFactLibrary())
      await refreshFacts()
      setClearConfirming(false)
    } catch (reason) {
      setFactError(formatError(reason))
    }
  }

  const clearKey = async () => {
    setClearing(true); setMessage(null)
    try {
      const result = await api.clearByokKey()
      setMessage(result.ok ? '已清除本地 API Key。' : result.message)
    } finally {
      setClearing(false)
    }
  }

  const copyToken = async () => {
    if (!localApiToken) return
    await navigator.clipboard.writeText(localApiToken)
    setCopyStatus('copied')
    window.setTimeout(() => setCopyStatus('idle'), 1500)
  }

  const previewRecentReevaluation = async () => {
    try { setReevaluationPreview(unwrap(await api.getReevaluationPreview('recent'))) } catch (reason) { setFactError(formatError(reason)) }
  }

  const saveAutoReevaluateCount = async () => {
    const count = Math.max(0, Math.floor(autoReevaluateCount || 0))
    try {
      unwrap(await api.setAutoReevaluateRecentCount(count))
      setAutoReevaluateCount(count)
      await previewRecentReevaluation()
    } catch (reason) { setFactError(formatError(reason)) }
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <div>
          <p className="settings-eyebrow">工作台配置</p>
          <h1 className="settings-title">设置</h1>
          <p className="settings-subtitle">管理评估偏好、本地连接和事实数据。</p>
        </div>
      </header>

      <section className="settings-shortcuts" aria-label="常用设置">
        <button className="settings-shortcut" onClick={onOpenPreferences}>
          <span className="settings-shortcut-icon" aria-hidden="true">偏</span>
          <span><strong>偏好设置</strong><small>目标方向、城市、薪资与排除项</small></span>
          <span className="settings-shortcut-arrow" aria-hidden="true">›</span>
        </button>
        <button className="settings-shortcut" onClick={onOpenOnboarding}>
          <span className="settings-shortcut-icon" aria-hidden="true">引</span>
          <span><strong>安装引导</strong><small>重新查看插件安装与首次导入流程</small></span>
          <span className="settings-shortcut-arrow" aria-hidden="true">›</span>
        </button>
      </section>

      {message && <p className="settings-message" role="status">{message}</p>}

      <section className="settings-card">
        <div className="settings-card-header">
          <div><h2 className="settings-card-title">自动重评范围</h2><p className="settings-card-copy">控制资料变化后自动更新多少条最近岗位，置顶岗位始终会重评。</p></div>
          <span className="settings-card-kicker">评估</span>
        </div>
        <div className="settings-inline-control">
          <label htmlFor="auto-reevaluate-count">自动重评最近</label>
          <input id="auto-reevaluate-count" className="settings-input settings-number-input" aria-label="自动重评最近 N 条" type="number" min="0" value={autoReevaluateCount} onChange={event => setAutoReevaluateCount(Number(event.target.value))} />
          <span>条岗位</span>
          <div className="settings-button-row">
            <button className="primary-button" onClick={() => void saveAutoReevaluateCount()}>保存范围</button>
            <button className="btn-secondary" onClick={() => void previewRecentReevaluation()}>查看调用预估</button>
          </div>
        </div>
        {reevaluationPreview && <p className="settings-preview">下次自动重评会处理 {reevaluationPreview.jobCount} 条岗位，预计消耗 {reevaluationPreview.modelCallCount} 次模型调用。</p>}
      </section>

      <section className="settings-card">
        <div className="settings-card-header">
          <div><h2 className="settings-card-title">本地连接</h2><p className="settings-card-copy">浏览器插件通过本机 token 与工作台配对，信息不会发送到第三方服务器。</p></div>
          <span className="settings-card-kicker">插件</span>
        </div>
        <label className="settings-field-label" htmlFor="local-pairing-token">本地插件配对 token</label>
        <div className="settings-token-control">
          <input id="local-pairing-token" className="settings-input settings-token-input" readOnly type={showToken ? 'text' : 'password'} value={localApiToken ?? ''} />
          <button className="btn-secondary" disabled={!localApiToken} onClick={() => setShowToken(value => !value)}>{showToken ? '遮罩' : '显示'}</button>
          <button className="btn-secondary" disabled={!localApiToken} onClick={() => void copyToken()}>{copyStatus === 'copied' ? '已复制' : '复制'}</button>
        </div>
        <p className="settings-help-text">粘贴到浏览器插件设置页，即可授权岗位导入。</p>
        <div className="settings-danger-row">
          <div><strong>本地 API Key</strong><p>清除后，模型相关功能会暂停，重新配置后可恢复。</p></div>
          <button className="btn-danger-ghost" disabled={clearing} onClick={() => void clearKey()}>{clearing ? '清除中…' : '清除本地 API Key'}</button>
        </div>
      </section>

      <section className="settings-card settings-facts-card">
        <div className="settings-card-header settings-facts-header">
          <div><h2 className="settings-card-title">事实库</h2><p className="settings-card-copy">查看和维护评估时使用的个人经历与偏好事实。</p></div>
          <span className="settings-fact-count">{facts.length} 条</span>
        </div>
        {factError && <p className="settings-error">{factError}</p>}
        {facts.length === 0 && <p className="settings-empty">暂无事实，上传简历后会自动填充。</p>}
        {facts.length > 0 && <>
          {!clearConfirming
            ? <button className="btn-danger-ghost settings-clear-trigger" onClick={() => setClearConfirming(true)}>清空事实库</button>
            : <div className="settings-clear-warning">
                <p>清空后需重新上传简历建库，已确认的事实会全部消失。确定要清空全部 {facts.length} 条事实吗？</p>
                <div className="settings-button-row">
                  <button className="btn-danger-solid" onClick={() => void clearAllFacts()}>确认清空</button>
                  <button className="btn-secondary" onClick={() => setClearConfirming(false)}>取消</button>
                </div>
              </div>}
          <div className="settings-fact-list">
            {facts.map(fact => {
              const group = fact.groupId ? factGroups.find(candidate => candidate.id === fact.groupId) : null
              return (
                <div key={fact.id} className="settings-fact-row">
                  <div className="settings-fact-body">
                    {group && <div className="settings-fact-group">{group.label}</div>}
                    <span className="settings-fact-category">{displayFactCategory(fact.category)}</span>
                    <strong>{displayFactLabel(fact.label)}</strong>
                    <span className="settings-fact-status">{FACT_STATUS_LABEL[fact.status]}</span>
                    {editingFactId === fact.id
                      ? <div className="settings-edit-panel">
                          <textarea className="settings-edit-textarea" value={editingValue} onChange={event => setEditingValue(event.target.value)} rows={2} aria-label={`修改${fact.label}`} />
                          <div className="settings-button-row">
                            <button className="btn-secondary" onClick={() => void saveEdit(fact)}>保存</button>
                            <button className="btn-secondary" onClick={() => { setEditingFactId(null); setEditingValue('') }}>取消</button>
                          </div>
                        </div>
                      : <>
                          {fact.summary && <div className="settings-fact-summary">{fact.summary}</div>}
                          <div className="settings-fact-value">{fact.value}</div>
                        </>}
                  </div>
                  {editingFactId !== fact.id && <div className="settings-fact-actions">
                    <button className="btn-secondary" onClick={() => { setEditingFactId(fact.id); setEditingValue(fact.value) }}>编辑</button>
                    <button className="btn-danger-ghost" onClick={() => void deleteFact(fact.id)}>删除</button>
                  </div>}
                </div>
              )
            })}
          </div>
        </>}
      </section>
    </div>
  )
}
