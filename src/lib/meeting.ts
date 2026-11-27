/**
 * Branded alphanumeric Meeting IDs look like `LEC-7K4M-9284` or `LEC-4829-7315`.
 * Excludes confusing characters (0, O, 1, I, L) when generating so codes are
 * crisp, professional, and easy to read aloud.
 */
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const ALPHANUM = `${DIGITS}${LETTERS}`

function randomBytes(length: number): Uint8Array {
  const values = new Uint8Array(length)
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(values)
  } else {
    for (let i = 0; i < length; i++) {
      values[i] = Math.floor(Math.random() * 256)
    }
  }
  return values
}

function segment(length: number, alphabet: string): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length]
  }
  return out
}

/**
 * Generates a branded alphanumeric meeting ID (`LEC-XXXX-XXXX`), guaranteeing
 * a clean text + numbers mix (e.g. `LEC-7K4M-9284`).
 */
export function generateMeetingId(): string {
  const raw = Array.from(segment(8, ALPHANUM))
  const hasLetter = raw.some((c) => LETTERS.includes(c))
  const hasDigit = raw.some((c) => DIGITS.includes(c))
  const fix = randomBytes(2)
  if (!hasLetter) raw[1] = LETTERS[fix[0] % LETTERS.length]
  if (!hasDigit) raw[6] = DIGITS[fix[1] % DIGITS.length]
  const code = raw.join('')
  return `LEC-${code.slice(0, 4)}-${code.slice(4, 8)}`
}

export function generatePasscode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

const MODERN_ID_PATTERN = /^LEC-[A-Z0-9]{4}-[A-Z0-9]{4}$/
const LEGACY_ID_PATTERN = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/

/** True for modern branded `LEC-XXXX-XXXX` IDs. */
export function isModernMeetingId(id: string): boolean {
  return MODERN_ID_PATTERN.test(id.trim().toUpperCase())
}

/** Accepts both modern `LEC-XXXX-XXXX` IDs and legacy `abc-defg-hij` links. */
export function isValidMeetingId(id: string): boolean {
  const trimmed = id.trim()
  return (
    MODERN_ID_PATTERN.test(trimmed.toUpperCase()) ||
    LEGACY_ID_PATTERN.test(trimmed.toLowerCase())
  )
}

/**
 * Normalizes a meeting ID or URL parameter to its canonical Firestore document ID:
 * - `lec48297315`, `LEC 4829 7315`, `lec-4829-7315` -> `LEC-4829-7315`
 * - legacy `abc-defg-hij` -> `abc-defg-hij`
 */
export function normalizeMeetingId(raw: string): string | null {
  return parseMeetingInput(raw)
}

/**
 * Accepts whatever a student or teacher pastes: a full invite link, a bare ID
 * (`LEC-4829-7315`), spaces (`LEC 4829 7315`), no separators (`lec48297315`),
 * or a legacy 10-letter ID. Returns the canonical ID or null.
 */
export function parseMeetingInput(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null

  // Match branded ID in invite URLs
  const brandedUrlMatch = text.match(
    /\/(?:join|meet)\/(LEC[\s-]?[A-Z0-9]{4}[\s-]?[A-Z0-9]{4})/i,
  )
  if (brandedUrlMatch) {
    const clean = brandedUrlMatch[1].toUpperCase().replace(/[\s-]+/g, '')
    if (clean.length === 11 && clean.startsWith('LEC')) {
      return `LEC-${clean.slice(3, 7)}-${clean.slice(7, 11)}`
    }
  }

  // Match legacy 10-letter ID in invite URLs
  const legacyUrlMatch = text.match(/\/(?:join|meet)\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i)
  if (legacyUrlMatch) return legacyUrlMatch[1].toLowerCase()

  const compact = text.toUpperCase().replace(/[\s-]+/g, '')

  // Branded `LEC` + 8 alphanumeric chars (e.g. `lec48297315`, `LEC 7K4M 9284`)
  if (/^LEC[A-Z0-9]{8}$/.test(compact)) {
    return `LEC-${compact.slice(3, 7)}-${compact.slice(7, 11)}`
  }

  // Shorthand 8 alphanumeric chars without prefix (e.g. `4829-7315` or `7K4M9284`)
  if (/^[A-Z0-9]{8}$/.test(compact)) {
    return `LEC-${compact.slice(0, 4)}-${compact.slice(4, 8)}`
  }

  // Legacy 10-letter format (`abc-defg-hij` or `abcdefghij`)
  if (/^[A-Z]{10}$/.test(compact)) {
    const lower = compact.toLowerCase()
    return `${lower.slice(0, 3)}-${lower.slice(3, 7)}-${lower.slice(7)}`
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
