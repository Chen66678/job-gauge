// @vitest-environment jsdom

import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { extractPdfResume, isPdfFile } = vi.hoisted(() => ({
  extractPdfResume: vi.fn(),
  isPdfFile: vi.fn(),
}))

vi.mock('../domain/pdfResume', () => ({ extractPdfResume, isPdfFile }))

import ProfilePage from '../ProfilePage'
import type { WorkflowApi, WorkflowState } from '../workflowApi'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  extractPdfResume.mockReset()
  isPdfFile.mockReset()
})

function buildApi(overrides: Partial<WorkflowApi> = {}) {
  const state: WorkflowState = { factLibrary: [], jobs: [] } as unknown as WorkflowState
  const api = {
    getState: vi.fn(async () => state),
    ingestResume: vi.fn(async () => []),
    buildResumeFollowUps: vi.fn(async () => []),
    ...overrides,
  } as unknown as WorkflowApi
  window.coreApi = api as unknown as typeof window.coreApi
  return api
}

async function selectResumeFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
}

describe('ProfilePage resume upload', () => {
  it('does not echo extracted PDF text into the visible paste textarea', async () => {
    buildApi()
    isPdfFile.mockReturnValue(true)
    extractPdfResume.mockResolvedValue('张三\n产品经理\n负责招聘平台项目。')

    render(createElement(ProfilePage))
    await selectResumeFile(new File(['%PDF'], 'resume.pdf', { type: 'application/pdf' }))

    await screen.findByText((_, element) => element?.textContent === '已选择文件：resume.pdf')
    const textarea = screen.getByPlaceholderText('粘贴简历文本') as HTMLTextAreaElement
    expect(textarea.value).toBe('')
    expect(screen.queryByText('张三')).toBeNull()
  })

  it('still sends the extracted text to ingestResume on submit', async () => {
    const api = buildApi()
    isPdfFile.mockReturnValue(true)
    extractPdfResume.mockResolvedValue('张三\n产品经理')

    render(createElement(ProfilePage))
    await selectResumeFile(new File(['%PDF'], 'resume.pdf', { type: 'application/pdf' }))
    await screen.findByText((_, element) => element?.textContent === '已选择文件：resume.pdf')

    fireEvent.click(screen.getByRole('button', { name: '解析简历' }))

    await waitFor(() => expect(api.ingestResume).toHaveBeenCalledWith({ kind: 'text', resumeText: '张三\n产品经理' }))
  })

  it('shows slow-model guidance and elapsed seconds only while parsing', async () => {
    vi.useFakeTimers()
    let resolveIngest: ((facts: never[]) => void) | undefined
    buildApi({
      ingestResume: vi.fn(() => new Promise<never[]>(resolve => { resolveIngest = resolve })),
    })

    render(createElement(ProfilePage))
    fireEvent.change(screen.getByPlaceholderText('粘贴简历文本'), { target: { value: '我的简历' } })
    fireEvent.click(screen.getByRole('button', { name: '解析简历' }))

    expect(screen.getByText(/模型响应较慢，可能需要几分钟/)).not.toBeNull()
    expect(screen.getByText(/已等待 0 秒/)).not.toBeNull()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(screen.getByText(/已等待 2 秒/)).not.toBeNull()

    await act(async () => { resolveIngest?.([]) })
    expect(screen.queryByText(/模型响应较慢，可能需要几分钟/)).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the selected-file indicator once the user types into the textarea', async () => {
    buildApi()
    isPdfFile.mockReturnValue(true)
    extractPdfResume.mockResolvedValue('张三')

    render(createElement(ProfilePage))
    await selectResumeFile(new File(['%PDF'], 'resume.pdf', { type: 'application/pdf' }))
    await screen.findByText((_, element) => element?.textContent === '已选择文件：resume.pdf')

    fireEvent.change(screen.getByPlaceholderText('粘贴简历文本'), { target: { value: '手动粘贴的文字' } })
    expect(screen.queryByText((_, element) => element?.textContent === '已选择文件：resume.pdf')).toBeNull()
  })

  it('shows the resume follow-up entry only after parsing returns questions', async () => {
    const parsedState = {
      factLibrary: [{ id: 'fact-1', category: '技能', label: 'React', value: '熟悉 React', sourceType: 'resume', sourceRef: 'resume_text', status: 'unconfirmed', confidence: 0.9 }],
      jobs: [],
    } as unknown as WorkflowState
    const getState = vi.fn()
      .mockResolvedValueOnce({ factLibrary: [], jobs: [] })
      .mockResolvedValue(parsedState)
    const api = buildApi({
      getState,
      buildResumeFollowUps: vi.fn(async () => [{ id: 'resume-q-1', question: '补充项目规模？', rationale: '完善经历' }]),
    })

    render(createElement(ProfilePage))
    fireEvent.change(screen.getByPlaceholderText('粘贴简历文本'), { target: { value: '我的简历' } })
    fireEvent.click(screen.getByRole('button', { name: '解析简历' }))

    expect(await screen.findByRole('button', { name: '完善简历信息（1 问）' })).not.toBeNull()
    expect(api.buildResumeFollowUps).toHaveBeenCalledOnce()
  })

  it('loads the resume follow-up count for an existing parsed resume', async () => {
    const state = {
      factLibrary: [{ id: 'fact-1', category: '技能', label: 'React', value: '熟悉 React', sourceType: 'resume', sourceRef: 'resume_text', status: 'unconfirmed', confidence: 0.9 }],
      jobs: [],
    } as unknown as WorkflowState
    const api = buildApi({
      getState: vi.fn(async () => state),
      buildResumeFollowUps: vi.fn(async () => [{ id: 'resume-q-1', question: '补充项目规模？', rationale: '完善经历' }]),
    })

    render(createElement(ProfilePage))

    expect(await screen.findByRole('button', { name: '完善简历信息（1 问）' })).not.toBeNull()
    expect(api.buildResumeFollowUps).toHaveBeenCalledOnce()
  })
})

