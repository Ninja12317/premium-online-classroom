import { createServerFn } from '@tanstack/react-start'
import { and, eq, gt, inArray, isNotNull, lt, ne } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db/index.js'
import { meetings, participants, signals } from '../../db/schema.js'
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
    const [meeting] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.meetingId, data.meetingId))
      .limit(1)
    if (!meeting) return { status: 'not-found' }
    if (meeting.endedAt) return { status: 'ended' }

    const [me] = await db
      .select()
      .from(participants)
      .where(
        and(
          eq(participants.meetingId, meeting.meetingId),
          eq(participants.identity, data.identity),
          eq(participants.keyHash, sha256(data.participantKey)),
        ),
      )
      .limit(1)
    if (!me) return { status: 'not-found' }
    if (me.status !== 'admitted') {
      return { status: me.status as 'removed' | 'rejected' | 'waiting' }
    }

    const now = new Date()
    const since = new Date(now.getTime() - PRESENCE_WINDOW_MS)
    const role = me.role as Role

    // Presence heartbeat.
    await db
      .update(participants)
      .set({ sessionId: data.sessionId, lastSeenAt: now })
      .where(eq(participants.id, me.id))

    // Outgoing signals, restricted to people actually in this meeting.
    if (data.outbox.length > 0) {
      const targets = Array.from(new Set(data.outbox.map((s) => s.to)))
      const known = await db
        .select({ identity: participants.identity })
        .from(participants)
        .where(
          and(
            eq(participants.meetingId, meeting.meetingId),
            inArray(participants.identity, targets),
            eq(participants.status, 'admitted'),
          ),
        )
      const allowed = new Set(known.map((k) => k.identity))
      const rows = data.outbox
        .filter((s) => allowed.has(s.to))
        .map((s) => ({
          meetingId: meeting.meetingId,
          fromIdentity: me.identity,
          fromSession: data.sessionId,
          toIdentity: s.to,
          toSession: s.toSession,
          kind: s.kind,
          payload: s.payload,
        }))
      if (rows.length > 0) await db.insert(signals).values(rows)
    }

    // Drain the inbox atomically so nothing is delivered twice.
    const inboxRows = await db
      .delete(signals)
      .where(
        and(
          eq(signals.meetingId, meeting.meetingId),
          eq(signals.toIdentity, me.identity),
          eq(signals.toSession, data.sessionId),
        ),
      )
      .returning()
    inboxRows.sort((a, b) => a.id - b.id)

    // Sweep abandoned signals (cheap, keeps the table tiny).
    await db
      .delete(signals)
      .where(lt(signals.createdAt, new Date(now.getTime() - SIGNAL_TTL_MS)))

    const online = await db
      .select({
        identity: participants.identity,
        sessionId: participants.sessionId,
        name: participants.name,
        role: participants.role,
      })
      .from(participants)
      .where(
        and(
          eq(participants.meetingId, meeting.meetingId),
          eq(participants.status, 'admitted'),
          ne(participants.identity, me.identity),
          isNotNull(participants.sessionId),
          gt(participants.lastSeenAt, since),
        ),
      )

    let waiting: WaitingParticipant[] | null = null
    if (isModerator(role)) {
      const rows = await db
        .select()
        .from(participants)
        .where(
          and(
            eq(participants.meetingId, meeting.meetingId),
            eq(participants.status, 'waiting'),
          ),
        )
        .orderBy(participants.createdAt)
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
    await db
      .update(participants)
      .set({ sessionId: null, lastSeenAt: null })
      .where(
        and(
          eq(participants.meetingId, data.meetingId),
          eq(participants.identity, data.identity),
          eq(participants.keyHash, sha256(data.participantKey)),
        ),
      )
    return { ok: true }
  })
