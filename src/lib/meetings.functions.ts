import { createServerFn } from '@tanstack/react-start'
import { getUser } from '@netlify/identity'
import { z } from 'zod'

import {
  memoryStore,
  type MeetingRow,
  type ParticipantRow,
} from '../../db/index.js'
import { sha256, randomSecret } from '@/lib/server/crypto'
import { iceServers } from '@/lib/server/ice'
import {
  generateMeetingId,
  generatePasscode,
  isValidMeetingId,
} from '@/lib/meeting'
import type {
  IceServer,
  MeetingSettings,
  MeetingSummary,
  Role,
  WaitingParticipant,
} from '@/lib/meeting-types'

const meetingIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(isValidMeetingId, 'Enter a meeting ID like abc-defg-hij')
const nameSchema = z.string().trim().min(1, 'Enter your name').max(60)
const keySchema = z.string().trim().min(8).max(200)

function settingsOf(row: MeetingRow): MeetingSettings {
  return {
    locked: row.locked,
    waitingRoom: row.waitingRoom,
    allowStudentScreenShare: row.allowStudentScreenShare,
    allowStudentDraw: row.allowStudentDraw,
    allowChat: row.allowChat,
    allowPrivateChat: row.allowPrivateChat,
  }
}

function summaryOf(row: MeetingRow): MeetingSummary {
  return {
    ...settingsOf(row),
    meetingId: row.meetingId,
    title: row.title,
    hostName: row.hostName,
    hasPasscode: !!row.passcode,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    durationMin: row.durationMin,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
  }
}

function findMeeting(meetingId: string): MeetingRow | null {
  return memoryStore.meetings.find((m) => m.meetingId === meetingId) ?? null
}

async function currentUser() {
  try {
    return await getUser()
  } catch {
    return null
  }
}

/**
 * Resolves who is acting: the host (by host key) or a co-host (by participant
 * key). Throws for anyone else so moderation can never be spoofed.
 */
function authorizeModerator(meetingId: string, actorKey: string) {
  const meeting = findMeeting(meetingId)
  if (!meeting) throw new Error('This meeting no longer exists.')
  const hash = sha256(actorKey)
  if (hash === meeting.hostKeyHash) {
    return { meeting, role: 'host' as Role }
  }
  const row = memoryStore.participants.find(
    (p) =>
      p.meetingId === meetingId &&
      p.keyHash === hash &&
      (p.role === 'host' || p.role === 'cohost') &&
      p.status === 'admitted',
  )
  if (row) return { meeting, role: row.role as Role }
  throw new Error('Only the teacher or a co-host can do that.')
}

// ---------------------------------------------------------------------------
// Creating and reading meetings
// ---------------------------------------------------------------------------

const createInput = z.object({
  title: z.string().trim().max(120).optional(),
  hostName: z.string().trim().max(60).optional(),
  passcode: z.boolean().optional(),
  waitingRoom: z.boolean().optional(),
  scheduledAt: z.string().datetime().optional(),
  durationMin: z.number().int().min(5).max(600).optional(),
})

export const createMeeting = createServerFn({ method: 'POST' })
  .validator(createInput)
  .handler(async ({ data }) => {
    const user = await currentUser()
    const hostName =
      data.hostName || user?.name || user?.email?.split('@')[0] || 'Teacher'
    const hostKey = randomSecret()
    const passcode = data.passcode ? generatePasscode() : null
    let meetingId = generateMeetingId()
    for (let i = 0; i < 5 && findMeeting(meetingId); i++) {
      meetingId = generateMeetingId()
    }
    memoryStore.meetings.push({
      id: memoryStore.nextMeetingId++,
      meetingId,
      title: data.title || 'Live class',
      hostName,
      hostUserId: user?.id ?? null,
      hostKeyHash: sha256(hostKey),
      passcode,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
      durationMin: data.durationMin ?? 60,
      waitingRoom: data.waitingRoom ?? true,
      locked: false,
      allowStudentScreenShare: false,
      allowStudentDraw: false,
      allowChat: true,
      allowPrivateChat: true,
      startedAt: null,
      endedAt: null,
      createdAt: new Date(),
    })
    return { meetingId, hostKey, passcode }
  })

