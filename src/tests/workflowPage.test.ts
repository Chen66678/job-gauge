// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CustomResumePage from '../CustomResumePage'
import FollowUpDrawer from '../FollowUpDrawer'
import {
  reevaluateForWorkflow,
  submitJobFollowUpsForWorkflow,
  type FollowUpApi,
  type FollowUpQuestion,
} from '../followUpActions'
import type { ProfileFact } from '../types'
import type { WorkflowJob } from '../workflowApi'

const questions: FollowUpQuestion[] = [
  { id: 'question-1', requirementId: 'req-react', kind: 'explore', question: '请补充项目经历', rationale: '评分缺少证据' },
]

const job = {
  job: {
    id: 'job-new',
    title: '前端工程师',
    company: '样例科技',
    city: '上海',
    requirements: [
      { id: 'req-react', kind: 'skill' as const, label: 'React 工程化经验', evidence: '', requiredFactIds: [], weight: 1 },
    ],
  },
  evaluation: null,
  evaluationError: null,
  followUps: questions,
  material: null,
} as WorkflowJob

function buildFact(): ProfileFact {
  return {
    id: 'follow-up-fact',
    category: 'skill',
    label: 'React',
    value: '负责 React 项目',
    sourceType: 'user_answer',
    sourceRef: '岗位追问',
    status: 'confirmed',
    confidence: 0.9,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('follow-up actions', () => {
  it('submits trimmed answers and reports whether facts were created', async () => {
    const fact = buildFact()
    const applyFollowUpAnswers = vi.fn(async () => [fact])
    const api = { applyFollowUpAnswers } as unknown as FollowUpApi

    const result = await submitJobFollowUpsForWorkflow({
      api,
      jobId: 'job-new',
      questions,
      answers: { 'question-1': '  补充说明  ' },
    })

    expect(applyFollowUpAnswers).toHaveBeenCalledWith('job-new', [
      { questionId: 'question-1', answerText: '补充说明' },
    ])
    expect(result).toEqual({ newFacts: [fact], hadNewFacts: true })
  })

  it('skips the apply call when every answer is blank', async () => {
    const applyFollowUpAnswers = vi.fn()
    const api = { applyFollowUpAnswers } as unknown as FollowUpApi

    await expect(submitJobFollowUpsForWorkflow({
      api,
      jobId: 'job-new',
      questions,
      answers: { 'question-1': '   ' },
    })).resolves.toEqual({ newFacts: [], hadNewFacts: false })
    expect(applyFollowUpAnswers).not.toHaveBeenCalled()
  })

  it('unwraps reevaluation errors', async () => {
    const api = { reevaluateJob: vi.fn(async () => ({ error: '模型服务无响应' })) } as unknown as FollowUpApi
    await expect(reevaluateForWorkflow(api, 'job-new')).rejects.toThrow('模型服务无响应')
  })
})

describe('FollowUpDrawer', () => {
  it('loads, submits, reevaluates new facts, and reaches success', async () => {
    const applyFollowUpAnswers = vi.fn(async () => [buildFact()])
    const reevaluateJob = vi.fn(async () => job)
    const getState = vi.fn(async () => ({ factLibrary: [], jobs: [job] }))
    window.coreApi = {
      getState,
      buildFollowUps: vi.fn(async () => questions),
      applyFollowUpAnswers,
      reevaluateJob,
    } as unknown as typeof window.coreApi

    render(createElement(FollowUpDrawer, {
      jobId: 'job-new',
      onClose: vi.fn(),
      onOpenProfile: vi.fn(),
    }))

    await screen.findByText('前端工程师 · 补充信息')
    expect(screen.getByText('针对要求：React 工程化经验')).not.toBeNull()
    fireEvent.change(screen.getByPlaceholderText('如实填写；不确定可以留空'), { target: { value: '补充说明' } })
    fireEvent.click(screen.getByRole('button', { name: '提交全部' }))

    await screen.findByRole('heading', { name: '提交成功' })
    expect(applyFollowUpAnswers).toHaveBeenCalledWith('job-new', [
      { questionId: 'question-1', answerText: '补充说明' },
    ])
    expect(reevaluateJob).toHaveBeenCalledWith('job-new')
    expect(getState).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/确认新增事实/)).toBeNull()
    expect(screen.queryByText(/重新评估/)).toBeNull()
  })

  it('keeps the drawer open and offers retry when submission fails', async () => {
    const applyFollowUpAnswers = vi.fn()
      .mockResolvedValueOnce({ error: '提交失败原因' })
      .mockResolvedValueOnce([])
    window.coreApi = {
      getState: vi.fn(async () => ({ factLibrary: [], jobs: [job] })),
      buildFollowUps: vi.fn(async () => questions),
      applyFollowUpAnswers,
      reevaluateJob: vi.fn(),
    } as unknown as typeof window.coreApi

    render(createElement(FollowUpDrawer, {
      jobId: 'job-new',
      onClose: vi.fn(),
      onOpenProfile: vi.fn(),
    }))

    await screen.findByText('前端工程师 · 补充信息')
    fireEvent.change(screen.getByPlaceholderText('如实填写；不确定可以留空'), { target: { value: '补充说明' } })
    fireEvent.click(screen.getByRole('button', { name: '提交全部' }))
    await screen.findByText('提交失败，请重试')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByRole('heading', { name: '提交成功' })
    expect(applyFollowUpAnswers).toHaveBeenCalledTimes(2)
  })

  it('loads and submits resume follow-ups without job reevaluation', async () => {
    const resumeQuestions = [{
      id: 'resume-question-1',
      requirementId: 'resume-refine',
      kind: 'explore' as const,
      question: '这个项目服务了多少用户？',
      rationale: '补充项目规模能让简历事实更具体。',
    }]
    const applyResumeFollowUpAnswers = vi.fn(async () => [buildFact()])
    const reevaluateJob = vi.fn()
    window.coreApi = {
      getState: vi.fn(async () => ({ factLibrary: [], jobs: [] })),
      buildResumeFollowUps: vi.fn(async () => resumeQuestions),
      applyResumeFollowUpAnswers,
      reevaluateJob,
    } as unknown as typeof window.coreApi

    render(createElement(FollowUpDrawer, {
      mode: 'resume',
      onClose: vi.fn(),
      onOpenProfile: vi.fn(),
    }))

    await screen.findByText('简历补充')
    expect(screen.getByText('完善简历事实')).not.toBeNull()
    expect(screen.queryByText(/针对要求/)).toBeNull()
    fireEvent.change(screen.getByLabelText('补充回答'), { target: { value: '日活超过一百万' } })
    fireEvent.click(screen.getByRole('button', { name: '提交全部' }))

    await screen.findByRole('heading', { name: '提交成功' })
    expect(applyResumeFollowUpAnswers).toHaveBeenCalledWith(resumeQuestions, [
      { questionId: 'resume-question-1', answerText: '日活超过一百万' },
    ])
    expect(reevaluateJob).not.toHaveBeenCalled()
  })
})

