/**
 * Infinite Whiteboard data model, vector renderer, hit-testing,
 * templates, and PNG / SVG / JSON exporters.
 */

export type InfiniteTool =
  | 'select'
  | 'hand'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'rounded-rect'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'star'
  | 'speech-bubble'
  | 'text'
  | 'sticky'
  | 'frame'
  | 'table'
  | 'laser'

export type ElementKind =
  | 'pen'
  | 'highlighter'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'rounded-rect'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'star'
  | 'speech-bubble'
  | 'text'
  | 'sticky'
  | 'image'
  | 'frame'
  | 'table'
  | 'pdf-page'
  | 'pdf-deck'

export type PenPreset =
  | 'smooth'
  | 'calligraphy'
  | 'marker'
  | 'pencil'
  | 'smart-shape'

export type FontFamilyKey = 'sans' | 'serif' | 'mono' | 'handwriting'
export type TextAlignKey = 'left' | 'center' | 'right'
export type AnchorSide = 'top' | 'right' | 'bottom' | 'left'

export interface ConnectorAnchor {
  elementId: string
  side: AnchorSide
}

export type StrokeStyle = 'solid' | 'dashed' | 'dotted'
export type BoardPattern = 'dots' | 'grid' | 'lined' | 'blank'
export type BoardTheme = 'light' | 'dark'
export type TemplateKind =
  | 'flowchart'
  | 'mindmap'
  | 'kanban'
  | 'matrix2x2'
  | 'coordGrid'

export interface BoardElement {
  id: string
  kind: ElementKind
  x: number
  y: number
  w: number
  h: number
  /** World-space flat [x0, y0, x1, y1, ...] for pen / highlighter / line / arrow */
  points?: number[]
  /** Per-point stroke widths for velocity-sensitive calligraphy pen */
  pointWidths?: number[]
  penPreset?: PenPreset
  rotation: number
  flipX?: boolean
  flipY?: boolean
  strokeColor: string
  fillColor: string
  strokeWidth: number
  strokeStyle: StrokeStyle
  opacity: number
  /** Styling for images / cards */
  borderRadius?: number
  borderWidth?: number
  borderColor?: string
  /** Optional shared group id for multi-select grouping */
  groupId?: string
  /** Text & Rich Text properties */
  text?: string
  fontSize?: number
  fontFamily?: FontFamilyKey
  fontWeight?: 'normal' | 'bold'
  fontStyle?: 'normal' | 'italic'
  textDecoration?: 'none' | 'underline' | 'line-through' | 'underline line-through'
  textAlign?: TextAlignKey
  textBg?: string
  stickyBg?: string
  /** Image & PDF page data */
  imageDataUrl?: string
  /** Interactive PDF Deck / Page linkage */
  pdfDeckId?: string
  pdfPageIndex?: number
  pdfPageCount?: number
  pdfTitle?: string
  /** Annotations created on top of a specific PDF deck page */
  pdfDeckPage?: number
  /** Lesson Frame / Slide metadata */
  frameTitle?: string
  frameRatio?: '16:9' | 'A4' | 'custom'
  /** Editable Table data */
  tableRows?: number
  tableCols?: number
  tableCells?: string[]
  tableHeaderBg?: boolean
  /** Smart Connector attachments */
  startAnchor?: ConnectorAnchor
  endAnchor?: ConnectorAnchor
  locked?: boolean
  zIndex: number
  author: string
  createdAt: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Camera {
  panX: number
  panY: number
  zoom: number
}

export interface LaserTrail {
  id: string
  name: string
  points: { x: number; y: number; at: number }[]
}

export const BOARD_COLORS = [
  '#1f2924', // chalk ink
  '#236446', // lectern board green
  '#c94a38', // terracotta / live
  '#d9822b', // warm amber
  '#2c6fb3', // slate blue
  '#7c4dad', // plum
  '#647068', // muted moss
  '#ffffff', // chalk white
]

export const STICKY_COLORS = [
  { name: 'Butter', bg: '#fef3c7', border: '#e5c158', ink: '#292524' },
  { name: 'Sage', bg: '#dcfce7', border: '#74c69d', ink: '#1b2e22' },
  { name: 'Blush', bg: '#fee2e2', border: '#f08c8c', ink: '#3b1d1d' },
  { name: 'Sky', bg: '#e0f2fe', border: '#7cc4fa', ink: '#172a3a' },
  { name: 'Lavender', bg: '#f3e8ff', border: '#c49bf7', ink: '#2c1c3d' },
]

export const MATH_SYMBOLS = [
  '∑',
  '∫',
  '√',
  'π',
  'θ',
  'α',
  'β',
  'Δ',
  '≤',
  '≥',
  '≠',
  '±',
  '×',
  '÷',
  '∞',
  '→',
  '°',
  '²',
  '³',
]

export function resolveFontStack(family?: FontFamilyKey): string {
  const bodyDefault =
    typeof document !== 'undefined'
      ? getComputedStyle(document.documentElement)
          .getPropertyValue('--font-body')
          .trim() || 'Instrument Sans, sans-serif'
      : 'Instrument Sans, sans-serif'
  switch (family) {
    case 'serif':
      return 'Georgia, "Times New Roman", serif'
    case 'mono':
      return 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    case 'handwriting':
      return '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive'
    case 'sans':
    default:
      return bodyDefault
  }
}

export function makeElementId() {
  return (
    'el_' +
    Math.random().toString(36).slice(2, 9) +
    Date.now().toString(36).slice(-4)
  )
}

export function getElementBounds(el: BoardElement): Rect {
  if (
    (el.kind === 'pen' ||
      el.kind === 'highlighter' ||
      el.kind === 'line' ||
      el.kind === 'arrow') &&
    el.points &&
    el.points.length >= 2
  ) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i < el.points.length; i += 2) {
      const px = el.points[i]
      const py = el.points[i + 1]
      if (px < minX) minX = px
      if (py < minY) minY = py
      if (px > maxX) maxX = px
      if (py > maxY) maxY = py
    }
    return {
      x: minX,
      y: minY,
      w: Math.max(4, maxX - minX),
      h: Math.max(4, maxY - minY),
    }
  }
  const x = el.w < 0 ? el.x + el.w : el.x
  const y = el.h < 0 ? el.y + el.h : el.y
  return { x, y, w: Math.max(8, Math.abs(el.w)), h: Math.max(8, Math.abs(el.h)) }
}

