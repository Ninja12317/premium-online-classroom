import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAnalytics, isSupported } from 'firebase/analytics'
import { getFirestore } from 'firebase/firestore'
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  type User,
} from 'firebase/auth'

const firebaseConfig = {
  apiKey: 'AIzaSyABTogRRkiPsOzjc8A5d1lYqgoAFo3ZKXM',
  authDomain: 'lectern-by-quizzy.firebaseapp.com',
  projectId: 'lectern-by-quizzy',
  storageBucket: 'lectern-by-quizzy.firebasestorage.app',
  messagingSenderId: '341944006560',
  appId: '1:341944006560:web:cb7543604d5561915a56c5',
  measurementId: 'G-07R01K67GB',
}

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const auth = getAuth(app)
export const analyticsPromise =
  typeof window !== 'undefined'
    ? isSupported()
        .then((ok) => (ok ? getAnalytics(app) : null))
        .catch(() => null)
    : Promise.resolve(null)

// ---------------------------------------------------------------------------
// Firebase Auth gate — ensures Anonymous (or Email) auth resolves BEFORE
// any Cloud Firestore read, write, or onSnapshot subscription executes.
// ---------------------------------------------------------------------------

const CLIENT_UID_KEY = 'lectern-client-uid'

function getOrCreateLocalUid(): string {
  if (typeof window === 'undefined') return 'ssr-guest'
  try {
    const existing = localStorage.getItem(CLIENT_UID_KEY)
    if (existing) return existing
    const next = `guest_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
    localStorage.setItem(CLIENT_UID_KEY, next)
    return next
  } catch {
    return `guest_${Math.random().toString(36).slice(2, 12)}`
  }
}

let authInitPromise: Promise<User> | null = null

/** Reset cached auth promise (called right before/after explicit signOut). */
export function resetAuthInit() {
  authInitPromise = null
}

/**
 * Waits for Firebase Auth to restore any persisted session via
 * `onAuthStateChanged(auth, ...)` and, if `user` is null, awaits
 * `signInAnonymously(auth)`. All Firestore operations gate on this helper
 * so ZERO requests ever fire with `request.auth == null`.
 */
export function ensureAuth(): Promise<User> {
  if (typeof window === 'undefined') {
    return Promise.reject(
      new Error('Firebase client auth is unavailable during SSR'),
    )
  }
  if (auth.currentUser) {
    return Promise.resolve(auth.currentUser)
  }
  if (!authInitPromise) {
    authInitPromise = new Promise<User>((resolve, reject) => {
      let settled = false
      const unsub = onAuthStateChanged(
        auth,
        (user) => {
          if (settled) return
          settled = true
          unsub()
          if (user) {
            resolve(user)
            return
          }
          signInAnonymously(auth)
            .then((cred) => resolve(cred.user))
            .catch((err) => {
              authInitPromise = null
              reject(err)
            })
        },
        (err) => {
          if (settled) return
          settled = true
          unsub()
          authInitPromise = null
          reject(err)
        },
      )
    })
  }
  return authInitPromise
}

/**
 * Ensures the browser has a stable UID: awaits `ensureAuth()` and falls back
 * to a persisted localStorage client UID only in SSR or offline failure so
 * the UI never crashes or kicks the user.
 */
export async function ensureClientUid(): Promise<string> {
  if (typeof window === 'undefined') return 'ssr-guest'
  try {
    const user = await ensureAuth()
    return user.uid
  } catch {
    return getOrCreateLocalUid()
  }
}

export function getCachedClientUid(): string {
  if (auth.currentUser?.uid) return auth.currentUser.uid
  return getOrCreateLocalUid()
}

// ---------------------------------------------------------------------------
// Single dismissible Firestore error banner state (zero duplicate spam)
// ---------------------------------------------------------------------------

export interface FirestoreNotice {
  code: string
  path: string
  message: string
  at: number
}

let currentNotice: FirestoreNotice | null = null
let noticeDismissed = false
const noticeListeners = new Set<() => void>()

export function isPermissionDeniedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: string; message?: string }
  const code = String(e.code ?? '').toLowerCase()
  const msg = String(e.message ?? '').toLowerCase()
  return (
    code.includes('permission-denied') ||
    msg.includes('permission-denied') ||
    msg.includes('missing or insufficient permissions')
  )
}

export function reportFirestorePermissionError(path: string, err?: unknown) {
  // Never spam duplicate notices or re-open after the user dismissed the banner.
  if (noticeDismissed || currentNotice !== null) return
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code ?? 'permission-denied')
      : 'permission-denied'
  currentNotice = {
    code,
    path,
    message: `Firestore denied access (${code}). Publish firestore.rules in Firebase Console (lectern-by-quizzy → Firestore Database → Rules) to allow authenticated access.`,
    at: Date.now(),
  }
  for (const l of noticeListeners) l()
}

export function clearFirestoreNotice() {
  noticeDismissed = true
  currentNotice = null
  for (const l of noticeListeners) l()
}

export function getFirestoreNotice(): FirestoreNotice | null {
  return currentNotice
}

export function subscribeFirestoreNotice(listener: () => void): () => void {
  noticeListeners.add(listener)
  return () => noticeListeners.delete(listener)
}
