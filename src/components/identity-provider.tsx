import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  getUser,
  handleAuthCallback,
  onAuthChange,
  AuthError,
  type CallbackResult,
  type User,
} from '@netlify/identity'

export interface IdentityState {
  user: User | null
  ready: boolean
  /**
   * Result of an email link (confirmation, password recovery, invite) that
   * was processed on this page load. Consumed once by `AuthCallbackHandler`.
   */
  callback: CallbackResult | null
  /** Set when the link in the URL was invalid or expired. */
  callbackError: string | null
  clearCallback: () => void
  refresh: () => Promise<void>
}

const IdentityContext = createContext<IdentityState | null>(null)

/**
 * Client-side auth state for the UI (never for authorization, which happens
 * in server functions). `user` is null and `ready` is false during SSR.
 *
 * On mount this first processes any `#confirmation_token`, `#recovery_token`
 * or `#invite_token` that Netlify Identity put in the URL from an emailed
 * link. Without this step a new account stays unconfirmed and signing in
 * fails with "Email not confirmed".
 */
export function IdentityProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [callback, setCallback] = useState<CallbackResult | null>(null)
  const [callbackError, setCallbackError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setUser(await getUser())
    } catch {
      setUser(null)
    }
  }, [])

  const clearCallback = useCallback(() => {
    setCallback(null)
    setCallbackError(null)
  }, [])

  useEffect(() => {
    let active = true
    let unsubscribe = () => {}
    try {
      unsubscribe = onAuthChange((_event, next) => {
        if (active) setUser(next)
      })
    } catch {
      // Identity is unavailable in plain Vite dev; the UI stays signed out.
    }

    async function init() {
      let result: CallbackResult | null = null
      try {
        result = await handleAuthCallback()
      } catch (err) {
        if (!active) return
        setCallbackError(
          err instanceof AuthError && err.message
            ? err.message
            : 'That link is invalid or has expired.',
        )
      }
      if (!active) return
      if (result) {
        setCallback(result)
        setUser(result.user)
        return
      }
      try {
        const current = await getUser()
        if (active) setUser(current)
      } catch {
        if (active) setUser(null)
      }
    }

    init().finally(() => {
      if (active) setReady(true)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return (
    <IdentityContext.Provider
      value={{ user, ready, callback, callbackError, clearCallback, refresh }}
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

export function displayName(user: User | null) {
  if (!user) return ''
  return user.name ?? user.email?.split('@')[0] ?? 'Teacher'
}
