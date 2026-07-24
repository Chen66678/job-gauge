declare module 'pdfjs-dist/build/pdf.mjs' {
  export interface PdfTextItem {
    str: string
    hasEOL: boolean
  }

  export interface PdfPageProxy {
    getTextContent(): Promise<{ items: Array<PdfTextItem | Record<string, unknown>> }>
    getViewport(input: { scale: number }): { width: number; height: number }
    render(input: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<void> }
  }

  export interface PdfDocumentProxy {
    numPages: number
    getPage(pageNumber: number): Promise<PdfPageProxy>
  }

  export interface PdfDocumentLoadingTask {
    promise: Promise<PdfDocumentProxy>
    destroy(): Promise<void>
  }

  export const GlobalWorkerOptions: { workerSrc: string }
  export function getDocument(input: { data: Uint8Array }): PdfDocumentLoadingTask
}

declare module 'pdfjs-dist/build/pdf.worker.mjs?url' {
  const workerUrl: string
  export default workerUrl
}
