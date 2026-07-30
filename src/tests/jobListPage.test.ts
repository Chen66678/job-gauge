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
      sourceRef: '反问:请补充 React 项目经历',
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
            { label: 'React 项目经验', score: 8, maxScore: 10, gap: null },
            { label: 'TypeScript 经验', score: 0, maxScore: 10, gap: '经历尚未确认' },
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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('JobListPage', () => {
  it('keeps JD details collapsed and opens follow-up from considerations', async () => {
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
    const jdToggle = screen.getByRole('button', { name: '查看完整 JD ▾' })
    expect(jdToggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('岗位职责')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '补一下这些信息 →' }))
    expect(onOpenFollowUp).toHaveBeenCalledWith('job-1')
    fireEvent.click(jdToggle)
    expect(screen.getByRole('button', { name: '查看完整 JD ▴' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('岗位职责')).not.toBeNull()
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
})
