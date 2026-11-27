import type { ParticipantStatus, Role } from '@/lib/meeting-types'
import { getActiveStorageUid } from '@/lib/storage-scope'

/** Host secrets scoped strictly to the active Firebase UID so accounts never share host keys. */
function hostKeyPrefix(): string | null {
  const uid = getActiveStorageUid()
  if (!uid) return null
  return `lectern_${uid}_host:`
}

export function saveHostKey(meetingId: string, key: string) {
  if (typeof window === 'undefined') return
  const prefix = hostKeyPrefix()
  if (!prefix) return
  try {
    localStorage.setItem(prefix + meetingId, key)
  } catch {
    // Storage unavailable; the host can still join via their account.
  }
}

export function loadHostKey(meetingId: string): string | null {
  if (typeof window === 'undefined') return null
  const prefix = hostKeyPrefix()
  if (!prefix) return null
  try {
    return localStorage.getItem(prefix + meetingId)
  } catch {
    return null
  }
}

export function listHostMeetingIds(): string[] {
  if (typeof window === 'undefined') return []
  const prefix = hostKeyPrefix()
  if (!prefix) return []
  try {
    const ids: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(prefix)) {
        ids.push(k.slice(prefix.length))
      }
    }
    return ids
  } catch {
    return []
  }
}

export function clearScopedHostKeys(uid?: string | null) {
  if (typeof window === 'undefined') return
  const targetUid = uid !== undefined ? uid : getActiveStorageUid()
  const prefix = targetUid ? `lectern_${targetUid}_host:` : null
  try {
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      if (k.startsWith('lectern-host:') || (prefix && k.startsWith(prefix))) {
        toRemove.push(k)
      }
    }
    for (const k of toRemove) localStorage.removeItem(k)
  } catch {
    // ignore
  }
}

/**
 * Synced lobby -> room session state in sessionStorage so waiting->admitted
 * transitions, toggling whiteboard/chat, or re-rendering never reset to Join.
 */
const PKEY = 'lectern-participant:'
const ACTIVE_SESSION_KEY = 'lectern-active-session'

export interface StoredParticipant {
  activeMeetingId?: string
  identity: string
  participantKey: string
  role?: Role
  status?: ParticipantStatus
  name?: string
}

export function saveParticipant(meetingId: string, value: StoredParticipant) {
  if (typeof window === 'undefined') return
  try {
    const payload: StoredParticipant = {
      ...value,
      activeMeetingId: meetingId,
    }
    sessionStorage.setItem(PKEY + meetingId, JSON.stringify(payload))
    sessionStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(payload))
  } catch {
    // ignore
  }
}

export function loadParticipant(meetingId: string): StoredParticipant | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(PKEY + meetingId)
    return raw ? (JSON.parse(raw) as StoredParticipant) : null
  } catch {
    return null
  }
}

export function clearParticipant(meetingId: string) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(PKEY + meetingId)
    const activeRaw = sessionStorage.getItem(ACTIVE_SESSION_KEY)
    if (activeRaw) {
      const active = JSON.parse(activeRaw) as StoredParticipant
      if (active.activeMeetingId === meetingId) {
        sessionStorage.removeItem(ACTIVE_SESSION_KEY)
      }
    }
  } catch {
    // ignore
  }
}

export function clearAllSessionParticipants() {
  if (typeof window === 'undefined') return
  try {
    const toRemove: string[] = [ACTIVE_SESSION_KEY]
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k && k.startsWith(PKEY)) toRemove.push(k)
    }
    for (const k of toRemove) sessionStorage.removeItem(k)
  } catch {
    // ignore
  }
}
