export const HOST_AUTH_REQUIRED_CODE = 'AUTH_REQUIRED' as const

export const HOST_AUTH_REQUIRED_NOTICE =
  'Please sign in with an account to start or schedule a meeting.'

export type PendingHostAction = 'new-meeting' | 'new-meeting-pmi' | 'schedule'

export interface UserLike {
  uid?: string | null
  id?: string | null
  isAnonymous?: boolean | null
  isGuest?: boolean | null
  role?: string | null
}

/**
 * Returns true ONLY when a real registered Firebase account is signed in
 * (never null/undefined, never anonymous Firebase auth, never guest role).
 */
export function isRegisteredUser(user: UserLike | null | undefined): boolean {
  if (!user) return false
  if (user.isAnonymous === true) return false
  if (user.isGuest === true) return false
  if (user.role === 'guest') return false
  return true
}

export class AuthRequiredError extends Error {
  readonly code = HOST_AUTH_REQUIRED_CODE

  constructor(message = HOST_AUTH_REQUIRED_NOTICE) {
    super(message)
    this.name = 'AuthRequiredError'
  }
}

export function isAuthRequiredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  return (
    (err as { code?: unknown }).code === HOST_AUTH_REQUIRED_CODE ||
    (err instanceof Error && err.message === HOST_AUTH_REQUIRED_CODE)
  )
}
