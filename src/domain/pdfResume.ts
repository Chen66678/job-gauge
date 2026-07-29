import { getDocument, GlobalWorkerOptions, type PdfDocumentProxy } from 'pdfjs-dist/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

const MINIMUM_TEXT_LAYER_CHARACTERS = 40

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export class PdfTextLayerMissingError extends Error {
  constructor() {
    super('这份 PDF 没有文字层（可能是扫描件或图片型 PDF），请上传带文字的版本，或直接在"我的资料"里手动录入。')
    this.name = 'PdfTextLayerMissingError'
  }
}

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

export async function extractPdfResume(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer())
  const loadingTask = getDocument({ data })

  try {
    const document = await loadingTask.promise
    const resumeText = await extractText(document)
    if (!hasUsablePdfText(resumeText)) {
      throw new PdfTextLayerMissingError()
    }
    return resumeText
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

