import type { WbOp } from '@/components/meeting/whiteboard/engine'
import type { MeetingSettings, ScreenAnnStroke } from '@/lib/meeting-types'

/**
 * Messages exchanged between participants over the peer-to-peer data
 * channels. Moderation messages (`force-mute`, `stop-share`, `kick`, `ended`,
 * `settings`, `spotlight`, `breakout-broadcast`) are only honoured when they
 * come from a moderator.
 */
export type RealtimeMessage =
  | {
      t: 'chat'
      id: string
      text: string
      at: number
      kind: 'message' | 'announcement' | 'private'
    }
  | { t: 'reaction'; emoji: string; id?: string }
  | { t: 'hand'; raised: boolean }
  | { t: 'lower-hand' }
  | { t: 'wb'; op: WbOp }
  | { t: 'wb-request' }
  | {
      t: 'wb-open'
      open: boolean
      boardId?: string | null
      boardTitle?: string | null
    }
  | { t: 'wb-laser'; x: number; y: number }
  | { t: 'wb-camera'; cx: number; cy: number; zoom: number }
  | { t: 'screen-ann'; op: 'add'; stroke: ScreenAnnStroke }
  | { t: 'screen-ann'; op: 'undo' }
  | { t: 'screen-ann'; op: 'clear' }
  | { t: 'recording'; on: boolean }
  | { t: 'announce-join' }
  | { t: 'force-mute' }
  | { t: 'stop-share' }
  | { t: 'kick' }
  | { t: 'ended' }
  | { t: 'settings'; settings: MeetingSettings }
  | { t: 'spotlight'; targetId: string | null }
  | { t: 'caption'; text: string; final: boolean }
  | { t: 'breakout-broadcast'; text: string }

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
