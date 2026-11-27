import type { ParticipantStatus, Role } from '@/lib/meeting-types'

/** Host secrets for meetings this browser created; proves teacher authority. */
const PREFIX = 'lectern-host:'

export function saveHostKey(meetingId: string, key: string) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(PREFIX + meetingId, key)
  } catch {
    // Storage unavailable; the host can still join via their account.
  }
}

export function loadHostKey(meetingId: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(PREFIX + meetingId)
  } catch {
    return null
  }
}

export function listHostMeetingIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const ids: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(PREFIX)) {
        ids.push(k.slice(PREFIX.length))
      }
    }
    return ids
  } catch {
    return []
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
