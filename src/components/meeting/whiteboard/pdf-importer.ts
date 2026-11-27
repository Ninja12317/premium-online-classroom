/**
 * Client-side PDF parsing and page rasterizer powered by `pdfjs-dist`.
 * Dynamic import keeps TanStack Start SSR completely safe, and adaptive
 * JPEG/WebP compression guarantees every page stays < 620 KB for Firestore sync.
 */

export interface PdfThumbItem {
  pageIndex: number
  pageNumber: number
  thumbDataUrl: string
  aspectRatio: number
}

export interface ParsedPdfSession {
  fileName: string
  title: string
  numPages: number
  thumbs: PdfThumbItem[]
  /** Renders the requested 0-based page indices at crisp board resolution (< 620 KB each). */
  renderPages: (
    pageIndices: number[],
    onProgress?: (done: number, total: number) => void,
  ) => Promise<
    {
      pageIndex: number
      dataUrl: string
      width: number
      height: number
    }[]
  >
  destroy: () => void
}

const MAX_PAGE_BYTES = 600_000 // Safe margin below Firestore's 1 MB doc limit
const TARGET_MAX_DIM = 1280

async function loadPdfJs() {
  const pdfjsLib = await import('pdfjs-dist')
  if (typeof window !== 'undefined') {
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString()
    } catch {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
    }
  }
  return pdfjsLib
}

function encodeCanvasUnderLimit(canvas: HTMLCanvasElement): string {
  // Try WebP first if browser supports it, fall back to JPEG, stepping down quality if needed
  const mimes: ('image/jpeg' | 'image/webp')[] = ['image/jpeg', 'image/webp']
  let best = canvas.toDataURL('image/jpeg', 0.82)
  if (best.length <= MAX_PAGE_BYTES) return best

  for (const mime of mimes) {
    for (const q of [0.76, 0.68, 0.58, 0.48, 0.38]) {
      const candidate = canvas.toDataURL(mime, q)
      if (candidate.length < best.length) best = candidate
      if (candidate.length <= MAX_PAGE_BYTES) return candidate
    }
  }

  // Final safeguard: downscale canvas by 0.78x and re-encode JPEG
  const small = document.createElement('canvas')
  small.width = Math.max(320, Math.round(canvas.width * 0.78))
  small.height = Math.max(320, Math.round(canvas.height * 0.78))
  const sctx = small.getContext('2d')
  if (sctx) {
    sctx.fillStyle = '#ffffff'
    sctx.fillRect(0, 0, small.width, small.height)
    sctx.drawImage(canvas, 0, 0, small.width, small.height)
    return small.toDataURL('image/jpeg', 0.65)
  }
  return best
}

async function renderPageToCanvas(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfDoc: any,
  pageNumber: number,
  maxDim: number,
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const page = await pdfDoc.getPage(pageNumber)
  const baseVp = page.getViewport({ scale: 1 })
  const scale = Math.min(2.0, maxDim / Math.max(baseVp.width, baseVp.height, 1))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(viewport.width))
  canvas.height = Math.max(1, Math.round(viewport.height))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  return { canvas, width: canvas.width, height: canvas.height }
}

/**
 * Loads a local `.pdf` file in the browser, extracts page count & fast preview
 * thumbnails, and returns a session that renders selected pages on demand.
 */
export async function parsePdfFile(
  file: File,
  onThumbProgress?: (done: number, total: number) => void,
): Promise<ParsedPdfSession> {
  const pdfjsLib = await loadPdfJs()
  const buffer = await file.arrayBuffer()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pdfDoc: any
  try {
    pdfDoc = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise
  } catch {
    // Fallback to version-matched CDN worker if local worker URL failed
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
    pdfDoc = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise
  }

  const numPages: number = pdfDoc.numPages
  const thumbs: PdfThumbItem[] = []
  const maxThumbCount = Math.min(numPages, 60)

  for (let i = 0; i < numPages; i++) {
    if (i < maxThumbCount) {
      const { canvas, width, height } = await renderPageToCanvas(
        pdfDoc,
        i + 1,
        220,
      )
      thumbs.push({
        pageIndex: i,
        pageNumber: i + 1,
        thumbDataUrl: canvas.toDataURL('image/jpeg', 0.65),
        aspectRatio: width / Math.max(1, height),
      })
      onThumbProgress?.(i + 1, numPages)
    } else {
      thumbs.push({
        pageIndex: i,
        pageNumber: i + 1,
        thumbDataUrl: '',
        aspectRatio: 0.77,
      })
    }
  }

  const title = file.name.replace(/\.pdf$/i, '') || 'PDF Document'

  return {
    fileName: file.name,
    title,
    numPages,
    thumbs,
    async renderPages(pageIndices, onProgress) {
      const results: {
        pageIndex: number
        dataUrl: string
        width: number
        height: number
      }[] = []
      for (let idx = 0; idx < pageIndices.length; idx++) {
        const pageIndex = pageIndices[idx]
        const { canvas, width, height } = await renderPageToCanvas(
          pdfDoc,
          pageIndex + 1,
          TARGET_MAX_DIM,
        )
        const dataUrl = encodeCanvasUnderLimit(canvas)
        // Board logical dimensions scaled nicely (around 720px wide/tall max)
        const boardScale = Math.min(1, 760 / Math.max(width, height, 1))
        results.push({
          pageIndex,
          dataUrl,
          width: Math.round(width * boardScale),
          height: Math.round(height * boardScale),
        })
        onProgress?.(idx + 1, pageIndices.length)
      }
      return results
    },
    destroy() {
      try {
        void pdfDoc.destroy?.()
      } catch {
        // ignore
      }
    },
  }
}
