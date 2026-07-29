// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { extractPdfResume, isPdfFile } = vi.hoisted(() => ({
  extractPdfResume: vi.fn(),
  isPdfFile: vi.fn(),
}))

vi.mock('../domain/pdfResume', () => ({ extractPdfResume, isPdfFile }))

import {
  default as WorkflowPage,
  prepareScoringAfterConfirmation,
  reevaluateForWorkflow,
  submitJobFollowUpsForWorkflow,
  type FollowUpQuestion,
  type WorkflowApi,
  type WorkflowJob,
  type WorkflowState,
} from '../WorkflowPage'
import type { FactStatus, ProfileFact } from '../types'

afterEach(() => {
  cleanup()
  extractPdfResume.mockReset()
  isPdfFile.mockReset()
})

function buildFact(id: string, status: FactStatus = 'unconfirmed'): ProfileFact {
  return {
    id,
    category: 'skill',
    label: 'React',
    value: '负责 React 项目',
    sourceType: 'user_answer',
    sourceRef: '岗位追问',
    status,
    confidence: 0.9,
  }
}

function buildJob(overrides: Partial<WorkflowJob> = {}): WorkflowJob {
  return {
    job: {
      id: 'job-new',
      title: '前端工程师',
      company: '样例科技',
      city: '上海',
      requirements: [
        { id: 'req-react', kind: 'skill', label: 'React 工程化经验', evidence: '', requiredFactIds: [], weight: 1 },
      ],
    },
    evaluation: {
      vetoed: false,
      score: { total: 60, strategyLabel: '观望', strategy: 'review', gaps: [], risks: [] },
    },
    evaluationError: null,
    followUps: [],
    material: null,
    ...overrides,
  }
}

function createStatefulApi(initialState: WorkflowState) {
  let state = structuredClone(initialState)
  const reevaluateJob = vi.fn(async (jobId: string) => {
    const pendingFacts = state.factLibrary.filter(fact => fact.status === 'unconfirmed')
    if (pendingFacts.length > 0) throw new Error('重评发生在事实确认之前')
    return state.jobs.find(record => record.job.id === jobId) ?? null
  })
  const api = {
    getState: vi.fn(async () => structuredClone(state)),
    applyFollowUpAnswers: vi.fn(async () => {
      const fact = buildFact('follow-up-fact', 'confirmed')
      state.factLibrary.push(fact)
      return [fact]
    }),
    setFactStatus: vi.fn(async (factId: string, status: FactStatus) => {
      state.factLibrary = state.factLibrary.map(fact => fact.id === factId ? { ...fact, status } : fact)
    }),
    setFactStatusBatch: vi.fn(async (updates: { factId: string; status: FactStatus }[]) => {
      const statusById = new Map(updates.map(update => [update.factId, update.status]))
      state.factLibrary = state.factLibrary.map(fact => ({ ...fact, status: statusById.get(fact.id) ?? fact.status }))
    }),
    reevaluateJob,
  } as unknown as WorkflowApi
  return { api, reevaluateJob, getState: () => state }
}

const questions: FollowUpQuestion[] = [
  { id: 'question-1', requirementId: 'req-react', kind: 'explore', question: '请补充项目经历', rationale: '评分缺少证据' },
]

