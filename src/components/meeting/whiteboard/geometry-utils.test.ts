import { describe, expect, it } from 'vitest'

import {
  alignElements,
  computeSnapAndGuides,
  createMindMapBranch,
  distributeElements,
  findNearestAnchor,
  parsePdfPageSelection,
  recognizeSmartShape,
  reorderElementsZ,
  updateAttachedConnectors,
} from './geometry-utils'
import type { BoardElement } from './infinite-engine'

function makeEl(partial: Partial<BoardElement> & { id: string }): BoardElement {
  return {
    kind: 'rect',
    x: 0,
    y: 0,
    w: 100,
    h: 60,
    rotation: 0,
    strokeColor: '#236446',
    fillColor: 'transparent',
    strokeWidth: 2,
    strokeStyle: 'solid',
    opacity: 1,
    zIndex: 1,
    author: 'u1',
    createdAt: 1,
    ...partial,
  }
}

describe('whiteboard geometry-utils', () => {
  it('recognizes straight line, circle, rectangle, and triangle with Smart Shape Pen', () => {
    const base = makeEl({ id: 'p1', kind: 'pen' })

    // Straight line
    const linePts: number[] = []
    for (let i = 0; i <= 10; i++) linePts.push(i * 20, i * 5)
    const line = recognizeSmartShape(linePts, base)
    expect(line?.kind).toBe('line')

    // Circle
    const circlePts: number[] = []
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2
      circlePts.push(200 + Math.cos(a) * 60, 200 + Math.sin(a) * 60)
    }
    const circle = recognizeSmartShape(circlePts, base)
    expect(circle?.kind).toBe('ellipse')

    // Rectangle
    const rectPts: number[] = []
    for (let i = 0; i <= 10; i++) rectPts.push(100 + i * 16, 100)
    for (let i = 1; i <= 10; i++) rectPts.push(260, 100 + i * 10)
    for (let i = 1; i <= 10; i++) rectPts.push(260 - i * 16, 200)
    for (let i = 1; i <= 10; i++) rectPts.push(100, 200 - i * 10)
    const rect = recognizeSmartShape(rectPts, base)
    expect(rect?.kind).toBe('rect')

    // Triangle
    const triPts: number[] = []
    for (let i = 0; i <= 10; i++) triPts.push(150 + i * 8, 50 + i * 12)
    for (let i = 1; i <= 10; i++) triPts.push(230 - i * 16, 170)
    for (let i = 1; i <= 10; i++) triPts.push(70 + i * 8, 170 - i * 12)
    const tri = recognizeSmartShape(triPts, base)
    expect(tri?.kind).toBe('triangle')
  })

  it('aligns and distributes multi-selected elements accurately', () => {
    const els = [
      makeEl({ id: 'a', x: 10, y: 20, w: 40, h: 40 }),
      makeEl({ id: 'b', x: 120, y: 80, w: 40, h: 40 }),
      makeEl({ id: 'c', x: 250, y: 140, w: 40, h: 40 }),
    ]

    const alignedLeft = alignElements(els, ['a', 'b', 'c'], 'left')
    expect(alignedLeft.next.map((e) => e.x)).toEqual([10, 10, 10])

    const distH = distributeElements(els, ['a', 'b', 'c'], 'horizontal')
    expect(distH.next.map((e) => Math.round(e.x))).toEqual([10, 130, 250])
  })

  it('supports 4-way layer ordering (front, forward, backward, back)', () => {
    const els = [
      makeEl({ id: 'a', zIndex: 1 }),
      makeEl({ id: 'b', zIndex: 2 }),
      makeEl({ id: 'c', zIndex: 3 }),
    ]
    const fwd = reorderElementsZ(els, ['a'], 'forward').next
    expect(fwd.find((e) => e.id === 'a')?.zIndex).toBe(2)
    expect(fwd.find((e) => e.id === 'b')?.zIndex).toBe(1)

    const back = reorderElementsZ(els, ['c'], 'back').next
    expect(back.find((e) => e.id === 'c')?.zIndex).toBe(1)
  })

  it('snaps connectors to shape anchors and keeps them attached when moving shapes', () => {
    const box1 = makeEl({ id: 'box1', x: 0, y: 0, w: 100, h: 100 })
    const box2 = makeEl({ id: 'box2', x: 300, y: 0, w: 100, h: 100 })
    const hit = findNearestAnchor([box1, box2], 103, 52, new Set())
    expect(hit?.anchor).toEqual({ elementId: 'box1', side: 'right' })

    const arrow = makeEl({
      id: 'arr1',
      kind: 'arrow',
      x: 100,
      y: 50,
      w: 200,
      h: 0,
      points: [100, 50, 300, 50],
      startAnchor: { elementId: 'box1', side: 'right' },
      endAnchor: { elementId: 'box2', side: 'left' },
    })

    const movedBox2 = { ...box2, x: 400, y: 100 }
    const { next, updatedConnectors } = updateAttachedConnectors(
      [box1, movedBox2, arrow],
      new Set(['box2']),
    )
    expect(updatedConnectors).toHaveLength(1)
    const updatedArrow = next.find((e) => e.id === 'arr1')!
    expect(updatedArrow.points).toEqual([100, 50, 400, 150])
  })

  it('computes smart alignment guides and snap-to-grid deltas', () => {
    const other = makeEl({ id: 'o1', x: 100, y: 100, w: 100, h: 60 })
    const res = computeSnapAndGuides(
      { x: 103, y: 240, w: 80, h: 50 },
      [other],
      { snapToGrid: false, tolerance: 6 },
    )
    expect(res.dx).toBe(-3)
    expect(res.guides.some((g) => g.axis === 'x' && g.pos === 100)).toBe(true)
  })

  it('creates connected mind map branch nodes and parses PDF page ranges', () => {
    const root = makeEl({ id: 'root', kind: 'rounded-rect', x: 0, y: 0, w: 200, h: 80 })
    const { node, connector } = createMindMapBranch(root, [root], 'teacher')
    expect(connector.startAnchor?.elementId).toBe('root')
    expect(connector.endAnchor?.elementId).toBe(node.id)

    expect(parsePdfPageSelection('1-3, 5, 8-9', 10)).toEqual([0, 1, 2, 4, 7, 8])
    expect(parsePdfPageSelection('all', 4)).toEqual([0, 1, 2, 3])
    expect(parsePdfPageSelection('99, 2-1', 5)).toEqual([0, 1])
  })
})
