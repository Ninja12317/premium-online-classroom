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

export function isBenignListenerError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: string; message?: string }
  const code = String(e.code ?? '').toLowerCase()
  const msg = String(e.message ?? '').toLowerCase()
  return (
    code.includes('cancelled') ||
    code.includes('aborted') ||
    code.includes('unauthenticated') ||
    msg.includes('the operation was aborted') ||
    msg.includes('client is offline')
  )
}

export interface FirestoreErrorGuardInput {
  err: unknown
  expectedUid?: string | null
  currentUid: string | null
  isAuthTransitioning: boolean
  isTornDown?: boolean
}

/**
 * Pure guard deciding whether a Firestore error should surface the user-facing
 * permission banner. Suppresses benign listener teardowns during sign-out,
 * signed-out states, and UID transitions while preserving genuine errors.
 */
export function shouldReportFirestoreError(
  input: FirestoreErrorGuardInput,
): boolean {
  if (input.isTornDown) return false
  if (input.isAuthTransitioning) return false
  if (!input.currentUid) return false
  if (input.expectedUid && input.expectedUid !== input.currentUid) return false
  if (isBenignListenerError(input.err)) return false
  return isPermissionDeniedError(input.err)
}
