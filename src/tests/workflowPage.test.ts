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
})