describe('CustomResumePage', () => {
  it('starts generation immediately and exports the generated markdown', async () => {
    const draftMaterial = vi.fn(async () => ({
      status: 'ready' as const,
      greeting: '您好',
      resumeLines: [{ text: '负责 React 项目', factIds: ['fact-1'] }],
      usedFacts: [],
      blockedFacts: [],
      guardrailNotes: [],
    }))
    const exportResume = vi.fn(async () => '# 定制简历')
    const createObjectURL = vi.fn(() => 'blob:resume')
    const revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    window.coreApi = { draftMaterial, exportResume } as unknown as typeof window.coreApi

    render(createElement(CustomResumePage, { jobId: 'job-new', onBack: vi.fn() }))

    await screen.findByText(/负责 React 项目/)
    expect(draftMaterial).toHaveBeenCalledOnce()
    expect(draftMaterial).toHaveBeenCalledWith('job-new')
    fireEvent.click(screen.getByRole('button', { name: '导出 Markdown' }))
    await waitFor(() => expect(exportResume).toHaveBeenCalledWith('job-new'))
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:resume')
  })

  it('shows generation errors and retries without a confirmation gate', async () => {
    const draftMaterial = vi.fn()
      .mockResolvedValueOnce({ error: '生成失败' })
      .mockResolvedValueOnce({
        status: 'ready' as const,
        greeting: '',
        resumeLines: [{ text: '重试成功', factIds: [] }],
        usedFacts: [],
        blockedFacts: [],
        guardrailNotes: [],
      })
    window.coreApi = { draftMaterial, exportResume: vi.fn() } as unknown as typeof window.coreApi

    render(createElement(CustomResumePage, { jobId: 'job-new', onBack: vi.fn() }))

    await screen.findByRole('alert')
    expect(screen.getByText('生成失败')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByText('重试成功')
    expect(draftMaterial).toHaveBeenCalledTimes(2)
  })

  it('allows export for needs-review material without exposing internal notes', async () => {
    window.coreApi = {
      draftMaterial: vi.fn(async () => ({
        status: 'needs_review' as const,
        greeting: '您好',
        resumeLines: [{ text: '负责核心项目', factIds: ['fact-1'] }],
        usedFacts: [{ factId: 'fact-1', label: '核心项目', value: '负责核心项目', source: 'resume' }],
        blockedFacts: [],
        guardrailNotes: ['internal-only-note'],
      })),
      exportResume: vi.fn(async () => '# 定制简历'),
    } as unknown as typeof window.coreApi

    render(createElement(CustomResumePage, { jobId: 'job-new', onBack: vi.fn() }))

    await screen.findByText('这份材料有需要你复核的地方')
    expect((screen.getByRole('button', { name: '导出 Markdown' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText('resume')).not.toBeNull()
    expect(screen.queryByText('internal-only-note')).toBeNull()
  })

  it('shows blocked facts, recovery action, and disables export', async () => {
    const onBack = vi.fn()
    window.coreApi = {
      draftMaterial: vi.fn(async () => ({
        status: 'blocked' as const,
        greeting: '',
        resumeLines: [],
        usedFacts: [],
        blockedFacts: [{ factId: 'fact-blocked', label: '项目规模', value: '', source: 'manual' }],
        guardrailNotes: ['do-not-render'],
      })),
      exportResume: vi.fn(),
    } as unknown as typeof window.coreApi

    render(createElement(CustomResumePage, { jobId: 'job-new', onBack }))

    await screen.findByText('部分关键事实无法安全写入')
    expect(screen.getAllByText('项目规模').length).toBeGreaterThan(0)
    expect((screen.getByRole('button', { name: '导出 Markdown' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '返回并补充资料 →' }))
    expect(onBack).toHaveBeenCalledOnce()
    expect(screen.queryByText('do-not-render')).toBeNull()
  })
})
