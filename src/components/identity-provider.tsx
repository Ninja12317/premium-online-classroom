import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  onAuthStateChanged,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from 'firebase/auth'

import {
  analyticsPromise,
  auth,
  ensureAuth,
  getCachedClientUid,
  resetAuthInit,
} from '@/services/firebase'

export interface LecternUser {
  id: string
  name: string | null
  email: string | null
  isAnonymous: boolean
}

export interface IdentityState {
  /** Signed-in teacher account (non-anonymous), or null for guest/anonymous users. */
  user: LecternUser | null
  /** Always-present stable UID (Firebase Auth UID or localStorage fallback). */
  clientUid: string
  ready: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const IdentityContext = createContext<IdentityState | null>(null)

function mapUser(u: FirebaseUser | null): LecternUser | null {
  if (!u || u.isAnonymous) return null
  return {
    id: u.uid,
    name: u.displayName ?? u.email?.split('@')[0] ?? 'Teacher',
    email: u.email,
    isAnonymous: u.isAnonymous,
  }
}

/**
 * Client-side Firebase Auth state for the UI. Waits for `ensureAuth()` on
 * mount (restoring any existing session or signing in anonymously) before
 * marking `ready` so Firestore queries never fire with `request.auth == null`.
 */
export function IdentityProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<LecternUser | null>(null)
  const [clientUid, setClientUid] = useState<string>('guest')
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    const current = auth.currentUser
    setUser(mapUser(current))
    if (current?.uid) {
      setClientUid(current.uid)
    } else {
      setClientUid(getCachedClientUid())
    }
  }, [])

  const signOut = useCallback(async () => {
    resetAuthInit()
    await firebaseSignOut(auth)
    setUser(null)
    try {
      const anon = await ensureAuth()
      setClientUid(anon.uid)
    } catch {
      setClientUid(getCachedClientUid())
    }
  }, [])

  useEffect(() => {
    let active = true
    void analyticsPromise

    const unsub = onAuthStateChanged(auth, (fbUser) => {
      if (!active) return
      setUser(mapUser(fbUser))
      if (fbUser?.uid) {
        setClientUid(fbUser.uid)
      }
    })

    ensureAuth()
      .then((fbUser) => {
        if (!active) return
        setClientUid(fbUser.uid)
        setUser(mapUser(fbUser))
      })
      .catch(() => {
        if (!active) return
        setClientUid(getCachedClientUid())
      })
      .finally(() => {
        if (active) setReady(true)
      })

    return () => {
      active = false
      unsub()
    }
  }, [])

  return (
    <IdentityContext.Provider
      value={{ user, clientUid, ready, refresh, signOut }}
    >
      {children}
    </IdentityContext.Provider>
  )
}

export function useIdentity() {
  const state = useContext(IdentityContext)
  if (!state) throw new Error('IdentityProvider is required')
  return state
}

export function displayName(user: LecternUser | null) {
  if (!user) return ''
  return user.name ?? user.email?.split('@')[0] ?? 'Teacher'
}
