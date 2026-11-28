import { describe, expect, it } from 'vitest'

import {
  AuthRequiredError,
  HOST_AUTH_REQUIRED_CODE,
  isAuthRequiredError,
  isRegisteredUser,
} from './auth-gate'
import {
  formatScheduledCountdown,
  isScheduledMeetingNotStarted,
} from './meeting-types'

describe('isRegisteredUser', () => {
  it('returns false for null, undefined, anonymous, and guest users', () => {
    expect(isRegisteredUser(null)).toBe(false)
    expect(isRegisteredUser(undefined)).toBe(false)
    expect(isRegisteredUser({ uid: 'anon-1', isAnonymous: true })).toBe(false)
    expect(
      isRegisteredUser({
        id: 'anon-2',
        isAnonymous: true,
        isGuest: true,
        role: 'guest',
      }),
    ).toBe(false)
    expect(
      isRegisteredUser({ id: 'guest-3', isAnonymous: false, role: 'guest' }),
    ).toBe(false)
    expect(
      isRegisteredUser({ id: 'guest-4', isAnonymous: false, isGuest: true }),
    ).toBe(false)
  })

  it('returns true for registered Firebase accounts', () => {
    expect(isRegisteredUser({ uid: 'teacher-1', isAnonymous: false })).toBe(
      true,
    )
    expect(
      isRegisteredUser({
        id: 'teacher-1',
        isAnonymous: false,
        isGuest: false,
        role: 'teacher',
      }),
    ).toBe(true)
    expect(
      isRegisteredUser({
        id: 'student-1',
        isAnonymous: false,
        isGuest: false,
        role: 'student',
      }),
    ).toBe(true)
  })

  it('recognizes AuthRequiredError instances and AUTH_REQUIRED code', () => {
    const err = new AuthRequiredError()
    expect(err.code).toBe(HOST_AUTH_REQUIRED_CODE)
    expect(isAuthRequiredError(err)).toBe(true)
    expect(isAuthRequiredError({ code: 'AUTH_REQUIRED' })).toBe(true)
    expect(isAuthRequiredError(new Error('Other'))).toBe(false)
  })
})

describe('isScheduledMeetingNotStarted', () => {
  it('returns true when status is scheduled or hostStarted is false', () => {
    expect(
      isScheduledMeetingNotStarted({
        meetingType: 'scheduled',
        status: 'scheduled',
        hostStarted: false,
        scheduledAt: '2027-02-10T10:00:00.000Z',
        endedAt: null,
      }),
    ).toBe(true)
    expect(
      isScheduledMeetingNotStarted({
        meetingType: 'scheduled',
        status: 'live',
        hostStarted: false,
        scheduledAt: '2027-02-10T10:00:00.000Z',
        endedAt: null,
      }),
    ).toBe(true)
  })

  it('returns false when hostStarted is true and live, or when ended', () => {
    expect(
      isScheduledMeetingNotStarted({
        meetingType: 'scheduled',
        status: 'live',
        hostStarted: true,
        scheduledAt: '2027-02-10T10:00:00.000Z',
        endedAt: null,
      }),
    ).toBe(false)
    expect(
      isScheduledMeetingNotStarted({
        meetingType: 'instant',
        status: 'live',
        hostStarted: true,
        scheduledAt: null,
        endedAt: null,
      }),
    ).toBe(false)
    expect(
      isScheduledMeetingNotStarted({
        meetingType: 'scheduled',
        status: 'ended',
        hostStarted: false,
        scheduledAt: '2027-02-10T10:00:00.000Z',
        endedAt: '2027-02-10T11:00:00.000Z',
      }),
    ).toBe(false)
  })
})

describe('formatScheduledCountdown', () => {
  it('formats < 24h durations as Starts in Xh Ym Zs', () => {
    const now = Date.UTC(2027, 0, 1, 10, 0, 0)
    const target = now + (2 * 3600 + 15 * 60 + 30) * 1000
    expect(formatScheduledCountdown(target, now)).toBe('Starts in 2h 15m 30s')

    const soon = now + (12 * 60 + 5) * 1000
    expect(formatScheduledCountdown(soon, now)).toBe('Starts in 0h 12m 5s')
  })

  it('formats >= 24h durations as Starts in Xd Yh Zm', () => {
    const now = Date.UTC(2027, 0, 1, 10, 0, 0)
    const target = now + (2 * 86400 + 3 * 3600 + 45 * 60) * 1000
    expect(formatScheduledCountdown(target, now)).toBe('Starts in 2d 3h 45m')
  })

  it('returns null once scheduled start time is reached or passed', () => {
    const now = Date.UTC(2027, 0, 1, 10, 0, 0)
    expect(formatScheduledCountdown(now, now)).toBeNull()
    expect(formatScheduledCountdown(now - 60_000, now)).toBeNull()
  })
})
