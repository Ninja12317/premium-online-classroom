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
  rotation: number
  strokeColor: string
  fillColor: string
  strokeWidth: number
  strokeStyle: StrokeStyle
  opacity: number
  text?: string
  fontSize?: number
  stickyBg?: string
  imageDataUrl?: string
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

export function getContentBounds(elements: BoardElement[]): Rect | null {
  if (elements.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const el of elements) {
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
  // Respect the caller's active logical transform (ctx.setTransform(dpr,0,0,dpr,0,0)
  // on Retina displays, or identity on export canvas) so the background fills 100%
  // of the viewport edge-to-edge with zero quarter-screen clipping.
  ctx.fillStyle = theme === 'dark' ? '#171f1b' : '#faf9f5'
  ctx.fillRect(0, 0, width, height)

  if (pattern === 'blank' || width <= 0 || height <= 0 || camera.zoom <= 0) {
    ctx.restore()
    return
  }

  // Compute the currently visible world bounds for truly infinite panning & zooming
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

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2)
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

export function drawBoardElement(
  ctx: CanvasRenderingContext2D,
  el: BoardElement,
  onImageLoaded?: () => void,
) {
  ctx.save()
  ctx.globalAlpha =
    el.kind === 'highlighter' ? Math.min(0.4, el.opacity) : el.opacity
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = el.strokeColor
  ctx.fillStyle = el.fillColor
  ctx.lineWidth = el.kind === 'highlighter' ? el.strokeWidth * 3.2 : el.strokeWidth
  applyDash(ctx, el.strokeStyle, el.strokeWidth)

  const b = getElementBounds(el)
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  if (el.rotation && el.kind !== 'pen' && el.kind !== 'highlighter') {
    ctx.translate(cx, cy)
    ctx.rotate(el.rotation)
    ctx.translate(-cx, -cy)
  }

  const fontStack =
    typeof document !== 'undefined'
      ? getComputedStyle(document.documentElement)
          .getPropertyValue('--font-body')
          .trim() || 'Instrument Sans, sans-serif'
      : 'Instrument Sans, sans-serif'

  switch (el.kind) {
    case 'pen':
    case 'highlighter':
      if (el.points) drawFreehandSmooth(ctx, el.points)
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
      drawRoundedRectPath(ctx, b.x, b.y, b.w, b.h, Math.min(18, b.w * 0.18, b.h * 0.18))
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
      ctx.font = `500 ${px}px ${fontStack}`
      ctx.fillStyle = el.strokeColor
      ctx.textBaseline = 'top'
      const lines = (el.text ?? '').split('\n')
      lines.forEach((line, i) => ctx.fillText(line, b.x, b.y + i * px * 1.3))
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
      // Subtle top accent bar
      ctx.fillStyle = preset.border
      ctx.globalAlpha = 0.25 * el.opacity
      ctx.fillRect(b.x + 1, b.y + 1, b.w - 2, 10)
      ctx.globalAlpha = el.opacity
      // Text inside sticky
      const px = el.fontSize ?? 16
      ctx.font = `500 ${px}px ${fontStack}`
      ctx.fillStyle = preset.ink
      ctx.textBaseline = 'top'
      const lines = wrapTextLines(ctx, el.text || 'Sticky note', Math.max(40, b.w - 24))
      lines.forEach((line, idx) => {
        const ty = b.y + 20 + idx * px * 1.32
        if (ty + px <= b.y + b.h - 8) ctx.fillText(line, b.x + 12, ty)
      })
      break
    }
    case 'image': {
      if (el.imageDataUrl) {
        const img = getCachedImage(el.imageDataUrl, onImageLoaded)
        if (img) {
          ctx.drawImage(img, b.x, b.y, b.w, b.h)
        } else {
          ctx.fillStyle = 'rgba(128,128,128,0.15)'
          ctx.fillRect(b.x, b.y, b.w, b.h)
        }
      }
      break
    }
  }

  // Optional centered label on shapes
  if (
    el.text &&
    el.kind !== 'text' &&
    el.kind !== 'sticky' &&
    el.kind !== 'pen' &&
    el.kind !== 'highlighter'
  ) {
    const px = el.fontSize ?? 15
    ctx.font = `500 ${px}px ${fontStack}`
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
    case 'mindmap':
      return [
        base({ kind: 'rounded-rect', x: cx - 110, y: cy - 42, w: 220, h: 84, fillColor: '#dcfce7', strokeWidth: 3, text: 'Central Topic' }),
        base({ kind: 'arrow', x: cx - 110, y: cy - 20, w: -140, h: -110, points: [cx - 110, cy - 20, cx - 250, cy - 130] }),
        base({ kind: 'arrow', x: cx + 110, y: cy - 20, w: 140, h: -110, points: [cx + 110, cy - 20, cx + 250, cy - 130] }),
        base({ kind: 'arrow', x: cx - 110, y: cy + 20, w: -140, h: 110, points: [cx - 110, cy + 20, cx - 250, cy + 130] }),
        base({ kind: 'arrow', x: cx + 110, y: cy + 20, w: 140, h: 110, points: [cx + 110, cy + 20, cx + 250, cy + 130] }),
        base({ kind: 'sticky', x: cx - 430, y: cy - 210, w: 180, h: 120, stickyBg: STICKY_COLORS[0].bg, text: 'Idea 1\nKey points…' }),
        base({ kind: 'sticky', x: cx + 250, y: cy - 210, w: 180, h: 120, stickyBg: STICKY_COLORS[1].bg, text: 'Idea 2\nExamples…' }),
        base({ kind: 'sticky', x: cx - 430, y: cy + 90, w: 180, h: 120, stickyBg: STICKY_COLORS[3].bg, text: 'Idea 3\nQuestions…' }),
        base({ kind: 'sticky', x: cx + 250, y: cy + 90, w: 180, h: 120, stickyBg: STICKY_COLORS[4].bg, text: 'Idea 4\nNext steps…' }),
      ]
    case 'kanban':
      return [
        base({ kind: 'rounded-rect', x: cx - 390, y: cy - 220, w: 240, h: 440, fillColor: 'rgba(35,100,70,0.05)', strokeColor: '#647068' }),
        base({ kind: 'rounded-rect', x: cx - 120, y: cy - 220, w: 240, h: 440, fillColor: 'rgba(217,130,43,0.06)', strokeColor: '#647068' }),
        base({ kind: 'rounded-rect', x: cx + 150, y: cy - 220, w: 240, h: 440, fillColor: 'rgba(44,111,179,0.06)', strokeColor: '#647068' }),
        base({ kind: 'text', x: cx - 370, y: cy - 204, w: 200, h: 32, fontSize: 20, text: 'To Do' }),
        base({ kind: 'text', x: cx - 100, y: cy - 204, w: 200, h: 32, fontSize: 20, text: 'In Progress' }),
        base({ kind: 'text', x: cx + 170, y: cy - 204, w: 200, h: 32, fontSize: 20, text: 'Done' }),
        base({ kind: 'sticky', x: cx - 370, y: cy - 155, w: 200, h: 110, stickyBg: STICKY_COLORS[0].bg, text: 'Warm-up exercise' }),
        base({ kind: 'sticky', x: cx - 100, y: cy - 155, w: 200, h: 110, stickyBg: STICKY_COLORS[3].bg, text: 'Group problem solving' }),
        base({ kind: 'sticky', x: cx + 170, y: cy - 155, w: 200, h: 110, stickyBg: STICKY_COLORS[1].bg, text: 'Review homework' }),
      ]
    case 'matrix2x2':
      return [
        base({ kind: 'arrow', x: cx - 320, y: cy, w: 640, h: 0, points: [cx - 320, cy, cx + 320, cy], strokeWidth: 3 }),
        base({ kind: 'arrow', x: cx, y: cy + 260, w: 0, h: -520, points: [cx, cy + 260, cx, cy - 260], strokeWidth: 3 }),
        base({ kind: 'text', x: cx - 280, y: cy - 240, w: 200, h: 30, fontSize: 18, text: 'High Impact / Low Effort' }),
        base({ kind: 'text', x: cx + 40, y: cy - 240, w: 220, h: 30, fontSize: 18, text: 'High Impact / High Effort' }),
        base({ kind: 'text', x: cx - 280, y: cy + 200, w: 200, h: 30, fontSize: 18, text: 'Low Impact / Low Effort' }),
        base({ kind: 'text', x: cx + 40, y: cy + 200, w: 220, h: 30, fontSize: 18, text: 'Low Impact / High Effort' }),
        base({ kind: 'sticky', x: cx - 230, y: cy - 160, w: 150, h: 100, stickyBg: STICKY_COLORS[1].bg, text: 'Quick wins' }),
        base({ kind: 'sticky', x: cx + 80, y: cy - 160, w: 150, h: 100, stickyBg: STICKY_COLORS[0].bg, text: 'Major projects' }),
      ]
    case 'coordGrid': {
      const items: BoardElement[] = [
        base({ kind: 'arrow', x: cx - 320, y: cy, w: 640, h: 0, points: [cx - 320, cy, cx + 320, cy], strokeWidth: 2.5 }),
        base({ kind: 'arrow', x: cx, y: cy + 260, w: 0, h: -520, points: [cx, cy + 260, cx, cy - 260], strokeWidth: 2.5 }),
        base({ kind: 'text', x: cx + 305, y: cy + 12, w: 40, h: 28, fontSize: 18, text: 'X' }),
        base({ kind: 'text', x: cx + 14, y: cy - 265, w: 40, h: 28, fontSize: 18, text: 'Y' }),
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
  for (const el of [...elements].sort((a, b) => a.zIndex - b.zIndex)) {
    drawBoardElement(ctx, el)
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

  for (const el of [...elements].sort((a, b) => a.zIndex - b.zIndex)) {
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
    } else if (el.kind === 'rect' || el.kind === 'rounded-rect') {
      const rx = el.kind === 'rounded-rect' ? 14 : 0
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
        `<text x="${b.x}" y="${b.y + px}" fill="${el.strokeColor}" font-family="sans-serif" font-size="${px}" opacity="${op}"${tf}>${tspans}</text>`,
      )
    } else if (el.kind === 'image' && el.imageDataUrl) {
      parts.push(
        `<image href="${el.imageDataUrl}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" opacity="${op}"${tf} />`,
      )
    }
  }
  parts.push('</svg>')
  return parts.join('\n')
}

export function exportBoardJson(elements: BoardElement[]): string {
  return JSON.stringify({ version: 1, app: 'lectern', elements }, null, 2)
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