describe('ProfilePage fact conflicts', () => {
  it('renders a conflict card with a Chinese title and both versions when factConflicts has entries', async () => {
    const state = {
      factLibrary: [
        { id: 'fact-1', category: '工作经历', label: '后端开发', value: '负责订单服务的开发', sourceType: 'resume', sourceRef: 'resume_text', status: 'confirmed', confidence: 0.9 },
        { id: 'fact-2', category: '工作经历', label: '后端开发', value: '负责订单服务的重构', sourceType: 'resume', sourceRef: 'resume_text', status: 'confirmed', confidence: 0.9 },
      ],
      factConflicts: [
        { id: 'conflict-1', factIds: ['fact-1', 'fact-2'], rationale: '两条描述指向同一职责但细节冲突', detectedAt: '2026-08-01T00:00:00.000Z' },
      ],
      jobs: [],
    } as unknown as WorkflowState
    buildApi({ getState: vi.fn(async () => state) })

    render(createElement(ProfilePage))

    expect(await screen.findByText('检测到「后端开发」存在 2 个版本，请选择正确版本')).not.toBeNull()
    expect(screen.getByText('负责订单服务的开发')).not.toBeNull()
    expect(screen.getByText('负责订单服务的重构')).not.toBeNull()
    expect(screen.queryByText('两条描述指向同一职责但细节冲突')).toBeNull()
  })

  it('normalizes equivalent English and Chinese fact labels in the conflict title', async () => {
    const state = {
      factLibrary: [
        { id: 'fact-1', category: '基本信息', label: 'personal information', value: '19 岁', sourceType: 'resume', sourceRef: 'resume_text', status: 'confirmed', confidence: 0.9 },
        { id: 'fact-2', category: '基本信息', label: '个人信息', value: '20 岁', sourceType: 'resume', sourceRef: 'resume_text', status: 'confirmed', confidence: 0.9 },
      ],
      factConflicts: [
        { id: 'conflict-1', factIds: ['fact-1', 'fact-2'], rationale: '年龄冲突', detectedAt: '2026-08-01T00:00:00.000Z' },
      ],
      jobs: [],
    } as unknown as WorkflowState
    buildApi({ getState: vi.fn(async () => state) })

    render(createElement(ProfilePage))

    expect(await screen.findByText('检测到「个人信息」存在 2 个版本，请选择正确版本')).not.toBeNull()
    expect(screen.queryByText(/personal information、个人信息/)).toBeNull()
  })

  it('calls dismissFactConflict and refreshes state when the user clicks the dismiss action', async () => {
    const state = {
      factLibrary: [
        { id: 'fact-1', category: '工作经历', label: '后端开发', value: '负责订单服务的开发', sourceType: 'resume', sourceRef: 'resume_text', status: 'confirmed', confidence: 0.9 },
        { id: 'fact-2', category: '工作经历', label: '后端开发', value: '负责订单服务的重构', sourceType: 'resume', sourceRef: 'resume_text', status: 'confirmed', confidence: 0.9 },
      ],
      factConflicts: [
        { id: 'conflict-1', factIds: ['fact-1', 'fact-2'], rationale: '两条描述指向同一职责但细节冲突', detectedAt: '2026-08-01T00:00:00.000Z' },
      ],
      jobs: [],
    } as unknown as WorkflowState
    const clearedState = { ...state, factConflicts: [] } as unknown as WorkflowState
    const getState = vi.fn()
      .mockResolvedValueOnce(state)
      .mockResolvedValue(clearedState)
    const dismissFactConflict = vi.fn(async () => undefined)
    buildApi({ getState, dismissFactConflict })

    render(createElement(ProfilePage))

    fireEvent.click(await screen.findByRole('button', { name: '暂时忽略' }))

    await waitFor(() => expect(dismissFactConflict).toHaveBeenCalledWith('conflict-1'))
    expect(getState).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.queryByText('检测到「后端开发」存在 2 个版本，请选择正确版本')).toBeNull())
  })
})

