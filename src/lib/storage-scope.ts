/**
 * Active Firebase UID namespace for all browser-local storage caches
 * (preferences, profile, host keys, recordings, and offline board mirrors).
 *
 * Guarantees strict per-profile isolation so switching accounts, signing out,
 * or starting a fresh Guest session never exposes data from another profile.
 */

let activeUid: string | null = null
const listeners = new Set<() => void>()

export function setActiveStorageUid(uid: string | null) {
  const normalized = uid && uid.trim() ? uid.trim() : null
  if (activeUid === normalized) return
  activeUid = normalized
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // ignore subscriber errors
    }
  }
}

export function getActiveStorageUid(): string | null {
  return activeUid
}

export function subscribeActiveStorageUid(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Returns a UID-namespaced localStorage key (e.g. `lectern_<uid>_prefs`),
 * or `null` when signed out so no prior account's data is ever read.
 */
export function scopedStorageKey(
  namespace: string,
  explicitUid?: string | null,
): string | null {
  const uid = explicitUid !== undefined ? explicitUid : activeUid
  if (!uid) return null
  return `lectern_${uid}_${namespace}`
}

const LEGACY_EXACT_KEYS = [
  'lectern-fs-meetings-cache',
  'lectern-fs-boards-cache',
  'lectern-fs-meetings-v1',
  'lectern-fs-boards-v1',
  'lectern-user-profile',
  'lectern-join-prefs',
  'lectern-client-uid',
  'lectern.prefs.v1',
  'lectern.profile.v1',
]

const LEGACY_PREFIXES = [
  'lectern-host:',
  'lectern-wb-el-cache:',
  'lectern-fs-wb-',
]

/**
 * Removes legacy unscoped localStorage keys from older builds so stale data
 * from previous profiles can never bleed into a fresh Guest or signed-in user.
 */
export function purgeLegacyUnscopedStorage() {
  if (typeof window === 'undefined') return
  try {
    for (const key of LEGACY_EXACT_KEYS) {
      localStorage.removeItem(key)
    }
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && LEGACY_PREFIXES.some((prefix) => k.startsWith(prefix))) {
        toRemove.push(k)
      }
    }
    for (const k of toRemove) {
      localStorage.removeItem(k)
    }
  } catch {
    // ignore storage errors
  }
}

/** Removes all localStorage keys belonging to a specific UID namespace. */
export function purgeScopedStorageForUid(uid: string | null) {
  if (typeof window === 'undefined' || !uid) return
  try {
    const prefix = `lectern_${uid}_`
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(prefix)) toRemove.push(k)
    }
    for (const k of toRemove) {
      localStorage.removeItem(k)
    }
  } catch {
    // ignore
  }
}
