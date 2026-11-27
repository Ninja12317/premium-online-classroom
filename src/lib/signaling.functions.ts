import {
  leaveRoomFirestore,
  syncRoomFirestore,
} from '@/services/firestore-meetings'
import type { OutgoingSignal, SyncResult } from '@/lib/meeting-types'

export async function syncRoom({
  data,
}: {
  data: {
    meetingId: string
    identity: string
    participantKey: string
    sessionId: string
    outbox: OutgoingSignal[]
  }
}): Promise<SyncResult> {
  return syncRoomFirestore(data)
}

export async function leaveRoom({
  data,
}: {
  data: {
    meetingId: string
    identity: string
    participantKey: string
  }
}) {
  return leaveRoomFirestore(data)
}