describe('ProfilePage manual facts', () => {
  it('uses associated labels, blocks empty submission, and refreshes after adding', async () => {
    const state = {
      factLibrary: [{ id: 'fact-1', category: '技能', label: 'React', value: '熟悉 React', sourceType: 'resume', sourceRef: 'resume_text', status: 'unconfirmed', confidence: 0.9 }],
      jobs: [],
    } as unknown as WorkflowState
    const addManualFact = vi.fn(async () => undefined)
    const getState = vi.fn(async () => state)
    buildApi({ getState, addManualFact })

    render(createElement(ProfilePage))
    fireEvent.click(await screen.findByRole('button', { name: /手动添加事实/ }))

    const content = screen.getByLabelText('事实内容') as HTMLTextAreaElement
    const category = screen.getByLabelText('类别') as HTMLSelectElement
    const submit = screen.getByRole('button', { name: '添加' }) as HTMLButtonElement
    expect(content.placeholder).toContain('主导过日活百万级产品')
    expect(category.value).toBe('技能')
    expect(submit.disabled).toBe(true)

    fireEvent.change(content, { target: { value: '主导过日活百万级产品的性能优化' } })
    fireEvent.click(submit)

    await waitFor(() => expect(addManualFact).toHaveBeenCalledWith({ content: '主导过日活百万级产品的性能优化', category: '技能' }))
    expect(getState).toHaveBeenCalledTimes(2)
    expect((await screen.findByRole('status')).textContent).toContain('事实已添加并标记为已确认')
    expect(screen.queryByLabelText('事实内容')).toBeNull()
  })

  it('falls back to the established default category set', async () => {
    buildApi()
    render(createElement(ProfilePage))

    fireEvent.click(await screen.findByRole('button', { name: /手动添加事实/ }))

    expect(screen.getByRole('option', { name: '工作经历' })).not.toBeNull()
    expect(screen.getByRole('option', { name: '技能' })).not.toBeNull()
    expect(screen.getByRole('option', { name: '教育' })).not.toBeNull()
    expect(screen.getByRole('option', { name: '偏好' })).not.toBeNull()
  })
})
