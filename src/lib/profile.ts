import { useSyncExternalStore } from 'react'

import { generateMeetingId, isModernMeetingId } from '@/lib/meeting'
import { loadPrefs, savePrefs } from '@/lib/prefs'
import {
  getActiveStorageUid,
  scopedStorageKey,
  subscribeActiveStorageUid,
} from '@/lib/storage-scope'

export type AvailabilityStatus = 'available' | 'in-meeting' | 'dnd' | 'away'

export type ProfileRole =
  | 'Teacher'
  | 'Host'
  | 'Presenter'
  | 'Student'
  | 'Participant'

export interface UserProfile {
  displayName: string
  role: ProfileRole
  status: AvailabilityStatus
  avatarColor: string
  avatarPhoto: string | null
  pmi: string
  subjectOrInstitution?: string
  classOrRollNo?: string
}

export const PROFILE_ROLES: ProfileRole[] = [
  'Teacher',
  'Host',
  'Presenter',
  'Student',
  'Participant',
]

export const AVAILABILITY_OPTIONS: {
  id: AvailabilityStatus
  label: string
  dotClass: string
}[] = [
  { id: 'available', label: 'Available', dotClass: 'bg-primary' },
  { id: 'in-meeting', label: 'In a Meeting', dotClass: 'bg-live' },
  { id: 'dnd', label: 'Do Not Disturb', dotClass: 'bg-destructive' },
  { id: 'away', label: 'Away', dotClass: 'bg-amber' },
]

export const AVATAR_COLOR_SWATCHES: {
  id: string
  label: string
  value: string
}[] = [
  { id: 'forest', label: 'Board Green', value: 'oklch(0.44 0.085 165)' },
  { id: 'sage', label: 'Deep Sage', value: 'oklch(0.48 0.09 140)' },
  { id: 'ochre', label: 'Warm Ochre', value: 'oklch(0.58 0.13 75)' },
  { id: 'terracotta', label: 'Terracotta', value: 'oklch(0.54 0.14 35)' },
  { id: 'slate', label: 'Slate Blue', value: 'oklch(0.47 0.09 235)' },
  { id: 'plum', label: 'Evening Plum', value: 'oklch(0.46 0.1 315)' },
]

const EVENT_NAME = 'lectern-profile-change'

export const defaultProfile: UserProfile = {
  displayName: '',
  role: 'Teacher',
  status: 'available',
  avatarColor: AVATAR_COLOR_SWATCHES[0].value,
  avatarPhoto: null,
  pmi: '',
}

let cachedScopeKey: string | null | undefined
let cachedRaw: string | null | undefined
let cachedProfile: UserProfile = defaultProfile

function currentProfileKey(): string | null {
  return scopedStorageKey('profile')
}

function migrateLoadedProfile(
  key: string,
  raw: Partial<UserProfile>,
): UserProfile {
  const merged: UserProfile = { ...defaultProfile, ...raw }
  if (merged.pmi && !isModernMeetingId(merged.pmi)) {
    merged.pmi = generateMeetingId()
    try {
      localStorage.setItem(key, JSON.stringify(merged))
    } catch {
      // ignore
    }
  }
  return merged
}

export function loadProfile(): UserProfile {
  if (typeof window === 'undefined') return defaultProfile
  const key = currentProfileKey()
  if (!key) return defaultProfile
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return defaultProfile
    return migrateLoadedProfile(key, JSON.parse(raw) as Partial<UserProfile>)
  } catch {
    return defaultProfile
  }
}

export function loadProfileCached(): UserProfile {
  if (typeof window === 'undefined') return defaultProfile
  const uid = getActiveStorageUid()
  const key = scopedStorageKey('profile', uid)
  if (!key) {
    cachedScopeKey = null
    cachedRaw = null
    cachedProfile = defaultProfile
    return defaultProfile
  }
  let raw: string | null
  try {
    raw = localStorage.getItem(key)
  } catch {
    raw = null
  }
  if (key !== cachedScopeKey || raw !== cachedRaw) {
    cachedScopeKey = key
    cachedRaw = raw
    try {
      cachedProfile = raw
        ? migrateLoadedProfile(key, JSON.parse(raw) as Partial<UserProfile>)
        : defaultProfile
    } catch {
      cachedProfile = defaultProfile
    }
  }
  return cachedProfile
}

export function saveProfile(patch: Partial<UserProfile>): UserProfile {
  const current = loadProfile()
  let nextPmi = patch.pmi !== undefined ? patch.pmi : current.pmi
  if (nextPmi && !isModernMeetingId(nextPmi)) {
    nextPmi = generateMeetingId()
  }
  const next: UserProfile = {
    ...current,
    ...patch,
    pmi: nextPmi,
  }
  const key = currentProfileKey()
  if (key) {
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      // Ignore storage quota errors if photo is too large.
    }
  }
  cachedScopeKey = undefined
  cachedRaw = undefined

  if (patch.displayName !== undefined) {
    const prefs = loadPrefs()
    if (prefs.name !== patch.displayName) {
      savePrefs({ ...prefs, name: patch.displayName })
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(EVENT_NAME))
  }
  return next
}

/** Generates and persists a fresh `LEC-XXXX-XXXX` Personal Meeting ID. */
export function regenerateLocalPmi(): string {
  const nextPmi = generateMeetingId()
  saveProfile({ pmi: nextPmi })
  return nextPmi
}

/** Clears cached local profile data immediately on sign-out / guest exit. */
export function clearProfile() {
  try {
    const key = currentProfileKey()
    if (key) localStorage.removeItem(key)
    localStorage.removeItem('lectern-user-profile')
  } catch {
    // ignore
  }
  cachedScopeKey = undefined
  cachedRaw = undefined
  cachedProfile = defaultProfile
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(EVENT_NAME))
  }
}

function subscribeProfile(callback: () => void) {
  if (typeof window === 'undefined') return () => {}
  const onEvent = () => {
    cachedScopeKey = undefined
    cachedRaw = undefined
    callback()
  }
  const onStorage = (e: StorageEvent) => {
    const key = currentProfileKey()
    if (!e.key || e.key === key) onEvent()
  }
  const unsubUid = subscribeActiveStorageUid(onEvent)
  window.addEventListener(EVENT_NAME, onEvent)
  window.addEventListener('storage', onStorage)
  return () => {
    unsubUid()
    window.removeEventListener(EVENT_NAME, onEvent)
    window.removeEventListener('storage', onStorage)
  }
}

/** Reactive profile hook with SSR-safe defaults. */
export function useUserProfile() {
  return useSyncExternalStore(
    subscribeProfile,
    loadProfileCached,
    () => defaultProfile,
  )
}

export function statusMeta(status: AvailabilityStatus) {
  return (
    AVAILABILITY_OPTIONS.find((o) => o.id === status) ?? AVAILABILITY_OPTIONS[0]
  )
}

/** Downscales and square-crops a local image file to a compact data URL for localStorage. */
export function resizeAvatarFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read image file.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Unsupported image format.'))
      img.onload = () => {
        const size = 160
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(String(reader.result))
          return
        }
        const minSide = Math.min(img.width, img.height)
        const sx = (img.width - minSide) / 2
        const sy = (img.height - minSide) / 2
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size)
        resolve(canvas.toDataURL('image/jpeg', 0.84))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
