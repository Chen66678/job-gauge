// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPdfFromJpeg, dataUrlToBytes } from '../CustomResumePage'
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import CustomResumePage from '../CustomResumePage'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// ── dataUrlToBytes ─────────────────────────────────────────────────────────

describe('dataUrlToBytes', () => {
  it('decodes a base64 data URL into the correct bytes', () => {
    const payload = 'hello-bytes'
    const dataUrl = 'data:image/jpeg;base64,' + window.btoa(payload)
    const result = dataUrlToBytes(dataUrl)
    expect(result).toBeInstanceOf(Uint8Array)
    const decoded = Array.from(result).map(b => String.fromCharCode(b)).join('')
    expect(decoded).toBe(payload)
  })

  it('throws on a string with no comma separator', () => {
    expect(() => dataUrlToBytes('not-a-data-url')).toThrow('简历图片数据无效，无法导出 PDF。')
  })

  it('throws when base64 segment is empty', () => {
    expect(() => dataUrlToBytes('data:image/jpeg;base64,')).toThrow('简历图片数据无效，无法导出 PDF。')
  })
})

// ── buildPdfFromJpeg ───────────────────────────────────────────────────────

describe('buildPdfFromJpeg', () => {
  function makeDataUrl(payload = 'fake-jpeg') {
    return 'data:image/jpeg;base64,' + window.btoa(payload)
  }

  it('returns a Blob with application/pdf MIME type', () => {
    const blob = buildPdfFromJpeg(makeDataUrl(), 100, 200)
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/pdf')
  })

  it('PDF content starts with %PDF-1.4', async () => {
    const blob = buildPdfFromJpeg(makeDataUrl(), 100, 200)
    const text = await blob.text()
    expect(text).toMatch(/^%PDF-1\.4/)
  })

  it('embeds correct image pixel dimensions in the Image XObject', async () => {
    const blob = buildPdfFromJpeg(makeDataUrl(), 120, 80)
    const text = await blob.text()
    expect(text).toContain('/Width 120')
    expect(text).toContain('/Height 80')
  })

  it('converts pixel dimensions to PDF points (72 dpi) in MediaBox', async () => {
    // 96px × 192px → 72pt × 144pt
    const blob = buildPdfFromJpeg(makeDataUrl(), 96, 192)
    const text = await blob.text()
    const ptW = (96 * 72) / 96
    const ptH = (192 * 72) / 96
    expect(text).toContain(`/MediaBox [0 0 ${ptW} ${ptH}]`)
  })

  it('includes the JPEG payload bytes inside the stream', async () => {
    const payload = 'unique-jpeg-payload'
    const blob = buildPdfFromJpeg(makeDataUrl(payload), 10, 10)
    const buffer = await blob.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    const payloadBytes = Array.from(new TextEncoder().encode(payload))
    // Find the payload bytes somewhere in the PDF body
    const asArray = Array.from(bytes)
    const found = asArray.some((_, i) =>
      payloadBytes.every((b, j) => asArray[i + j] === b)
    )
    expect(found).toBe(true)
  })

  it('ends with %%EOF', async () => {
    const blob = buildPdfFromJpeg(makeDataUrl(), 10, 10)
    const text = await blob.text()
    expect(text.trimEnd()).toMatch(/%%EOF$/)
  })
})

// ── CustomResumePage PDF export UI ─────────────────────────────────────────

function readyMaterial() {
  return {
    status: 'ready' as const,
    greeting: '您好',
    resumeLines: [{ text: '负责核心模块', factIds: ['fact-1'] }],
    usedFacts: [],
    blockedFacts: [],
    guardrailNotes: [],
  }
}

describe('CustomResumePage · PDF export', () => {
  it('downloads a .pdf file named 简历.pdf after rendering the resume image', async () => {
    const draftMaterial = vi.fn(async () => readyMaterial())
    const fakeJpegDataUrl = 'data:image/jpeg;base64,' + window.btoa('fake-jpeg')
    const renderResumeImage = vi.fn(async () => fakeJpegDataUrl)
    window.coreApi = { draftMaterial, renderResumeImage } as unknown as typeof window.coreApi

    // Mock Image: trigger onload synchronously when src is set
    const OrigImage = window.Image
    vi.stubGlobal('Image', class {
      naturalWidth = 100
      naturalHeight = 150
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_: string) { Promise.resolve().then(() => this.onload?.()) }
    })

    // Mock canvas context so drawImage + toDataURL work
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(fakeJpegDataUrl)

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:fake-pdf-url'),
      revokeObjectURL: vi.fn(),
    })
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    render(createElement(CustomResumePage, { jobId: 'job-pdf', onBack: vi.fn() }))
    await screen.findByText('已生成，可导出')

    fireEvent.click(screen.getByRole('button', { name: '导出 PDF' }))

    await waitFor(() => expect(renderResumeImage).toHaveBeenCalledWith('job-pdf'))
    await waitFor(() => expect(anchorClick).toHaveBeenCalledOnce())

    const link = anchorClick.mock.instances[0] as unknown as HTMLAnchorElement
    expect(link.download).toBe('简历.pdf')
    expect(link.href).toContain('blob:fake-pdf-url')

    vi.unstubAllGlobals()
  })

  it('shows an error and re-enables the button when renderResumeImage fails', async () => {
    const draftMaterial = vi.fn(async () => readyMaterial())
    const renderResumeImage = vi.fn(async () => { throw new Error('渲染失败') })
    window.coreApi = { draftMaterial, renderResumeImage } as unknown as typeof window.coreApi

    render(createElement(CustomResumePage, { jobId: 'job-pdf-err', onBack: vi.fn() }))
    await screen.findByText('已生成，可导出')

    fireEvent.click(screen.getByRole('button', { name: '导出 PDF' }))

    await waitFor(() => expect(screen.getByRole('alert')).not.toBeNull())
    expect(screen.getByText('渲染失败')).not.toBeNull()
    // Button re-enabled after error
    expect((screen.getByRole('button', { name: '导出 PDF' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('导出 PDF 按钮在 blocked 状态下禁用', async () => {
    window.coreApi = {
      draftMaterial: vi.fn(async () => ({
        status: 'blocked' as const,
        greeting: '',
        resumeLines: [],
        usedFacts: [],
        blockedFacts: [{ factId: 'f1', label: '缺失事实', value: '', source: 'manual' }],
        guardrailNotes: [],
      })),
    } as unknown as typeof window.coreApi

    render(createElement(CustomResumePage, { jobId: 'job-pdf-blocked', onBack: vi.fn() }))

    await screen.findByText('部分关键事实无法安全写入')
    expect((screen.getByRole('button', { name: '导出 PDF' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
