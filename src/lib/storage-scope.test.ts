import { beforeEach, describe, expect, it } from 'vitest'

import {
  getActiveStorageUid,
  purgeLegacyUnscopedStorage,
  purgeScopedStorageForUid,
  scopedStorageKey,
  setActiveStorageUid,
} from './storage-scope'

describe('storage-scope per-UID isolation', () => {
  beforeEach(() => {
    localStorage.clear()
    setActiveStorageUid(null)
  })

  it('namespaces keys per Firebase UID and returns null when logged out', () => {
    expect(scopedStorageKey('meetings')).toBeNull()

    setActiveStorageUid('uid-teacher-1')
    expect(getActiveStorageUid()).toBe('uid-teacher-1')
    expect(scopedStorageKey('meetings')).toBe('lectern_uid-teacher-1_meetings')
    expect(scopedStorageKey('prefs')).toBe('lectern_uid-teacher-1_prefs')

    // Switching to fresh guest yields completely distinct namespace
    setActiveStorageUid('uid-guest-fresh')
    expect(scopedStorageKey('meetings')).toBe(
      'lectern_uid-guest-fresh_meetings',
    )
    expect(scopedStorageKey('meetings')).not.toBe(
      scopedStorageKey('meetings', 'uid-teacher-1'),
    )
  })

  it('purges legacy unscoped keys without touching other UID-scoped keys', () => {
    localStorage.setItem('lectern-fs-meetings-v1', '{"LEC-1234-5678":{}}')
    localStorage.setItem('lectern-fs-boards-v1', '[]')
    localStorage.setItem('lectern-host:LEC-1234-5678', 'secret')
    localStorage.setItem('lectern-fs-wb-meeting:LEC-1234-5678', '[]')
    localStorage.setItem('lectern.prefs.v1', '{"name":"Old"}')
    localStorage.setItem('lectern.profile.v1', '{"displayName":"Old"}')
    localStorage.setItem('lectern_uid-teacher-1_meetings', '{"ok":true}')

    purgeLegacyUnscopedStorage()

    expect(localStorage.getItem('lectern-fs-meetings-v1')).toBeNull()
    expect(localStorage.getItem('lectern-fs-boards-v1')).toBeNull()
    expect(localStorage.getItem('lectern-host:LEC-1234-5678')).toBeNull()
    expect(localStorage.getItem('lectern-fs-wb-meeting:LEC-1234-5678')).toBeNull()
    expect(localStorage.getItem('lectern.prefs.v1')).toBeNull()
    expect(localStorage.getItem('lectern.profile.v1')).toBeNull()
    expect(localStorage.getItem('lectern_uid-teacher-1_meetings')).toBe(
      '{"ok":true}',
    )
  })

  it('purges all keys for a specific UID on guest reset or sign-out', () => {
    localStorage.setItem('lectern_guest-1_meetings', '{"a":1}')
    localStorage.setItem('lectern_guest-1_boards', '[]')
    localStorage.setItem('lectern_guest-1_prefs', '{}')
    localStorage.setItem('lectern_teacher-1_meetings', '{"b":2}')

    purgeScopedStorageForUid('guest-1')

    expect(localStorage.getItem('lectern_guest-1_meetings')).toBeNull()
    expect(localStorage.getItem('lectern_guest-1_boards')).toBeNull()
    expect(localStorage.getItem('lectern_guest-1_prefs')).toBeNull()
    expect(localStorage.getItem('lectern_teacher-1_meetings')).toBe('{"b":2}')
  })
})
