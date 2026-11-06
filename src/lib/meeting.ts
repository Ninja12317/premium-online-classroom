/** Meeting IDs look like `kqv-mhzp-dwr`: easy to read aloud and type on a phone. */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz' // no l/o to avoid confusion

function chunk(length: number) {
  let out = ''
  const values = new Uint8Array(length)
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(values)
  } else {
    for (let i = 0; i < length; i++) values[i] = Math.floor(Math.random() * 256)
  }
  for (let i = 0; i < length; i++) {
    out += ALPHABET[values[i] % ALPHABET.length]
  }
  return out
}

export function generateMeetingId() {
  return `${chunk(3)}-${chunk(4)}-${chunk(3)}`
}

export function generatePasscode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

const ID_PATTERN = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/

export function isValidMeetingId(id: string) {
  return ID_PATTERN.test(id)
}

/**
 * Accepts whatever a student pastes: a full invite link, a bare ID, or an ID
 * with spaces/uppercase. Returns a normalized ID or null.
 */
export function parseMeetingInput(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  const urlMatch = text.match(/\/(?:join|meet)\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i)
  if (urlMatch) return urlMatch[1].toLowerCase()
  const compact = text.toLowerCase().replace(/[^a-z]/g, '')
  if (compact.length === 10) {
    return `${compact.slice(0, 3)}-${compact.slice(3, 7)}-${compact.slice(7)}`
  }
  return null
}

export function meetingUrl(meetingId: string) {
  if (typeof window === 'undefined') return `/join/${meetingId}`
  return `${window.location.origin}/join/${meetingId}`
}

export function formatDuration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/** Builds a calendar file so a teacher can drop the class into any calendar. */
export function buildIcs(opts: {
  title: string
  startsAt: Date
  durationMin: number
  meetingId: string
  passcode?: string
}) {
  const stamp = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '')
  const end = new Date(opts.startsAt.getTime() + opts.durationMin * 60_000)
  const url = meetingUrl(opts.meetingId)
  const description = [
    `Join the class: ${url}`,
    `Meeting ID: ${opts.meetingId}`,
    opts.passcode ? `Passcode: ${opts.passcode}` : null,
  ]
    .filter(Boolean)
    .join('\\n')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lectern//Live classroom//EN',
    'BEGIN:VEVENT',
    `UID:${opts.meetingId}@lectern`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(opts.startsAt)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${opts.title.replace(/,/g, '\\,')}`,
    `DESCRIPTION:${description}`,
    `URL:${url}`,
    `LOCATION:${url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

export function downloadTextFile(name: string, contents: string, type: string) {
  const blob = new Blob([contents], { type })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}
