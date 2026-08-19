// @vitest-environment jsdom

import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { extractPdfResume, isPdfFile } = vi.hoisted(() => ({
  extractPdfResume: vi.fn(),
  isPdfFile: vi.fn(),
}))

vi.mock('../domain/pdfResume', () => ({ extractPdfResume, isPdfFile }))

import OnboardingPage from '../OnboardingPage'
import type { CoreState } from '../domain/coreState'
import type { WorkflowApi } from '../workflowApi'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  extractPdfResume.mockReset()
  isPdfFile.mockReset()
  localStorage.clear()
})

function buildApi(overrides: Partial<WorkflowApi> = {}) {
  const state = { factLibrary: [], jobs: [] } as unknown as CoreState
  const api = {
    getState: vi.fn(async () => state),
    onStateChanged: vi.fn(() => () => {}),
    ingestResume: vi.fn(async () => []),
    saveAndVerifyByokKey: vi.fn(async () => ({ ok: true as const, configured: true, source: 'keychain' as const })),
    getByokKeyStatus: vi.fn(async () => ({ configured: false, source: 'none' as const })),
    clearByokKey: vi.fn(async () => ({ ok: true as const, configured: false, source: 'none' as const })),
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
  await screen.findByRole('heading', { name: '上传简历', level: 1 }, { timeout: 5000 })
}

describe('OnboardingPage resume step', () => {
  it('renders the five-step progress without the removed fact-confirmation step', () => {
    buildApi()

    render(createElement(OnboardingPage, { onFinished: vi.fn(), onOpenJobs: vi.fn() }))

    const progress = screen.getByRole('banner', { name: '安装引导进度' })
    expect(progress.querySelectorAll('.progress-step')).toHaveLength(5)
    expect(progress.textContent).toContain('配 Key')
    expect(progress.textContent).toContain('传简历')
    expect(progress.textContent).toContain('设偏好')
    expect(progress.textContent).toContain('装插件')
    expect(progress.textContent).toContain('导入岗位')
    expect(progress.textContent).not.toContain('确认事实')
  })

  it('does not echo extracted PDF text after selecting a file', async () => {
    buildApi()
    isPdfFile.mockReturnValue(true)
    extractPdfResume.mockResolvedValue('张三\n产品经理\n负责招聘平台项目。')

    render(createElement(OnboardingPage, { onFinished: vi.fn(), onOpenJobs: vi.fn() }))
    await advanceToStep2()
    await selectResumeFile(new File(['%PDF'], 'resume.pdf', { type: 'application/pdf' }))

    await screen.findByText((_, element) => element?.textContent === '✓ 已选择文件：resume.pdf')
    expect(screen.queryByPlaceholderText('也可以粘贴简历文本')).toBeNull()
    expect(screen.queryByText('张三')).toBeNull()
  })

  it('still sends the extracted text to ingestResume on submit', async () => {
    const api = buildApi()
    isPdfFile.mockReturnValue(true)
    extractPdfResume.mockResolvedValue('张三\n产品经理')

    render(createElement(OnboardingPage, { onFinished: vi.fn(), onOpenJobs: vi.fn() }))
    await advanceToStep2()
    await selectResumeFile(new File(['%PDF'], 'resume.pdf', { type: 'application/pdf' }))
    await screen.findByText((_, element) => element?.textContent === '✓ 已选择文件：resume.pdf')

    fireEvent.click(screen.getByRole('button', { name: '解析简历' }))

    await waitFor(() => expect(api.ingestResume).toHaveBeenCalledWith({ kind: 'text', resumeText: '张三\n产品经理' }))
  })

  it('shows slow-model guidance and stops the elapsed timer after parsing', async () => {
    let resolveIngest: ((facts: never[]) => void) | undefined
    buildApi({
      ingestResume: vi.fn(() => new Promise<never[]>(resolve => { resolveIngest = resolve })),
    })

    render(createElement(OnboardingPage, { onFinished: vi.fn(), onOpenJobs: vi.fn() }))
    await advanceToStep2()
    await selectResumeFile(new File(['张三'], 'resume.txt', { type: 'text/plain' }))
    await screen.findByText((_, element) => element?.textContent === '✓ 已选择文件：resume.txt')
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: '解析简历' }))
    expect(screen.getByText(/模型响应较慢，可能需要几分钟/)).not.toBeNull()
    expect(screen.getByText(/已等待 0 秒/)).not.toBeNull()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(screen.getByText(/已等待 2 秒/)).not.toBeNull()

    await act(async () => { resolveIngest?.([]) })
    expect(screen.queryByText(/模型响应较慢，可能需要几分钟/)).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses the real saveAndVerifyByokKey IPC result instead of the old fake key==="invalid" check', async () => {
    const api = buildApi({
      saveAndVerifyByokKey: vi.fn(async (request: { apiKey: string }) => {
        // 旧假验证只认字符串 'invalid'；这里故意传一个旧逻辑会判定为"有效"的
        // 值，但让真实 IPC mock 判定失败，证明界面现在真的依赖 IPC 返回值。
        expect(request.apiKey).toBe('sk-should-fail')
        return { ok: false as const, code: 'auth_failed' as const, message: 'API Key 无效或无权访问模型，请检查后重试。' }
      }),
    })

    render(createElement(OnboardingPage, { onFinished: vi.fn(), onOpenJobs: vi.fn() }))
    fireEvent.change(screen.getByPlaceholderText('输入模型服务 Key'), { target: { value: 'sk-should-fail' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并继续' }))

    await screen.findByText('API Key 无效或无权访问模型，请检查后重试。')
    expect(screen.queryByRole('heading', { name: '上传简历', level: 1 })).toBeNull()
    expect(api.saveAndVerifyByokKey).toHaveBeenCalledWith({ apiKey: 'sk-should-fail' })
  })

  it('advances to step 2 only after saveAndVerifyByokKey resolves ok', async () => {
    buildApi({
      saveAndVerifyByokKey: vi.fn(async () => ({ ok: true as const, configured: true, source: 'keychain' as const })),
    })

    render(createElement(OnboardingPage, { onFinished: vi.fn(), onOpenJobs: vi.fn() }))
    fireEvent.change(screen.getByPlaceholderText('输入模型服务 Key'), { target: { value: 'sk-real-valid-key' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并继续' }))

    await screen.findByRole('heading', { name: '上传简历', level: 1 }, { timeout: 5000 })
  })

  it('shows the real error instead of a hardcoded format-error banner when the model key is missing', async () => {
    const api = buildApi({
      ingestResume: vi.fn(async () => ({ error: '未配置模型 API key，暂时无法执行需要模型的操作。' })),
    })
    isPdfFile.mockReturnValue(true)
    extractPdfResume.mockResolvedValue('张三\n产品经理')

    render(createElement(OnboardingPage, { onFinished: vi.fn(), onOpenJobs: vi.fn() }))
    await advanceToStep2()
    await selectResumeFile(new File(['%PDF'], 'resume.pdf', { type: 'application/pdf' }))
    await screen.findByText((_, element) => element?.textContent === '✓ 已选择文件：resume.pdf')

    fireEvent.click(screen.getByRole('button', { name: '解析简历' }))

    await screen.findByText((_, element) => element?.textContent === '操作失败：未配置模型 API key，暂时无法执行需要模型的操作。')
    expect(screen.queryByText('解析失败：文件格式无法识别或内容为空，请重新上传')).toBeNull()
    void api
  })
})

describe('OnboardingPage job import step', () => {
  it('shows success when state changes include a new job', async () => {
    let stateChangedListener: ((state: CoreState) => void) | undefined
    const api = buildApi({
      onStateChanged: vi.fn(listener => {
        stateChangedListener = listener as (state: CoreState) => void
        return () => {}
      }),
    })

    render(createElement(OnboardingPage, { onFinished: vi.fn(), onOpenJobs: vi.fn() }))
    await advanceToStep2()

    isPdfFile.mockReturnValue(false)
    await selectResumeFile(new File(['张三'], 'resume.txt', { type: 'text/plain' }))
    await screen.findByText((_, element) => element?.textContent === '✓ 已选择文件：resume.txt')
    fireEvent.click(screen.getByRole('button', { name: '解析简历' }))
    await waitFor(() => expect(api.ingestResume).toHaveBeenCalledWith({ kind: 'text', resumeText: '张三' }))
    await screen.findByRole('button', { name: '下一步：设置偏好 →' }, { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: '下一步：设置偏好 →' }))
    fireEvent.click(screen.getByRole('button', { name: '跳过，使用默认' }))
    await screen.findByRole('heading', { name: '安装浏览器插件', level: 1 })
    expect(screen.getByText('当前请在浏览器扩展管理页打开开发者模式并加载插件；后续会在这里提供商店链接。')).not.toBeNull()
    expect(screen.getByText('回到应用的「设置」，从只读 token 框复制 token。')).not.toBeNull()
    expect(screen.queryByText(/自动检测|授权|预览发送失败/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '下一步：导入岗位 →' }))
    await screen.findByRole('heading', { name: '导入第一个岗位', level: 1 }, { timeout: 3000 })
    await waitFor(() => expect(api.onStateChanged).toHaveBeenCalledOnce())

    stateChangedListener?.({
      factLibrary: [],
      jobs: [{ evaluation: { vetoed: false, score: {} }, evaluationError: null }]
    } as unknown as CoreState)

    await screen.findByRole('heading', { name: '第一个岗位已评估完成！', level: 2 })
  }, 10000)
})
