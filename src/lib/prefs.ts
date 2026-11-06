/** Join preferences carried from the lobby into the meeting on this device. */
export interface JoinPrefs {
  name: string
  micOn: boolean
  camOn: boolean
  cameraId?: string
  micId?: string
  speakerId?: string
}

const KEY = 'lectern-join-prefs'

export const defaultPrefs: JoinPrefs = { name: '', micOn: true, camOn: true }

export function loadPrefs(): JoinPrefs {
  if (typeof window === 'undefined') return defaultPrefs
  try {
    const raw = sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY)
    if (!raw) return defaultPrefs
    return { ...defaultPrefs, ...(JSON.parse(raw) as Partial<JoinPrefs>) }
  } catch {
    return defaultPrefs
  }
}

export function savePrefs(prefs: JoinPrefs) {
  try {
    const raw = JSON.stringify(prefs)
    sessionStorage.setItem(KEY, raw)
    localStorage.setItem(KEY, raw)
  } catch {
    // Ignore storage failures; prefs are a convenience.
  }
}

let cachedRaw: string | null | undefined
let cachedValue: JoinPrefs = defaultPrefs

/** Like loadPrefs, but returns the same object while storage is unchanged (safe for useSyncExternalStore). */
export function loadPrefsCached(): JoinPrefs {
  if (typeof window === 'undefined') return defaultPrefs
  let raw: string | null
  try {
    raw = sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY)
  } catch {
    raw = null
  }
  if (raw !== cachedRaw) {
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
