import { describe, expect, it } from 'vitest'

import {
  generateMeetingId,
  isModernMeetingId,
  isValidMeetingId,
  normalizeMeetingId,
  parseMeetingInput,
} from './meeting'
import { isUpcomingScheduledMeeting } from './meeting-types'

describe('meeting ID generation and normalization', () => {
  it('generates branded LEC-XXXX-XXXX IDs without confusing characters', () => {
    for (let i = 0; i < 40; i++) {
      const id = generateMeetingId()
      expect(id).toMatch(/^LEC-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
      expect(isModernMeetingId(id)).toBe(true)
      expect(isValidMeetingId(id)).toBe(true)
      const body = id.slice(4).replace(/-/g, '')
      expect(body).not.toMatch(/[0O1IL]/)
      expect(body).toMatch(/[A-Z]/)
      expect(body).toMatch(/[2-9]/)
    }
  })

  it('normalizes spaces, hyphens, missing separators, and lowercase inputs', () => {
    expect(parseMeetingInput('lec48297315')).toBe('LEC-4829-7315')
    expect(parseMeetingInput('LEC 4829 7315')).toBe('LEC-4829-7315')
    expect(parseMeetingInput('  lec-4829-7315  ')).toBe('LEC-4829-7315')
    expect(parseMeetingInput('7k4m-9284')).toBe('LEC-7K4M-9284')
    expect(normalizeMeetingId('lec 7k4m 9284')).toBe('LEC-7K4M-9284')
  })

  it('extracts meeting IDs from full invite URLs', () => {
    expect(
      parseMeetingInput('https://lectern.app/join/lec-4829-7315'),
    ).toBe('LEC-4829-7315')
    expect(
      parseMeetingInput('https://lectern.app/meet/LEC-7K4M-9284'),
    ).toBe('LEC-7K4M-9284')
  })

  it('remains backward-compatible with legacy 10-letter codes', () => {
    expect(isValidMeetingId('abc-defg-hij')).toBe(true)
    expect(isModernMeetingId('abc-defg-hij')).toBe(false)
    expect(parseMeetingInput('abc-defg-hij')).toBe('abc-defg-hij')
    expect(
      parseMeetingInput('https://lectern.app/join/abc-defg-hij'),
    ).toBe('abc-defg-hij')
  })

  it('rejects invalid inputs', () => {
    expect(parseMeetingInput('')).toBeNull()
    expect(parseMeetingInput('hello')).toBeNull()
    expect(parseMeetingInput('LEC-123')).toBeNull()
  })
})

describe('isUpcomingScheduledMeeting', () => {
  it('includes scheduled meetings that have not ended', () => {
    expect(
      isUpcomingScheduledMeeting({
        meetingType: 'scheduled',
        scheduledAt: '2027-02-10T10:00:00.000Z',
        status: 'scheduled',
        endedAt: null,
      }),
    ).toBe(true)
    expect(
      isUpcomingScheduledMeeting({
        meetingType: 'scheduled',
        scheduledAt: '2027-02-10T10:00:00.000Z',
        status: 'live',
        endedAt: null,
      }),
    ).toBe(true)
  })

  it('excludes instant meetings even when live or unended', () => {
    expect(
      isUpcomingScheduledMeeting({
        meetingType: 'instant',
        scheduledAt: null,
        status: 'live',
        endedAt: null,
      }),
    ).toBe(false)
    expect(
      isUpcomingScheduledMeeting({
        meetingType: 'instant',
        scheduledAt: '2027-02-10T10:00:00.000Z',
        status: 'scheduled',
        endedAt: null,
      }),
    ).toBe(false)
  })

  it('includes legacy docs with scheduledAt and excludes legacy instant docs without scheduledAt', () => {
    expect(
      isUpcomingScheduledMeeting({
        scheduledAt: '2027-02-10T10:00:00.000Z',
        status: 'scheduled',
        endedAt: null,
      }),
    ).toBe(true)
    expect(
      isUpcomingScheduledMeeting({
        scheduledAt: null,
        status: 'live',
        endedAt: null,
      }),
    ).toBe(false)
  })

  it('excludes ended scheduled meetings', () => {
    expect(
      isUpcomingScheduledMeeting({
        meetingType: 'scheduled',
        scheduledAt: '2027-02-10T10:00:00.000Z',
        status: 'ended',
        endedAt: null,
      }),
    ).toBe(false)
    expect(
      isUpcomingScheduledMeeting({
        meetingType: 'scheduled',
        scheduledAt: '2027-02-10T10:00:00.000Z',
        status: 'scheduled',
        endedAt: '2027-02-10T11:00:00.000Z',
      }),
    ).toBe(false)
  })
})
