import { getDocument, GlobalWorkerOptions, type PdfDocumentProxy } from 'pdfjs-dist/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

const MINIMUM_TEXT_LAYER_CHARACTERS = 40
const RENDER_SCALE = 1.5
const MAX_RENDER_WIDTH = 1600
const MAX_RENDER_HEIGHT = 12000
const PAGE_GAP = 24

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export type PdfResumeExtraction =
  | { kind: 'text'; resumeText: string }
  | { kind: 'image'; imageBase64: string; mimeType: 'image/png' }

export function isPdfFile(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

export function normalizePdfText(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/[\t\f\v ]+\n/g, '\n')
    .replace(/\n[\t\f\v ]+/g, '\n')
    .replace(/[\t\f\v ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function hasUsablePdfText(text: string): boolean {
  const meaningfulCharacterCount = Array.from(text).filter(character => /[\p{L}\p{N}]/u.test(character)).length
  return meaningfulCharacterCount >= MINIMUM_TEXT_LAYER_CHARACTERS
}

export async function extractPdfResume(file: File): Promise<PdfResumeExtraction> {
  const data = new Uint8Array(await file.arrayBuffer())
  const loadingTask = getDocument({ data })

  try {
    const document = await loadingTask.promise
    const resumeText = await extractText(document)
    if (hasUsablePdfText(resumeText)) {
      return { kind: 'text', resumeText }
    }
    return {
      kind: 'image',
      imageBase64: await renderPdfToPngBase64(document),
      mimeType: 'image/png',
    }
  } finally {
    await loadingTask.destroy()
  }
}

async function extractText(pdfDocument: PdfDocumentProxy): Promise<string> {
  const pages: string[] = []
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber)
    const content = await page.getTextContent()
    let pageText = ''
    for (const item of content.items) {
      if (!('str' in item) || !item.str) continue
      pageText += item.str
      pageText += item.hasEOL ? '\n' : ' '
    }
    const normalized = normalizePdfText(pageText)
    if (normalized) pages.push(normalized)
  }
  return pages.join('\n\n')
}

async function renderPdfToPngBase64(pdfDocument: PdfDocumentProxy): Promise<string> {
  const renderedPages = [] as Array<{ canvas: HTMLCanvasElement; width: number; height: number }>
  let widestPage = 0
  let combinedHeight = 0

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber)
    const viewport = page.getViewport({ scale: RENDER_SCALE })
    const canvas = globalThis.document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前环境无法将扫描版 PDF 转为图片。')
    await page.render({ canvasContext: context, viewport }).promise
    renderedPages.push({ canvas, width: canvas.width, height: canvas.height })
    widestPage = Math.max(widestPage, canvas.width)
    combinedHeight += canvas.height
  }

  combinedHeight += PAGE_GAP * Math.max(renderedPages.length - 1, 0)
  const scale = Math.min(1, MAX_RENDER_WIDTH / widestPage, MAX_RENDER_HEIGHT / combinedHeight)
  const output = globalThis.document.createElement('canvas')
  output.width = Math.max(1, Math.floor(widestPage * scale))
  output.height = Math.max(1, Math.floor(combinedHeight * scale))
  const context = output.getContext('2d')
  if (!context) throw new Error('当前环境无法将扫描版 PDF 转为图片。')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, output.width, output.height)

  let offsetY = 0
  for (const page of renderedPages) {
    const renderedWidth = page.width * scale
    const renderedHeight = page.height * scale
    context.drawImage(page.canvas, (output.width - renderedWidth) / 2, offsetY, renderedWidth, renderedHeight)
    offsetY += renderedHeight + PAGE_GAP * scale
  }

  const [, base64 = ''] = output.toDataURL('image/png').split(',', 2)
  return base64
}
