import {
  makeElementId,
  translateElement,
  type BoardElement,
} from './infinite-engine'

export const INTERNAL_CLIPBOARD_MIME = 'application/x-lectern-wb-elements'
export const MAX_IMAGE_DIMENSION = 1400
export const DEFAULT_IMAGE_QUALITY = 0.82
export const MAX_IMAGE_BASE64_BYTES = 350 * 1024
export const PASTE_OFFSET_PX = 24

/**
 * Returns true if the event target (or currently focused element) is an
 * editable form control or contentEditable region where native paste/copy
 * must NOT be intercepted by the whiteboard.
 */
export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as HTMLElement
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : ''
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  if (typeof el.getAttribute === 'function') {
    const ce = el.getAttribute('contenteditable')
    if (ce === '' || ce === 'true' || ce === 'plaintext-only') return true
  }
  if (typeof el.closest === 'function') {
    if (
      el.closest(
        'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
      )
    ) {
      return true
    }
  }
  return false
}

const HTML_ENTITY_MAP: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/gi, (match) => {
      const lower = match.toLowerCase()
      return HTML_ENTITY_MAP[lower] ?? match
    })
    .replace(/&#(\d+);/g, (_, num) => {
      const code = Number(num)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : ''
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : ''
    })
}

/**
 * Safely strips HTML into clean plain text while preserving block-level and
 * `<br>` line breaks. Does not execute scripts or inject raw HTML into the DOM.
 */
export function stripHtmlToPlainText(html: string): string {
  if (!html) return ''
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '\t')
    .replace(/<[^>]+>/g, '')
  cleaned = decodeHtmlEntities(cleaned)
  return cleaned
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface ClipboardDataLike {
  getData?: (format: string) => string
  items?: ArrayLike<{
    kind?: string
    type?: string
    getAsFile?: () => File | null
  }> | null
  files?: ArrayLike<File> | null
}

/**
 * Extracts pasted text from clipboardData: prefers `text/plain`, falling back
 * to safely stripped `text/html`, preserving intentional line breaks.
 */
export function extractPastedText(
  clipboardData: ClipboardDataLike | null | undefined,
): string {
  if (!clipboardData || typeof clipboardData.getData !== 'function') return ''
  const plain = clipboardData.getData('text/plain')
  if (plain && plain.trim().length > 0) {
    return plain.replace(/\r\n?/g, '\n').trimEnd()
  }
  const html = clipboardData.getData('text/html')
  if (html && html.trim().length > 0) {
    return stripHtmlToPlainText(html)
  }
  return ''
}

/**
 * Extracts image File/Blob items from clipboardData (`items` first, then `files`).
 */
export function extractPastedImageBlobs(
  clipboardData: ClipboardDataLike | null | undefined,
): Blob[] {
  if (!clipboardData) return []
  const blobs: Blob[] = []
  if (clipboardData.items) {
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i]
      if (!item) continue
      if (item.type && item.type.startsWith('image/')) {
        const f = item.getAsFile?.()
        if (f) blobs.push(f)
      }
    }
  }
  if (blobs.length === 0 && clipboardData.files) {
    for (let i = 0; i < clipboardData.files.length; i++) {
      const f = clipboardData.files[i]
      if (f && f.type && f.type.startsWith('image/')) {
        blobs.push(f)
      }
    }
  }
  return blobs
}

/**
 * Computes clean wrapped dimensions for a pasted text block so multi-line
 * paragraphs and math expressions render cleanly without overflowing.
 */
export function computeWrappedTextMetrics(
  text: string,
  fontSize = 20,
  maxBoxWidth = 520,
): { width: number; height: number; lineCount: number } {
  const normalized = text.replace(/\r\n?/g, '\n')
  const paragraphs = normalized.split('\n')
  const avgCharW = fontSize * 0.56
  const longestLinePx = paragraphs.reduce(
    (max, line) => Math.max(max, line.length * avgCharW),
    0,
  )
  const width = Math.max(
    180,
    Math.min(maxBoxWidth, Math.ceil(longestLinePx + 28)),
  )
  const charsPerLine = Math.max(12, Math.floor((width - 16) / avgCharW))
  let lineCount = 0
  for (const para of paragraphs) {
    if (!para) {
      lineCount += 1
      continue
    }
    const words = para.split(/\s+/)
    let currentLen = 0
    let paraLines = 1
    for (const word of words) {
      if (currentLen === 0) {
        if (word.length > charsPerLine) {
          paraLines += Math.ceil(word.length / charsPerLine) - 1
          currentLen = word.length % charsPerLine || charsPerLine
        } else {
          currentLen = word.length
        }
      } else if (currentLen + 1 + word.length <= charsPerLine) {
        currentLen += 1 + word.length
      } else {
        paraLines += 1
        if (word.length > charsPerLine) {
          paraLines += Math.ceil(word.length / charsPerLine) - 1
          currentLen = word.length % charsPerLine || charsPerLine
        } else {
          currentLen = word.length
        }
      }
    }
    lineCount += paraLines
  }
  const lineHeight = fontSize * 1.38
  const height = Math.max(40, Math.ceil(lineCount * lineHeight + 12))
  return { width, height, lineCount }
}

/**
 * Computes aspect-ratio-preserving display dimensions for an inserted image on
 * the whiteboard canvas.
 */
