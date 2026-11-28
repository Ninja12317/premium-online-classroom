import { useSyncExternalStore } from 'react'

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

/**
 * Returns the currently active fullscreen element (supporting standard and
 * WebKit-prefixed APIs), or `null` when not in fullscreen mode.
 */
export function getFullscreenElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const doc = document as WebkitDocument
  const el = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null
  return el instanceof HTMLElement ? el : null
}

/**
 * Toggles browser fullscreen on `document.documentElement` (with
 * `webkitRequestFullscreen` / `webkitExitFullscreen` fallback) so the entire
 * document—including portals and overlays—fills `100vw x 100dvh`.
 *
 * Returns `true` if entering/exiting succeeded, or `false` when fullscreen is
 * unsupported or rejected by the browser.
 */
export async function toggleDocumentFullscreen(): Promise<boolean> {
  if (typeof document === 'undefined') return false
  const doc = document as WebkitDocument
  const root = document.documentElement as WebkitElement
  try {
    if (getFullscreenElement()) {
      if (typeof doc.exitFullscreen === 'function') {
        await doc.exitFullscreen()
        return true
      }
      if (typeof doc.webkitExitFullscreen === 'function') {
        await doc.webkitExitFullscreen()
        return true
      }
      return false
    }
    if (typeof root.requestFullscreen === 'function') {
      await root.requestFullscreen()
      return true
    }
    if (typeof root.webkitRequestFullscreen === 'function') {
      await root.webkitRequestFullscreen()
      return true
    }
    return false
  } catch {
    return false
  }
}

function subscribeFullscreen(callback: () => void) {
  if (typeof document === 'undefined') return () => {}
  document.addEventListener('fullscreenchange', callback)
  document.addEventListener('webkitfullscreenchange', callback)
  return () => {
    document.removeEventListener('fullscreenchange', callback)
    document.removeEventListener('webkitfullscreenchange', callback)
  }
}

/**
 * React hook returning the active `document.fullscreenElement` (or `null` when
 * outside fullscreen). Pass `container={fullscreenContainer ?? undefined}` to
 * Radix UI `<Portal>` wrappers so menus, dialogs, popovers, selects, sheets,
 * and tooltips always render inside the browser's top-layer fullscreen element.
 */
export function useFullscreenContainer(): HTMLElement | null {
  return useSyncExternalStore(
    subscribeFullscreen,
    getFullscreenElement,
    () => null,
  )
}