describe('WorkflowPage state machine', () => {
  function createResumeUploadApi() {
    return {
      getState: vi.fn(async () => ({ factLibrary: [], jobs: [buildJob()] })),
      ingestResume: vi.fn(async () => []),
      buildResumeFollowUps: vi.fn(async () => []),
    } as unknown as WorkflowApi
  }

  async function selectResumeFile(file: File) {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
  }

  it('sends PDF text-layer content through the existing text ingestion path', async () => {
    const api = createResumeUploadApi()
    window.coreApi = api as unknown as typeof window.coreApi
    isPdfFile.mockReturnValue(true)
    extractPdfResume.mockResolvedValue('张三\n产品经理\n负责招聘平台项目。')

    render(createElement(WorkflowPage, { selectedJobId: 'job-new' }))
    await selectResumeFile(new File(['%PDF'], 'resume.pdf', { type: 'application/pdf' }))
    await screen.findByText((_, element) => element?.textContent === '✓ 已选择文件：resume.pdf')
    expect((screen.getByPlaceholderText('粘贴简历文本') as HTMLTextAreaElement).value).toBe('')
    expect(screen.queryByText('张三')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))

    await waitFor(() => expect(api.ingestResume).toHaveBeenCalledWith({
      kind: 'text',
      resumeText: '张三\n产品经理\n负责招聘平台项目。',
    }))
  })

  it('[D025] 无文字层 PDF 明确报错给用户，不静默失败、不再走图片识别路径', async () => {
    const api = createResumeUploadApi()
    window.coreApi = api as unknown as typeof window.coreApi
    isPdfFile.mockReturnValue(true)
    extractPdfResume.mockRejectedValue(new Error('这份 PDF 没有文字层（可能是扫描件或图片型 PDF），请上传带文字的版本，或直接在"我的资料"里手动录入。'))

    render(createElement(WorkflowPage, { selectedJobId: 'job-new' }))
    await selectResumeFile(new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' }))
    await waitFor(() => expect(extractPdfResume).toHaveBeenCalledOnce())

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('没有文字层'))
    expect(api.ingestResume).not.toHaveBeenCalled()
  })

  it('[D026] job follow-up facts are auto-confirmed and route directly to GENERATE without CONFIRM_FACTS', async () => {
    const { api, reevaluateJob, getState } = createStatefulApi({ factLibrary: [], jobs: [buildJob()] })

    const submission = await submitJobFollowUpsForWorkflow({
      api,
      jobId: 'job-new',
      questions,
      answers: { 'question-1': '我负责过 React 项目' },
    })

    expect(submission.hadNewFacts).toBe(true)
    expect(getState().factLibrary[0]?.status).toBe('confirmed')
    expect(reevaluateJob).not.toHaveBeenCalled()

    await reevaluateForWorkflow(api, 'job-new')
    expect(reevaluateJob).toHaveBeenCalledOnce()
    expect(reevaluateJob).toHaveBeenCalledWith('job-new')
  })

  it('exposes a failed re-evaluation warning and retries the same job without replacing its score', async () => {
    const previousEvaluation = buildJob().evaluation
    const failedJob = buildJob({ evaluation: previousEvaluation, evaluationError: '模型服务无响应' })
    let state: WorkflowState = { factLibrary: [], jobs: [buildJob()] }
    const reevaluateJob = vi.fn(async (jobId: string) => {
      state = { ...state, jobs: [{ ...failedJob, job: { ...failedJob.job, id: jobId } }] }
      return state.jobs[0]
    })
    const api = {
      getState: vi.fn(async () => structuredClone(state)),
      ingestResume: vi.fn(async () => []),
      buildResumeFollowUps: vi.fn(async () => []),
      reevaluateJob,
    } as unknown as WorkflowApi
    window.coreApi = api as unknown as typeof window.coreApi

    render(createElement(WorkflowPage, { selectedJobId: 'job-new' }))
    fireEvent.change(screen.getByPlaceholderText('粘贴简历文本'), { target: { value: '简历内容' } })
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByRole('heading', { name: '简历追问' })
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))

    await screen.findByRole('heading', { name: '岗位评分' })
    expect(screen.getByRole('alert').textContent).toContain('重评失败，当前展示的是上一次的分数：模型服务无响应')
    expect(screen.getByText('60').closest('p')?.textContent).toContain('评分：60 — 观望')

    fireEvent.click(screen.getByRole('button', { name: '重试重评' }))
    await waitFor(() => expect(reevaluateJob).toHaveBeenCalledTimes(2))
    expect(reevaluateJob).toHaveBeenLastCalledWith('job-new')
  })

  it('[D026] job follow-up submission with new facts triggers reevaluation before reaching GENERATE', async () => {
    const state: WorkflowState = { factLibrary: [], jobs: [buildJob({ evaluation: null })] }
    const reevaluateJob = vi.fn(async (jobId: string) => state.jobs.find(record => record.job.id === jobId) ?? null)
    const evaluateJobFromJd = vi.fn(async () => {
      const scored = buildJob()
      state.jobs = [scored]
      return scored
    })
    const applyFollowUpAnswers = vi.fn(async () => {
      const fact = buildFact('job-follow-up-fact', 'confirmed')
      state.factLibrary.push(fact)
      return [fact]
    })
    const api = {
      getState: vi.fn(async () => structuredClone(state)),
      ingestResume: vi.fn(async () => []),
      buildResumeFollowUps: vi.fn(async () => []),
      evaluateJobFromJd,
      buildFollowUps: vi.fn(async () => questions),
      applyFollowUpAnswers,
      reevaluateJob,
    } as unknown as WorkflowApi
    window.coreApi = api as unknown as typeof window.coreApi

    render(createElement(WorkflowPage, { selectedJobId: 'job-new' }))
    fireEvent.change(screen.getByPlaceholderText('粘贴简历文本'), { target: { value: '简历内容' } })
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByRole('heading', { name: '简历追问' })
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByRole('heading', { name: '岗位评分' })
    fireEvent.change(screen.getByPlaceholderText('粘贴岗位描述'), { target: { value: '岗位 JD' } })
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByRole('complementary', { name: '岗位补充信息' })
    await screen.findByText('针对要求：React 工程化经验')
    await screen.findByText('探索')
    fireEvent.change(screen.getByPlaceholderText('如实填写；不确定可以留空'), { target: { value: '补充说明' } })
    fireEvent.click(screen.getByRole('button', { name: '提交全部' }))
    await screen.findByRole('heading', { name: '提交成功' })
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    await waitFor(() => expect(reevaluateJob).toHaveBeenCalledOnce())
    expect(reevaluateJob).toHaveBeenCalledWith('job-new')
    await screen.findByRole('heading', { name: '生成材料' })
  })

  it('keeps the newly selected job active when an older scoring request resolves', async () => {
    let resolveEvaluation!: (job: WorkflowJob) => void
    const evaluationPromise = new Promise<WorkflowJob>(resolve => {
      resolveEvaluation = resolve
    })
    const jobA = buildJob({
      job: { id: 'job-a', title: '岗位 A', company: '公司 A', city: '上海' },
      evaluation: null,
    })
    const jobB = buildJob({
      job: { id: 'job-b', title: '岗位 B', company: '公司 B', city: '北京' },
      evaluation: {
        vetoed: false,
        score: { total: 88, strategyLabel: '推荐', strategy: 'apply', gaps: [], risks: [] },
      },
    })
    const state: WorkflowState = { factLibrary: [], jobs: [jobA, jobB] }
    const evaluateJobFromJd = vi.fn(() => evaluationPromise)
    const api = {
      getState: vi.fn(async () => structuredClone(state)),
      ingestResume: vi.fn(async () => []),
      buildResumeFollowUps: vi.fn(async () => []),
      evaluateJobFromJd,
      buildFollowUps: vi.fn(async () => questions),
    } as unknown as WorkflowApi
    window.coreApi = api as unknown as typeof window.coreApi

    const view = render(createElement(WorkflowPage, { selectedJobId: 'job-a' }))
    fireEvent.change(screen.getByPlaceholderText('粘贴简历文本'), { target: { value: '简历内容' } })
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByRole('heading', { name: '简历追问' })
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByRole('heading', { name: '岗位评分' })

    fireEvent.change(screen.getByPlaceholderText('粘贴岗位描述'), { target: { value: '岗位 A 的 JD' } })
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    await waitFor(() => expect(evaluateJobFromJd).toHaveBeenCalledOnce())

    view.rerender(createElement(WorkflowPage, { selectedJobId: 'job-b' }))
    await waitFor(() => expect(screen.getByText('88').closest('p')?.textContent).toContain('评分：88 — 推荐'))

    resolveEvaluation({ ...jobA, evaluation: buildJob().evaluation })

    await waitFor(() => expect(screen.queryByRole('complementary', { name: '岗位补充信息' })).toBeNull())
    expect(screen.getByRole('heading', { name: '岗位评分' })).not.toBeNull()
    expect(screen.getByText('88').closest('p')?.textContent).toContain('评分：88 — 推荐')
    expect(api.buildFollowUps).not.toHaveBeenCalled()
  })

  it('does not re-evaluate when confirmation leads to an unscored job form', async () => {
    const reevaluateJob = vi.fn()
    const api = { reevaluateJob } as unknown as WorkflowApi

    await prepareScoringAfterConfirmation({ api, jobId: 'job-new', hasExistingEvaluation: false })

    expect(reevaluateJob).not.toHaveBeenCalled()
  })
})
