import { useCallback, useEffect, useId, useRef } from 'react'
import { toast } from 'sonner'

/**
 * Lightweight accidental Back-button / swipe-Back guard while inside an active
 * live meeting or open whiteboard.
 *
 * - Pushes a single sentinel history state while `active` is true.
 * - On accidental `popstate` (trackpad swipe-Back or mobile edge-Back), stays
 *   on the active screen and displays a calm reminder toast.
 * - Calling `releaseGuard()` before intentional navigation (Leave, End Meeting,
 *   Back button) disarms the guard immediately so intentional exits work in one
 *   click without getting blocked.
 */
export function useBackNavigationGuard(
  active: boolean,
  notice = 'Use Leave to exit the class',
) {
  const bypassedRef = useRef(false)
  const lastToastAtRef = useRef(0)
  const guardId = `lectern-guard-${useId()}`

  const releaseGuard = useCallback(() => {
    bypassedRef.current = true
  }, [])

  useEffect(() => {
    if (!active || typeof window === 'undefined') return
    bypassedRef.current = false

    const pushSentinel = () => {
      try {
        const currentState =
          window.history.state && typeof window.history.state === 'object'
            ? (window.history.state as Record<string, unknown>)
            : {}
        if (currentState.__lecternGuard !== guardId) {
          window.history.pushState(
            { ...currentState, __lecternGuard: guardId },
            '',
            window.location.href,
          )
        }
      } catch {
        // Ignore restricted history contexts (e.g. sandboxed iframes)
      }
    }

    pushSentinel()

    const onPopState = () => {
      if (bypassedRef.current) return
      pushSentinel()
      const now = Date.now()
      if (now - lastToastAtRef.current > 2400) {
        lastToastAtRef.current = now
        toast.info(notice)
      }
    }

    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      bypassedRef.current = true
    }
  }, [active, notice, guardId])

  return { releaseGuard }
}