export const getMeeting = createServerFn({ method: 'GET' })
  .validator(z.object({ meetingId: meetingIdSchema }))
  .handler(
    async ({
      data,
    }): Promise<(MeetingSummary & { youAreHost: boolean }) | null> => {
      const row = findMeeting(data.meetingId)
      if (!row) return null
      let youAreHost = false
      if (row.hostUserId) {
        const user = await currentUser()
        youAreHost = !!user && user.id === row.hostUserId
      }
      return { ...summaryOf(row), youAreHost }
    },
  )

/** The teacher's own meetings; requires a signed-in account. */
export const listMyMeetings = createServerFn({ method: 'GET' }).handler(
  async () => {
    const user = await currentUser()
    if (!user) return null
    const rows = memoryStore.meetings
      .filter((m) => m.hostUserId === user.id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50)
    return rows.map((row) => ({ ...summaryOf(row), passcode: row.passcode }))
  },
)

/** The passcode is only revealed to the host (by key) or the owning account. */
export const getHostDetails = createServerFn({ method: 'POST' })
  .validator(z.object({ meetingId: meetingIdSchema, hostKey: keySchema }))
  .handler(async ({ data }) => {
    const { meeting } = authorizeModerator(data.meetingId, data.hostKey)
    return { ...summaryOf(meeting), passcode: meeting.passcode }
  })

export const deleteMeeting = createServerFn({ method: 'POST' })
  .validator(z.object({ meetingId: meetingIdSchema }))
  .handler(async ({ data }) => {
    const user = await currentUser()
    if (!user) throw new Error('Sign in to manage your classes.')
    const row = findMeeting(data.meetingId)
    if (!row || row.hostUserId !== user.id) {
      throw new Error('That class is not yours to delete.')
    }
    memoryStore.signals = memoryStore.signals.filter(
      (s) => s.meetingId !== row.meetingId,
    )
    memoryStore.participants = memoryStore.participants.filter(
      (p) => p.meetingId !== row.meetingId,
    )
    memoryStore.meetings = memoryStore.meetings.filter((m) => m.id !== row.id)
    return { ok: true }
  })

// ---------------------------------------------------------------------------
// Joining, the waiting room, and admission
// ---------------------------------------------------------------------------

export type JoinResult =
  | { status: 'not-found' }
  | { status: 'ended'; meeting: MeetingSummary }
  | { status: 'locked'; meeting: MeetingSummary }
  | { status: 'passcode-required'; meeting: MeetingSummary; wrong: boolean }
  | { status: 'rejected'; meeting: MeetingSummary }
  | { status: 'removed'; meeting: MeetingSummary }
  | {
      status: 'waiting'
      meeting: MeetingSummary
      identity: string
      participantKey: string
    }
  | {
      status: 'joined'
      meeting: MeetingSummary
      identity: string
      participantKey: string
      role: Role
      /** STUN/TURN servers for the peer-to-peer connections. */
      iceServers: IceServer[]
    }

const joinInput = z.object({
  meetingId: meetingIdSchema,
  name: nameSchema,
  passcode: z.string().trim().max(12).optional(),
  hostKey: z.string().trim().max(200).optional(),
  identity: z.string().trim().max(64).optional(),
  participantKey: z.string().trim().max(200).optional(),
})

function joinedResult(
  meeting: MeetingRow,
  participant: ParticipantRow,
  participantKey: string,
): JoinResult {
  return {
    status: 'joined',
    meeting: summaryOf(meeting),
    identity: participant.identity,
    participantKey,
    role: participant.role as Role,
    iceServers: iceServers(),
  }
}

