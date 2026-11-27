/**
 * Pure geometry & layout helpers for Lectern Infinite Whiteboard:
 * - Smart Shape Pen auto-recognition (line, arrow, circle/ellipse, rect, triangle)
 * - 6-way Align & H/V Distribute
 * - 4-way Layering (front, forward, backward, back)
 * - Smart Connector anchor points & auto-follow when shapes move/resize
 * - Snap-to-grid & smart edge/center alignment guides
 * - Mind Map quick branch builder
 * - PDF page range parser
 */

import {
  STICKY_COLORS,
  getElementBounds,
  makeElementId,
  translateElement,
  type AnchorSide,
  type BoardElement,
  type ConnectorAnchor,
  type Rect,
} from './infinite-engine'

export type AlignmentKind =
  | 'left'
  | 'center'
  | 'right'
  | 'top'
  | 'middle'
  | 'bottom'

export type LayerDirection = 'front' | 'forward' | 'backward' | 'back'

export interface AlignmentGuide {
  axis: 'x' | 'y'
  pos: number
  from: number
  to: number
}

// ---------------------------------------------------------------------------
// 1. Smart Shape Pen Recognizer (Auto-Shape)
// ---------------------------------------------------------------------------

function pointToSegDist(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const dx = x1 - x0
  const dy = y1 - y0
  const l2 = dx * dx + dy * dy
  let t = l2 === 0 ? 0 : ((px - x0) * dx + (py - y0) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
}

function rdpSimplify(
  pts: { x: number; y: number }[],
  epsilon: number,
): { x: number; y: number }[] {
  if (pts.length <= 2) return pts
  let maxDist = 0
  let index = 0
  const end = pts.length - 1
  for (let i = 1; i < end; i++) {
    const d = pointToSegDist(
      pts[i].x,
      pts[i].y,
      pts[0].x,
      pts[0].y,
      pts[end].x,
      pts[end].y,
    )
    if (d > maxDist) {
      maxDist = d
      index = i
    }
  }
  if (maxDist > epsilon) {
    const left = rdpSimplify(pts.slice(0, index + 1), epsilon)
    const right = rdpSimplify(pts.slice(index), epsilon)
    return [...left.slice(0, -1), ...right]
  }
  return [pts[0], pts[end]]
}

/**
 * Recognizes rough freehand strokes into crisp vector shapes:
 * - straight line / arrow (open stroke)
 * - circle / ellipse, rectangle, or triangle (closed stroke)
 * Returns null if the stroke is too small or too complex to snap.
 */
export function recognizeSmartShape(
  flatPoints: number[],
  base: BoardElement,
): BoardElement | null {
  if (flatPoints.length < 6) return null
  const pts: { x: number; y: number }[] = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let pathLen = 0
  for (let i = 0; i < flatPoints.length; i += 2) {
    const x = flatPoints[i]
    const y = flatPoints[i + 1]
    if (pts.length > 0) {
      const prev = pts[pts.length - 1]
      pathLen += Math.hypot(x - prev.x, y - prev.y)
    }
    pts.push({ x, y })
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }

  const w = maxX - minX
  const h = maxY - minY
  const diag = Math.hypot(w, h)
  if (diag < 28 || pathLen < 28) return null

  const start = pts[0]
  const end = pts[pts.length - 1]
  const endToEnd = Math.hypot(end.x - start.x, end.y - start.y)

  // Check Straight Line first (open stroke with low deviation from start->end chord)
  if (endToEnd > diag * 0.72) {
    let maxDev = 0
    for (const p of pts) {
      const d = pointToSegDist(p.x, p.y, start.x, start.y, end.x, end.y)
      if (d > maxDev) maxDev = d
    }
    if (maxDev <= Math.max(12, diag * 0.1)) {
      return {
        ...base,
        kind: 'line',
        penPreset: undefined,
        pointWidths: undefined,
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        w: end.x - start.x,
        h: end.y - start.y,
        points: [start.x, start.y, end.x, end.y],
      }
    }
    // Check Arrow: first 70% is roughly straight, tail hooks back at the end
    const splitIdx = Math.floor(pts.length * 0.7)
    if (splitIdx >= 3) {
      const tip = pts[splitIdx]
      const shaftLen = Math.hypot(tip.x - start.x, tip.y - start.y)
      let shaftDev = 0
      for (let i = 0; i <= splitIdx; i++) {
        shaftDev = Math.max(
          shaftDev,
          pointToSegDist(pts[i].x, pts[i].y, start.x, start.y, tip.x, tip.y),
        )
      }
      const tailBack = Math.hypot(end.x - tip.x, end.y - tip.y)
      if (
        shaftLen > 30 &&
        shaftDev <= Math.max(12, shaftLen * 0.12) &&
        tailBack > 10 &&
        tailBack < shaftLen * 0.55
      ) {
        return {
          ...base,
          kind: 'arrow',
          penPreset: undefined,
          pointWidths: undefined,
          x: Math.min(start.x, tip.x),
          y: Math.min(start.y, tip.y),
          w: tip.x - start.x,
          h: tip.y - start.y,
          points: [start.x, start.y, tip.x, tip.y],
        }
      }
    }
  }

  // Closed shape test (start & end close relative to bounding box diagonal)
  const closed = endToEnd <= Math.max(42, diag * 0.36)
  if (!closed || w < 18 || h < 18) return null

  const cx = minX + w / 2
  const cy = minY + h / 2
  const rx = w / 2
  const ry = h / 2

  // Normalized ellipse error: |(x-cx)^2/rx^2 + (y-cy)^2/ry^2 - 1|
  let ellipseErrSum = 0
  for (const p of pts) {
    const nx = (p.x - cx) / rx
    const ny = (p.y - cy) / ry
    const r = Math.hypot(nx, ny)
    ellipseErrSum += Math.abs(r - 1)
  }
  const ellipseErr = ellipseErrSum / pts.length

  // Polygon simplification (closed loop)
  const simp = rdpSimplify([...pts, start], Math.max(10, diag * 0.085))
  // Remove closing duplicate vertex
  const vertices =
    simp.length > 1 &&
    Math.hypot(
      simp[0].x - simp[simp.length - 1].x,
      simp[0].y - simp[simp.length - 1].y,
    ) < Math.max(18, diag * 0.14)
      ? simp.slice(0, -1)
      : simp

  // Triangle check: 3 corners & noticeably worse fit as an ellipse
  if (vertices.length === 3 && ellipseErr > 0.14) {
    return {
      ...base,
      kind: 'triangle',
      penPreset: undefined,
      pointWidths: undefined,
      points: undefined,
      x: minX,
      y: minY,
      w,
      h,
    }
  }

  // Rectangle check: 4 corners and points cling closely to bounding box edges
  let rectEdgeErrSum = 0
  for (const p of pts) {
    const dEdge = Math.min(
      Math.abs(p.x - minX),
      Math.abs(p.x - maxX),
      Math.abs(p.y - minY),
      Math.abs(p.y - maxY),
    )
    rectEdgeErrSum += dEdge / Math.max(1, Math.min(w, h))
  }
  const rectErr = rectEdgeErrSum / pts.length

  if (ellipseErr < 0.17 && ellipseErr < rectErr * 1.15) {
    // Snap near-circles to perfect circles
    const aspect = w / h
    let fw = w
    let fh = h
    let fx = minX
    let fy = minY
    if (aspect > 0.85 && aspect < 1.18) {
      const size = (w + h) / 2
      fw = size
      fh = size
      fx = cx - size / 2
      fy = cy - size / 2
    }
    return {
      ...base,
      kind: 'ellipse',
      penPreset: undefined,
      pointWidths: undefined,
      points: undefined,
      x: fx,
      y: fy,
      w: fw,
      h: fh,
    }
  }

  if (vertices.length === 4 || rectErr < 0.13) {
    return {
      ...base,
      kind: 'rect',
      penPreset: undefined,
      pointWidths: undefined,
      points: undefined,
      x: minX,
      y: minY,
      w,
      h,
    }
  }

  if (ellipseErr < 0.24) {
    return {
      ...base,
      kind: 'ellipse',
      penPreset: undefined,
      pointWidths: undefined,
      points: undefined,
      x: minX,
      y: minY,
      w,
      h,
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// 2. Align & Distribute (Multi-Selection)
// ---------------------------------------------------------------------------

export function alignElements(
  elements: BoardElement[],
  selectedIds: string[],
  alignment: AlignmentKind,
): { next: BoardElement[]; changed: BoardElement[] } {
  const selSet = new Set(selectedIds)
  const targets = elements.filter((e) => selSet.has(e.id) && !e.locked)
  if (targets.length < 2) return { next: elements, changed: [] }

  const boundsById = new Map<string, Rect>()
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const el of targets) {
    const b = getElementBounds(el)
    boundsById.set(el.id, b)
    if (b.x < minX) minX = b.x
    if (b.y < minY) minY = b.y
    if (b.x + b.w > maxX) maxX = b.x + b.w
    if (b.y + b.h > maxY) maxY = b.y + b.h
  }
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2

  const changed: BoardElement[] = []
  const next = elements.map((el) => {
    const b = boundsById.get(el.id)
    if (!b) return el
    let dx = 0
    let dy = 0
    switch (alignment) {
      case 'left':
        dx = minX - b.x
        break
      case 'center':
        dx = midX - (b.x + b.w / 2)
        break
      case 'right':
        dx = maxX - (b.x + b.w)
        break
      case 'top':
        dy = minY - b.y
        break
      case 'middle':
        dy = midY - (b.y + b.h / 2)
        break
      case 'bottom':
        dy = maxY - (b.y + b.h)
        break
    }
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return el
    const moved = translateElement(el, dx, dy)
    changed.push(moved)
    return moved
  })
  return { next, changed }
}

export function distributeElements(
  elements: BoardElement[],
  selectedIds: string[],
  axis: 'horizontal' | 'vertical',
): { next: BoardElement[]; changed: BoardElement[] } {
  const selSet = new Set(selectedIds)
  const targets = elements.filter((e) => selSet.has(e.id) && !e.locked)
  if (targets.length < 3) return { next: elements, changed: [] }

  const items = targets.map((el) => ({ el, b: getElementBounds(el) }))
  items.sort((a, c) => (axis === 'horizontal' ? a.b.x - c.b.x : a.b.y - c.b.y))

  const first = items[0].b
  const last = items[items.length - 1].b
  const deltaById = new Map<string, { dx: number; dy: number }>()

  if (axis === 'horizontal') {
    const totalW = items.reduce((sum, it) => sum + it.b.w, 0)
    const span = last.x + last.w - first.x
    const gap = (span - totalW) / (items.length - 1)
    let cursor = first.x
    for (const it of items) {
      const dx = cursor - it.b.x
      if (Math.abs(dx) > 0.01) deltaById.set(it.el.id, { dx, dy: 0 })
      cursor += it.b.w + gap
    }
  } else {
    const totalH = items.reduce((sum, it) => sum + it.b.h, 0)
    const span = last.y + last.h - first.y
    const gap = (span - totalH) / (items.length - 1)
    let cursor = first.y
    for (const it of items) {
      const dy = cursor - it.b.y
      if (Math.abs(dy) > 0.01) deltaById.set(it.el.id, { dx: 0, dy })
      cursor += it.b.h + gap
    }
  }

  const changed: BoardElement[] = []
  const next = elements.map((el) => {
    const d = deltaById.get(el.id)
    if (!d) return el
    const moved = translateElement(el, d.dx, d.dy)
    changed.push(moved)
    return moved
  })
  return { next, changed }
}

// ---------------------------------------------------------------------------
// 3. Full 4-Way Layer Ordering
// ---------------------------------------------------------------------------

export function reorderElementsZ(
  elements: BoardElement[],
  selectedIds: string[],
  dir: LayerDirection,
): { next: BoardElement[]; changed: BoardElement[] } {
  if (selectedIds.length === 0 || elements.length < 2) {
    return { next: elements, changed: [] }
  }
  const selSet = new Set(selectedIds)
  const ordered = [...elements].sort((a, b) => a.zIndex - b.zIndex)
  let nextOrder: BoardElement[]

  if (dir === 'front') {
    const rest = ordered.filter((e) => !selSet.has(e.id))
    const picked = ordered.filter((e) => selSet.has(e.id))
    nextOrder = [...rest, ...picked]
  } else if (dir === 'back') {
    const picked = ordered.filter((e) => selSet.has(e.id))
    const rest = ordered.filter((e) => !selSet.has(e.id))
    nextOrder = [...picked, ...rest]
  } else if (dir === 'forward') {
    nextOrder = [...ordered]
    for (let i = nextOrder.length - 2; i >= 0; i--) {
      if (selSet.has(nextOrder[i].id) && !selSet.has(nextOrder[i + 1].id)) {
        const tmp = nextOrder[i]
        nextOrder[i] = nextOrder[i + 1]
        nextOrder[i + 1] = tmp
      }
    }
  } else {
    nextOrder = [...ordered]
    for (let i = 1; i < nextOrder.length; i++) {
      if (selSet.has(nextOrder[i].id) && !selSet.has(nextOrder[i - 1].id)) {
        const tmp = nextOrder[i]
        nextOrder[i] = nextOrder[i - 1]
        nextOrder[i - 1] = tmp
      }
    }
  }

  const newZById = new Map<string, number>()
  nextOrder.forEach((el, idx) => newZById.set(el.id, idx + 1))

  const changed: BoardElement[] = []
  const next = elements.map((el) => {
    const z = newZById.get(el.id) ?? el.zIndex
    if (z === el.zIndex) return el
    const updated = { ...el, zIndex: z }
    changed.push(updated)
    return updated
  })
  return { next, changed }
}

// ---------------------------------------------------------------------------
// 4. Smart Connectors (Anchor Snapping + Auto-Follow)
// ---------------------------------------------------------------------------

export function isConnectableShape(el: BoardElement): boolean {
  return (
    el.kind === 'rect' ||
    el.kind === 'rounded-rect' ||
    el.kind === 'ellipse' ||
    el.kind === 'triangle' ||
    el.kind === 'diamond' ||
    el.kind === 'star' ||
    el.kind === 'speech-bubble' ||
    el.kind === 'sticky' ||
    el.kind === 'table' ||
    el.kind === 'image'
  )
}

export function getElementAnchorPoints(
  el: BoardElement,
): Record<AnchorSide, { x: number; y: number }> {
  const b = getElementBounds(el)
  return {
    top: { x: b.x + b.w / 2, y: b.y },
    right: { x: b.x + b.w, y: b.y + b.h / 2 },
    bottom: { x: b.x + b.w / 2, y: b.y + b.h },
    left: { x: b.x, y: b.y + b.h / 2 },
  }
}

export function findNearestAnchor(
  elements: BoardElement[],
  wx: number,
  wy: number,
  excludeIds: Set<string>,
  maxDist = 22,
): { anchor: ConnectorAnchor; x: number; y: number } | null {
  let best: { anchor: ConnectorAnchor; x: number; y: number; dist: number } | null =
    null
  for (const el of elements) {
    if (excludeIds.has(el.id) || !isConnectableShape(el)) continue
    const anchors = getElementAnchorPoints(el)
    for (const side of ['top', 'right', 'bottom', 'left'] as AnchorSide[]) {
      const pt = anchors[side]
      const dist = Math.hypot(wx - pt.x, wy - pt.y)
      if (dist <= maxDist && (!best || dist < best.dist)) {
        best = { anchor: { elementId: el.id, side }, x: pt.x, y: pt.y, dist }
      }
    }
  }
  return best ? { anchor: best.anchor, x: best.x, y: best.y } : null
}

/**
 * Keeps all attached line/arrow connectors stuck to their shapes when those shapes move or resize.
 */
export function updateAttachedConnectors(
  elements: BoardElement[],
  movedIds: Set<string>,
): { next: BoardElement[]; updatedConnectors: BoardElement[] } {
  const byId = new Map(elements.map((e) => [e.id, e]))
  const updatedConnectors: BoardElement[] = []
  const next = elements.map((el) => {
    if (el.kind !== 'line' && el.kind !== 'arrow') return el
    if (!el.startAnchor && !el.endAnchor) return el
    const startHit = el.startAnchor && movedIds.has(el.startAnchor.elementId)
    const endHit = el.endAnchor && movedIds.has(el.endAnchor.elementId)
    if (!startHit && !endHit) return el

    const pts = el.points ? [...el.points] : [el.x, el.y, el.x + el.w, el.y + el.h]
    if (el.startAnchor) {
      const target = byId.get(el.startAnchor.elementId)
      if (target) {
        const pt = getElementAnchorPoints(target)[el.startAnchor.side]
        pts[0] = pt.x
        pts[1] = pt.y
      }
    }
    if (el.endAnchor) {
      const target = byId.get(el.endAnchor.elementId)
      if (target) {
        const pt = getElementAnchorPoints(target)[el.endAnchor.side]
        pts[2] = pt.x
        pts[3] = pt.y
      }
    }
    const updated: BoardElement = {
      ...el,
      points: pts,
      x: Math.min(pts[0], pts[2]),
      y: Math.min(pts[1], pts[3]),
      w: pts[2] - pts[0],
      h: pts[3] - pts[1],
    }
    updatedConnectors.push(updated)
    return updated
  })
  return { next, updatedConnectors }
}

// ---------------------------------------------------------------------------
// 5. Snap-to-Grid & Smart Alignment Guides
// ---------------------------------------------------------------------------

export function computeSnapAndGuides(
  moving: Rect,
  others: BoardElement[],
  opts: {
    snapToGrid: boolean
    gridStep?: number
    tolerance?: number
  },
): { dx: number; dy: number; guides: AlignmentGuide[] } {
  const tol = opts.tolerance ?? 6
  const guides: AlignmentGuide[] = []
  let dx = 0
  let dy = 0
  let bestX = tol + 1
  let bestY = tol + 1

  const mLeft = moving.x
  const mCenter = moving.x + moving.w / 2
  const mRight = moving.x + moving.w
  const mTop = moving.y
  const mMiddle = moving.y + moving.h / 2
  const mBottom = moving.y + moving.h

  let bestXGuide: AlignmentGuide | null = null
  let bestYGuide: AlignmentGuide | null = null

  for (const el of others) {
    if (el.kind === 'pen' || el.kind === 'highlighter' || el.kind === 'pdf-page') {
      continue
    }
    const b = getElementBounds(el)
    const xTargets = [b.x, b.x + b.w / 2, b.x + b.w]
    const xSources = [mLeft, mCenter, mRight]
    for (const s of xSources) {
      for (const t of xTargets) {
        const diff = t - s
        if (Math.abs(diff) < bestX) {
          bestX = Math.abs(diff)
          dx = diff
          bestXGuide = {
            axis: 'x',
            pos: t,
            from: Math.min(mTop, b.y) - 24,
            to: Math.max(mBottom, b.y + b.h) + 24,
          }
        }
      }
    }

    const yTargets = [b.y, b.y + b.h / 2, b.y + b.h]
    const ySources = [mTop, mMiddle, mBottom]
    for (const s of ySources) {
      for (const t of yTargets) {
        const diff = t - s
        if (Math.abs(diff) < bestY) {
          bestY = Math.abs(diff)
          dy = diff
          bestYGuide = {
            axis: 'y',
            pos: t,
            from: Math.min(mLeft, b.x) - 24,
            to: Math.max(mRight, b.x + b.w) + 24,
          }
        }
      }
    }
  }

  if (bestXGuide && bestX <= tol) {
    guides.push(bestXGuide)
  } else if (opts.snapToGrid) {
    const step = opts.gridStep ?? 32
    dx = Math.round(moving.x / step) * step - moving.x
  } else {
    dx = 0
  }

  if (bestYGuide && bestY <= tol) {
    guides.push(bestYGuide)
  } else if (opts.snapToGrid) {
    const step = opts.gridStep ?? 32
    dy = Math.round(moving.y / step) * step - moving.y
  } else {
    dy = 0
  }

  return { dx, dy, guides }
}

// ---------------------------------------------------------------------------
// 6. Mind Map Quick Branch
// ---------------------------------------------------------------------------

export function createMindMapBranch(
  parent: BoardElement,
  existing: BoardElement[],
  author: string,
): { node: BoardElement; connector: BoardElement } {
  const b = getElementBounds(parent)
  const existingChildren = existing.filter(
    (e) =>
      (e.kind === 'arrow' || e.kind === 'line') &&
      e.startAnchor?.elementId === parent.id,
  ).length
  const maxZ = existing.reduce((m, e) => Math.max(m, e.zIndex), 0)
  const offsets = [
    { side: 'right' as AnchorSide, targetSide: 'left' as AnchorSide, dx: 260, dy: -80 },
    { side: 'right' as AnchorSide, targetSide: 'left' as AnchorSide, dx: 260, dy: 80 },
    { side: 'left' as AnchorSide, targetSide: 'right' as AnchorSide, dx: -260, dy: -80 },
    { side: 'left' as AnchorSide, targetSide: 'right' as AnchorSide, dx: -260, dy: 80 },
    { side: 'bottom' as AnchorSide, targetSide: 'top' as AnchorSide, dx: 0, dy: 190 },
    { side: 'top' as AnchorSide, targetSide: 'bottom' as AnchorSide, dx: 0, dy: -190 },
  ]
  const pick = offsets[existingChildren % offsets.length]
  const layerOffset = Math.floor(existingChildren / offsets.length) * 52
  const nw = 180
  const nh = 90
  const nx = b.x + b.w / 2 + pick.dx - nw / 2 + (pick.dx === 0 ? layerOffset : 0)
  const ny = b.y + b.h / 2 + pick.dy - nh / 2 + (pick.dx !== 0 ? layerOffset : 0)

  const nodeId = makeElementId()
  const now = Date.now()
  const node: BoardElement = {
    id: nodeId,
    kind: parent.kind === 'sticky' ? 'sticky' : 'rounded-rect',
    x: nx,
    y: ny,
    w: nw,
    h: nh,
    rotation: 0,
    strokeColor: '#236446',
    fillColor: parent.kind === 'sticky' ? 'transparent' : '#dcfce7',
    stickyBg:
      parent.kind === 'sticky'
        ? STICKY_COLORS[(existingChildren + 1) % STICKY_COLORS.length].bg
        : undefined,
    strokeWidth: 2.5,
    strokeStyle: 'solid',
    opacity: 1,
    text: `Branch ${existingChildren + 1}`,
    fontSize: 15,
    zIndex: maxZ + 2,
    author,
    createdAt: now,
  }

  const pAnchors = getElementAnchorPoints(parent)
  const cAnchors = getElementAnchorPoints(node)
  const sPt = pAnchors[pick.side]
  const ePt = cAnchors[pick.targetSide]

  const connector: BoardElement = {
    id: makeElementId(),
    kind: 'arrow',
    x: Math.min(sPt.x, ePt.x),
    y: Math.min(sPt.y, ePt.y),
    w: ePt.x - sPt.x,
    h: ePt.y - sPt.y,
    points: [sPt.x, sPt.y, ePt.x, ePt.y],
    rotation: 0,
    strokeColor: '#236446',
    fillColor: 'transparent',
    strokeWidth: 2.5,
    strokeStyle: 'solid',
    opacity: 1,
    startAnchor: { elementId: parent.id, side: pick.side },
    endAnchor: { elementId: nodeId, side: pick.targetSide },
    zIndex: maxZ + 1,
    author,
    createdAt: now,
  }

  return { node, connector }
}

// ---------------------------------------------------------------------------
// 7. PDF Page Range Parser (1-based input -> 0-based sorted unique indices)
// ---------------------------------------------------------------------------

export function parsePdfPageSelection(
  input: string,
  totalPages: number,
): number[] {
  if (totalPages <= 0) return []
  const cleaned = input.trim()
  if (!cleaned || cleaned.toLowerCase() === 'all') {
    return Array.from({ length: totalPages }, (_, i) => i)
  }
  const indices = new Set<number>()
  for (const part of cleaned.split(',')) {
    const token = part.trim()
    if (!token) continue
    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(token)
    if (rangeMatch) {
      let start = Number(rangeMatch[1])
      let end = Number(rangeMatch[2])
      if (start > end) [start, end] = [end, start]
      for (let p = Math.max(1, start); p <= Math.min(totalPages, end); p++) {
        indices.add(p - 1)
      }
    } else if (/^\d+$/.test(token)) {
      const p = Number(token)
      if (p >= 1 && p <= totalPages) indices.add(p - 1)
    }
  }
  return Array.from(indices).sort((a, b) => a - b)
}
