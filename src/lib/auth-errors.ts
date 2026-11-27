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
 * Turns a Firebase Auth error into a clear, actionable message for teachers.
 */
export function describeAuthError(
  err: unknown,
  fallback: string,
): AuthErrorInfo {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code ?? '').toLowerCase()
      : ''
  const text =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message ?? '').toLowerCase()
      : ''

  if (
    code === 'auth/operation-not-allowed' ||
    code === 'auth/configuration-not-found'
  ) {
    return {
      kind: 'unavailable',
      message:
        'Email/Password sign-in is not enabled yet in Firebase Console (Authentication → Sign-in method). You can still start or join classes without an account.',
    }
  }
  if (text.includes('not confirmed') || text.includes('unconfirmed')) {
    return {
      kind: 'unconfirmed',
      message:
        'Your email isn’t confirmed yet. Open the confirmation link we emailed you, then sign in.',
    }
  }
  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found' ||
    text.includes('invalid-credential')
  ) {
    return { kind: 'credentials', message: 'Wrong email or password.' }
  }
  if (code === 'auth/too-many-requests' || text.includes('too-many-requests')) {
    return {
      kind: 'rate-limited',
      message: 'Too many attempts. Wait a minute and try again.',
    }
  }
  if (
    code === 'auth/email-already-in-use' ||
    text.includes('email-already-in-use')
  ) {
    return {
      kind: 'exists',
      message: 'That email is already registered. Try signing in instead.',
    }
  }
  if (code === 'auth/weak-password') {
    return {
      kind: 'invalid',
      message: 'Use at least 8 characters for your password.',
    }
  }
  if (code === 'auth/invalid-email') {
    return {
      kind: 'invalid',
      message: 'Please enter a valid email address.',
    }
  }
  return { kind: 'unknown', message: fallback }
}
