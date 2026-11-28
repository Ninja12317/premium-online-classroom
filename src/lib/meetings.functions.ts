import {
  admitAllWaiting,
  createMeetingRecord,
  decideParticipantAdmission,
  deleteMeetingRecord,
  endMeetingRecord,
  getHostMeetingDetails,
  getMeetingSummary,
  joinMeetingRecord,
  listUserMeetings,
  listWaitingParticipants,
  moderateParticipantRecord,
  scheduleMeetingRecord,
  startInstantMeetingRecord,
  startScheduledMeetingRecord,
  updateMeetingDetails,
  updateMeetingSettingsRecord,
  type CreateMeetingInput,
  type JoinMeetingInput,
  type JoinResult,
} from '@/services/firestore-meetings'
import type { MeetingSettings } from '@/lib/meeting-types'

export type { JoinResult }

export async function createMeeting({ data }: { data: CreateMeetingInput }) {
  return createMeetingRecord(data)
}

export async function startInstantMeeting({
  data,
}: {
  data: Omit<CreateMeetingInput, 'meetingType' | 'scheduledAt'>
}) {
  return startInstantMeetingRecord(data)
}

export async function scheduleMeeting({
  data,
}: {
  data: Omit<CreateMeetingInput, 'meetingType'> & { scheduledAt: string }
}) {
  return scheduleMeetingRecord(data)
}

export async function startScheduledMeeting({
  data,
}: {
  data: { meetingId: string; hostKey?: string }
}) {
  return startScheduledMeetingRecord(data.meetingId, data.hostKey)
}

export async function updateMeeting({
  data,
}: {
  data: {
    meetingId: string
    title?: string
    scheduledAt?: string | null
    durationMin?: number
    waitingRoom?: boolean
    passcode?: string | null
  }
}) {
  return updateMeetingDetails(data.meetingId, data)
}

export async function getMeeting({ data }: { data: { meetingId: string } }) {
  return getMeetingSummary(data.meetingId)
}

export async function listMyMeetings() {
  return listUserMeetings()
}

export async function getHostDetails({
  data,
}: {
  data: { meetingId: string; hostKey: string }
}) {
  return getHostMeetingDetails(data.meetingId, data.hostKey)
}

export async function deleteMeeting({ data }: { data: { meetingId: string } }) {
  return deleteMeetingRecord(data.meetingId)
}

export async function joinMeeting({
  data,
}: {
  data: JoinMeetingInput
}): Promise<JoinResult> {
  return joinMeetingRecord(data)
}

export async function listWaiting({
  data,
}: {
  data: { meetingId: string; actorKey: string }
}) {
  return listWaitingParticipants(data.meetingId, data.actorKey)
}

export async function decideAdmission({
  data,
}: {
  data: {
    meetingId: string
    actorKey: string
    identity: string
    admit: boolean
  }
}) {
  return decideParticipantAdmission(
    data.meetingId,
    data.actorKey,
    data.identity,
    data.admit,
  )
}

export async function admitAll({
  data,
}: {
  data: { meetingId: string; actorKey: string }
}) {
  return admitAllWaiting(data.meetingId, data.actorKey)
}

export async function updateSettings({
  data,
}: {
  data: {
    meetingId: string
    actorKey: string
    patch: Partial<MeetingSettings>
  }
}) {
  return updateMeetingSettingsRecord(data.meetingId, data.actorKey, data.patch)
}

export async function moderate({
  data,
}: {
  data: {
    meetingId: string
    actorKey: string
    identity: string
    action: 'remove' | 'make-cohost' | 'revoke-cohost'
  }
}) {
  return moderateParticipantRecord(
    data.meetingId,
    data.actorKey,
    data.identity,
    data.action,
  )
}

export async function endMeeting({
  data,
}: {
  data: { meetingId: string; actorKey: string }
}) {
  return endMeetingRecord(data.meetingId, data.actorKey)
}
