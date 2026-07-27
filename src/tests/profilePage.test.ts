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
import type { WorkflowApi, WorkflowState } from '../WorkflowPage'

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
    extractPdfResume.mockResolvedValue({ kind: 'text', resumeText: '张三\n产品经理\n负责招聘平台项目。' })

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
    extractPdfResume.mockResolvedValue({ kind: 'text', resumeText: '张三\n产品经理' })

    render(createElement(ProfilePage))
    await selectResumeFile(new File(['%PDF'], 'resume.pdf', { type: 'application/pdf' }))
    await screen.findByText((_, element) => element?.textContent === '已选择文件：resume.pdf')

    fireEvent.click(screen.getByRole('button', { name: '解析简历' }))

    await waitFor(() => expect(api.ingestResume).toHaveBeenCalledWith({ kind: 'text', resumeText: '张三\n产品经理' }))
  })

  it('clears the selected-file indicator once the user types into the textarea', async () => {
    buildApi()
    isPdfFile.mockReturnValue(true)
    extractPdfResume.mockResolvedValue({ kind: 'text', resumeText: '张三' })

    render(createElement(ProfilePage))
    await selectResumeFile(new File(['%PDF'], 'resume.pdf', { type: 'application/pdf' }))
    await screen.findByText((_, element) => element?.textContent === '已选择文件：resume.pdf')

    fireEvent.change(screen.getByPlaceholderText('粘贴简历文本'), { target: { value: '手动粘贴的文字' } })
    expect(screen.queryByText((_, element) => element?.textContent === '已选择文件：resume.pdf')).toBeNull()
  })
})

describe('ProfilePage manual fact entry', () => {
  it('is enabled (not the disabled "即将开放" placeholder) and calls addManualFact on submit', async () => {
    const api = buildApi({ addManualFact: vi.fn(async () => undefined) })

    render(createElement(ProfilePage))

    expect(screen.queryByText('即将开放')).toBeNull()

    fireEvent.change(screen.getByPlaceholderText('事实内容'), { target: { value: '熟悉 TypeScript' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => expect(api.addManualFact).toHaveBeenCalledWith({ content: '熟悉 TypeScript', category: 'skill' }))
  })

  it('disables the submit button while the content input is empty', async () => {
    buildApi({ addManualFact: vi.fn(async () => undefined) })

    render(createElement(ProfilePage))

    expect((screen.getByRole('button', { name: '添加' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
