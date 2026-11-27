import { useCallback, useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'lectern-theme'
const EVENT_NAME = 'lectern-theme-change'

function readTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function subscribeTheme(callback: () => void) {
  if (typeof window === 'undefined') return () => {}
  const onEvent = () => callback()
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback()
  }
  window.addEventListener(EVENT_NAME, onEvent)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT_NAME, onEvent)
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * Reads the theme applied by the inline <head> script and lets any UI toggle
 * stay in sync across the header, profile dropdown, and settings.
 * `theme` is null until hydrated so server and client render identical markup.
 */
export function useTheme() {
  const theme = useSyncExternalStore<Theme | null>(
    subscribeTheme,
    readTheme,
    () => null,
  )

  const apply = useCallback((next: Theme) => {
    document.documentElement.classList.toggle('dark', next === 'dark')
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage can be unavailable in private sessions; the class still applies.
    }
    window.dispatchEvent(new Event(EVENT_NAME))
  }, [])

  const toggle = useCallback(() => {
    apply(readTheme() === 'dark' ? 'light' : 'dark')
  }, [apply])

  return { theme, setTheme: apply, toggle }
}
