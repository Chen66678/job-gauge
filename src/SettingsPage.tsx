import { useEffect, useState } from 'react'
import type { WorkflowApi } from './workflowApi'
import type { FactStatus, ProfileFact } from './types'
import { unwrap, errorText as formatError } from './coreApiResult'

const FACT_STATUS_LABEL: Record<FactStatus, string> = {
  confirmed: '已确认',
  rejected: '已排除',
  unconfirmed: '待确认'
}

// 唯一清除入口（首席裁定五）：只此一处，文案「清除本地 API Key」。
export default function SettingsPage({ onOpenPreferences, onOpenOnboarding }: { onOpenPreferences: () => void; onOpenOnboarding: () => void }) {
  const api = window.coreApi as unknown as WorkflowApi
  const [clearing, setClearing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [localApiToken, setLocalApiToken] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle')
  const [facts, setFacts] = useState<ProfileFact[]>([])
  const [factError, setFactError] = useState<string | null>(null)
  const [editingFactId, setEditingFactId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [clearConfirming, setClearConfirming] = useState(false)
  const [autoReevaluateCount, setAutoReevaluateCount] = useState(30)
  const [reevaluationPreview, setReevaluationPreview] = useState<{ jobCount: number; modelCallCount: number } | null>(null)

  const refreshFacts = () => api.getState().then(state => {
    setFacts(state.factLibrary ?? [])
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

  return <div style={{ padding: 40, color: 'var(--text-secondary)' }}>
    <h1 style={{ marginBottom: 16 }}>设置</h1>
    <p style={{ marginBottom: 20 }}>管理求职偏好和安装引导。</p>
    <button onClick={onOpenPreferences}>偏好设置</button>
    <button style={{ marginLeft: 12 }} onClick={onOpenOnboarding}>重新打开安装引导</button>
    <button style={{ marginLeft: 12 }} disabled={clearing} onClick={() => void clearKey()}>{clearing ? '清除中…' : '清除本地 API Key'}</button>
    {message && <p style={{ marginTop: 12 }}>{message}</p>}

    <div style={{ marginTop: 24, padding: 16, border: '1px solid var(--border-hairline)', borderRadius: 8 }}>
      <h2 style={{ marginBottom: 8 }}>自动重评范围</h2>
      <p style={{ marginBottom: 10 }}>简历或偏好保存后，自动重评最近采集的 N 条岗位；置顶岗位始终会重评。范围外岗位会标记为评分已过期。</p>
      <label>自动重评最近 <input aria-label="自动重评最近 N 条" type="number" min="0" value={autoReevaluateCount} onChange={event => setAutoReevaluateCount(Number(event.target.value))} style={{ width: 72, margin: '0 6px' }} /> 条</label>
      <button style={{ marginLeft: 12 }} onClick={() => void saveAutoReevaluateCount()}>保存</button>
      <button style={{ marginLeft: 8 }} onClick={() => void previewRecentReevaluation()}>查看调用预估</button>
      {reevaluationPreview && <p style={{ marginTop: 10, fontSize: 13 }}>下次自动重评会处理 {reevaluationPreview.jobCount} 条岗位，预计消耗 {reevaluationPreview.modelCallCount} 次模型调用。</p>}
    </div>

    <div style={{ marginTop: 24 }}>
      <p style={{ marginBottom: 8 }}>本地插件配对 token</p>
      <input readOnly value={localApiToken ?? ''} style={{ width: 320 }} />
      <button style={{ marginLeft: 12 }} disabled={!localApiToken} onClick={() => void copyToken()}>{copyStatus === 'copied' ? '已复制' : '复制'}</button>
      <p style={{ marginTop: 8, fontSize: 12 }}>粘贴到浏览器插件设置以授权岗位导入</p>
    </div>

    <div style={{ marginTop: 32 }}>
      <h2 style={{ marginBottom: 12 }}>事实库</h2>
      {factError && <p style={{ color: 'var(--red-deep)', marginBottom: 12 }}>{factError}</p>}
      {facts.length === 0 && <p>暂无事实，上传简历后自动填充。</p>}
      {facts.length > 0 && <>
        {!clearConfirming
          ? <button style={{ marginBottom: 12 }} onClick={() => setClearConfirming(true)}>清空事实库</button>
          : <div style={{ marginBottom: 12, padding: 12, border: '1px solid var(--red-border)', borderRadius: 8, background: 'var(--red-bg)' }}>
              <p style={{ color: 'var(--red-deep)', marginBottom: 8 }}>清空后需重新上传简历建库，已确认的事实会全部消失。确定要清空全部 {facts.length} 条事实吗？</p>
              <button onClick={() => void clearAllFacts()}>确认清空</button>
              <button style={{ marginLeft: 8 }} onClick={() => setClearConfirming(false)}>取消</button>
            </div>}
        {facts.map(fact => (
          <div key={fact.id} style={{ borderBottom: '1px solid var(--border-hairline)', padding: '10px 0', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginRight: 8 }}>{fact.category}</span>
              <strong>{fact.label}</strong>
              <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)' }}>{FACT_STATUS_LABEL[fact.status]}</span>
              {editingFactId === fact.id
                ? <div style={{ marginTop: 6 }}>
                    <textarea value={editingValue} onChange={event => setEditingValue(event.target.value)} rows={2} style={{ width: '100%' }} aria-label={`修改${fact.label}`} />
                    <button onClick={() => void saveEdit(fact)}>保存</button>
                    <button style={{ marginLeft: 8 }} onClick={() => { setEditingFactId(null); setEditingValue('') }}>取消</button>
                  </div>
                : <div style={{ marginTop: 4, color: 'var(--text-secondary)' }}>{fact.value}</div>}
            </div>
            {editingFactId !== fact.id && <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button onClick={() => { setEditingFactId(fact.id); setEditingValue(fact.value) }}>编辑</button>
              <button onClick={() => void deleteFact(fact.id)}>删除</button>
            </div>}
          </div>
        ))}
      </>}
    </div>
  </div>
}
