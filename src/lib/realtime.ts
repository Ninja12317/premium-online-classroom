import type { WbOp } from '@/components/meeting/whiteboard/engine'
import type { MeetingSettings } from '@/lib/meeting-types'

/**
 * Messages exchanged between participants over the peer-to-peer data
 * channels. Moderation messages (`force-mute`, `stop-share`, `kick`, `ended`,
 * `settings`) are only honoured when they come from a moderator; the sender's
 * role is established by the server during signalling, so it cannot be faked.
 */
export type RealtimeMessage =
  | {
      t: 'chat'
      id: string
      text: string
      at: number
      kind: 'message' | 'announcement' | 'private'
    }
  | { t: 'reaction'; emoji: string }
  | { t: 'hand'; raised: boolean }
  | { t: 'lower-hand' }
  | { t: 'wb'; op: WbOp }
  | { t: 'wb-request' }
  | { t: 'wb-open'; open: boolean }
  | { t: 'recording'; on: boolean }
  | { t: 'announce-join' }
  | { t: 'force-mute' }
  | { t: 'stop-share' }
  | { t: 'kick' }
  | { t: 'ended' }
  | { t: 'settings'; settings: MeetingSettings }

export function encode(message: RealtimeMessage) {
  return JSON.stringify(message)
}

export function decode(payload: string): RealtimeMessage | null {
  try {
    const parsed = JSON.parse(payload) as RealtimeMessage
    return typeof parsed === 'object' && parsed && 't' in parsed ? parsed : null
  } catch {
    return null
  }
}
