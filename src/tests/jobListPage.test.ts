// @vitest-environment jsdom

import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import JobListPage from '../JobListPage'

type StateListener = (state: ReturnType<typeof buildState>) => void

function buildState(score: number | null, evaluationError: string | null = null) {
  return {
    factLibrary: [{
      id: 'fact-follow-up',
      sourceType: 'user_answer',
      sourceRef: '反问:follow-up-1:请补充 React 项目经历',
      status: 'confirmed' as const,
    }],
    jobs: [{
      job: {
        id: 'job-1',
        title: '前端工程师',
        company: '样例科技',
        city: '上海',
        salaryK: [25, 35] as [number, number],
        companyTags: ['互联网'],
        jdText: '负责 React 项目。要求 TypeScript 经验。',
        requirements: [
          { label: 'React 项目经验', evidence: '负责 React 项目', requiredFactIds: ['fact-follow-up'] },
          { label: 'TypeScript 经验', evidence: '', requiredFactIds: [] },
        ],
        risks: [],
        pinned: false,
        workAddress: '上海市徐汇区',
        sourceUrl: 'https://example.com/job-1',
      },
      evaluation: score === null ? null : {
        vetoed: false as const,
        score: {
          total: score,
          strategyLabel: '建议投递',
          strategy: 'suggest',
          gaps: ['TypeScript 经验'],
          risks: [],
          breakdown: { requirements: [
            { label: 'React 项目经验', score: 8, maxScore: 10, gap: null as string | null },
          ] },
        },
      },
      evaluationError,
      followUps: [{
        id: 'follow-up-1',
        requirementId: 'req-react',
        kind: 'explore' as const,
        question: '请补充 React 项目经历',
        rationale: '需要更多证据',
      }],
    }],
  }
}

