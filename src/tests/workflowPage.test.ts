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
} as unknown as WorkflowJob

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
    groupId: null,
    summary: null,
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
  it('starts generation immediately and copies the generated plain text', async () => {
    const draftMaterial = vi.fn(async () => ({
      status: 'ready' as const,
      greeting: '您好',
      resumeLines: [{ text: '负责 React 项目', factIds: ['fact-1'] }],
      usedFacts: [],
      blockedFacts: [],
      guardrailNotes: [],
    }))
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    window.coreApi = { draftMaterial } as unknown as typeof window.coreApi

    render(createElement(CustomResumePage, { jobId: 'job-new', onBack: vi.fn() }))

    await screen.findByText(/负责 React 项目/)
    expect(draftMaterial).toHaveBeenCalledOnce()
    expect(draftMaterial).toHaveBeenCalledWith('job-new')
    fireEvent.click(screen.getByRole('button', { name: '复制正文文字' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('负责 React 项目'))
    expect(screen.getByRole('button', { name: '已复制' })).not.toBeNull()
  })

  it('reuses stored material without generating again, but allows an explicit regeneration', async () => {
    const storedMaterial = {
      status: 'ready' as const,
      greeting: '已保存的开场白',
      resumeLines: [{ text: '已保存的简历内容', factIds: ['fact-1'] }],
      usedFacts: [{ factId: 'fact-1', label: '已确认项目', value: '项目原始事实内容', source: 'resume' }],
      blockedFacts: [],
      guardrailNotes: [],
    }
    const draftMaterial = vi.fn(async () => ({ ...storedMaterial, greeting: '重新生成的开场白' }))
    window.coreApi = {
      getState: vi.fn(async () => ({ jobs: [{ job: { id: 'job-stored', sourceUrl: null }, material: storedMaterial }] })),
      draftMaterial,
    } as unknown as typeof window.coreApi

    render(createElement(CustomResumePage, { jobId: 'job-stored', onBack: vi.fn() }))

    await screen.findByText('已保存的简历内容')
    expect(draftMaterial).not.toHaveBeenCalled()
    expect(screen.getByText('来源事实')).not.toBeNull()
    expect(screen.getByText(/已确认项目：项目原始事实内容/)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    await screen.findByText('重新生成的开场白')
    expect(draftMaterial).toHaveBeenCalledWith('job-stored')
  })

  it('exports the rendered resume image through the existing renderer path', async () => {
    const draftMaterial = vi.fn(async () => ({
      status: 'ready' as const,
      greeting: '',
      resumeLines: [],
      usedFacts: [],
      blockedFacts: [],
      guardrailNotes: [],
    }))
    const renderResumeImage = vi.fn(async () => 'data:image/png;base64,abc123')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    window.coreApi = { draftMaterial, exportResume: vi.fn(), renderResumeImage } as unknown as typeof window.coreApi

    render(createElement(CustomResumePage, { jobId: 'job-new', onBack: vi.fn() }))

    await screen.findByText('已生成，可导出')
    fireEvent.click(screen.getByRole('button', { name: '导出图片' }))
    await waitFor(() => expect(renderResumeImage).toHaveBeenCalledWith('job-new'))
    const link = click.mock.instances[0] as unknown as HTMLAnchorElement
    expect(link.download).toBe('简历图.png')
    expect(link.href).toContain('data:image/png;base64,abc123')
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
        usedFacts: [{ factId: 'fact-1', label: '核心项目', value: '负责核心项目。'.repeat(20), source: 'resume' }],
        blockedFacts: [],
        guardrailNotes: ['internal-only-note'],
      })),
    } as unknown as typeof window.coreApi

    render(createElement(CustomResumePage, { jobId: 'job-new', onBack: vi.fn() }))

    await screen.findByText('这份材料有需要你复核的地方')
    expect((screen.getByRole('button', { name: '复制正文文字' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText('resume')).not.toBeNull()
    expect(screen.queryByText('internal-only-note')).toBeNull()
    const factValue = screen.getByText('负责核心项目。'.repeat(20))
    expect(factValue.className).toContain('cr-fact-value--collapsed')
    const toggle = screen.getByRole('button', { name: '展开' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(factValue.className).not.toContain('cr-fact-value--collapsed')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
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
    } as unknown as typeof window.coreApi

    render(createElement(CustomResumePage, { jobId: 'job-new', onBack }))

    await screen.findByText('部分关键事实无法安全写入')
    expect(screen.getAllByText('项目规模').length).toBeGreaterThan(0)
    expect((screen.getByRole('button', { name: '复制正文文字' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '导出图片' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '返回并补充资料 →' }))
    expect(onBack).toHaveBeenCalledOnce()
    expect(screen.queryByText('do-not-render')).toBeNull()
  })
})
