import { useSyncExternalStore } from 'react'

import {
  getActiveStorageUid,
  scopedStorageKey,
  subscribeActiveStorageUid,
} from '@/lib/storage-scope'

/** Join preferences carried from the lobby into the meeting on this device. */
export interface JoinPrefs {
  name: string
  micOn: boolean
  camOn: boolean
  blurOn?: boolean
  cameraId?: string
  micId?: string
  speakerId?: string
}

const SESSION_FALLBACK_KEY = 'lectern_session_prefs'
const EVENT_NAME = 'lectern-prefs-change'

export const defaultPrefs: JoinPrefs = {
  name: '',
  micOn: true,
  camOn: true,
  blurOn: false,
}

function currentLocalKey(): string | null {
  return scopedStorageKey('prefs')
}

export function loadPrefs(): JoinPrefs {
  if (typeof window === 'undefined') return defaultPrefs
  try {
    const key = currentLocalKey()
    const raw = key
      ? (sessionStorage.getItem(key) ?? localStorage.getItem(key))
      : sessionStorage.getItem(SESSION_FALLBACK_KEY)
    if (!raw) return defaultPrefs
    return { ...defaultPrefs, ...(JSON.parse(raw) as Partial<JoinPrefs>) }
  } catch {
    return defaultPrefs
  }
}

export function savePrefs(prefs: JoinPrefs) {
  try {
    const raw = JSON.stringify(prefs)
    const key = currentLocalKey()
    if (key) {
      sessionStorage.setItem(key, raw)
      localStorage.setItem(key, raw)
    } else {
      sessionStorage.setItem(SESSION_FALLBACK_KEY, raw)
    }
  } catch {
    // Ignore storage failures; prefs are a convenience.
  }
  cachedScopeKey = undefined
  cachedRaw = undefined
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(EVENT_NAME))
  }
}

export function patchStoredPrefs(patch: Partial<JoinPrefs>) {
  const next = { ...loadPrefs(), ...patch }
  savePrefs(next)
  return next
}

export function clearPrefs() {
  try {
    const key = currentLocalKey()
    if (key) {
      sessionStorage.removeItem(key)
      localStorage.removeItem(key)
    }
    sessionStorage.removeItem(SESSION_FALLBACK_KEY)
    sessionStorage.removeItem('lectern-join-prefs')
    localStorage.removeItem('lectern-join-prefs')
  } catch {
    // ignore
  }
  cachedScopeKey = undefined
  cachedRaw = undefined
  cachedValue = defaultPrefs
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(EVENT_NAME))
  }
}

let cachedScopeKey: string | null | undefined
let cachedRaw: string | null | undefined
let cachedValue: JoinPrefs = defaultPrefs

/** Like loadPrefs, but returns the same object while storage is unchanged (safe for useSyncExternalStore). */
export function loadPrefsCached(): JoinPrefs {
  if (typeof window === 'undefined') return defaultPrefs
  const uid = getActiveStorageUid()
  const key = scopedStorageKey('prefs', uid)
  const scopeMarker = key ?? SESSION_FALLBACK_KEY
  let raw: string | null
  try {
    raw = key
      ? (sessionStorage.getItem(key) ?? localStorage.getItem(key))
      : sessionStorage.getItem(SESSION_FALLBACK_KEY)
  } catch {
    raw = null
  }
  if (scopeMarker !== cachedScopeKey || raw !== cachedRaw) {
    cachedScopeKey = scopeMarker
    cachedRaw = raw
    try {
      cachedValue = raw
        ? { ...defaultPrefs, ...(JSON.parse(raw) as Partial<JoinPrefs>) }
        : defaultPrefs
    } catch {
      cachedValue = defaultPrefs
    }
  }
  return cachedValue
}

function subscribePrefs(callback: () => void) {
  if (typeof window === 'undefined') return () => {}
  const onEvent = () => {
    cachedScopeKey = undefined
    cachedRaw = undefined
    callback()
  }
  const onStorage = (e: StorageEvent) => {
    const key = currentLocalKey()
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

/** Reactive hook for join preferences (mic/cam defaults, name, devices). */
export function useJoinPrefs() {
  return useSyncExternalStore(subscribePrefs, loadPrefsCached, () => defaultPrefs)
}
