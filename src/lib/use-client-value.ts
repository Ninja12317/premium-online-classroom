import { useSyncExternalStore } from 'react'

const noop = () => () => {}

/**
 * Reads a browser-only value (storage, DOM class, feature support) in a way
 * that is safe for SSR and hydration: `serverValue` is used on the server and
 * during hydration, then the real value takes over. `read` must return a
 * stable value when nothing changed (primitives, or a cached object).
 */
export function useClientValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(noop, read, () => serverValue)
}