export function getVisibleElements(elements: BoardElement[]): BoardElement[] {
  const deckPageMap = new Map<string, number>()
  for (const el of elements) {
    if (el.kind === 'pdf-deck') {
      deckPageMap.set(el.id, el.pdfPageIndex ?? 0)
    }
  }
  return elements.filter((el) => {
    if (el.kind === 'pdf-page' && el.pdfDeckId && deckPageMap.has(el.pdfDeckId)) {
      // Deck pages are rendered inside their parent pdf-deck frame
      return false
    }
    if (
      el.pdfDeckId &&
      el.pdfDeckPage !== undefined &&
      deckPageMap.has(el.pdfDeckId)
    ) {
      return deckPageMap.get(el.pdfDeckId) === el.pdfDeckPage
    }
    return true
  })
}

export function getContentBounds(elements: BoardElement[]): Rect | null {
  const visible = getVisibleElements(elements)
  if (visible.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const el of visible) {
    const b = getElementBounds(el)
    if (b.x < minX) minX = b.x
    if (b.y < minY) minY = b.y
    if (b.x + b.w > maxX) maxX = b.x + b.w
    if (b.y + b.h > maxY) maxY = b.y + b.h
  }
  if (!Number.isFinite(minX)) return null
  return {
    x: minX,
    y: minY,
    w: Math.max(20, maxX - minX),
    h: Math.max(20, maxY - minY),
  }
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.w &&
    a.x + a.w >= b.x &&
    a.y <= b.y + b.h &&
    a.y + a.h >= b.y
  )
}

function distToSeg(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  const dx = x1 - x0
  const dy = y1 - y0
  const l2 = dx * dx + dy * dy
  let t = l2 === 0 ? 0 : ((px - x0) * dx + (py - y0) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
}

function unrotatePoint(
  px: number,
  py: number,
  cx: number,
  cy: number,
  rot: number,
) {
  if (!rot) return { x: px, y: py }
  const c = Math.cos(-rot)
  const s = Math.sin(-rot)
  const dx = px - cx
  const dy = py - cy
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c }
}

export function hitTestElement(
  el: BoardElement,
  wx: number,
  wy: number,
  tolerance = 8,
): boolean {
  const pad = tolerance + el.strokeWidth / 2
  if (
    (el.kind === 'pen' || el.kind === 'highlighter') &&
    el.points &&
    el.points.length >= 2
  ) {
    const r = el.kind === 'highlighter' ? pad + el.strokeWidth * 1.5 : pad
    if (el.points.length === 2) {
      return Math.hypot(wx - el.points[0], wy - el.points[1]) <= r
    }
    for (let i = 0; i < el.points.length - 2; i += 2) {
      if (
        distToSeg(
          wx,
          wy,
          el.points[i],
          el.points[i + 1],
          el.points[i + 2],
          el.points[i + 3],
        ) <= r
      ) {
        return true
      }
    }
    return false
  }
  if (
    (el.kind === 'line' || el.kind === 'arrow') &&
    el.points &&
    el.points.length >= 4
  ) {
    return (
      distToSeg(
        wx,
        wy,
        el.points[0],
        el.points[1],
        el.points[2],
        el.points[3],
      ) <= pad
    )
  }
  const b = getElementBounds(el)
  if (el.kind === 'frame') {
    // Allow clicking frame header bar or border edge without stealing interior clicks
    const inHeader =
      wx >= b.x && wx <= b.x + Math.min(b.w, 260) && wy >= b.y - 30 && wy <= b.y + 4
    const nearEdge =
      wx >= b.x - pad &&
      wx <= b.x + b.w + pad &&
      wy >= b.y - pad &&
      wy <= b.y + b.h + pad &&
      (Math.abs(wx - b.x) <= pad + 4 ||
        Math.abs(wx - (b.x + b.w)) <= pad + 4 ||
        Math.abs(wy - b.y) <= pad + 4 ||
        Math.abs(wy - (b.y + b.h)) <= pad + 4)
    return inHeader || nearEdge
  }
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  const p = unrotatePoint(wx, wy, cx, cy, el.rotation)
  return (
    p.x >= b.x - pad &&
    p.x <= b.x + b.w + pad &&
    p.y >= b.y - pad &&
    p.y <= b.y + b.h + pad
  )
}

export function translateElement(
  el: BoardElement,
  dx: number,
  dy: number,
): BoardElement {
  if (el.points) {
    const pts = el.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy))
    return { ...el, x: el.x + dx, y: el.y + dy, points: pts }
  }
  return { ...el, x: el.x + dx, y: el.y + dy }
}

export function resizeElementToBounds(
  el: BoardElement,
  next: Rect,
): BoardElement {
  const old = getElementBounds(el)
  const w = Math.max(16, next.w)
  const h = Math.max(16, next.h)
  if (el.points && el.points.length >= 2) {
    const sx = old.w > 0 ? w / old.w : 1
    const sy = old.h > 0 ? h / old.h : 1
    const pts = el.points.map((v, i) =>
      i % 2 === 0 ? next.x + (v - old.x) * sx : next.y + (v - old.y) * sy,
    )
    return { ...el, x: next.x, y: next.y, w, h, points: pts }
  }
  return { ...el, x: next.x, y: next.y, w, h }
}

// ---------------------------------------------------------------------------
// Image cache for Canvas rendering
// ---------------------------------------------------------------------------

const imageCache = new Map<string, HTMLImageElement>()

export function getCachedImage(
  dataUrl: string,
  onLoad?: () => void,
): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null
  const hit = imageCache.get(dataUrl)
  if (hit) {
    if (hit.complete && hit.naturalWidth > 0) return hit
    return null
  }
  const img = new Image()
  img.onload = () => onLoad?.()
  img.src = dataUrl
  imageCache.set(dataUrl, img)
  return img.complete && img.naturalWidth > 0 ? img : null
}

// ---------------------------------------------------------------------------
// Background Pattern Rendering (Infinite Canvas)
// ---------------------------------------------------------------------------

