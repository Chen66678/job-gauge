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

const IconList = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none" />
    <path d="M8 6h11M8 12h11M8 18h11" />
  </svg>
)

const IconProfile = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="3.25" />
    <path d="M5.5 19.25c.65-3.2 3.05-5.25 6.5-5.25s5.85 2.05 6.5 5.25" />
  </svg>
)

const IconSettings = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M4 7h5M15 7h5M4 17h8M18 17h2" />
    <circle cx="12" cy="7" r="2.25" />
    <circle cx="15" cy="17" r="2.25" />
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
