import { describe, expect, it } from 'vitest'
import { stripUndefinedDeep } from './firestore-sanitize'

class FakeFieldValue {
  readonly kind = 'arrayUnion'
  constructor(public readonly values: string[]) {}
}

describe('stripUndefinedDeep', () => {
  it('removes top-level and nested undefined keys while preserving null and primitives', () => {
    const input = {
      id: 'el-1',
      kind: 'pen',
      points: [1, 2, 3, 4],
      pointWidths: undefined,
      penPreset: undefined,
      startAnchor: undefined,
      nested: {
        a: 1,
        b: undefined,
        c: null,
        d: '',
        e: false,
      },
    }
    const result = stripUndefinedDeep(input)
    expect(result).toEqual({
      id: 'el-1',
      kind: 'pen',
      points: [1, 2, 3, 4],
      nested: {
        a: 1,
        c: null,
        d: '',
        e: false,
      },
    })
    expect('pointWidths' in result).toBe(false)
    expect('b' in result.nested).toBe(false)
  })

  it('filters undefined array items and cleans objects inside arrays', () => {
    const input = {
      items: [
        { id: '1', label: undefined },
        undefined,
        { id: '2', label: 'ok' },
      ],
    }
    expect(stripUndefinedDeep(input)).toEqual({
      items: [{ id: '1' }, { id: '2', label: 'ok' }],
    })
  })

  it('preserves non-plain class instances like Firestore FieldValue sentinels and Date', () => {
    const sentinel = new FakeFieldValue(['uid-1'])
    const now = new Date('2026-11-27T00:00:00.000Z')
    const input = {
      memberIds: sentinel,
      createdAt: now,
      ignored: undefined,
    }
    const result = stripUndefinedDeep(input)
    expect(result.memberIds).toBe(sentinel)
    expect(result.createdAt).toBe(now)
    expect('ignored' in result).toBe(false)
  })
})
