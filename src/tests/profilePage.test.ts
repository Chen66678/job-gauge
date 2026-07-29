// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  extractPdfResume.mockReset()
  isPdfFile.mockReset()
})

function buildApi(overrides: Partial<WorkflowApi> = {}) {
  const state: WorkflowState = { factLibrary: [], jobs: [] } as unknown as WorkflowState
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
})
