import { useCallback, useSyncExternalStore } from 'react'

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
  prompt(): Promise<void>
}

declare global {
  interface Window {
    __lecternDeferredInstallPrompt?: BeforeInstallPromptEvent | null
  }
}

/**
 * Pure helper: detects iPhone, iPad (including iPadOS desktop-class UA), and iPod.
 */
export function isIOSDevice(
  userAgent: string,
  maxTouchPoints = 0,
): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true
  // iPadOS 13+ reports Macintosh with multi-touch support
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return true
  return false
}

/**
 * Pure helper: returns true when running on iOS Safari (not Chrome/Firefox/Edge on iOS).
 */
export function isIOSSafari(
  userAgent: string,
  maxTouchPoints = 0,
): boolean {
  if (!isIOSDevice(userAgent, maxTouchPoints)) return false
  // Exclude third-party iOS browsers that do not expose Safari's Share -> Add to Home Screen flow in the same way
  if (/CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent)) return false
  return /Safari/i.test(userAgent)
}

/**
 * Pure helper: returns true when the app is already running as an installed PWA.
 */
export function isStandaloneDisplay(
  win?: {
    matchMedia?: (q: string) => { matches: boolean }
    navigator?: Navigator | { standalone?: boolean }
  } | null,
): boolean {
  if (!win) return false
  try {
    const nav = win.navigator as { standalone?: boolean } | undefined
    if (nav?.standalone === true) return true
    if (win.matchMedia?.('(display-mode: standalone)').matches) return true
    if (win.matchMedia?.('(display-mode: fullscreen)').matches) return true
  } catch {
    // ignore environments without matchMedia
  }
  return false
}

// External store for PWA installability so multiple consumers stay in sync
// with zero synchronous setState inside effects and full SSR safety.
type Listener = () => void
const listeners = new Set<Listener>()
let listenersBound = false
let installedOverride = false

function notify() {
  for (const l of listeners) l()
}

function ensureBound() {
  if (listenersBound || typeof window === 'undefined') return
  listenersBound = true

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault()
    window.__lecternDeferredInstallPrompt = e as BeforeInstallPromptEvent
    notify()
  })

  window.addEventListener('appinstalled', () => {
    window.__lecternDeferredInstallPrompt = null
    installedOverride = true
    notify()
  })

  const mq = window.matchMedia?.('(display-mode: standalone)')
  mq?.addEventListener?.('change', () => {
    if (isStandaloneDisplay(window)) {
      window.__lecternDeferredInstallPrompt = null
    }
    notify()
  })
}

function subscribe(listener: Listener) {
  ensureBound()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getDeferredPromptSnapshot(): BeforeInstallPromptEvent | null {
  if (typeof window === 'undefined') return null
  return window.__lecternDeferredInstallPrompt ?? null
}

function getInstalledSnapshot(): boolean {
  if (typeof window === 'undefined') return false
  return installedOverride || isStandaloneDisplay(window)
}

function getIOSSafariSnapshot(): boolean {
  if (typeof window === 'undefined') return false
  return isIOSSafari(
    window.navigator.userAgent || '',
    window.navigator.maxTouchPoints || 0,
  )
}

const getServerNull = () => null
const getServerFalse = () => false

export interface PWAInstallState {
  /** True when the browser fired `beforeinstallprompt` and the app is not yet installed. */
  isInstallable: boolean
  /** True when already running in standalone / installed PWA mode. */
  isInstalled: boolean
  /** True on iOS Safari when not yet installed (show one-line Share -> Add to Home Screen hint). */
  showIOSHint: boolean
  /** Triggers the native browser install prompt when available. */
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>
}

export function usePWAInstall(): PWAInstallState {
  const deferredPrompt = useSyncExternalStore(
    subscribe,
    getDeferredPromptSnapshot,
    getServerNull,
  )
  const isInstalled = useSyncExternalStore(
    subscribe,
    getInstalledSnapshot,
    getServerFalse,
  )
  const iosSafari = useSyncExternalStore(
    subscribe,
    getIOSSafariSnapshot,
    getServerFalse,
  )

  const promptInstall = useCallback(async () => {
    const promptEvent =
      deferredPrompt ??
      (typeof window !== 'undefined'
        ? window.__lecternDeferredInstallPrompt ?? null
        : null)
    if (!promptEvent) return 'unavailable'
    try {
      await promptEvent.prompt()
      const choice = await promptEvent.userChoice
      window.__lecternDeferredInstallPrompt = null
      if (choice.outcome === 'accepted') {
        installedOverride = true
      }
      notify()
      return choice.outcome
    } catch {
      return 'unavailable'
    }
  }, [deferredPrompt])

  return {
    isInstallable: !isInstalled && deferredPrompt !== null,
    isInstalled,
    showIOSHint: !isInstalled && deferredPrompt === null && iosSafari,
    promptInstall,
  }
}
