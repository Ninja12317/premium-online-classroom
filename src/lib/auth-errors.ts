import { AuthError, MissingIdentityError } from '@netlify/identity'

export type AuthErrorKind =
  | 'unavailable'
  | 'unconfirmed'
  | 'credentials'
  | 'exists'
  | 'invalid'
  | 'rate-limited'
  | 'unknown'

export interface AuthErrorInfo {
  kind: AuthErrorKind
  message: string
}

/**
 * Turns an error from `@netlify/identity` into a message a teacher can act on.
 * GoTrue reports an unconfirmed email as a 400 "Email not confirmed", which
 * used to fall through to a generic "couldn't sign you in" message.
 */
export function describeAuthError(
  err: unknown,
  fallback: string,
): AuthErrorInfo {
  if (err instanceof MissingIdentityError) {
    return {
      kind: 'unavailable',
      message:
        'Accounts are not available in this environment yet. Deploy to Netlify to enable them.',
    }
  }
  if (err instanceof AuthError) {
    const text = (err.message ?? '').toLowerCase()
    if (text.includes('not confirmed') || text.includes('unconfirmed')) {
      return {
        kind: 'unconfirmed',
        message:
          'Your email isn’t confirmed yet. Open the confirmation link we emailed you, then sign in.',
      }
    }
    if (
      err.status === 401 ||
      text.includes('invalid_grant') ||
      text.includes('invalid login') ||
      text.includes('no user found')
    ) {
      return { kind: 'credentials', message: 'Wrong email or password.' }
    }
    if (err.status === 429 || text.includes('too many')) {
      return {
        kind: 'rate-limited',
        message: 'Too many attempts. Wait a minute and try again.',
      }
    }
    if (err.status === 422 && text.includes('already')) {
      return {
        kind: 'exists',
        message: 'That email is already registered. Try signing in instead.',
      }
    }
    if (err.status === 422 || err.status === 400) {
      return {
        kind: 'invalid',
        message: err.message || 'Check your email and password and try again.',
      }
    }
  }
  return { kind: 'unknown', message: fallback }
}
