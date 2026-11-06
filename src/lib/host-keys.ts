/** Host secrets for meetings this browser created; proves teacher authority. */
const PREFIX = 'lectern-host:'

export function saveHostKey(meetingId: string, key: string) {
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

/** The participant secret for a meeting, so refreshes rejoin as the same person. */
const PKEY = 'lectern-participant:'

export interface StoredParticipant {
  identity: string
  participantKey: string
}

export function saveParticipant(meetingId: string, value: StoredParticipant) {
  try {
    sessionStorage.setItem(PKEY + meetingId, JSON.stringify(value))
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
  try {
    sessionStorage.removeItem(PKEY + meetingId)
  } catch {
    // ignore
  }
}
