import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { memoryStore, type SignalRow } from '../../db/index.js'
import { sha256 } from '@/lib/server/crypto'
import { isValidMeetingId } from '@/lib/meeting'
import {
  isModerator,
  type MeetingSettings,
  type Role,
  type SyncResult,
  type WaitingParticipant,
} from '@/lib/meeting-types'

/** A participant counts as online while they synced within this window. */
const PRESENCE_WINDOW_MS = 15_000
/** Signals older than this were either consumed or abandoned. */
const SIGNAL_TTL_MS = 120_000

const identitySchema = z.string().trim().min(1).max(64)
const sessionSchema = z.string().trim().min(1).max(64)

const syncInput = z.object({
  meetingId: z.string().trim().toLowerCase().refine(isValidMeetingId),
  identity: identitySchema,
  participantKey: z.string().trim().min(8).max(200),
  sessionId: sessionSchema,
  outbox: z
    .array(
      z.object({
        kind: z.enum(['offer', 'answer', 'ice']),
        to: identitySchema,
        toSession: sessionSchema,
        payload: z.string().max(64_000),
      }),
    )
    .max(50)
    .default([]),
})

/**
 * One heartbeat of the peer-to-peer room. Authenticates the participant,
 * records presence, delivers any queued signalling messages, drains the
 * caller's inbox, and reports who else is online plus the live settings.
 * Everything else (audio, video, chat, whiteboard) travels directly between
 * browsers over WebRTC.
 */
export const syncRoom = createServerFn({ method: 'POST' })
  .validator(syncInput)
  .handler(async ({ data }): Promise<SyncResult> => {
    const meeting = memoryStore.meetings.find(
      (m) => m.meetingId === data.meetingId,
    )
    if (!meeting) return { status: 'not-found' }
    if (meeting.endedAt) return { status: 'ended' }

    const keyHash = sha256(data.participantKey)
    const me = memoryStore.participants.find(
      (p) =>
        p.meetingId === meeting.meetingId &&
        p.identity === data.identity &&
        p.keyHash === keyHash,
    )
    if (!me) return { status: 'not-found' }
    if (me.status !== 'admitted') {
      return { status: me.status as 'removed' | 'rejected' | 'waiting' }
    }

    const now = new Date()
    const sinceMs = now.getTime() - PRESENCE_WINDOW_MS
    const role = me.role as Role

    // Presence heartbeat.
    me.sessionId = data.sessionId
    me.lastSeenAt = now

    // Outgoing signals, restricted to people actually in this meeting.
    if (data.outbox.length > 0) {
      const targets = new Set(data.outbox.map((s) => s.to))
      const allowed = new Set(
        memoryStore.participants
          .filter(
            (p) =>
              p.meetingId === meeting.meetingId &&
              p.status === 'admitted' &&
              targets.has(p.identity),
          )
          .map((p) => p.identity),
      )
      for (const s of data.outbox) {
        if (!allowed.has(s.to)) continue
        memoryStore.signals.push({
          id: memoryStore.nextSignalId++,
          meetingId: meeting.meetingId,
          fromIdentity: me.identity,
          fromSession: data.sessionId,
          toIdentity: s.to,
          toSession: s.toSession,
          kind: s.kind,
          payload: s.payload,
          createdAt: now,
        })
      }
    }

    // Drain the inbox atomically and sweep abandoned signals in one pass.
    const cutoffMs = now.getTime() - SIGNAL_TTL_MS
    const inboxRows: SignalRow[] = []
    const remaining: SignalRow[] = []
    for (const s of memoryStore.signals) {
      if (
        s.meetingId === meeting.meetingId &&
        s.toIdentity === me.identity &&
        s.toSession === data.sessionId
      ) {
        inboxRows.push(s)
      } else if (s.createdAt.getTime() >= cutoffMs) {
        remaining.push(s)
      }
    }
    memoryStore.signals = remaining
    inboxRows.sort((a, b) => a.id - b.id)

    const online = memoryStore.participants.filter(
      (p) =>
        p.meetingId === meeting.meetingId &&
        p.status === 'admitted' &&
        p.identity !== me.identity &&
        p.sessionId !== null &&
        p.lastSeenAt !== null &&
        p.lastSeenAt.getTime() > sinceMs,
    )

    let waiting: WaitingParticipant[] | null = null
    if (isModerator(role)) {
      const rows = memoryStore.participants
        .filter((p) => p.meetingId === meeting.meetingId && p.status === 'waiting')
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      waiting = rows.map((r) => ({
        identity: r.identity,
        name: r.name,
        requestedAt: r.createdAt.toISOString(),
      }))
    }

    const settings: MeetingSettings = {
      locked: meeting.locked,
      waitingRoom: meeting.waitingRoom,
      allowStudentScreenShare: meeting.allowStudentScreenShare,
      allowStudentDraw: meeting.allowStudentDraw,
      allowChat: meeting.allowChat,
      allowPrivateChat: meeting.allowPrivateChat,
    }

    return {
      status: 'ok',
      role,
      settings,
      peers: online.map((p) => ({
        identity: p.identity,
        session: p.sessionId!,
        name: p.name,
        role: p.role as Role,
      })),
      inbox: inboxRows.map((r) => ({
        id: r.id,
        kind: r.kind as 'offer' | 'answer' | 'ice',
        from: r.fromIdentity,
        fromSession: r.fromSession,
        payload: r.payload,
      })),
      waiting,
    }
  })

/** Marks the caller offline right away so others stop waiting for them. */
export const leaveRoom = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      meetingId: z.string().trim().toLowerCase().refine(isValidMeetingId),
      identity: identitySchema,
      participantKey: z.string().trim().min(8).max(200),
    }),
  )
  .handler(async ({ data }) => {
    const keyHash = sha256(data.participantKey)
    for (const p of memoryStore.participants) {
      if (
        p.meetingId === data.meetingId &&
        p.identity === data.identity &&
        p.keyHash === keyHash
      ) {
        p.sessionId = null
        p.lastSeenAt = null
      }
    }
    return { ok: true }
  })
