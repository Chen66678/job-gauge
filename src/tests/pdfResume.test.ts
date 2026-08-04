// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

const { getDocument, destroy } = vi.hoisted(() => ({
  getDocument: vi.fn(),
  destroy: vi.fn(async () => undefined),
}))

vi.mock('pdfjs-dist/build/pdf.mjs', () => ({
  getDocument,
  GlobalWorkerOptions: {},
}))

import { PdfTextLayerMissingError, extractPdfResume, hasUsablePdfText, normalizePdfText } from '../domain/pdfResume'

function createPdfFile(): File {
  return {
    arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
  } as unknown as File
}

function createPage(items: Array<{ str: string; hasEOL?: boolean }>) {
  return {
    getTextContent: vi.fn(async () => ({ items })),
    getViewport: vi.fn(() => ({ width: 600, height: 800 })),
    render: vi.fn(() => ({ promise: Promise.resolve() })),
  }
}

afterEach(() => {
  getDocument.mockReset()
  destroy.mockClear()
  vi.restoreAllMocks()
})

describe('pdfResume', () => {
  it('normalizes text and requires at least 40 letter or number characters for a usable text layer', () => {
    expect(normalizePdfText('  产品经理\t\t\n\n\n负责平台  ')).toBe('产品经理\n\n负责平台')
    expect(hasUsablePdfText('联系方式：13800138000')).toBe(false)
    expect(hasUsablePdfText('产品经理负责招聘平台的用户增长、需求分析、跨团队协作和数据复盘，持续优化核心转化链路，并制定实验方案推动投递转化与运营效率提升。')).toBe(true)
  })

  it('expands all PDF ligature code points without introducing spaces', () => {
    expect(normalizePdfText('oﬀer ofﬁce Workﬂow eﬃcient baﬄe ﬅate ﬆop')).toBe(
      'offer office Workflow efficient baffle state stop',
    )
  })

  it('extracts a real text layer as clean text without rendering PDF pages', async () => {
    const page = createPage([
      { str: '张三', hasEOL: true },
      { str: '产品经理', hasEOL: true },
      { str: '负责招聘平台的用户增长、需求分析、跨团队协作和数据复盘，持续优化核心转化链路，并制定实验方案推动投递转化与运营效率提升。', hasEOL: true },
    ])
    getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: vi.fn(async () => page) }),
      destroy,
    })

    await expect(extractPdfResume(createPdfFile())).resolves.toBe(
      '张三\n产品经理\n负责招聘平台的用户增长、需求分析、跨团队协作和数据复盘，持续优化核心转化链路，并制定实验方案推动投递转化与运营效率提升。',
    )
    expect(page.render).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('[D025] 无文字层 PDF（扫描件/图片型）明确抛错，不静默失败、不降级成图片识别', async () => {
    const page = createPage([])
    getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: vi.fn(async () => page) }),
      destroy,
    })

    await expect(extractPdfResume(createPdfFile())).rejects.toBeInstanceOf(PdfTextLayerMissingError)
    await expect(extractPdfResume(createPdfFile())).rejects.toThrow('没有文字层')
    expect(page.render).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledTimes(2)
  })
})
