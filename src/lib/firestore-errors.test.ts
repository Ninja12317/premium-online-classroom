import { describe, expect, it } from 'vitest'

import {
  isBenignListenerError,
  isPermissionDeniedError,
  shouldReportFirestoreError,
} from './firestore-errors'

describe('firestore-errors guard', () => {
  const permDenied = {
    code: 'permission-denied',
    message: 'Missing or insufficient permissions.',
  }

  it('detects permission-denied errors accurately', () => {
    expect(isPermissionDeniedError(permDenied)).toBe(true)
    expect(
      isPermissionDeniedError({
        code: 'unknown',
        message: 'Missing or insufficient permissions.',
      }),
    ).toBe(true)
    expect(isPermissionDeniedError({ code: 'cancelled' })).toBe(false)
    expect(isPermissionDeniedError(null)).toBe(false)
  })

  it('detects benign cancellation/unauthenticated listener errors', () => {
    expect(isBenignListenerError({ code: 'cancelled' })).toBe(true)
    expect(isBenignListenerError({ code: 'aborted' })).toBe(true)
    expect(isBenignListenerError({ code: 'unauthenticated' })).toBe(true)
    expect(isBenignListenerError(permDenied)).toBe(false)
  })

  it('suppresses errors when signed out (currentUid is null)', () => {
    expect(
      shouldReportFirestoreError({
        err: permDenied,
        expectedUid: 'uid-1',
        currentUid: null,
        isAuthTransitioning: false,
      }),
    ).toBe(false)
  })

  it('suppresses errors when UID changed mid-flight during account switch', () => {
    expect(
      shouldReportFirestoreError({
        err: permDenied,
        expectedUid: 'guest-uid',
        currentUid: 'teacher-uid',
        isAuthTransitioning: false,
      }),
    ).toBe(false)
  })

  it('suppresses errors while auth transition or listener teardown is active', () => {
    expect(
      shouldReportFirestoreError({
        err: permDenied,
        expectedUid: 'uid-1',
        currentUid: 'uid-1',
        isAuthTransitioning: true,
      }),
    ).toBe(false)
    expect(
      shouldReportFirestoreError({
        err: permDenied,
        expectedUid: 'uid-1',
        currentUid: 'uid-1',
        isAuthTransitioning: false,
        isTornDown: true,
      }),
    ).toBe(false)
  })

  it('reports genuine permission-denied errors for active matching authenticated user', () => {
    expect(
      shouldReportFirestoreError({
        err: permDenied,
        expectedUid: 'uid-1',
        currentUid: 'uid-1',
        isAuthTransitioning: false,
        isTornDown: false,
      }),
    ).toBe(true)
  })
})