export function drawInfiniteBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera: Camera,
  pattern: BoardPattern,
  theme: BoardTheme,
) {
  ctx.save()
  ctx.fillStyle = theme === 'dark' ? '#171f1b' : '#faf9f5'
  ctx.fillRect(0, 0, width, height)

  if (pattern === 'blank' || width <= 0 || height <= 0 || camera.zoom <= 0) {
    ctx.restore()
    return
  }

  const visibleMinX = -camera.panX / camera.zoom
  const visibleMaxX = (width - camera.panX) / camera.zoom
  const visibleMinY = -camera.panY / camera.zoom
  const visibleMaxY = (height - camera.panY) / camera.zoom

  const baseStep = pattern === 'lined' ? 36 : 32
  let worldStep = baseStep
  while (worldStep * camera.zoom < 14) worldStep *= 2
  while (worldStep * camera.zoom > 96) worldStep /= 2

  const startX = Math.floor(visibleMinX / worldStep) * worldStep
  const startY = Math.floor(visibleMinY / worldStep) * worldStep

  if (pattern === 'dots') {
    ctx.fillStyle =
      theme === 'dark' ? 'rgba(235,240,235,0.18)' : 'rgba(28,38,32,0.2)'
    const radius = Math.max(1, Math.min(2.2, camera.zoom * 1.35))
    for (let wx = startX; wx <= visibleMaxX + worldStep; wx += worldStep) {
      const sx = wx * camera.zoom + camera.panX
      if (sx < -4 || sx > width + 4) continue
      for (let wy = startY; wy <= visibleMaxY + worldStep; wy += worldStep) {
        const sy = wy * camera.zoom + camera.panY
        if (sy < -4 || sy > height + 4) continue
        ctx.beginPath()
        ctx.arc(sx, sy, radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  } else if (pattern === 'grid') {
    ctx.strokeStyle =
      theme === 'dark' ? 'rgba(235,240,235,0.09)' : 'rgba(28,38,32,0.09)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let wx = startX; wx <= visibleMaxX + worldStep; wx += worldStep) {
      const sx = wx * camera.zoom + camera.panX
      if (sx < -1 || sx > width + 1) continue
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, height)
    }
    for (let wy = startY; wy <= visibleMaxY + worldStep; wy += worldStep) {
      const sy = wy * camera.zoom + camera.panY
      if (sy < -1 || sy > height + 1) continue
      ctx.moveTo(0, sy)
      ctx.lineTo(width, sy)
    }
    ctx.stroke()
  } else if (pattern === 'lined') {
    ctx.strokeStyle =
      theme === 'dark' ? 'rgba(235,240,235,0.11)' : 'rgba(35,100,70,0.13)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let wy = startY; wy <= visibleMaxY + worldStep; wy += worldStep) {
      const sy = wy * camera.zoom + camera.panY
      if (sy < -1 || sy > height + 1) continue
      ctx.moveTo(0, sy)
      ctx.lineTo(width, sy)
    }
    ctx.stroke()
  }
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Element Rendering
// ---------------------------------------------------------------------------

function applyDash(ctx: CanvasRenderingContext2D, style: StrokeStyle, w: number) {
  if (style === 'dashed') ctx.setLineDash([Math.max(8, w * 3), Math.max(6, w * 2)])
  else if (style === 'dotted') ctx.setLineDash([Math.max(2, w), Math.max(4, w * 2)])
  else ctx.setLineDash([])
}

function drawFreehandSmooth(ctx: CanvasRenderingContext2D, pts: number[]) {
  if (pts.length < 2) return
  ctx.beginPath()
  if (pts.length < 6) {
    ctx.moveTo(pts[0], pts[1])
    ctx.lineTo(pts[pts.length - 2] + 0.01, pts[pts.length - 1] + 0.01)
  } else {
    ctx.moveTo(pts[0], pts[1])
    for (let i = 2; i < pts.length - 2; i += 2) {
      const mx = (pts[i] + pts[i + 2]) / 2
      const my = (pts[i + 1] + pts[i + 3]) / 2
      ctx.quadraticCurveTo(pts[i], pts[i + 1], mx, my)
    }
    ctx.lineTo(pts[pts.length - 2], pts[pts.length - 1])
  }
  ctx.stroke()
}

function drawCalligraphyStroke(
  ctx: CanvasRenderingContext2D,
  pts: number[],
  widths: number[] | undefined,
  baseWidth: number,
) {
  if (pts.length < 4) {
    drawFreehandSmooth(ctx, pts)
    return
  }
  const n = pts.length / 2
  for (let i = 0; i < n - 1; i++) {
    const x0 = pts[i * 2]
    const y0 = pts[i * 2 + 1]
    const x1 = pts[(i + 1) * 2]
    const y1 = pts[(i + 1) * 2 + 1]
    const w = widths?.[i] ?? baseWidth
    // Slight chisel/fountain angle modulation by stroke direction
    const angle = Math.atan2(y1 - y0, x1 - x0)
    const nibFactor = 0.65 + 0.55 * Math.abs(Math.sin(angle - Math.PI / 4))
    ctx.lineWidth = Math.max(1, w * nibFactor)
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
  }
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

function drawStarPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
) {
  const spikes = 5
  ctx.beginPath()
  for (let i = 0; i < spikes * 2; i++) {
    const angle = (i * Math.PI) / spikes - Math.PI / 2
    const rFactor = i % 2 === 0 ? 1 : 0.44
    const px = cx + Math.cos(angle) * rx * rFactor
    const py = cy + Math.sin(angle) * ry * rFactor
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

function drawSpeechBubblePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const tailH = Math.min(26, h * 0.24)
  const bh = Math.max(16, h - tailH)
  const r = Math.min(14, w / 5, bh / 4)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + bh - r)
  ctx.quadraticCurveTo(x + w, y + bh, x + w - r, y + bh)
  ctx.lineTo(x + w * 0.36, y + bh)
  ctx.lineTo(x + w * 0.2, y + h)
  ctx.lineTo(x + w * 0.22, y + bh)
  ctx.lineTo(x + r, y + bh)
  ctx.quadraticCurveTo(x, y + bh, x, y + bh - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const result: string[] = []
  for (const para of text.split('\n')) {
    if (!para) {
      result.push('')
      continue
    }
    const words = para.split(' ')
    let line = ''
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      if (ctx.measureText(test).width > maxWidth && line) {
        result.push(line)
        line = word
      } else {
        line = test
      }
    }
    if (line) result.push(line)
  }
  return result
}

function drawImageBox(
  ctx: CanvasRenderingContext2D,
  b: Rect,
  dataUrl: string | undefined,
  opts: {
    borderRadius?: number
    borderWidth?: number
    borderColor?: string
    onImageLoaded?: () => void
  },
) {
  const r = opts.borderRadius ?? 0
  ctx.save()
  if (r > 0) {
    drawRoundedRectPath(ctx, b.x, b.y, b.w, b.h, r)
    ctx.clip()
  }
  if (dataUrl) {
    const img = getCachedImage(dataUrl, opts.onImageLoaded)
    if (img) {
      ctx.drawImage(img, b.x, b.y, b.w, b.h)
    } else {
      ctx.fillStyle = 'rgba(128,128,128,0.14)'
      ctx.fillRect(b.x, b.y, b.w, b.h)
    }
  } else {
    ctx.fillStyle = 'rgba(128,128,128,0.12)'
    ctx.fillRect(b.x, b.y, b.w, b.h)
  }
  ctx.restore()

  if (opts.borderWidth && opts.borderWidth > 0 && opts.borderColor) {
    ctx.save()
    ctx.setLineDash([])
    ctx.strokeStyle = opts.borderColor
    ctx.lineWidth = opts.borderWidth
    if (r > 0) {
      drawRoundedRectPath(ctx, b.x, b.y, b.w, b.h, r)
      ctx.stroke()
    } else {
      ctx.strokeRect(b.x, b.y, b.w, b.h)
    }
    ctx.restore()
  }
}

export function drawBoardElement(
  ctx: CanvasRenderingContext2D,
  el: BoardElement,
  onImageLoaded?: () => void,
  deckActivePageImage?: string,
) {
  ctx.save()
  ctx.globalAlpha =
    el.kind === 'highlighter' ? Math.min(0.4, el.opacity) : el.opacity
  ctx.lineCap = el.penPreset === 'marker' ? 'square' : 'round'
  ctx.lineJoin = el.penPreset === 'marker' ? 'bevel' : 'round'
  ctx.strokeStyle = el.strokeColor
  ctx.fillStyle = el.fillColor
  ctx.lineWidth =
    el.kind === 'highlighter'
      ? el.strokeWidth * 3.2
      : el.penPreset === 'marker'
        ? el.strokeWidth * 2.1
        : el.strokeWidth
  applyDash(ctx, el.strokeStyle, el.strokeWidth)

  const b = getElementBounds(el)
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  const needsTransform =
    (el.rotation && el.kind !== 'pen' && el.kind !== 'highlighter') ||
    el.flipX ||
    el.flipY
  if (needsTransform) {
    ctx.translate(cx, cy)
    if (el.rotation && el.kind !== 'pen' && el.kind !== 'highlighter') {
      ctx.rotate(el.rotation)
    }
    if (el.flipX || el.flipY) {
      ctx.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1)
    }
    ctx.translate(-cx, -cy)
  }

  const fontStack = resolveFontStack(el.fontFamily)

  switch (el.kind) {
    case 'pen':
    case 'highlighter':
      if (el.points) {
        if (el.kind === 'pen' && el.penPreset === 'calligraphy') {
          drawCalligraphyStroke(ctx, el.points, el.pointWidths, el.strokeWidth)
        } else if (el.kind === 'pen' && el.penPreset === 'marker') {
          ctx.globalAlpha = Math.min(0.72, el.opacity * 0.72)
          drawFreehandSmooth(ctx, el.points)
        } else if (el.kind === 'pen' && el.penPreset === 'pencil') {
          ctx.globalAlpha = el.opacity * 0.78
          drawFreehandSmooth(ctx, el.points)
          // Subtle dry-graphite texture overlay
          ctx.globalAlpha = el.opacity * 0.32
          ctx.lineWidth = Math.max(0.8, el.strokeWidth * 0.55)
          ctx.setLineDash([2, 3])
          ctx.translate(0.7, 0.7)
          drawFreehandSmooth(ctx, el.points)
        } else {
          drawFreehandSmooth(ctx, el.points)
        }
      }
      break
    case 'line':
    case 'arrow': {
      const pts = el.points ?? [el.x, el.y, el.x + el.w, el.y + el.h]
      const [x0, y0, x1, y1] = pts
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
      if (el.kind === 'arrow') {
        ctx.setLineDash([])
        const angle = Math.atan2(y1 - y0, x1 - x0)
        const len = Math.max(12, el.strokeWidth * 4)
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(
          x1 - len * Math.cos(angle - Math.PI / 6),
          y1 - len * Math.sin(angle - Math.PI / 6),
        )
        ctx.moveTo(x1, y1)
        ctx.lineTo(
          x1 - len * Math.cos(angle + Math.PI / 6),
          y1 - len * Math.sin(angle + Math.PI / 6),
        )
        ctx.stroke()
      }
      break
    }
    case 'rect':
      if (el.fillColor && el.fillColor !== 'transparent') {
        ctx.fillRect(b.x, b.y, b.w, b.h)
      }
      ctx.strokeRect(b.x, b.y, b.w, b.h)
      break
    case 'rounded-rect':
      drawRoundedRectPath(
        ctx,
        b.x,
        b.y,
        b.w,
        b.h,
        el.borderRadius ?? Math.min(18, b.w * 0.18, b.h * 0.18),
      )
      if (el.fillColor && el.fillColor !== 'transparent') ctx.fill()
      ctx.stroke()
      break
    case 'ellipse':
      ctx.beginPath()
      ctx.ellipse(cx, cy, b.w / 2, b.h / 2, 0, 0, Math.PI * 2)
      if (el.fillColor && el.fillColor !== 'transparent') ctx.fill()
      ctx.stroke()
      break
    case 'triangle':
      ctx.beginPath()
      ctx.moveTo(cx, b.y)
      ctx.lineTo(b.x + b.w, b.y + b.h)
      ctx.lineTo(b.x, b.y + b.h)
      ctx.closePath()
      if (el.fillColor && el.fillColor !== 'transparent') ctx.fill()
      ctx.stroke()
      break
    case 'diamond':
      ctx.beginPath()
      ctx.moveTo(cx, b.y)
      ctx.lineTo(b.x + b.w, cy)
      ctx.lineTo(cx, b.y + b.h)
      ctx.lineTo(b.x, cy)
      ctx.closePath()
      if (el.fillColor && el.fillColor !== 'transparent') ctx.fill()
      ctx.stroke()
      break
    case 'star':
      drawStarPath(ctx, cx, cy, b.w / 2, b.h / 2)
      if (el.fillColor && el.fillColor !== 'transparent') ctx.fill()
      ctx.stroke()
      break
    case 'speech-bubble':
      drawSpeechBubblePath(ctx, b.x, b.y, b.w, b.h)
      if (el.fillColor && el.fillColor !== 'transparent') ctx.fill()
      ctx.stroke()
      break
    case 'text': {
      const px = el.fontSize ?? Math.max(18, el.strokeWidth * 6)
      const weight = el.fontWeight === 'bold' ? '700' : '500'
      const style = el.fontStyle === 'italic' ? 'italic ' : ''
      ctx.font = `${style}${weight} ${px}px ${fontStack}`
      const align = el.textAlign ?? 'left'
      ctx.textAlign = align
      ctx.textBaseline = 'top'
      const lines = wrapTextLines(ctx, el.text ?? '', Math.max(48, b.w - 8))
      const lineH = px * 1.32
      if (el.textBg && el.textBg !== 'transparent') {
        ctx.save()
        ctx.fillStyle = el.textBg
        const bgH = Math.max(b.h, lines.length * lineH + 10)
        drawRoundedRectPath(ctx, b.x - 4, b.y - 4, b.w + 8, bgH, 6)
        ctx.fill()
        ctx.restore()
      }
      ctx.fillStyle = el.strokeColor
      const dec = el.textDecoration ?? 'none'
      lines.forEach((line, i) => {
        const ty = b.y + i * lineH
        const tx =
          align === 'center'
            ? b.x + b.w / 2
            : align === 'right'
              ? b.x + b.w
              : b.x
        ctx.fillText(line, tx, ty)
        if (line && dec !== 'none') {
          const tw = ctx.measureText(line).width
          const lx =
            align === 'center'
              ? tx - tw / 2
              : align === 'right'
                ? tx - tw
                : tx
          ctx.save()
          ctx.strokeStyle = el.strokeColor
          ctx.lineWidth = Math.max(1.2, px * 0.065)
          ctx.setLineDash([])
          if (dec.includes('underline')) {
            ctx.beginPath()
            ctx.moveTo(lx, ty + px * 1.08)
            ctx.lineTo(lx + tw, ty + px * 1.08)
            ctx.stroke()
          }
          if (dec.includes('line-through')) {
            ctx.beginPath()
            ctx.moveTo(lx, ty + px * 0.56)
            ctx.lineTo(lx + tw, ty + px * 0.56)
            ctx.stroke()
          }
          ctx.restore()
        }
      })
      break
    }
    case 'sticky': {
      const preset =
        STICKY_COLORS.find((s) => s.bg === el.stickyBg) ?? STICKY_COLORS[0]
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.14)'
      ctx.shadowBlur = 14
      ctx.shadowOffsetY = 6
      drawRoundedRectPath(ctx, b.x, b.y, b.w, b.h, 10)
      ctx.fillStyle = el.stickyBg || preset.bg
      ctx.fill()
      ctx.restore()
      drawRoundedRectPath(ctx, b.x, b.y, b.w, b.h, 10)
      ctx.lineWidth = 1.5
      ctx.setLineDash([])
      ctx.strokeStyle = preset.border
      ctx.stroke()
      ctx.fillStyle = preset.border
      ctx.globalAlpha = 0.25 * el.opacity
      ctx.fillRect(b.x + 1, b.y + 1, b.w - 2, 10)
      ctx.globalAlpha = el.opacity
      const px = el.fontSize ?? 16
      const weight = el.fontWeight === 'bold' ? '700' : '500'
      const style = el.fontStyle === 'italic' ? 'italic ' : ''
      ctx.font = `${style}${weight} ${px}px ${fontStack}`
      ctx.fillStyle = preset.ink
      ctx.textBaseline = 'top'
      ctx.textAlign = el.textAlign ?? 'left'
      const lines = wrapTextLines(
        ctx,
        el.text || 'Sticky note',
        Math.max(40, b.w - 24),
      )
      lines.forEach((line, idx) => {
        const ty = b.y + 20 + idx * px * 1.32
        if (ty + px <= b.y + b.h - 8) {
          const tx =
            el.textAlign === 'center'
              ? b.x + b.w / 2
              : el.textAlign === 'right'
                ? b.x + b.w - 12
                : b.x + 12
          ctx.fillText(line, tx, ty)
        }
      })
      break
    }
    case 'image':
    case 'pdf-page': {
      drawImageBox(ctx, b, el.imageDataUrl, {
        borderRadius: el.borderRadius ?? (el.kind === 'pdf-page' ? 4 : 0),
        borderWidth: el.borderWidth ?? (el.kind === 'pdf-page' ? 1 : 0),
        borderColor:
          el.borderColor ?? (el.kind === 'pdf-page' ? 'rgba(35,100,70,0.28)' : undefined),
        onImageLoaded,
      })
      break
    }
    case 'pdf-deck': {
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.12)'
      ctx.shadowBlur = 18
      ctx.shadowOffsetY = 6
      drawRoundedRectPath(ctx, b.x, b.y, b.w, b.h, 8)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.restore()
      drawImageBox(ctx, b, deckActivePageImage ?? el.imageDataUrl, {
        borderRadius: 8,
        borderWidth: 2,
        borderColor: '#236446',
        onImageLoaded,
      })
      // Top-left PDF title pill
      const label = `${el.pdfTitle || 'PDF Deck'} · Page ${(el.pdfPageIndex ?? 0) + 1} / ${el.pdfPageCount ?? 1}`
      ctx.save()
      ctx.font = `600 12px ${fontStack}`
      const tw = ctx.measureText(label).width + 16
      drawRoundedRectPath(ctx, b.x, b.y - 28, Math.min(b.w, tw), 22, 6)
      ctx.fillStyle = '#236446'
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.fillText(label, b.x + 8, b.y - 17)
      ctx.restore()
      break
    }
    case 'frame': {
      ctx.save()
      drawRoundedRectPath(ctx, b.x, b.y, b.w, b.h, 12)
      ctx.fillStyle =
        el.fillColor && el.fillColor !== 'transparent'
          ? el.fillColor
          : 'rgba(255,255,255,0.55)'
      ctx.fill()
      ctx.setLineDash([8, 5])
      ctx.lineWidth = 2
      ctx.strokeStyle = el.strokeColor || '#236446'
      ctx.stroke()
      ctx.setLineDash([])
      // Slide title tab above top-left
      const label = el.frameTitle || 'Lesson Slide'
      ctx.font = `600 13px ${fontStack}`
      const tw = ctx.measureText(label).width + 18
      drawRoundedRectPath(ctx, b.x, b.y - 28, Math.min(b.w, tw), 23, 6)
      ctx.fillStyle = el.strokeColor || '#236446'
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.fillText(label, b.x + 9, b.y - 16.5)
      ctx.restore()
      break
    }
    case 'table': {
      const rows = Math.max(1, el.tableRows ?? 3)
      const cols = Math.max(1, el.tableCols ?? 3)
      const cells = el.tableCells ?? []
      const rowH = b.h / rows
      const colW = b.w / cols
      const headerBg = el.tableHeaderBg !== false

      ctx.save()
      drawRoundedRectPath(ctx, b.x, b.y, b.w, b.h, 8)
      ctx.fillStyle =
        el.fillColor && el.fillColor !== 'transparent'
          ? el.fillColor
          : '#ffffff'
      ctx.fill()
      ctx.clip()

      if (headerBg) {
        ctx.fillStyle = 'rgba(35,100,70,0.12)'
        ctx.fillRect(b.x, b.y, b.w, rowH)
      }

      ctx.strokeStyle = el.strokeColor || '#236446'
      ctx.lineWidth = 1.25
      ctx.setLineDash([])
      for (let r = 1; r < rows; r++) {
        ctx.beginPath()
        ctx.moveTo(b.x, b.y + r * rowH)
        ctx.lineTo(b.x + b.w, b.y + r * rowH)
        ctx.stroke()
      }
      for (let c = 1; c < cols; c++) {
        ctx.beginPath()
        ctx.moveTo(b.x + c * colW, b.y)
        ctx.lineTo(b.x + c * colW, b.y + b.h)
        ctx.stroke()
      }

      const px = el.fontSize ?? 14
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const val = cells[r * cols + c] ?? ''
          if (!val) continue
          ctx.font = `${r === 0 && headerBg ? '600' : '400'} ${px}px ${fontStack}`
          ctx.fillStyle = '#1f2924'
          ctx.save()
          ctx.beginPath()
          ctx.rect(b.x + c * colW + 4, b.y + r * rowH + 2, colW - 8, rowH - 4)
          ctx.clip()
          ctx.fillText(val, b.x + c * colW + 8, b.y + (r + 0.5) * rowH)
          ctx.restore()
        }
      }
      ctx.restore()

      ctx.save()
      drawRoundedRectPath(ctx, b.x, b.y, b.w, b.h, 8)
      ctx.strokeStyle = el.strokeColor || '#236446'
      ctx.lineWidth = 1.75
      ctx.setLineDash([])
      ctx.stroke()
      ctx.restore()
      break
    }
  }

  // Optional centered label on shapes
  if (
    el.text &&
    el.kind !== 'text' &&
    el.kind !== 'sticky' &&
    el.kind !== 'pen' &&
    el.kind !== 'highlighter' &&
    el.kind !== 'frame' &&
    el.kind !== 'table' &&
    el.kind !== 'image' &&
    el.kind !== 'pdf-page' &&
    el.kind !== 'pdf-deck'
  ) {
    const px = el.fontSize ?? 15
    const weight = el.fontWeight === 'bold' ? '700' : '500'
    const style = el.fontStyle === 'italic' ? 'italic ' : ''
    ctx.font = `${style}${weight} ${px}px ${fontStack}`
    ctx.fillStyle = el.strokeColor
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const lines = wrapTextLines(ctx, el.text, Math.max(40, b.w - 16))
    const totalH = lines.length * px * 1.25
    lines.forEach((line, i) => {
      ctx.fillText(
        line,
        cx,
        cy - totalH / 2 + (i + 0.5) * px * 1.25,
      )
    })
  }

  ctx.restore()
}

