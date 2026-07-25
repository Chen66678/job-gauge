// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { extractPdfResume, isPdfFile } = vi.hoisted(() => ({
  extractPdfResume: vi.fn(),
  isPdfFile: vi.fn(),
}))

vi.mock('../domain/pdfResume', () => ({ extractPdfResume, isPdfFile }))

import OnboardingPage from '../OnboardingPage'
import type { CoreState } from '../domain/coreState'
import type { WorkflowApi } from '../WorkflowPage'

afterEach(() => {
  cleanup()
  extractPdfResume.mockReset()
  isPdfFile.mockReset()
  localStorage.clear()
})

function buildApi(overrides: Partial<WorkflowApi> = {}) {
  const state = { factLibrary: [], jobs: [] } as unknown as CoreState
  const api = {
    getState: vi.fn(async () => state),
    ingestResume: vi.fn(async () => []),
    ...overrides,
  } as unknown as WorkflowApi
  window.coreApi = api as unknown as typeof window.coreApi
  return api
}

async function selectResumeFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
}

async function advanceToStep2() {
  fireEvent.change(screen.getByPlaceholderText('输入模型服务 Key'), { target: { value: 'sk-valid' } })
  fireEvent.click(screen.getByRole('button', { name: '验证并继续' }))
  await screen.findByRole('heading', { name: '上传简历', level: 1 }, { timeout: 3000 })
}

describe('OnboardingPage resume step', () => {
  it('does not echo extracted PDF text into the visible paste textarea', async () => {
    buildApi()
    isPdfFile.mockReturnValue(true)
    extractPdfResume.mockResolvedValue({ kind: 'text', resumeText: '张三\n产品经理\n负责招聘平台项目。' })

    render(createElement(OnboardingPage, { onFinished: vi.fn(), onOpenJobs: vi.fn() }))
    await advanceToStep2()
    await selectResumeFile(new File(['%PDF'], 'resume.pdf', { type: 'application/pdf' }))

    await screen.findByText((_, element) => element?.textContent === '✓ 已选择文件：resume.pdf')
    const textarea = screen.getByPlaceholderText('也可以粘贴简历文本') as HTMLTextAreaElement
    expect(textarea.value).toBe('')
    expect(screen.queryByText('张三')).toBeNull()
  })

  it('still sends the extracted text to ingestResume on submit', async () => {
    const api = buildApi()
    isPdfFile.mockReturnValue(true)
    extractPdfResume.mockResolvedValue({ kind: 'text', resumeText: '张三\n产品经理' })

    render(createElement(OnboardingPage, { onFinished: vi.fn(), onOpenJobs: vi.fn() }))
    await advanceToStep2()
    await selectResumeFile(new File(['%PDF'], 'resume.pdf', { type: 'application/pdf' }))
    await screen.findByText((_, element) => element?.textContent === '✓ 已选择文件：resume.pdf')

    fireEvent.click(screen.getByRole('button', { name: '解析简历' }))

    await waitFor(() => expect(api.ingestResume).toHaveBeenCalledWith({ kind: 'text', resumeText: '张三\n产品经理' }))
  })
})