export const joinMeeting = createServerFn({ method: 'POST' })
  .validator(joinInput)
  .handler(async ({ data }): Promise<JoinResult> => {
    const meeting = findMeeting(data.meetingId)
    if (!meeting) return { status: 'not-found' }
    const summary = summaryOf(meeting)
    if (meeting.endedAt) return { status: 'ended', meeting: summary }

    // Host joining with their key or their signed-in account: always
    // admitted, and starts the class.
    const byKey = !!data.hostKey && sha256(data.hostKey) === meeting.hostKeyHash
    let byAccount = false
    if (!byKey && meeting.hostUserId) {
      const user = await currentUser()
      byAccount = !!user && user.id === meeting.hostUserId
    }
    if (byKey || byAccount) {
      const hostSecret = byKey ? data.hostKey! : randomSecret()
      let row = memoryStore.participants.find(
        (p) => p.meetingId === meeting.meetingId && p.role === 'host',
      )
      if (!row) {
        const now = new Date()
        row = {
          id: memoryStore.nextParticipantId++,
          meetingId: meeting.meetingId,
          identity: `host-${randomSecret(6)}`,
          name: data.name,
          role: 'host',
          status: 'admitted',
          keyHash: sha256(hostSecret),
          sessionId: null,
          lastSeenAt: null,
          createdAt: now,
          updatedAt: now,
        }
        memoryStore.participants.push(row)
      } else {
        row.name = data.name
        row.keyHash = sha256(hostSecret)
        row.updatedAt = new Date()
      }
      if (!meeting.startedAt) {
        meeting.startedAt = new Date()
      }
      return joinedResult(meeting, row, hostSecret)
    }

    // Returning participant (page refresh, reconnect, or waiting-room poll).
    if (data.identity && data.participantKey) {
      const keyHash = sha256(data.participantKey)
      const row = memoryStore.participants.find(
        (p) =>
          p.identity === data.identity &&
          p.meetingId === meeting.meetingId &&
          p.keyHash === keyHash,
      )
      if (row) {
        if (row.status === 'admitted') {
          return joinedResult(meeting, row, data.participantKey)
        }
        if (row.status === 'waiting') {
          return {
            status: 'waiting',
            meeting: summary,
            identity: row.identity,
            participantKey: data.participantKey,
          }
        }
        return {
          status: row.status as 'rejected' | 'removed',
          meeting: summary,
        }
      }
    }

    // New student.
    if (meeting.passcode) {
      if (!data.passcode) {
        return { status: 'passcode-required', meeting: summary, wrong: false }
      }
      if (data.passcode !== meeting.passcode) {
        return { status: 'passcode-required', meeting: summary, wrong: true }
      }
    }
    if (meeting.locked) return { status: 'locked', meeting: summary }

    const participantKey = randomSecret()
    const now = new Date()
    const row: ParticipantRow = {
      id: memoryStore.nextParticipantId++,
      meetingId: meeting.meetingId,
      identity: `p-${randomSecret(6)}`,
      name: data.name,
      role: 'student',
      status: meeting.waitingRoom ? 'waiting' : 'admitted',
      keyHash: sha256(participantKey),
      sessionId: null,
      lastSeenAt: null,
      createdAt: now,
      updatedAt: now,
    }
    memoryStore.participants.push(row)
    if (row.status === 'waiting') {
      return {
        status: 'waiting',
        meeting: summary,
        identity: row.identity,
        participantKey,
      }
    }
    return joinedResult(meeting, row, participantKey)
  })

const moderatorInput = z.object({
  meetingId: meetingIdSchema,
  actorKey: keySchema,
})

export const listWaiting = createServerFn({ method: 'POST' })
  .validator(moderatorInput)
  .handler(async ({ data }): Promise<WaitingParticipant[]> => {
    authorizeModerator(data.meetingId, data.actorKey)
    const rows = memoryStore.participants
      .filter((p) => p.meetingId === data.meetingId && p.status === 'waiting')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    return rows.map((r) => ({
      identity: r.identity,
      name: r.name,
      requestedAt: r.createdAt.toISOString(),
    }))
  })

