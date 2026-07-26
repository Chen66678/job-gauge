import { useState } from 'react'
import type { WorkflowApi } from './WorkflowPage'

// 唯一清除入口（首席裁定五）：只此一处，文案「清除本地 API Key」。
export default function SettingsPage({ onOpenPreferences, onOpenOnboarding }: { onOpenPreferences: () => void; onOpenOnboarding: () => void }) {
  const api = window.coreApi as unknown as WorkflowApi
  const [clearing, setClearing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const clearKey = async () => {
    setClearing(true); setMessage(null)
    try {
      const result = await api.clearByokKey()
      setMessage(result.ok ? '已清除本地 API Key。' : result.message)
    } finally {
      setClearing(false)
    }
  }

  return <div style={{ padding: 40, color: 'var(--text-secondary)' }}>
    <h1 style={{ marginBottom: 16 }}>设置</h1>
    <p style={{ marginBottom: 20 }}>管理求职偏好和安装引导。</p>
    <button onClick={onOpenPreferences}>偏好设置</button>
    <button style={{ marginLeft: 12 }} onClick={onOpenOnboarding}>重新打开安装引导</button>
    <button style={{ marginLeft: 12 }} disabled={clearing} onClick={() => void clearKey()}>{clearing ? '清除中…' : '清除本地 API Key'}</button>
    {message && <p style={{ marginTop: 12 }}>{message}</p>}
  </div>
}