export function resolveDeckPageImage(
  elements: BoardElement[],
  deck: BoardElement,
): string | undefined {
  const idx = deck.pdfPageIndex ?? 0
  const match = elements.find(
    (e) =>
      e.kind === 'pdf-page' &&
      e.pdfDeckId === deck.id &&
      (e.pdfPageIndex ?? 0) === idx,
  )
  return match?.imageDataUrl ?? deck.imageDataUrl
}

// ---------------------------------------------------------------------------
// Quick Templates
// ---------------------------------------------------------------------------

export function createTemplateElements(
  kind: TemplateKind,
  cx: number,
  cy: number,
  author: string,
  startZ: number,
): BoardElement[] {
  const now = Date.now()
  let z = startZ
  const base = (
    partial: Partial<BoardElement> & Pick<BoardElement, 'kind' | 'x' | 'y' | 'w' | 'h'>,
  ): BoardElement => ({
    id: makeElementId(),
    rotation: 0,
    strokeColor: '#236446',
    fillColor: 'transparent',
    strokeWidth: 2.5,
    strokeStyle: 'solid',
    opacity: 1,
    zIndex: z++,
    author,
    createdAt: now,
    ...partial,
  })

  switch (kind) {
    case 'flowchart':
      return [
        base({ kind: 'rounded-rect', x: cx - 90, y: cy - 230, w: 180, h: 64, fillColor: '#dcfce7', text: 'Start' }),
        base({ kind: 'arrow', x: cx, y: cy - 166, w: 0, h: 56, points: [cx, cy - 166, cx, cy - 110] }),
        base({ kind: 'diamond', x: cx - 100, y: cy - 110, w: 200, h: 120, fillColor: '#fef3c7', text: 'Condition?' }),
        base({ kind: 'arrow', x: cx - 100, y: cy - 50, w: -80, h: 90, points: [cx - 100, cy - 50, cx - 180, cy + 40] }),
        base({ kind: 'arrow', x: cx + 100, y: cy - 50, w: 80, h: 90, points: [cx + 100, cy - 50, cx + 180, cy + 40] }),
        base({ kind: 'rect', x: cx - 265, y: cy + 40, w: 170, h: 68, fillColor: '#e0f2fe', text: 'Path A (Yes)' }),
        base({ kind: 'rect', x: cx + 95, y: cy + 40, w: 170, h: 68, fillColor: '#fee2e2', text: 'Path B (No)' }),
        base({ kind: 'arrow', x: cx - 180, y: cy + 108, w: 140, h: 72, points: [cx - 180, cy + 108, cx - 40, cy + 180] }),
        base({ kind: 'arrow', x: cx + 180, y: cy + 108, w: -140, h: 72, points: [cx + 180, cy + 108, cx + 40, cy + 180] }),
        base({ kind: 'rounded-rect', x: cx - 90, y: cy + 180, w: 180, h: 64, fillColor: '#f3e8ff', text: 'Outcome' }),
      ]
    case 'mindmap': {
      const centerId = makeElementId()
      const n1 = makeElementId()
      const n2 = makeElementId()
      const n3 = makeElementId()
      const n4 = makeElementId()
      return [
        base({ id: centerId, kind: 'rounded-rect', x: cx - 110, y: cy - 42, w: 220, h: 84, fillColor: '#dcfce7', strokeWidth: 3, text: 'Central Topic' }),
        base({ kind: 'arrow', x: cx - 110, y: cy, w: -140, h: -150, points: [cx - 110, cy, cx - 250, cy - 150], startAnchor: { elementId: centerId, side: 'left' }, endAnchor: { elementId: n1, side: 'right' } }),
        base({ kind: 'arrow', x: cx + 110, y: cy, w: 140, h: -150, points: [cx + 110, cy, cx + 250, cy - 150], startAnchor: { elementId: centerId, side: 'right' }, endAnchor: { elementId: n2, side: 'left' } }),
        base({ kind: 'arrow', x: cx - 110, y: cy, w: -140, h: 150, points: [cx - 110, cy, cx - 250, cy + 150], startAnchor: { elementId: centerId, side: 'left' }, endAnchor: { elementId: n3, side: 'right' } }),
        base({ kind: 'arrow', x: cx + 110, y: cy, w: 140, h: 150, points: [cx + 110, cy, cx + 250, cy + 150], startAnchor: { elementId: centerId, side: 'right' }, endAnchor: { elementId: n4, side: 'left' } }),
        base({ id: n1, kind: 'sticky', x: cx - 430, y: cy - 210, w: 180, h: 120, stickyBg: STICKY_COLORS[0].bg, text: 'Idea 1\nKey points…' }),
        base({ id: n2, kind: 'sticky', x: cx + 250, y: cy - 210, w: 180, h: 120, stickyBg: STICKY_COLORS[1].bg, text: 'Idea 2\nExamples…' }),
        base({ id: n3, kind: 'sticky', x: cx - 430, y: cy + 90, w: 180, h: 120, stickyBg: STICKY_COLORS[3].bg, text: 'Idea 3\nQuestions…' }),
        base({ id: n4, kind: 'sticky', x: cx + 250, y: cy + 90, w: 180, h: 120, stickyBg: STICKY_COLORS[4].bg, text: 'Idea 4\nNext steps…' }),
      ]
    }
    case 'kanban':
      return [
        base({ kind: 'rounded-rect', x: cx - 390, y: cy - 220, w: 240, h: 440, fillColor: 'rgba(35,100,70,0.05)', strokeColor: '#647068' }),
        base({ kind: 'rounded-rect', x: cx - 120, y: cy - 220, w: 240, h: 440, fillColor: 'rgba(217,130,43,0.06)', strokeColor: '#647068' }),
        base({ kind: 'rounded-rect', x: cx + 150, y: cy - 220, w: 240, h: 440, fillColor: 'rgba(44,111,179,0.06)', strokeColor: '#647068' }),
        base({ kind: 'text', x: cx - 370, y: cy - 204, w: 200, h: 32, fontSize: 20, fontWeight: 'bold', text: 'To Do' }),
        base({ kind: 'text', x: cx - 100, y: cy - 204, w: 200, h: 32, fontSize: 20, fontWeight: 'bold', text: 'In Progress' }),
        base({ kind: 'text', x: cx + 170, y: cy - 204, w: 200, h: 32, fontSize: 20, fontWeight: 'bold', text: 'Done' }),
        base({ kind: 'sticky', x: cx - 370, y: cy - 155, w: 200, h: 110, stickyBg: STICKY_COLORS[0].bg, text: 'Warm-up exercise' }),
        base({ kind: 'sticky', x: cx - 100, y: cy - 155, w: 200, h: 110, stickyBg: STICKY_COLORS[3].bg, text: 'Group problem solving' }),
        base({ kind: 'sticky', x: cx + 170, y: cy - 155, w: 200, h: 110, stickyBg: STICKY_COLORS[1].bg, text: 'Review homework' }),
      ]
    case 'matrix2x2':
      return [
        base({ kind: 'arrow', x: cx - 320, y: cy, w: 640, h: 0, points: [cx - 320, cy, cx + 320, cy], strokeWidth: 3 }),
        base({ kind: 'arrow', x: cx, y: cy + 260, w: 0, h: -520, points: [cx, cy + 260, cx, cy - 260], strokeWidth: 3 }),
        base({ kind: 'text', x: cx - 280, y: cy - 240, w: 220, h: 30, fontSize: 18, text: 'High Impact / Low Effort' }),
        base({ kind: 'text', x: cx + 40, y: cy - 240, w: 220, h: 30, fontSize: 18, text: 'High Impact / High Effort' }),
        base({ kind: 'text', x: cx - 280, y: cy + 200, w: 220, h: 30, fontSize: 18, text: 'Low Impact / Low Effort' }),
        base({ kind: 'text', x: cx + 40, y: cy + 200, w: 220, h: 30, fontSize: 18, text: 'Low Impact / High Effort' }),
        base({ kind: 'sticky', x: cx - 230, y: cy - 160, w: 150, h: 100, stickyBg: STICKY_COLORS[1].bg, text: 'Quick wins' }),
        base({ kind: 'sticky', x: cx + 80, y: cy - 160, w: 150, h: 100, stickyBg: STICKY_COLORS[0].bg, text: 'Major projects' }),
      ]
    case 'coordGrid': {
      const items: BoardElement[] = [
        base({ kind: 'arrow', x: cx - 320, y: cy, w: 640, h: 0, points: [cx - 320, cy, cx + 320, cy], strokeWidth: 2.5 }),
        base({ kind: 'arrow', x: cx, y: cy + 260, w: 0, h: -520, points: [cx, cy + 260, cx, cy - 260], strokeWidth: 2.5 }),
        base({ kind: 'text', x: cx + 305, y: cy + 12, w: 40, h: 28, fontSize: 18, fontWeight: 'bold', text: 'X' }),
        base({ kind: 'text', x: cx + 14, y: cy - 265, w: 40, h: 28, fontSize: 18, fontWeight: 'bold', text: 'Y' }),
      ]
      for (let i = -5; i <= 5; i++) {
        if (i === 0) continue
        items.push(
          base({
            kind: 'line',
            x: cx + i * 55,
            y: cy - 7,
            w: 0,
            h: 14,
            points: [cx + i * 55, cy - 7, cx + i * 55, cy + 7],
            strokeWidth: 2,
          }),
        )
      }
      for (let j = -4; j <= 4; j++) {
        if (j === 0) continue
        items.push(
          base({
            kind: 'line',
            x: cx - 7,
            y: cy + j * 55,
            w: 14,
            h: 0,
            points: [cx - 7, cy + j * 55, cx + 7, cy + j * 55],
            strokeWidth: 2,
          }),
        )
      }
      return items
    }
  }
}

