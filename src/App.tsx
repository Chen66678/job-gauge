import { useState } from 'react'
import { Tooltip } from 'antd'
import JobListPage from './JobListPage'
import OnboardingPage from './OnboardingPage'
import PreferencesPage from './PreferencesPage'
import ProfilePage from './ProfilePage'
import WorkflowPage, { type WorkflowStep } from './WorkflowPage'

type Page = 'home' | 'jobs' | 'profile' | 'preferences' | 'settings' | 'onboarding'

// Compact, filled navigation glyphs. They are intentionally not part of the
// usual thin-outline admin icon family: the rail should feel like a small
// desktop tool, not a dashboard template.
const IconHome = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h3A2.5 2.5 0 0 1 12 5.5v3A2.5 2.5 0 0 1 9.5 11h-3A2.5 2.5 0 0 1 4 8.5v-3Zm8 10A2.5 2.5 0 0 1 14.5 13h3a2.5 2.5 0 0 1 2.5 2.5v3a2.5 2.5 0 0 1-2.5 2.5h-3a2.5 2.5 0 0 1-2.5-2.5v-3ZM14.5 3h3A2.5 2.5 0 0 1 20 5.5v3a2.5 2.5 0 0 1-2.5 2.5h-3A2.5 2.5 0 0 1 12 8.5v-3A2.5 2.5 0 0 1 14.5 3ZM4 15.5A2.5 2.5 0 0 1 6.5 13h3a2.5 2.5 0 0 1 0 5h-3A2.5 2.5 0 0 1 4 15.5Z"/>
  </svg>
)

const IconList = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M5.75 4h12.5A2.75 2.75 0 0 1 21 6.75v1.5A2.75 2.75 0 0 1 18.25 11H5.75A2.75 2.75 0 0 1 3 8.25v-1.5A2.75 2.75 0 0 1 5.75 4Zm0 9h12.5A2.75 2.75 0 0 1 21 15.75v1.5A2.75 2.75 0 0 1 18.25 20H5.75A2.75 2.75 0 0 1 3 17.25v-1.5A2.75 2.75 0 0 1 5.75 13Z"/>
    <circle cx="7" cy="7.5" r="1.25" fill="var(--nav-glyph-cutout)"/>
    <circle cx="7" cy="16.5" r="1.25" fill="var(--nav-glyph-cutout)"/>
  </svg>
)

const IconProfile = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M6 3h9.2L20 7.8V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm8 1.8V9h4.2L14 4.8ZM8.5 11a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Zm-2.75 5h5.5a2.75 2.75 0 0 0-5.5 0Z"/>
  </svg>
)

const IconSettings = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M5 7h3m5 0h6M5 17h6m5 0h3"/>
    <circle cx="10.5" cy="7" r="2.5" fill="currentColor" stroke="none"/>
    <circle cx="13.5" cy="17" r="2.5" fill="currentColor" stroke="none"/>
  </svg>
)

const NAV_ITEMS = [
  { id: 'home' as Page, label: '首页', Icon: IconHome },
  { id: 'jobs' as Page, label: '岗位列表', Icon: IconList },
  { id: 'profile' as Page, label: '我的资料', Icon: IconProfile },
]

export default function App() {
  const [page, setPage] = useState<Page>(() => localStorage.getItem('onboardingCompleted') === 'true' ? 'jobs' : 'onboarding')
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [workflowInitialStep, setWorkflowInitialStep] = useState<WorkflowStep | undefined>()

  const startWorkflow = (jobId: string) => {
    setSelectedJobId(jobId)
    setWorkflowInitialStep(undefined)
    setPage('home')
  }

  const openFollowUp = (jobId: string) => {
    setSelectedJobId(jobId)
    setWorkflowInitialStep('JOB_FOLLOW_UP')
    setPage('home')
  }

  return (
    <div className="app-layout">
      {/* ── Sidebar ── */}
      <nav className="sidebar" aria-label="主导航">
        <div className="sidebar-nav">
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <Tooltip key={id} title={label} placement="right" mouseEnterDelay={0.35}>
              <button
                className={`nav-item ${page === id ? 'active' : ''}`}
                onClick={() => setPage(id)}
                aria-label={label}
                aria-current={page === id ? 'page' : undefined}
              >
                <Icon />
                <span className="nav-item-label">{label}</span>
              </button>
            </Tooltip>
          ))}
        </div>

        <div className="sidebar-bottom">
          <Tooltip title="设置" placement="right" mouseEnterDelay={0.35}>
            <button
              className={`nav-item ${page === 'settings' ? 'active' : ''}`}
              aria-label="设置"
              aria-current={page === 'settings' ? 'page' : undefined}
              onClick={() => setPage('settings')}
            >
              <IconSettings />
              <span className="nav-item-label">设置</span>
            </button>
          </Tooltip>
        </div>
      </nav>

      {/* ── Main ── */}
      <main className="app-main">
        {page === 'jobs' && <JobListPage onStartWorkflow={startWorkflow} onOpenFollowUp={openFollowUp} onOpenProfile={() => setPage('profile')} />}
        {page === 'home' && (
          <WorkflowPage selectedJobId={selectedJobId} initialStep={workflowInitialStep} onOpenProfile={() => setPage('profile')} />
        )}
        {page === 'profile' && <ProfilePage />}
        {page === 'preferences' && <PreferencesPage />}
        {page === 'onboarding' && <OnboardingPage onFinished={() => setPage('jobs')} onOpenJobs={() => setPage('jobs')} />}
        {page === 'settings' && (
          <div style={{ padding: 40, color: 'var(--text-secondary)' }}>
            <h1 style={{ marginBottom: 16 }}>设置</h1>
            <p style={{ marginBottom: 20 }}>管理求职偏好和安装引导。</p>
            <button onClick={() => setPage('preferences')}>偏好设置</button>
            <button style={{ marginLeft: 12 }} onClick={() => setPage('onboarding')}>重新打开安装引导</button>
          </div>
        )}
      </main>
    </div>
  )
}