export const decideAdmission = createServerFn({ method: 'POST' })
  .validator(
    moderatorInput.extend({
      identity: z.string().trim().min(1).max(64),
      admit: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    authorizeModerator(data.meetingId, data.actorKey)
    for (const p of memoryStore.participants) {
      if (
        p.meetingId === data.meetingId &&
        p.identity === data.identity &&
        p.status === 'waiting'
      ) {
        p.status = data.admit ? 'admitted' : 'rejected'
        p.updatedAt = new Date()
      }
    }
    return { ok: true }
  })

export const admitAll = createServerFn({ method: 'POST' })
  .validator(moderatorInput)
  .handler(async ({ data }) => {
    authorizeModerator(data.meetingId, data.actorKey)
    const now = new Date()
    for (const p of memoryStore.participants) {
      if (p.meetingId === data.meetingId && p.status === 'waiting') {
        p.status = 'admitted'
        p.updatedAt = now
      }
    }
    return { ok: true }
  })

// ---------------------------------------------------------------------------
// Host controls
// ---------------------------------------------------------------------------

const settingsPatch = z.object({
  locked: z.boolean().optional(),
  waitingRoom: z.boolean().optional(),
  allowStudentScreenShare: z.boolean().optional(),
  allowStudentDraw: z.boolean().optional(),
  allowChat: z.boolean().optional(),
  allowPrivateChat: z.boolean().optional(),
})

export const updateSettings = createServerFn({ method: 'POST' })
  .validator(moderatorInput.extend({ patch: settingsPatch }))
  .handler(async ({ data }): Promise<MeetingSettings> => {
    const { meeting } = authorizeModerator(data.meetingId, data.actorKey)
    if (data.patch.locked !== undefined) meeting.locked = data.patch.locked
    if (data.patch.waitingRoom !== undefined)
      meeting.waitingRoom = data.patch.waitingRoom
    if (data.patch.allowStudentScreenShare !== undefined)
      meeting.allowStudentScreenShare = data.patch.allowStudentScreenShare
    if (data.patch.allowStudentDraw !== undefined)
      meeting.allowStudentDraw = data.patch.allowStudentDraw
    if (data.patch.allowChat !== undefined)
      meeting.allowChat = data.patch.allowChat
    if (data.patch.allowPrivateChat !== undefined)
      meeting.allowPrivateChat = data.patch.allowPrivateChat
    // Peers pick the change up on their next sync; the moderator also
    // broadcasts it over the data channel for immediacy.
    return settingsOf(meeting)
  })

/**
 * Moderation that changes server state. Muting and stopping a screen share
 * are enforced in the browser: the moderator sends the instruction over the
 * data channel and the recipient honours it because the sender's role was
 * verified during signalling.
 */
const moderateInput = moderatorInput.extend({
  identity: z.string().trim().min(1).max(64),
  action: z.enum(['remove', 'make-cohost', 'revoke-cohost']),
})

export const moderate = createServerFn({ method: 'POST' })
  .validator(moderateInput)
  .handler(async ({ data }) => {
    const { meeting, role } = authorizeModerator(data.meetingId, data.actorKey)
    const target = memoryStore.participants.find(
      (p) => p.meetingId === meeting.meetingId && p.identity === data.identity,
    )
    if (!target) throw new Error('That participant has already left.')
    if (target.role === 'host')
      throw new Error('The teacher cannot be moderated.')
    if (
      (data.action === 'make-cohost' || data.action === 'revoke-cohost') &&
      role !== 'host'
    ) {
      throw new Error('Only the teacher can change co-hosts.')
    }

    switch (data.action) {
      case 'remove': {
        target.status = 'removed'
        target.sessionId = null
        target.lastSeenAt = null
        target.updatedAt = new Date()
        return { ok: true }
      }
      case 'make-cohost':
      case 'revoke-cohost': {
        const nextRole: Role =
          data.action === 'make-cohost' ? 'cohost' : 'student'
        target.role = nextRole
        target.updatedAt = new Date()
        return { ok: true }
      }
    }
  })

export const endMeeting = createServerFn({ method: 'POST' })
  .validator(moderatorInput)
  .handler(async ({ data }) => {
    const { meeting, role } = authorizeModerator(data.meetingId, data.actorKey)
    if (role !== 'host') throw new Error('Only the teacher can end the class.')
    meeting.endedAt = new Date()
    memoryStore.signals = memoryStore.signals.filter(
      (s) => s.meetingId !== meeting.meetingId,
    )
    return { ok: true }
  })
