import { describe, expect, it } from 'vitest'
import { AuthError, MissingIdentityError } from '@netlify/identity'
import { describeAuthError } from './auth-errors'

const fallback = 'Something went wrong.'

describe('describeAuthError', () => {
  it('explains an unconfirmed email instead of a generic failure', () => {
    const info = describeAuthError(
      new AuthError('Email not confirmed', 400),
      fallback,
    )
    expect(info.kind).toBe('unconfirmed')
    expect(info.message).toMatch(/confirmation link/i)
  })

  it('maps 401 to wrong credentials', () => {
    const info = describeAuthError(
      new AuthError('invalid_grant: No user found with that email', 401),
      fallback,
    )
    expect(info.kind).toBe('credentials')
  })

  it('recognises an already registered email', () => {
    const info = describeAuthError(
      new AuthError(
        'A user with this email address has already been registered',
        422,
      ),
      fallback,
    )
    expect(info.kind).toBe('exists')
  })

  it('explains when Identity is unavailable', () => {
    expect(describeAuthError(new MissingIdentityError(), fallback).kind).toBe(
      'unavailable',
    )
  })

  it('falls back for unknown errors', () => {
    const info = describeAuthError(new TypeError('network'), fallback)
    expect(info).toEqual({ kind: 'unknown', message: fallback })
  })
})