function buildTieredState() {
  const state = buildState(62)
  state.jobs[0].job.requirements = [
    { label: '需求分析经验', evidence: '参与需求分析', requiredFactIds: [] },
    { label: '数据建模能力', evidence: '维护数据模型', requiredFactIds: [] },
    { label: '行业知识', evidence: '', requiredFactIds: [] },
  ]
  if (state.jobs[0].evaluation && !state.jobs[0].evaluation.vetoed) {
    state.jobs[0].evaluation.score.gaps = []
    state.jobs[0].evaluation.score.breakdown.requirements = [
      { label: '需求分析经验', score: 6, maxScore: 10, gap: '缺少独立负责复杂需求的案例' },
      { label: '数据建模能力', score: 3, maxScore: 10, gap: null },
    ]
  }
  return state
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('JobListPage', () => {
  it('opens follow-up from considerations', async () => {
    const onOpenFollowUp = vi.fn()
    window.coreApi = {
      getState: vi.fn(async () => buildState(68)),
      onStateChanged: vi.fn(() => () => undefined),
      setJobPinned: vi.fn(),
      reevaluateJob: vi.fn(),
      evaluateJobFromJd: vi.fn(),
    } as unknown as typeof window.coreApi

    render(createElement(JobListPage, { onOpenFollowUp }))

    await screen.findByText('前端工程师')
    fireEvent.click(screen.getByText('前端工程师'))
    fireEvent.click(screen.getByRole('button', { name: '补一下这些信息 →' }))
    expect(onOpenFollowUp).toHaveBeenCalledWith('job-1')
  })

  it('shows score comparison only after explicit reevaluation completes', async () => {
    vi.useFakeTimers()
    try {
      let listener: StateListener | undefined
      let resolveReevaluation: (() => void) | undefined
      const reevaluateJob = vi.fn(() => new Promise<void>(resolve => { resolveReevaluation = resolve }))
      window.coreApi = {
        getState: vi.fn(async () => buildState(68)),
        onStateChanged: vi.fn((nextListener: StateListener) => { listener = nextListener; return () => undefined }),
        setJobPinned: vi.fn(),
        reevaluateJob,
        evaluateJobFromJd: vi.fn(),
      } as unknown as typeof window.coreApi

      render(createElement(JobListPage))
      await act(async () => { await Promise.resolve() })
      fireEvent.click(screen.getByRole('button', { name: '立刻重评' }))
      expect(screen.getByText('重新评估中…')).not.toBeNull()
      expect(screen.queryByText('68 → 76')).toBeNull()

      act(() => listener?.(buildState(null)))
      expect(screen.queryByText('68 → 76')).toBeNull()

      await act(async () => {
        listener?.(buildState(76))
        resolveReevaluation?.()
        await Promise.resolve()
      })
      expect(screen.getByText('68 → 76')).not.toBeNull()

      act(() => { vi.advanceTimersByTime(4500) })
      expect(screen.queryByText('68 → 76')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows measured requirements by tier and keeps unmeasured requirements separate', async () => {
    window.coreApi = {
      getState: vi.fn(async () => buildTieredState()),
      onStateChanged: vi.fn(() => () => undefined),
      setJobPinned: vi.fn(),
      reevaluateJob: vi.fn(),
      evaluateJobFromJd: vi.fn(),
    } as unknown as typeof window.coreApi

    render(createElement(JobListPage))

    await screen.findByText('前端工程师')
    expect(screen.getByText('部分符合 需求分析经验')).not.toBeNull()
    fireEvent.click(screen.getByText('前端工程师'))

    const partialScore = screen.getByText('60%')
    const weakScore = screen.getByText('30%')
    const partialBar = partialScore.parentElement?.querySelector('.evidence-bar-fill')
    const weakBar = weakScore.parentElement?.querySelector('.evidence-bar-fill')
    expect(partialScore.classList.contains('tier-partial')).toBe(true)
    expect(weakScore.classList.contains('tier-weak')).toBe(true)
    expect(partialBar?.classList.contains('tier-partial')).toBe(true)
    expect(weakBar?.classList.contains('tier-weak')).toBe(true)
    expect(partialBar?.getAttribute('style')).toContain('width: 60%')
    expect(weakBar?.getAttribute('style')).toContain('width: 30%')
    expect(screen.getByText('缺少独立负责复杂需求的案例')).not.toBeNull()
    expect(screen.getByText('与要求有距离')).not.toBeNull()
    expect(screen.getByText('部分符合').classList.contains('tier-partial')).toBe(true)
    expect(screen.getByText('匹配较弱').classList.contains('tier-weak')).toBe(true)
    expect(screen.queryByText('✓ 已确认 需求分析经验')).toBeNull()
    expect(screen.queryByText('✓ 已确认 数据建模能力')).toBeNull()
    expect(screen.getByText('行业知识：经历尚未确认')).not.toBeNull()
    expect(screen.queryByText('行业知识', { selector: '.evidence-name' })).toBeNull()
  })
})

it('re-evaluates all stale jobs from the remaining-jobs entry', async () => {
  const staleState = buildState(68)
  ;(staleState.jobs[0] as { evaluationStale?: boolean }).evaluationStale = true
  const reevaluateJobs = vi.fn(async () => undefined)
  window.coreApi = {
    getState: vi.fn(async () => staleState),
    onStateChanged: vi.fn(() => () => undefined),
    setJobPinned: vi.fn(),
    reevaluateJob: vi.fn(),
    reevaluateJobs,
    getReevaluationPreview: vi.fn(async (scope: string) => scope === 'stale' && reevaluateJobs.mock.calls.length === 0 ? { jobCount: 1, modelCallCount: 1 } : { jobCount: 0, modelCallCount: 0 }),
    evaluateJobFromJd: vi.fn(),
  } as unknown as typeof window.coreApi
  vi.spyOn(window, 'confirm').mockReturnValue(true)

  render(createElement(JobListPage))

  await screen.findByRole('button', { name: /把剩下 1 条也重评/ })
  expect(screen.getByLabelText('评分已过期')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /把剩下 1 条也重评/ }))
  await waitFor(() => expect(reevaluateJobs).toHaveBeenCalledWith('stale'))
  await waitFor(() => expect(screen.queryByRole('button', { name: /把剩下 1 条也重评/ })).toBeNull())
})
