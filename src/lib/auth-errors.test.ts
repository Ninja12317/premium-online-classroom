import { describe, expect, it } from 'vitest'
import { describeAuthError } from './auth-errors'

const fallback = 'Something went wrong.'

describe('describeAuthError', () => {
  it('maps invalid credentials to wrong email or password', () => {
    const info = describeAuthError(
      { code: 'auth/invalid-credential', message: 'Firebase: Error' },
      fallback,
    )
    expect(info.kind).toBe('credentials')
    expect(info.message).toMatch(/wrong email or password/i)
  })

  it('recognises an already registered email', () => {
    const info = describeAuthError(
      { code: 'auth/email-already-in-use', message: 'Already in use' },
      fallback,
    )
    expect(info.kind).toBe('exists')
  })

  it('explains when email/password auth is not enabled', () => {
    expect(
      describeAuthError({ code: 'auth/operation-not-allowed' }, fallback).kind,
    ).toBe('unavailable')
  })

  it('handles rate limits', () => {
    expect(
      describeAuthError({ code: 'auth/too-many-requests' }, fallback).kind,
    ).toBe('rate-limited')
  })

  it('falls back for unknown errors', () => {
    const info = describeAuthError(new TypeError('network'), fallback)
    expect(info).toEqual({ kind: 'unknown', message: fallback })
  })
})
