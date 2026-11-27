export interface WorkspaceStatusPill {
  label: string
  live: boolean
}

export function getTimeGreeting(date: Date): string {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function getFirstName(fullName?: string | null): string {
  const clean = (fullName ?? '').trim()
  if (!clean) return ''
  return clean.split(/\s+/)[0] ?? ''
}

export function formatWorkspaceStatusPill(opts: {
  role: 'teacher' | 'student' | 'guest' | null
  nowMs: number
  nextMeeting: {
    startedAt: string | null
    endedAt: string | null
    scheduledAt: string | null
  } | null
}): WorkspaceStatusPill | null {
  if (opts.role !== 'teacher' && opts.role !== 'student') {
    return null
  }

  const next = opts.nextMeeting
  if (next && !next.endedAt) {
    if (next.startedAt) {
      return { label: 'Class live now', live: true }
    }
    if (next.scheduledAt) {
      const startMs = Date.parse(next.scheduledAt)
      if (!Number.isNaN(startMs)) {
        const diffMin = Math.round((startMs - opts.nowMs) / 60_000)
        if (diffMin >= -15 && diffMin <= 1) {
          return { label: 'Starting now', live: true }
        }
        if (diffMin > 1 && diffMin < 60) {
          return { label: `Next class in ${diffMin}m`, live: true }
        }
        if (diffMin >= 60 && diffMin < 24 * 60) {
          const hours = Math.round(diffMin / 60)
          return { label: `Next class in ${hours}h`, live: false }
        }
      }
    }
  }

  if (opts.role === 'teacher') {
    return { label: 'Ready to host', live: true }
  }

  return { label: 'No classes scheduled today', live: false }
}
