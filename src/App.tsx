import { lazy, Suspense, useState } from 'react'
import { Tooltip } from 'antd'
import JobListPage from './JobListPage'
import FollowUpDrawer from './FollowUpDrawer'

const CustomResumePage = lazy(() => import('./CustomResumePage'))
const OnboardingPage = lazy(() => import('./OnboardingPage'))
const PreferencesPage = lazy(() => import('./PreferencesPage'))
const ProfilePage = lazy(() => import('./ProfilePage'))
const SettingsPage = lazy(() => import('./SettingsPage'))

type Page = 'jobs' | 'profile' | 'preferences' | 'settings' | 'onboarding' | 'customResume'

// Compact, filled navigation glyphs. They are intentionally not part of the
// usual thin-outline admin icon family: the rail should feel like a small
// desktop tool, not a dashboard template.
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
  { id: 'jobs' as Page, label: '岗位列表', Icon: IconList },
  { id: 'profile' as Page, label: '我的资料', Icon: IconProfile },
]

export default function App() {
  const [page, setPage] = useState<Page>(() => localStorage.getItem('onboardingCompleted') === 'true' ? 'jobs' : 'onboarding')
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [followUpJobId, setFollowUpJobId] = useState<string | null>(null)

  const startWorkflow = (jobId: string) => {
    setSelectedJobId(jobId)
    setPage('customResume')
  }

  const openFollowUp = (jobId: string) => {
    setFollowUpJobId(jobId)
  }

  const isNavActive = (id: Page) => {
    if (id === 'jobs') return page === 'jobs' || page === 'customResume'
    if (id === 'settings') return page === 'settings' || page === 'preferences' || page === 'onboarding'
    return page === id
  }

  return (
    <div className="app-layout">
      {/* ── Sidebar ── */}
      <nav className="sidebar" aria-label="主导航">
        <div className="sidebar-brand" aria-label="Job HQ 求职工作台">
          <span className="sidebar-brand-mark" aria-hidden="true">J</span>
          <span className="sidebar-brand-copy">
            <strong>Job HQ</strong>
            <small>求职工作台</small>
          </span>
        </div>
        <div className="sidebar-section-label">工作区</div>
        <div className="sidebar-nav">
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <Tooltip key={id} title={label} placement="right" mouseEnterDelay={0.35}>
              <button
                className={`nav-item ${isNavActive(id) ? 'active' : ''}`}
                onClick={() => setPage(id)}
                aria-label={label}
                aria-current={isNavActive(id) ? 'page' : undefined}
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
              className={`nav-item ${isNavActive('settings') ? 'active' : ''}`}
              aria-label="设置"
              aria-current={isNavActive('settings') ? 'page' : undefined}
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
        <Suspense fallback={<div className="app-page-loading" aria-live="polite">加载中...</div>}>
          {page === 'jobs' && <JobListPage onStartWorkflow={startWorkflow} onOpenFollowUp={openFollowUp} onOpenProfile={() => setPage('profile')} />}
          {page === 'customResume' && selectedJobId && <CustomResumePage jobId={selectedJobId} onBack={() => setPage('jobs')} />}
          {page === 'profile' && <ProfilePage />}
          {page === 'preferences' && <PreferencesPage onBack={() => setPage('settings')} />}
          {page === 'onboarding' && <OnboardingPage onFinished={() => setPage('jobs')} onOpenJobs={() => setPage('jobs')} />}
          {page === 'settings' && (
            <SettingsPage onOpenPreferences={() => setPage('preferences')} onOpenOnboarding={() => setPage('onboarding')} />
          )}
        </Suspense>
      </main>
      <FollowUpDrawer
        jobId={followUpJobId}
        onClose={() => setFollowUpJobId(null)}
        onOpenProfile={() => { setFollowUpJobId(null); setPage('profile') }}
      />
    </div>
  )
}
