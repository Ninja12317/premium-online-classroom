import { describe, expect, it } from 'vitest'

import {
  formatWorkspaceStatusPill,
  getFirstName,
  getTimeGreeting,
} from './workspace-status'

describe('workspace status helpers', () => {
  it('returns time-aware greetings for morning, afternoon, and evening', () => {
    expect(getTimeGreeting(new Date(2026, 10, 27, 8, 30))).toBe('Good morning')
    expect(getTimeGreeting(new Date(2026, 10, 27, 14, 0))).toBe(
      'Good afternoon',
    )
    expect(getTimeGreeting(new Date(2026, 10, 27, 19, 15))).toBe('Good evening')
  })

  it('extracts clean first names', () => {
    expect(getFirstName('Priya Sharma')).toBe('Priya')
    expect(getFirstName('  Aarav  ')).toBe('Aarav')
    expect(getFirstName('')).toBe('')
  })

  it('formats live and upcoming status pills by role', () => {
    const now = Date.UTC(2026, 10, 27, 14, 0, 0)
    expect(
      formatWorkspaceStatusPill({
        role: 'teacher',
        nowMs: now,
        nextMeeting: {
          startedAt: null,
          endedAt: null,
          scheduledAt: new Date(now + 15 * 60_000).toISOString(),
        },
      }),
    ).toEqual({ label: 'Next class in 15m', live: true })

    expect(
      formatWorkspaceStatusPill({
        role: 'teacher',
        nowMs: now,
        nextMeeting: null,
      }),
    ).toEqual({ label: 'Ready to host', live: true })

    expect(
      formatWorkspaceStatusPill({
        role: 'student',
        nowMs: now,
        nextMeeting: null,
      }),
    ).toEqual({ label: 'No classes scheduled today', live: false })

    expect(
      formatWorkspaceStatusPill({
        role: 'guest',
        nowMs: now,
        nextMeeting: null,
      }),
    ).toBeNull()
  })
})