export function computeFittedImageSize(
  naturalW: number,
  naturalH: number,
  maxDisplayDim = 560,
): { width: number; height: number } {
  const nw = Math.max(1, naturalW)
  const nh = Math.max(1, naturalH)
  const scale = Math.min(1, maxDisplayDim / Math.max(nw, nh))
  return {
    width: Math.max(40, Math.round(nw * scale)),
    height: Math.max(40, Math.round(nh * scale)),
  }
}

/**
 * Estimates UTF-8 byte length of a base64 data URL string.
 */
export function estimateDataUrlBytes(dataUrl: string): number {
  return dataUrl.length
}

/**
 * Clones whiteboard elements with brand-new IDs, unlocked state, sequential
 * z-index above all existing elements, and a clean (+24, +24) offset.
 */
export function cloneBoardElementsWithOffset(
  source: BoardElement[],
  existingElements: BoardElement[],
  dx = PASTE_OFFSET_PX,
  dy = PASTE_OFFSET_PX,
  now = Date.now(),
): BoardElement[] {
  const maxZ = existingElements.reduce((m, e) => Math.max(m, e.zIndex), 0)
  let z = maxZ + 1
  return source
    .filter((el) => el.kind !== 'pdf-deck')
    .map((el) => {
      const shifted = translateElement(el, dx, dy)
      return {
        ...shifted,
        id: makeElementId(),
        locked: false,
        groupId: undefined,
        startAnchor: undefined,
        endAnchor: undefined,
        zIndex: z++,
        createdAt: now,
      }
    })
}

export interface CompressedImageResult {
  dataUrl: string
  width: number
  height: number
  naturalWidth: number
  naturalHeight: number
  byteSize: number
}

/**
 * Resizes and compresses any image Blob/File on an offscreen canvas:
 * - Max dimension: 1400px (preserving exact aspect ratio)
 * - Format: WebP (0.82) with automatic JPEG (0.82) fallback
 * - Hard budget: < 350 KB base64 payload so Firestore's 1 MB doc limit never fails.
 */
export async function compressImageBlobForBoard(
  blob: Blob,
  opts?: {
    maxDimension?: number
    initialQuality?: number
    maxBase64Bytes?: number
    maxDisplayDim?: number
  },
): Promise<CompressedImageResult> {
  const maxDim = opts?.maxDimension ?? MAX_IMAGE_DIMENSION
  const initialQuality = opts?.initialQuality ?? DEFAULT_IMAGE_QUALITY
  const maxBytes = opts?.maxBase64Bytes ?? MAX_IMAGE_BASE64_BYTES
  const maxDisplayDim = opts?.maxDisplayDim ?? 560

  const rawUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read image'))
    reader.readAsDataURL(blob)
  })

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('Could not decode image'))
    el.src = rawUrl
  })

  const naturalW = Math.max(1, img.naturalWidth || img.width)
  const naturalH = Math.max(1, img.naturalHeight || img.height)

  const encodeCanvas = (
    w: number,
    h: number,
    quality: number,
    preferWebp: boolean,
  ): string => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w))
    canvas.height = Math.max(1, Math.round(h))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    // Fill white background for JPEG fallback when source has alpha transparency
    if (!preferWebp) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    if (preferWebp) {
      const webp = canvas.toDataURL('image/webp', quality)
      if (webp.startsWith('data:image/webp')) {
        return webp
      }
      // Browser doesn't support WebP encoding — fall back to JPEG with white bg
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    }
    return canvas.toDataURL('image/jpeg', quality)
  }

  let scale = Math.min(1, maxDim / Math.max(naturalW, naturalH))
  let targetW = Math.max(1, Math.round(naturalW * scale))
  let targetH = Math.max(1, Math.round(naturalH * scale))
  let quality = initialQuality

  // Prefer WebP first (smaller & preserves transparency), auto-fallback to JPEG
  let dataUrl = encodeCanvas(targetW, targetH, quality, true)

  // If over 350 KB, progressively reduce quality then scale down until under budget
  const qualitySteps = [0.74, 0.64, 0.54, 0.45]
  for (const q of qualitySteps) {
    if (estimateDataUrlBytes(dataUrl) <= maxBytes) break
    quality = q
    dataUrl = encodeCanvas(targetW, targetH, quality, true)
  }

  let shrinkAttempts = 0
  while (estimateDataUrlBytes(dataUrl) > maxBytes && shrinkAttempts < 5) {
    shrinkAttempts += 1
    scale *= 0.78
    targetW = Math.max(64, Math.round(naturalW * scale))
    targetH = Math.max(64, Math.round(naturalH * scale))
    dataUrl = encodeCanvas(targetW, targetH, Math.min(quality, 0.72), true)
    // Also compare JPEG in case WebP is larger for photographic screenshots
    if (estimateDataUrlBytes(dataUrl) > maxBytes) {
      const jpeg = encodeCanvas(targetW, targetH, Math.min(quality, 0.68), false)
      if (estimateDataUrlBytes(jpeg) < estimateDataUrlBytes(dataUrl)) {
        dataUrl = jpeg
      }
    }
  }

  const display = computeFittedImageSize(targetW, targetH, maxDisplayDim)

  return {
    dataUrl,
    width: display.width,
    height: display.height,
    naturalWidth: targetW,
    naturalHeight: targetH,
    byteSize: estimateDataUrlBytes(dataUrl),
  }
}