// ---------------------------------------------------------------------------
// Exporters (PNG, SVG, JSON)
// ---------------------------------------------------------------------------

export function renderExportCanvas(
  elements: BoardElement[],
  opts: {
    bounds: Rect
    scale?: number
    theme: BoardTheme
    pattern: BoardPattern
  },
): HTMLCanvasElement {
  const scale = opts.scale ?? 1.5
  const pad = 48
  const w = Math.min(4096, Math.max(400, Math.round((opts.bounds.w + pad * 2) * scale)))
  const h = Math.min(4096, Math.max(300, Math.round((opts.bounds.h + pad * 2) * scale)))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const camera: Camera = {
    panX: (-opts.bounds.x + pad) * scale,
    panY: (-opts.bounds.y + pad) * scale,
    zoom: scale,
  }
  drawInfiniteBackground(ctx, w, h, camera, opts.pattern, opts.theme)
  ctx.save()
  ctx.setTransform(camera.zoom, 0, 0, camera.zoom, camera.panX, camera.panY)
  const visible = getVisibleElements(elements)
  for (const el of [...visible].sort((a, b) => a.zIndex - b.zIndex)) {
    const deckImg =
      el.kind === 'pdf-deck' ? resolveDeckPageImage(elements, el) : undefined
    drawBoardElement(ctx, el, undefined, deckImg)
  }
  ctx.restore()
  return canvas
}

