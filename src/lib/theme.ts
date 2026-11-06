import { useCallback, useState } from 'react'
import { useClientValue } from '@/lib/use-client-value'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'lectern-theme'

function readTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/**
 * Reads the theme applied by the inline <head> script and lets the UI toggle it.
 * `theme` is null until mounted so server and client render the same markup.
 */
export function useTheme() {
  const initial = useClientValue<Theme | null>(readTheme, null)
  const [override, setOverride] = useState<Theme | null>(null)
  const theme = override ?? initial

  const apply = useCallback((next: Theme) => {
    document.documentElement.classList.toggle('dark', next === 'dark')
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage can be unavailable in private sessions; the class still applies.
    }
    setOverride(next)
  }, [])

  const toggle = useCallback(() => {
    apply(theme === 'dark' ? 'light' : 'dark')
  }, [apply, theme])

  return { theme, setTheme: apply, toggle }
}
