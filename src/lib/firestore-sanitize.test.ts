import { describe, expect, it } from 'vitest'
import { arrayUnion } from 'firebase/firestore'
import { stripUndefined } from './firestore-sanitize'

describe('stripUndefined', () => {
  it('removes top-level and nested undefined keys while preserving null, zero, false, and empty strings', () => {
    const input = {
      id: 'el-1',
      kind: 'pen',
      x: 0,
      y: 0,
      locked: false,
      text: '',
      nullable: null,
      points: [10, 20, 30, 40],
      pointWidths: undefined,
      penPreset: undefined,
      startAnchor: {
        elementId: 'shape-1',
        side: 'top',
        extra: undefined,
      },
      pdfDeckId: undefined,
      pdfDeckPage: undefined,
    }

    const result = stripUndefined(input) as Record<string, unknown>
    expect(result).toEqual({
      id: 'el-1',
      kind: 'pen',
      x: 0,
      y: 0,
      locked: false,
      text: '',
      nullable: null,
      points: [10, 20, 30, 40],
      startAnchor: {
        elementId: 'shape-1',
        side: 'top',
      },
    })
    expect('pointWidths' in result).toBe(false)
    expect('penPreset' in result).toBe(false)
    expect('pdfDeckId' in result).toBe(false)
    expect('pdfDeckPage' in result).toBe(false)
  })

  it('strips undefined values from arrays and objects inside arrays', () => {
    const input = {
      items: [
        { id: 'a', note: undefined },
        undefined,
        { id: 'b', note: 'kept' },
      ],
    }
    expect(stripUndefined(input)).toEqual({
      items: [{ id: 'a' }, { id: 'b', note: 'kept' }],
    })
  })

  it('preserves Firestore FieldValue sentinels like arrayUnion and Date instances', () => {
    const union = arrayUnion('uid-123')
    const now = new Date('2026-01-01T00:00:00Z')
    const input = {
      memberIds: union,
      createdAt: now,
      ignored: undefined,
    }
    const result = stripUndefined(input)
    expect(result.memberIds).toBe(union)
    expect(result.createdAt).toBe(now)
    expect('ignored' in result).toBe(false)
  })
})