function escapeXml(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function exportBoardSvg(
  elements: BoardElement[],
  theme: BoardTheme,
): string {
  const visible = getVisibleElements(elements)
  const bounds = getContentBounds(elements) ?? { x: 0, y: 0, w: 1200, h: 800 }
  const pad = 48
  const vx = bounds.x - pad
  const vy = bounds.y - pad
  const vw = bounds.w + pad * 2
  const vh = bounds.h + pad * 2
  const bg = theme === 'dark' ? '#171f1b' : '#faf9f5'

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${Math.round(vw)}" height="${Math.round(vh)}">`,
    `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="${bg}" />`,
  ]

  for (const el of [...visible].sort((a, b) => a.zIndex - b.zIndex)) {
    const b = getElementBounds(el)
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    const tf = el.rotation
      ? ` transform="rotate(${((el.rotation * 180) / Math.PI).toFixed(2)} ${cx} ${cy})"`
      : ''
    const dash =
      el.strokeStyle === 'dashed'
        ? ` stroke-dasharray="${el.strokeWidth * 3} ${el.strokeWidth * 2}"`
        : el.strokeStyle === 'dotted'
          ? ` stroke-dasharray="${el.strokeWidth} ${el.strokeWidth * 2}"`
          : ''
    const op =
      el.kind === 'highlighter' ? Math.min(0.4, el.opacity) : el.opacity
    const sw =
      el.kind === 'highlighter' ? el.strokeWidth * 3.2 : el.strokeWidth
    const fill =
      el.fillColor && el.fillColor !== 'transparent' ? el.fillColor : 'none'

    if ((el.kind === 'pen' || el.kind === 'highlighter') && el.points) {
      let d = ''
      for (let i = 0; i < el.points.length; i += 2) {
        d += `${i === 0 ? 'M' : 'L'}${el.points[i].toFixed(1)},${el.points[i + 1].toFixed(1)} `
      }
      parts.push(
        `<path d="${d.trim()}" fill="none" stroke="${el.strokeColor}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"${dash} />`,
      )
    } else if ((el.kind === 'line' || el.kind === 'arrow') && el.points) {
      const [x0, y0, x1, y1] = el.points
      parts.push(
        `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${el.strokeColor}" stroke-width="${sw}" stroke-linecap="round" opacity="${op}"${dash} />`,
      )
      if (el.kind === 'arrow') {
        const angle = Math.atan2(y1 - y0, x1 - x0)
        const len = Math.max(12, sw * 4)
        const ax = x1 - len * Math.cos(angle - Math.PI / 6)
        const ay = y1 - len * Math.sin(angle - Math.PI / 6)
        const bx = x1 - len * Math.cos(angle + Math.PI / 6)
        const by = y1 - len * Math.sin(angle + Math.PI / 6)
        parts.push(
          `<path d="M${ax},${ay} L${x1},${y1} L${bx},${by}" fill="none" stroke="${el.strokeColor}" stroke-width="${sw}" stroke-linecap="round" opacity="${op}" />`,
        )
      }
    } else if (el.kind === 'rect' || el.kind === 'rounded-rect' || el.kind === 'frame') {
      const rx = el.kind === 'rounded-rect' || el.kind === 'frame' ? 12 : 0
      parts.push(
        `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${rx}" fill="${fill}" stroke="${el.strokeColor}" stroke-width="${sw}" opacity="${op}"${dash}${tf} />`,
      )
    } else if (el.kind === 'ellipse') {
      parts.push(
        `<ellipse cx="${cx}" cy="${cy}" rx="${b.w / 2}" ry="${b.h / 2}" fill="${fill}" stroke="${el.strokeColor}" stroke-width="${sw}" opacity="${op}"${dash}${tf} />`,
      )
    } else if (el.kind === 'triangle') {
      parts.push(
        `<polygon points="${cx},${b.y} ${b.x + b.w},${b.y + b.h} ${b.x},${b.y + b.h}" fill="${fill}" stroke="${el.strokeColor}" stroke-width="${sw}" opacity="${op}"${dash}${tf} />`,
      )
    } else if (el.kind === 'diamond') {
      parts.push(
        `<polygon points="${cx},${b.y} ${b.x + b.w},${cy} ${cx},${b.y + b.h} ${b.x},${cy}" fill="${fill}" stroke="${el.strokeColor}" stroke-width="${sw}" opacity="${op}"${dash}${tf} />`,
      )
    } else if (el.kind === 'sticky') {
      const preset =
        STICKY_COLORS.find((s) => s.bg === el.stickyBg) ?? STICKY_COLORS[0]
      parts.push(
        `<g opacity="${op}"${tf}><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10" fill="${preset.bg}" stroke="${preset.border}" stroke-width="1.5" />` +
          `<text x="${b.x + 12}" y="${b.y + 34}" fill="${preset.ink}" font-family="sans-serif" font-size="${el.fontSize ?? 16}">${escapeXml(el.text ?? '')}</text></g>`,
      )
    } else if (el.kind === 'text') {
      const px = el.fontSize ?? 20
      const lines = (el.text ?? '').split('\n')
      const tspans = lines
        .map(
          (l, i) =>
            `<tspan x="${b.x}" dy="${i === 0 ? 0 : px * 1.3}">${escapeXml(l)}</tspan>`,
        )
        .join('')
      parts.push(
        `<text x="${b.x}" y="${b.y + px}" fill="${el.strokeColor}" font-family="sans-serif" font-weight="${el.fontWeight ?? 'normal'}" font-style="${el.fontStyle ?? 'normal'}" font-size="${px}" opacity="${op}"${tf}>${tspans}</text>`,
      )
    } else if (
      (el.kind === 'image' || el.kind === 'pdf-page' || el.kind === 'pdf-deck')
    ) {
      const href =
        el.kind === 'pdf-deck'
          ? resolveDeckPageImage(elements, el)
          : el.imageDataUrl
      if (href) {
        parts.push(
          `<image href="${href}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" opacity="${op}"${tf} />`,
        )
      }
    }
  }
  parts.push('</svg>')
  return parts.join('\n')
}

export function exportBoardJson(elements: BoardElement[]): string {
  return JSON.stringify({ version: 2, app: 'lectern', elements }, null, 2)
}

export function parseBoardJson(raw: string): BoardElement[] {
  const parsed = JSON.parse(raw) as unknown
  if (
    parsed &&
    typeof parsed === 'object' &&
    'elements' in parsed &&
    Array.isArray((parsed as { elements: unknown }).elements)
  ) {
    return (parsed as { elements: BoardElement[] }).elements
  }
  if (Array.isArray(parsed)) return parsed as BoardElement[]
  throw new Error('Invalid whiteboard JSON file.')
}
