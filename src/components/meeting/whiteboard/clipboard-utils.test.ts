import { describe, expect, it } from 'vitest'

import type { BoardElement } from './infinite-engine'
import {
  PASTE_OFFSET_PX,
  cloneBoardElementsWithOffset,
  computeFittedImageSize,
  computeWrappedTextMetrics,
  extractPastedImageBlobs,
  extractPastedText,
  isEditableEventTarget,
  stripHtmlToPlainText,
} from './clipboard-utils'

describe('whiteboard clipboard & paste utilities', () => {
  it('detects editable targets and ignores canvas/body targets', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const editableDiv = document.createElement('div')
    editableDiv.setAttribute('contenteditable', 'true')
    const nestedSpan = document.createElement('span')
    editableDiv.appendChild(nestedSpan)
    const canvas = document.createElement('canvas')

    expect(isEditableEventTarget(input)).toBe(true)
    expect(isEditableEventTarget(textarea)).toBe(true)
    expect(isEditableEventTarget(editableDiv)).toBe(true)
    expect(isEditableEventTarget(nestedSpan)).toBe(true)
    expect(isEditableEventTarget(canvas)).toBe(false)
    expect(isEditableEventTarget(document.body)).toBe(false)
    expect(isEditableEventTarget(null)).toBe(false)
  })

  it('strips HTML safely while preserving line breaks and math entities', () => {
    const html =
      '<style>.x{color:red}</style><script>alert(1)</script><p>Euler&apos;s identity:</p><div>e^(i&pi;) + 1 = 0<br/>&#8747; x dx = x&sup2;/2</div>'
    const text = stripHtmlToPlainText(html)
    expect(text).not.toContain('alert')
    expect(text).not.toContain('color:red')
    expect(text).toContain("Euler's identity:\n")
    expect(text).toContain('\n∫ x dx')
  })

  it('extracts plain text first and falls back to stripped HTML', () => {
    const plainClipboard = {
      getData: (fmt: string) =>
        fmt === 'text/plain' ? 'Line 1\r\nLine 2' : '<p>Ignored</p>',
    }
    expect(extractPastedText(plainClipboard)).toBe('Line 1\nLine 2')

    const htmlOnlyClipboard = {
      getData: (fmt: string) =>
        fmt === 'text/html' ? '<p>First</p><p>Second</p>' : '',
    }
    expect(extractPastedText(htmlOnlyClipboard)).toBe('First\nSecond')
  })

  it('extracts image blobs from clipboard items or files', () => {
    const fakePng = new File(['png-bytes'], 'snip.png', { type: 'image/png' })
    const fromItems = extractPastedImageBlobs({
      items: [
        {
          kind: 'file',
          type: 'image/png',
          getAsFile: () => fakePng,
        },
      ],
    })
    expect(fromItems).toHaveLength(1)
    expect(fromItems[0]).toBe(fakePng)

    const fromFiles = extractPastedImageBlobs({
      items: [],
      files: [fakePng],
    })
    expect(fromFiles).toHaveLength(1)
    expect(fromFiles[0]).toBe(fakePng)
  })

  it('computes clean wrapped dimensions for multi-line text', () => {
    const single = computeWrappedTextMetrics('E = mc²', 20)
    expect(single.width).toBeGreaterThanOrEqual(180)
    expect(single.lineCount).toBe(1)

    const multi = computeWrappedTextMetrics(
      'Theorem 1:\nLet f(x) be continuous on [a, b] and differentiable on (a, b). Then there exists c in (a, b) such that f\'(c) = (f(b) - f(a)) / (b - a).',
      20,
      460,
    )
    expect(multi.width).toBeLessThanOrEqual(460)
    expect(multi.lineCount).toBeGreaterThanOrEqual(3)
    expect(multi.height).toBeGreaterThan(single.height)
  })

  it('preserves aspect ratio when fitting large images to the viewport', () => {
    const wide = computeFittedImageSize(1400, 700, 560)
    expect(wide.width).toBe(560)
    expect(wide.height).toBe(280)

    const tall = computeFittedImageSize(600, 1200, 560)
    expect(tall.height).toBe(560)
    expect(tall.width).toBe(280)

    const small = computeFittedImageSize(300, 200, 560)
    expect(small.width).toBe(300)
    expect(small.height).toBe(200)
  })

  it('clones selected elements with unique IDs and (+24, +24) offset', () => {
    const rect: BoardElement = {
      id: 'el-1',
      kind: 'rect',
      x: 100,
      y: 200,
      w: 120,
      h: 80,
      rotation: 0,
      strokeColor: '#236446',
      fillColor: 'transparent',
      strokeWidth: 2,
      strokeStyle: 'solid',
      opacity: 1,
      locked: true,
      zIndex: 5,
      author: 'u1',
      createdAt: 1000,
    }
    const stroke: BoardElement = {
      id: 'el-2',
      kind: 'pen',
      x: 10,
      y: 20,
      w: 50,
      h: 30,
      points: [10, 20, 60, 50],
      rotation: 0,
      strokeColor: '#1f2924',
      fillColor: 'transparent',
      strokeWidth: 3,
      strokeStyle: 'solid',
      opacity: 1,
      zIndex: 6,
      author: 'u1',
      createdAt: 1001,
    }

    const cloned = cloneBoardElementsWithOffset([rect, stroke], [rect, stroke])
    expect(cloned).toHaveLength(2)
    expect(cloned[0].id).not.toBe(rect.id)
    expect(cloned[1].id).not.toBe(stroke.id)
    expect(cloned[0].id).not.toBe(cloned[1].id)
    expect(cloned[0].x).toBe(100 + PASTE_OFFSET_PX)
    expect(cloned[0].y).toBe(200 + PASTE_OFFSET_PX)
    expect(cloned[0].locked).toBe(false)
    expect(cloned[0].zIndex).toBe(7)
    expect(cloned[1].zIndex).toBe(8)
    expect(cloned[1].points).toEqual([
      10 + PASTE_OFFSET_PX,
      20 + PASTE_OFFSET_PX,
      60 + PASTE_OFFSET_PX,
      50 + PASTE_OFFSET_PX,
    ])
  })
})
