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

export type InstallPlatformGuidance =
  | 'iframe'
  | 'ios-safari'
  | 'ios-other'
  | 'android'
  | 'desktop-chromium'
  | 'desktop-safari'
  | 'desktop-firefox'
  | 'generic'

/**
 * Pure helper: detects iPhone, iPad (including iPadOS desktop-class UA), and iPod.
 */
export function isIOSDevice(
  userAgent: string,
  maxTouchPoints = 0,
): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true
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

/**
 * Pure helper: returns the most accurate manual install instructions for the
 * current browser/environment when native `beforeinstallprompt` is unavailable.
 */
export function getInstallGuidance(env: {
  userAgent: string
  maxTouchPoints?: number
  isInIframe?: boolean
}): InstallPlatformGuidance {
  if (env.isInIframe) return 'iframe'
  const ua = env.userAgent || ''
  const touch = env.maxTouchPoints ?? 0
  if (isIOSSafari(ua, touch)) return 'ios-safari'
  if (isIOSDevice(ua, touch)) return 'ios-other'
  if (/Android/i.test(ua)) return 'android'
  if (/Firefox|FxiOS/i.test(ua)) return 'desktop-firefox'
  if (/Chrome|Chromium|Edg|Brave|OPR/i.test(ua)) return 'desktop-chromium'
  if (/Safari/i.test(ua)) return 'desktop-safari'
  return 'generic'
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

function getHydratedClientSnapshot(): boolean {
  return true
}

function getGuidanceSnapshot(): InstallPlatformGuidance {
  if (typeof window === 'undefined') return 'generic'
  let inIframe: boolean
  try {
    inIframe = window.self !== window.top
  } catch {
    inIframe = true
  }
  return getInstallGuidance({
    userAgent: window.navigator.userAgent || '',
    maxTouchPoints: window.navigator.maxTouchPoints || 0,
    isInIframe: inIframe,
  })
}

const getServerNull = () => null
const getServerFalse = () => false
const getServerGeneric = (): InstallPlatformGuidance => 'generic'

export interface PWAInstallState {
  /** True when the browser fired `beforeinstallprompt` and the app is not yet installed. */
  isInstallable: boolean
  /** True when already running in standalone / installed PWA mode. */
  isInstalled: boolean
  /** True on the client when not yet running as an installed PWA (controls Install button visibility). */
  showInstallOption: boolean
  /** True on iOS Safari when not yet installed. */
  showIOSHint: boolean
  /** Platform-specific install guidance when native `beforeinstallprompt` is not available. */
  guidance: InstallPlatformGuidance
  /** Triggers the native browser install prompt when available. */
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>
}

export function usePWAInstall(): PWAInstallState {
  const hydrated = useSyncExternalStore(
    subscribe,
    getHydratedClientSnapshot,
    getServerFalse,
  )
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
  const guidance = useSyncExternalStore(
    subscribe,
    getGuidanceSnapshot,
    getServerGeneric,
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
    showInstallOption: hydrated && !isInstalled,
    showIOSHint: hydrated && !isInstalled && deferredPrompt === null && guidance === 'ios-safari',
    guidance,
    promptInstall,
  }
}
