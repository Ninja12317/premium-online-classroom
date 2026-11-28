import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore'

import {
  auth,
  db,
  ensureAuth,
  ensureClientUid,
  getCachedClientUid,
  isPermissionDeniedError,
  reportFirestorePermissionError,
} from '@/services/firebase'
import { randomToken, sha256Hex } from '@/lib/hash'
import { stripUndefined } from '@/lib/firestore-sanitize'
import { getIceServers } from '@/lib/ice-client'
import {
  getActiveStorageUid,
  purgeLegacyUnscopedStorage,
  scopedStorageKey,
} from '@/lib/storage-scope'
import {
  generateMeetingId,
  generatePasscode,
  isValidMeetingId,
  normalizeMeetingId,
} from '@/lib/meeting'
import {
  isModerator,
  type BoardLaserState,
  type BreakoutState,
  type IceServer,
  type IncomingSignal,
  type MeetingPoll,
  type MeetingReactionEvent,
  type MeetingSettings,
  type MeetingSummary,
  type OutgoingSignal,
  type ParticipantStatus,
  type PeerInfo,
  type PollOption,
  type PresenterCameraState,
  type PresenterViewportState,
  type Role,
  type ScreenAnnStroke,
  type StandaloneBoardMeta,
  type SyncResult,
  type WaitingParticipant,
  type WhiteboardPresenceEntry,
} from '@/lib/meeting-types'
import type { ChatMessage } from '@/components/meeting/types'
import {
  createTemplateElements,
  type BoardElement,
  type TemplateKind,
} from '@/components/meeting/whiteboard/infinite-engine'

// ---------------------------------------------------------------------------
// UID-namespaced local mirror fallback (NEVER shared across profiles/guests)
// ---------------------------------------------------------------------------

function localMeetingsKey(): string | null {
  return scopedStorageKey('meetings', auth.currentUser?.uid ?? getActiveStorageUid())
}

function localBoardsKey(): string | null {
  return scopedStorageKey('boards', auth.currentUser?.uid ?? getActiveStorageUid())
}

interface MeetingDoc {
  meetingId: string
  topic: string
  title: string
  hostId: string | null
  memberIds: string[]
  hostName: string
  hostKeyHash: string
  passcode: string | null
  waitingRoomEnabled: boolean
  waitingRoom: boolean
  isLocked: boolean
  locked: boolean
  allowStudentScreenShare: boolean
  allowStudentDraw: boolean
  allowChat: boolean
  allowPrivateChat: boolean
  status: 'scheduled' | 'live' | 'ended'
  scheduledAt: string | null
  durationMin: number
  startedAt: string | null
  endedAt: string | null
  createdAt: number
  updatedAt: number
  spotlightId: string | null
  breakout: BreakoutState | null
  notes: string
  whiteboardOpen: boolean
  activeWhiteboardId: string | null
  activeWhiteboardTitle: string | null
  allowParticipantAnnotate?: boolean
  muteAllAt: number | null
  lastReaction: MeetingReactionEvent | null
  screenAnnotations: ScreenAnnStroke[]
  presenterCamera?: PresenterCameraState | null
  presenterViewport?: PresenterViewportState | null
}

export interface ParticipantDoc {
  identity: string
  name: string
  role: Role
  status: ParticipantStatus
  keyHash: string
  sessionId: string | null
  micOn: boolean
  camOn: boolean
  handRaised: boolean
  speaking?: boolean
  sharing?: boolean
  breakoutRoomId?: string | null
  lastSeen: number
  createdAt: number
  updatedAt: number
}

const memMeetings = new Map<string, MeetingDoc>()
const memParticipants = new Map<string, Map<string, ParticipantDoc>>()

/** Clears cached meeting/board mirrors on sign-out or profile switch so no prior user's data leaks. */
export function clearLocalMeetingCaches() {
  memMeetings.clear()
  memParticipants.clear()
  purgeLegacyUnscopedStorage()
  if (typeof window === 'undefined') return
  try {
    const mk = localMeetingsKey()
    const bk = localBoardsKey()
    if (mk) localStorage.removeItem(mk)
    if (bk) localStorage.removeItem(bk)
  } catch {
    // ignore
  }
}

function loadLocalMeetings(): Record<string, MeetingDoc> {
  if (typeof window === 'undefined') return {}
  const key = localMeetingsKey()
  if (!key) return {}
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Record<string, MeetingDoc>) : {}
  } catch {
    return {}
  }
}

function saveLocalMeeting(m: MeetingDoc) {
  memMeetings.set(m.meetingId, m)
  if (typeof window === 'undefined') return
  const key = localMeetingsKey()
  if (!key) return
  try {
    const all = loadLocalMeetings()
    all[m.meetingId] = m
    localStorage.setItem(key, JSON.stringify(all))
  } catch {
    // ignore
  }
}

function replaceLocalMeetings(list: MeetingDoc[]) {
  memMeetings.clear()
  const record: Record<string, MeetingDoc> = {}
  for (const m of list) {
    memMeetings.set(m.meetingId, m)
    record[m.meetingId] = m
  }
  if (typeof window === 'undefined') return
  const key = localMeetingsKey()
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(record))
  } catch {
    // ignore
  }
}

function deleteLocalMeeting(meetingId: string) {
  memMeetings.delete(meetingId)
  memParticipants.delete(meetingId)
  if (typeof window === 'undefined') return
  const key = localMeetingsKey()
  if (!key) return
  try {
    const all = loadLocalMeetings()
    delete all[meetingId]
    localStorage.setItem(key, JSON.stringify(all))
  } catch {
    // ignore
  }
}

function getLocalMeeting(meetingId: string): MeetingDoc | null {
  const mem = memMeetings.get(meetingId)
  if (mem) return mem
  const local = loadLocalMeetings()[meetingId] ?? null
  if (local) memMeetings.set(meetingId, local)
  return local
}

function getLocalParticipantsMap(meetingId: string) {
  let map = memParticipants.get(meetingId)
  if (!map) {
    map = new Map()
    memParticipants.set(meetingId, map)
  }
  return map
}

function normalizeMeetingDoc(
  meetingId: string,
  raw: Record<string, unknown>,
): MeetingDoc {
  const waitingRoom = Boolean(raw.waitingRoom ?? raw.waitingRoomEnabled ?? true)
  const locked = Boolean(raw.locked ?? raw.isLocked ?? false)
  const title = String(raw.title ?? raw.topic ?? 'Live class')
  const endedAt = typeof raw.endedAt === 'string' ? raw.endedAt : null
  const startedAt = typeof raw.startedAt === 'string' ? raw.startedAt : null
  const status =
    raw.status === 'ended' || endedAt
      ? 'ended'
      : raw.status === 'live' || startedAt
        ? 'live'
        : 'scheduled'
  const hostId = typeof raw.hostId === 'string' ? raw.hostId : null
  const rawMembers = Array.isArray(raw.memberIds)
    ? raw.memberIds.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : []
  const memberIds =
    hostId && !rawMembers.includes(hostId) ? [hostId, ...rawMembers] : rawMembers
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now()
  return {
    meetingId,
    topic: title,
    title,
    hostId,
    memberIds,
    hostName: String(raw.hostName ?? 'Teacher'),
    hostKeyHash: String(raw.hostKeyHash ?? ''),
    passcode: typeof raw.passcode === 'string' ? raw.passcode : null,
    waitingRoomEnabled: waitingRoom,
    waitingRoom,
    isLocked: locked,
    locked,
    allowStudentScreenShare: Boolean(raw.allowStudentScreenShare ?? false),
    allowStudentDraw: Boolean(
      raw.allowStudentDraw ?? raw.allowParticipantAnnotate ?? false,
    ),
    allowParticipantAnnotate: Boolean(
      raw.allowParticipantAnnotate ?? raw.allowStudentDraw ?? false,
    ),
    allowChat: raw.allowChat === undefined ? true : Boolean(raw.allowChat),
    allowPrivateChat:
      raw.allowPrivateChat === undefined ? true : Boolean(raw.allowPrivateChat),
    status,
    scheduledAt: typeof raw.scheduledAt === 'string' ? raw.scheduledAt : null,
    durationMin: typeof raw.durationMin === 'number' ? raw.durationMin : 60,
    startedAt,
    endedAt,
    createdAt,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt,
    spotlightId: typeof raw.spotlightId === 'string' ? raw.spotlightId : null,
    breakout: (raw.breakout as BreakoutState | null) ?? null,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    whiteboardOpen: Boolean(raw.whiteboardOpen ?? false),
    activeWhiteboardId:
      typeof raw.activeWhiteboardId === 'string'
        ? raw.activeWhiteboardId
        : null,
    activeWhiteboardTitle:
      typeof raw.activeWhiteboardTitle === 'string'
        ? raw.activeWhiteboardTitle
        : null,
    muteAllAt: typeof raw.muteAllAt === 'number' ? raw.muteAllAt : null,
    lastReaction:
      (raw.lastReaction as MeetingReactionEvent | null) ?? null,
    screenAnnotations: Array.isArray(raw.screenAnnotations)
      ? (raw.screenAnnotations as ScreenAnnStroke[])
      : [],
    presenterCamera:
      (raw.presenterCamera as PresenterCameraState | null | undefined) ?? null,
    presenterViewport:
      (raw.presenterViewport as PresenterViewportState | null | undefined) ??
      null,
  }
}

export function settingsOf(row: MeetingDoc): MeetingSettings {
  return {
    locked: row.locked,
    waitingRoom: row.waitingRoom,
    allowStudentScreenShare: row.allowStudentScreenShare,
    allowStudentDraw: row.allowStudentDraw,
    allowChat: row.allowChat,
    allowPrivateChat: row.allowPrivateChat,
  }
}

export function summaryOf(row: MeetingDoc): MeetingSummary {
  return {
    ...settingsOf(row),
    meetingId: row.meetingId,
    title: row.title,
    hostName: row.hostName,
    hostId: row.hostId,
    memberIds: row.memberIds,
    hasPasscode: !!row.passcode,
    scheduledAt: row.scheduledAt,
    durationMin: row.durationMin,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    status: row.status,
    spotlightId: row.spotlightId,
    breakout: row.breakout,
    notes: row.notes,
    whiteboardOpen: row.whiteboardOpen,
    activeWhiteboardId: row.activeWhiteboardId,
    activeWhiteboardTitle: row.activeWhiteboardTitle,
    allowParticipantAnnotate:
      row.allowParticipantAnnotate ?? row.allowStudentDraw,
    muteAllAt: row.muteAllAt,
    lastReaction: row.lastReaction,
    screenAnnotations: row.screenAnnotations,
    presenterCamera: row.presenterCamera ?? null,
    presenterViewport: row.presenterViewport ?? null,
  }
}

function handleFsError(path: string, err: unknown) {
  if (isPermissionDeniedError(err)) {
    reportFirestorePermissionError(path, err)
  }
}

/**
 * Ensures Firebase Auth has resolved (Anonymous or Email/Password) before ANY
 * Firestore read/write/listener executes. Returns `false` on SSR so server-side
 * route loaders never fire unauthenticated client-SDK requests.
 */
async function requireAuth(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  try {
    await ensureAuth()
    return true
  } catch {
    return false
  }
}

function subscribeAfterAuth(
  path: string,
  attach: () => Unsubscribe,
): Unsubscribe {
  if (typeof window === 'undefined') return () => {}
  let cancelled = false
  let unsub: Unsubscribe | null = null
  void ensureAuth()
    .then(() => {
      if (cancelled) return
      unsub = attach()
    })
    .catch((err) => {
      if (!cancelled) handleFsError(path, err)
    })
  return () => {
    cancelled = true
    unsub?.()
    unsub = null
  }
}

// ---------------------------------------------------------------------------
// Meetings CRUD (`meetings/{meetingId}`)
// ---------------------------------------------------------------------------

export async function fetchMeetingDoc(
  meetingId: string,
): Promise<MeetingDoc | null> {
  const id = normalizeMeetingId(meetingId)
  if (!id || !isValidMeetingId(id)) return null
  if (!(await requireAuth())) return getLocalMeeting(id)
  try {
    const snap = await getDoc(doc(db, 'meetings', id))
    if (snap.exists()) {
      const normalized = normalizeMeetingDoc(
        id,
        snap.data() as Record<string, unknown>,
      )
      saveLocalMeeting(normalized)
      return normalized
    }
    return getLocalMeeting(id)
  } catch (err) {
    handleFsError(`meetings/${id}`, err)
    return getLocalMeeting(id)
  }
}

export interface CreateMeetingInput {
  title?: string
  hostName?: string
  customMeetingId?: string
  passcode?: boolean
  customPasscode?: string | null
  waitingRoom?: boolean
  scheduledAt?: string
  durationMin?: number
}

export async function createMeetingRecord(input: CreateMeetingInput) {
  const uid = await ensureClientUid()
  const hostName = input.hostName?.trim() || 'Teacher'
  const hostKey = randomToken(18)
  const passcode = input.customPasscode
    ? input.customPasscode.trim()
    : input.passcode
      ? generatePasscode()
      : null
  const customId = input.customMeetingId
    ? normalizeMeetingId(input.customMeetingId)
    : null
  const meetingId = customId && isValidMeetingId(customId) ? customId : generateMeetingId()
  const title = input.title?.trim() || 'Live class'
  const waitingRoom = input.waitingRoom ?? true
  const now = Date.now()
  const record: MeetingDoc = {
    meetingId,
    topic: title,
    title,
    hostId: uid,
    memberIds: [uid],
    hostName,
    hostKeyHash: sha256Hex(hostKey),
    passcode,
    waitingRoomEnabled: waitingRoom,
    waitingRoom,
    isLocked: false,
    locked: false,
    allowStudentScreenShare: false,
    allowStudentDraw: false,
    allowChat: true,
    allowPrivateChat: true,
    status: input.scheduledAt ? 'scheduled' : 'live',
    scheduledAt: input.scheduledAt ?? null,
    durationMin: input.durationMin ?? 60,
    startedAt: null,
    endedAt: null,
    createdAt: now,
    updatedAt: now,
    spotlightId: null,
    breakout: null,
    notes: '',
    whiteboardOpen: false,
    activeWhiteboardId: null,
    activeWhiteboardTitle: null,
    allowParticipantAnnotate: false,
    muteAllAt: null,
    lastReaction: null,
    screenAnnotations: [],
    presenterCamera: null,
    presenterViewport: null,
  }
  saveLocalMeeting(record)
  if (await requireAuth()) {
    try {
      await setDoc(doc(db, 'meetings', meetingId), stripUndefined(record))
    } catch (err) {
      handleFsError(`meetings/${meetingId}`, err)
    }
  }
  return { meetingId, hostKey, passcode }
}

export async function updateMeetingDetails(
  meetingId: string,
  patch: {
    title?: string
    scheduledAt?: string | null
    durationMin?: number
    waitingRoom?: boolean
    passcode?: string | null
  },
): Promise<MeetingSummary | null> {
  const existing = await fetchMeetingDoc(meetingId)
  if (!existing) return null
  const next: MeetingDoc = {
    ...existing,
    title: patch.title !== undefined ? patch.title.trim() || 'Live class' : existing.title,
    topic: patch.title !== undefined ? patch.title.trim() || 'Live class' : existing.topic,
    scheduledAt:
      patch.scheduledAt !== undefined ? patch.scheduledAt : existing.scheduledAt,
    durationMin:
      patch.durationMin !== undefined ? patch.durationMin : existing.durationMin,
    waitingRoom:
      patch.waitingRoom !== undefined ? patch.waitingRoom : existing.waitingRoom,
    waitingRoomEnabled:
      patch.waitingRoom !== undefined ? patch.waitingRoom : existing.waitingRoom,
    passcode: patch.passcode !== undefined ? patch.passcode : existing.passcode,
  }
  saveLocalMeeting(next)
  if (await requireAuth()) {
    try {
      await setDoc(doc(db, 'meetings', meetingId), stripUndefined(next), {
        merge: true,
      })
    } catch (err) {
      handleFsError(`meetings/${meetingId}`, err)
    }
  }
  return { ...summaryOf(next), passcode: next.passcode }
}

export async function getMeetingSummary(
  meetingId: string,
): Promise<(MeetingSummary & { youAreHost: boolean }) | null> {
  const row = await fetchMeetingDoc(meetingId)
  if (!row) return null
  const uid = getCachedClientUid()
  const youAreHost = !!row.hostId && row.hostId === uid
  return { ...summaryOf(row), youAreHost }
}

export async function listUserMeetings(
  explicitUid?: string | null,
): Promise<(MeetingSummary & { passcode: string | null })[]> {
  const uid =
    explicitUid !== undefined
      ? explicitUid
      : (auth.currentUser?.uid ?? getActiveStorageUid())
  if (!uid) return []

  const byId = new Map<string, MeetingDoc>()

  if (await requireAuth()) {
    try {
      // Strictly uid-scoped single-field array-contains query (ZERO composite indexes)
      const q = query(
        collection(db, 'meetings'),
        where('memberIds', 'array-contains', uid),
      )
      const snap = await getDocs(q)
      for (const d of snap.docs) {
        const m = normalizeMeetingDoc(d.id, d.data() as Record<string, unknown>)
        byId.set(m.meetingId, m)
      }
      replaceLocalMeetings(Array.from(byId.values()))
    } catch (err) {
      handleFsError('meetings', err)
      // Fallback only to UID-scoped cache if offline
      for (const m of Object.values(loadLocalMeetings())) {
        if (m.hostId === uid || m.memberIds.includes(uid)) {
          byId.set(m.meetingId, m)
        }
      }
    }
  }

  return Array.from(byId.values())
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
    .slice(0, 50)
    .map((row) => ({ ...summaryOf(row), passcode: row.passcode }))
}

/**
 * Real-time subscription to ONLY classrooms where `memberIds` contains `uid`.
 * Uses a single-field `array-contains` query and sorts in JavaScript (zero composite indexes).
 */
export function subscribeUserMeetings(
  uid: string | null,
  onMeetings: (list: (MeetingSummary & { passcode: string | null })[]) => void,
): Unsubscribe {
  if (!uid || typeof window === 'undefined') {
    onMeetings([])
    return () => {}
  }
  return subscribeAfterAuth('meetings', () => {
    const q = query(
      collection(db, 'meetings'),
      where('memberIds', 'array-contains', uid),
    )
    return onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.map((d) =>
          normalizeMeetingDoc(d.id, d.data() as Record<string, unknown>),
        )
        docs.sort(
          (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt),
        )
        replaceLocalMeetings(docs)
        onMeetings(
          docs
            .slice(0, 50)
            .map((row) => ({ ...summaryOf(row), passcode: row.passcode })),
        )
      },
      (err) => {
        handleFsError('meetings', err)
        onMeetings([])
      },
    )
  })
}

export async function deleteMeetingRecord(meetingId: string) {
  deleteLocalMeeting(meetingId)
  if (await requireAuth()) {
    try {
      await deleteDoc(doc(db, 'meetings', meetingId))
    } catch (err) {
      handleFsError(`meetings/${meetingId}`, err)
    }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Authorization & Participants (`meetings/{meetingId}/participants/{id}`)
// ---------------------------------------------------------------------------

async function fetchParticipantDoc(
  meetingId: string,
  identity: string,
): Promise<ParticipantDoc | null> {
  if (!(await requireAuth())) {
    return getLocalParticipantsMap(meetingId).get(identity) ?? null
  }
  try {
    const snap = await getDoc(
      doc(db, 'meetings', meetingId, 'participants', identity),
    )
    if (snap.exists()) {
      const data = snap.data() as ParticipantDoc
      getLocalParticipantsMap(meetingId).set(identity, data)
      return data
    }
    return getLocalParticipantsMap(meetingId).get(identity) ?? null
  } catch (err) {
    handleFsError(`meetings/${meetingId}/participants/${identity}`, err)
    return getLocalParticipantsMap(meetingId).get(identity) ?? null
  }
}

async function authorizeModerator(meetingId: string, actorKey: string) {
  await requireAuth()
  const meeting = await fetchMeetingDoc(meetingId)
  if (!meeting) throw new Error('This meeting no longer exists.')
  const hash = sha256Hex(actorKey)
  if (hash === meeting.hostKeyHash) {
    return { meeting, role: 'host' as Role }
  }
  const uid = getCachedClientUid()
  if (meeting.hostId && meeting.hostId === uid) {
    return { meeting, role: 'host' as Role }
  }
  if (await requireAuth()) {
    try {
      const q = query(
        collection(db, 'meetings', meetingId, 'participants'),
        where('keyHash', '==', hash),
      )
      const snap = await getDocs(q)
      for (const d of snap.docs) {
        const p = d.data() as ParticipantDoc
        if (
          (p.role === 'host' || p.role === 'cohost') &&
          p.status === 'admitted'
        ) {
          return { meeting, role: p.role }
        }
      }
    } catch (err) {
      handleFsError(`meetings/${meetingId}/participants`, err)
    }
  }
  for (const p of getLocalParticipantsMap(meetingId).values()) {
    if (
      p.keyHash === hash &&
      (p.role === 'host' || p.role === 'cohost') &&
      p.status === 'admitted'
    ) {
      return { meeting, role: p.role }
    }
  }
  throw new Error('Only the teacher or a co-host can do that.')
}

export async function getHostMeetingDetails(
  meetingId: string,
  hostKey: string,
) {
  const { meeting } = await authorizeModerator(meetingId, hostKey)
  return { ...summaryOf(meeting), passcode: meeting.passcode }
}

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
      iceServers: IceServer[]
    }

export interface JoinMeetingInput {
  meetingId: string
  name: string
  passcode?: string
  hostKey?: string
  identity?: string
  participantKey?: string
}

function joinedPayload(
  meeting: MeetingDoc,
  participant: ParticipantDoc,
  participantKey: string,
): JoinResult {
  return {
    status: 'joined',
    meeting: summaryOf(meeting),
    identity: participant.identity,
    participantKey,
    role: participant.role,
    iceServers: getIceServers(),
  }
}

async function cleanupStaleSignals(meetingId: string, identity: string) {
  if (!(await requireAuth())) return
  try {
    const q = query(
      collection(db, 'meetings', meetingId, 'signals'),
      where('toIdentity', '==', identity),
    )
    const snap = await getDocs(q)
    if (snap.empty) return
    const batch = writeBatch(db)
    for (const d of snap.docs) {
      batch.delete(d.ref)
    }
    await batch.commit()
  } catch {
    // Best-effort stale signal cleanup
  }
}

export async function joinMeetingRecord(
  input: JoinMeetingInput,
): Promise<JoinResult> {
  const meetingId = normalizeMeetingId(input.meetingId)
  if (!meetingId) return { status: 'not-found' }

  const uid = await ensureClientUid()
  const meeting = await fetchMeetingDoc(meetingId)
  if (!meeting) return { status: 'not-found' }
  const summary = summaryOf(meeting)
  if (meeting.endedAt || meeting.status === 'ended') {
    return { status: 'ended', meeting: summary }
  }

  const ensureMembership = async () => {
    const now = Date.now()
    if (!meeting.memberIds.includes(uid)) {
      meeting.memberIds = [...meeting.memberIds, uid]
      meeting.updatedAt = now
      saveLocalMeeting(meeting)
    }
    if (!(await requireAuth())) return
    try {
      await setDoc(
        doc(db, 'meetings', meetingId),
        { memberIds: arrayUnion(uid), updatedAt: now },
        { merge: true },
      )
    } catch (err) {
      handleFsError(`meetings/${meetingId}`, err)
    }
    if (meeting.activeWhiteboardId) {
      void joinWhiteboardMembership(meeting.activeWhiteboardId)
    }
  }

  const byKey =
    !!input.hostKey && sha256Hex(input.hostKey) === meeting.hostKeyHash
  const byAccount = !!meeting.hostId && meeting.hostId === uid

  if (byKey || byAccount) {
    const hostSecret = byKey ? input.hostKey! : randomToken(18)
    const identity =
      input.identity && input.identity.startsWith('host-')
        ? input.identity
        : `host-${uid.slice(0, 12)}`
    const now = Date.now()
    const participant: ParticipantDoc = {
      identity,
      name: input.name.trim() || meeting.hostName,
      role: 'host',
      status: 'admitted',
      keyHash: sha256Hex(hostSecret),
      sessionId: null,
      micOn: false,
      camOn: false,
      handRaised: false,
      lastSeen: now,
      createdAt: now,
      updatedAt: now,
    }
    getLocalParticipantsMap(meetingId).set(identity, participant)
    if (!meeting.startedAt) {
      meeting.startedAt = new Date(now).toISOString()
      meeting.status = 'live'
    }
    meeting.updatedAt = now
    if (!meeting.memberIds.includes(uid)) {
      meeting.memberIds = [...meeting.memberIds, uid]
    }
    saveLocalMeeting(meeting)
    if (await requireAuth()) {
      await Promise.allSettled([
        setDoc(
          doc(db, 'meetings', meetingId, 'participants', identity),
          stripUndefined(participant),
          { merge: true },
        ).catch((err) =>
          handleFsError(`meetings/${meetingId}/participants/${identity}`, err),
        ),
        setDoc(
          doc(db, 'meetings', meetingId),
          {
            startedAt: meeting.startedAt,
            status: 'live',
            memberIds: arrayUnion(uid),
            updatedAt: now,
          },
          { merge: true },
        ).catch((err) => handleFsError(`meetings/${meetingId}`, err)),
        cleanupStaleSignals(meetingId, identity),
        meeting.activeWhiteboardId
          ? joinWhiteboardMembership(meeting.activeWhiteboardId)
          : Promise.resolve(),
      ])
    }
    return joinedPayload(meeting, participant, hostSecret)
  }

  // Returning participant (page refresh, lobby poll, reconnect)
  if (input.identity && input.participantKey) {
    const existing = await fetchParticipantDoc(meetingId, input.identity)
    if (existing && existing.keyHash === sha256Hex(input.participantKey)) {
      if (existing.status === 'admitted' || existing.status === 'left') {
        existing.status = 'admitted'
        existing.name = input.name.trim() || existing.name
        existing.lastSeen = Date.now()
        existing.updatedAt = Date.now()
        getLocalParticipantsMap(meetingId).set(existing.identity, existing)
        await Promise.allSettled([
          requireAuth().then((ok) =>
            ok
              ? setDoc(
                  doc(
                    db,
                    'meetings',
                    meetingId,
                    'participants',
                    existing.identity,
                  ),
                  stripUndefined(existing),
                  { merge: true },
                ).catch((err) =>
                  handleFsError(
                    `meetings/${meetingId}/participants/${existing.identity}`,
                    err,
                  ),
                )
              : undefined,
          ),
          ensureMembership(),
          cleanupStaleSignals(meetingId, existing.identity),
        ])
        return joinedPayload(meeting, existing, input.participantKey)
      }
      if (existing.status === 'waiting') {
        return {
          status: 'waiting',
          meeting: summary,
          identity: existing.identity,
          participantKey: input.participantKey,
        }
      }
      return {
        status: existing.status === 'rejected' ? 'rejected' : 'removed',
        meeting: summary,
      }
    }
  }

  // New student / guest joining by exact ID or invite link
  if (meeting.passcode) {
    if (!input.passcode) {
      return { status: 'passcode-required', meeting: summary, wrong: false }
    }
    if (input.passcode.trim() !== meeting.passcode) {
      return { status: 'passcode-required', meeting: summary, wrong: true }
    }
  }
  if (meeting.locked) return { status: 'locked', meeting: summary }

  const participantKey = randomToken(18)
  const identity = `p-${randomToken(6)}`
  const now = Date.now()
  const status: ParticipantStatus = meeting.waitingRoom ? 'waiting' : 'admitted'
  const participant: ParticipantDoc = {
    identity,
    name: input.name.trim() || 'Student',
    role: 'student',
    status,
    keyHash: sha256Hex(participantKey),
    sessionId: null,
    micOn: false,
    camOn: false,
    handRaised: false,
    lastSeen: now,
    createdAt: now,
    updatedAt: now,
  }
  getLocalParticipantsMap(meetingId).set(identity, participant)
  await Promise.allSettled([
    requireAuth().then((ok) =>
      ok
        ? setDoc(
            doc(db, 'meetings', meetingId, 'participants', identity),
            stripUndefined(participant),
          ).catch((err) =>
            handleFsError(`meetings/${meetingId}/participants/${identity}`, err),
          )
        : undefined,
    ),
    ensureMembership(),
  ])

  if (status === 'waiting') {
    return {
      status: 'waiting',
      meeting: summary,
      identity,
      participantKey,
    }
  }
  return joinedPayload(meeting, participant, participantKey)
}

export async function listWaitingParticipants(
  meetingId: string,
  actorKey: string,
): Promise<WaitingParticipant[]> {
  await authorizeModerator(meetingId, actorKey)
  try {
    const q = query(
      collection(db, 'meetings', meetingId, 'participants'),
      where('status', '==', 'waiting'),
    )
    const snap = await getDocs(q)
    return snap.docs
      .map((d) => d.data() as ParticipantDoc)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => ({
        identity: r.identity,
        name: r.name,
        requestedAt: new Date(r.createdAt).toISOString(),
      }))
  } catch (err) {
    handleFsError(`meetings/${meetingId}/participants`, err)
    return Array.from(getLocalParticipantsMap(meetingId).values())
      .filter((p) => p.status === 'waiting')
      .map((r) => ({
        identity: r.identity,
        name: r.name,
        requestedAt: new Date(r.createdAt).toISOString(),
      }))
  }
}

export async function decideParticipantAdmission(
  meetingId: string,
  actorKey: string,
  identity: string,
  admit: boolean,
) {
  await authorizeModerator(meetingId, actorKey)
  const nextStatus: ParticipantStatus = admit ? 'admitted' : 'rejected'
  const local = getLocalParticipantsMap(meetingId).get(identity)
  if (local) {
    local.status = nextStatus
    local.updatedAt = Date.now()
  }
  try {
    await updateDoc(doc(db, 'meetings', meetingId, 'participants', identity), {
      status: nextStatus,
      updatedAt: Date.now(),
    })
  } catch (err) {
    handleFsError(`meetings/${meetingId}/participants/${identity}`, err)
  }
  return { ok: true }
}

export async function admitAllWaiting(meetingId: string, actorKey: string) {
  await authorizeModerator(meetingId, actorKey)
  const now = Date.now()
  for (const p of getLocalParticipantsMap(meetingId).values()) {
    if (p.status === 'waiting') {
      p.status = 'admitted'
      p.updatedAt = now
    }
  }
  try {
    const q = query(
      collection(db, 'meetings', meetingId, 'participants'),
      where('status', '==', 'waiting'),
    )
    const snap = await getDocs(q)
    const batch = writeBatch(db)
    for (const d of snap.docs) {
      batch.update(d.ref, { status: 'admitted', updatedAt: now })
    }
    await batch.commit()
  } catch (err) {
    handleFsError(`meetings/${meetingId}/participants`, err)
  }
  return { ok: true }
}

export async function updateMeetingSettingsRecord(
  meetingId: string,
  actorKey: string,
  patch: Partial<MeetingSettings>,
): Promise<MeetingSettings> {
  const { meeting } = await authorizeModerator(meetingId, actorKey)
  const next: MeetingDoc = {
    ...meeting,
    ...patch,
    isLocked: patch.locked !== undefined ? patch.locked : meeting.locked,
    waitingRoomEnabled:
      patch.waitingRoom !== undefined ? patch.waitingRoom : meeting.waitingRoom,
    allowParticipantAnnotate:
      patch.allowStudentDraw !== undefined
        ? patch.allowStudentDraw
        : meeting.allowParticipantAnnotate ?? meeting.allowStudentDraw,
  }
  saveLocalMeeting(next)
  try {
    await setDoc(
      doc(db, 'meetings', meetingId),
      stripUndefined({
        ...patch,
        isLocked: next.locked,
        waitingRoomEnabled: next.waitingRoom,
        allowParticipantAnnotate: next.allowStudentDraw,
      }),
      { merge: true },
    )
  } catch (err) {
    handleFsError(`meetings/${meetingId}`, err)
  }
  return settingsOf(next)
}

export async function moderateParticipantRecord(
  meetingId: string,
  actorKey: string,
  identity: string,
  action: 'remove' | 'make-cohost' | 'revoke-cohost',
) {
  const { role } = await authorizeModerator(meetingId, actorKey)
  const target = await fetchParticipantDoc(meetingId, identity)
  if (!target) throw new Error('That participant has already left.')
  if (target.role === 'host')
    throw new Error('The teacher cannot be moderated.')
  if (
    (action === 'make-cohost' || action === 'revoke-cohost') &&
    role !== 'host'
  ) {
    throw new Error('Only the teacher can change co-hosts.')
  }
  const now = Date.now()
  if (action === 'remove') {
    target.status = 'removed'
    target.sessionId = null
    target.updatedAt = now
    try {
      await updateDoc(doc(db, 'meetings', meetingId, 'participants', identity), {
        status: 'removed',
        sessionId: null,
        updatedAt: now,
      })
    } catch (err) {
      handleFsError(`meetings/${meetingId}/participants/${identity}`, err)
    }
    return { ok: true }
  }
  const nextRole: Role = action === 'make-cohost' ? 'cohost' : 'student'
  target.role = nextRole
  target.updatedAt = now
  try {
    await updateDoc(doc(db, 'meetings', meetingId, 'participants', identity), {
      role: nextRole,
      updatedAt: now,
    })
  } catch (err) {
    handleFsError(`meetings/${meetingId}/participants/${identity}`, err)
  }
  return { ok: true }
}

export async function endMeetingRecord(meetingId: string, actorKey: string) {
  const { meeting, role } = await authorizeModerator(meetingId, actorKey)
  if (role !== 'host') throw new Error('Only the teacher can end the class.')
  const endedAt = new Date().toISOString()
  meeting.endedAt = endedAt
  meeting.status = 'ended'
  saveLocalMeeting(meeting)
  try {
    await setDoc(
      doc(db, 'meetings', meetingId),
      { endedAt, status: 'ended' },
      { merge: true },
    )
  } catch (err) {
    handleFsError(`meetings/${meetingId}`, err)
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Spotlight, Breakout Rooms, Notes, Whiteboard Open state
// ---------------------------------------------------------------------------

export async function updateMeetingMeta(
  meetingId: string,
  patch: Partial<{
    spotlightId: string | null
    breakout: BreakoutState | null
    notes: string
    whiteboardOpen: boolean
    activeWhiteboardId: string | null
    activeWhiteboardTitle: string | null
    allowParticipantAnnotate: boolean
    allowStudentDraw: boolean
    muteAllAt: number | null
    lastReaction: MeetingReactionEvent | null
    screenAnnotations: ScreenAnnStroke[]
    presenterCamera: PresenterCameraState | null
    presenterViewport: PresenterViewportState | null
  }>,
) {
  const existing = getLocalMeeting(meetingId)
  if (existing) {
    saveLocalMeeting({ ...existing, ...patch })
  }
  if (!(await requireAuth())) return
  try {
    await setDoc(doc(db, 'meetings', meetingId), stripUndefined(patch), {
      merge: true,
    })
  } catch (err) {
    handleFsError(`meetings/${meetingId}`, err)
  }
}

export async function updateParticipantState(
  meetingId: string,
  identity: string,
  patch: Partial<{
    micOn: boolean
    camOn: boolean
    handRaised: boolean
    breakoutRoomId: string | null
  }>,
) {
  const local = getLocalParticipantsMap(meetingId).get(identity)
  if (local) {
    Object.assign(local, patch, { lastSeen: Date.now(), updatedAt: Date.now() })
  }
  if (!(await requireAuth())) return
  try {
    await setDoc(
      doc(db, 'meetings', meetingId, 'participants', identity),
      stripUndefined({ ...patch, lastSeen: Date.now(), updatedAt: Date.now() }),
      { merge: true },
    )
  } catch (err) {
    handleFsError(`meetings/${meetingId}/participants/${identity}`, err)
  }
}

/**
 * Subscribe to a meeting document in real time (gated behind `ensureAuth()`).
 * Ignores initial empty/cache snapshots so transient offline states never
 * kick users out of the room.
 */
export function subscribeMeetingDoc(
  meetingId: string,
  onUpdate: (summary: MeetingSummary) => void,
): Unsubscribe {
  return subscribeAfterAuth(`meetings/${meetingId}`, () =>
    onSnapshot(
      doc(db, 'meetings', meetingId),
      (snap) => {
        if (!snap.exists()) return
        const normalized = normalizeMeetingDoc(
          meetingId,
          snap.data() as Record<string, unknown>,
        )
        saveLocalMeeting(normalized)
        onUpdate(summaryOf(normalized))
      },
      (err) => {
        handleFsError(`meetings/${meetingId}`, err)
      },
    ),
  )
}

/**
 * Subscribe to the caller's own participant doc (gated behind `ensureAuth()`),
 * used in waiting lobby for instant admission without poll delays.
 */
export function subscribeParticipantDoc(
  meetingId: string,
  identity: string,
  onUpdate: (doc: ParticipantDoc) => void,
): Unsubscribe {
  return subscribeAfterAuth(
    `meetings/${meetingId}/participants/${identity}`,
    () =>
      onSnapshot(
        doc(db, 'meetings', meetingId, 'participants', identity),
        (snap) => {
          if (!snap.exists()) return
          const data = snap.data() as ParticipantDoc
          getLocalParticipantsMap(meetingId).set(identity, data)
          onUpdate(data)
        },
        (err) => {
          handleFsError(`meetings/${meetingId}/participants/${identity}`, err)
        },
      ),
  )
}

// ---------------------------------------------------------------------------
// WebRTC Signaling & Presence (`meetings/{meetingId}/signals/{signalId}`)
// ---------------------------------------------------------------------------

const PRESENCE_WINDOW_MS = 20_000
const SIGNAL_TTL_MS = 120_000

/**
 * Real-time signal push listener: nudges MeshRoom immediately (<150ms) whenever
 * an offer, answer, or ICE candidate arrives for `identity`.
 */
export function subscribeMeetingSignals(
  meetingId: string,
  identity: string,
  onSignal: () => void,
): Unsubscribe {
  return subscribeAfterAuth(`meetings/${meetingId}/signals`, () => {
    const q = query(
      collection(db, 'meetings', meetingId, 'signals'),
      where('toIdentity', '==', identity),
    )
    return onSnapshot(
      q,
      (snap) => {
        if (!snap.empty) onSignal()
      },
      (err) => {
        handleFsError(`meetings/${meetingId}/signals`, err)
      },
    )
  })
}

/**
 * Real-time participant presence listener: nudges MeshRoom immediately whenever
 * another participant joins, leaves, or refreshes their WebRTC session.
 */
export function subscribeMeetingParticipants(
  meetingId: string,
  onChange: () => void,
): Unsubscribe {
  return subscribeAfterAuth(`meetings/${meetingId}/participants`, () => {
    let initial = true
    return onSnapshot(
      collection(db, 'meetings', meetingId, 'participants'),
      () => {
        if (initial) {
          initial = false
          return
        }
        onChange()
      },
      (err) => {
        handleFsError(`meetings/${meetingId}/participants`, err)
      },
    )
  })
}

export async function syncRoomFirestore(input: {
  meetingId: string
  identity: string
  participantKey: string
  sessionId: string
  outbox: OutgoingSignal[]
}): Promise<SyncResult> {
  const { meetingId, identity, participantKey, sessionId, outbox } = input
  const now = Date.now()
  const keyHash = sha256Hex(participantKey)

  await requireAuth()

  // Run meeting + self participant lookup in parallel
  const [meeting, fetchedMe] = await Promise.all([
    fetchMeetingDoc(meetingId),
    fetchParticipantDoc(meetingId, identity),
  ])
  if (!meeting) {
    return { status: 'not-found' }
  }
  if (meeting.endedAt || meeting.status === 'ended') {
    return { status: 'ended' }
  }

  let me = fetchedMe
  if (!me || me.keyHash !== keyHash) {
    return { status: 'not-found' }
  }
  if (me.status === 'removed' || me.status === 'rejected') {
    return { status: me.status }
  }
  if (me.status === 'waiting') {
    return { status: 'waiting' }
  }

  // Heartbeat presence
  me = { ...me, sessionId, lastSeen: now, updatedAt: now, status: 'admitted' }
  getLocalParticipantsMap(meetingId).set(identity, me)

  try {
    const sigCol = collection(db, 'meetings', meetingId, 'signals')
    const inboxQ = query(sigCol, where('toIdentity', '==', identity))

    // Run heartbeat write, outbox signal writes, inbox read, and participants read IN PARALLEL
    const [, , inboxSnap, partSnap] = await Promise.all([
      setDoc(
        doc(db, 'meetings', meetingId, 'participants', identity),
        { sessionId, lastSeen: now, updatedAt: now, status: 'admitted' },
        { merge: true },
      ),
      outbox.length > 0
        ? Promise.all(
            outbox.map((s) =>
              addDoc(sigCol, {
                fromIdentity: identity,
                fromSession: sessionId,
                toIdentity: s.to,
                toSession: s.toSession,
                kind: s.kind,
                payload: s.payload,
                createdAt: now,
              }),
            ),
          )
        : Promise.resolve([]),
      getDocs(inboxQ),
      getDocs(collection(db, 'meetings', meetingId, 'participants')),
    ])

    const inbox: IncomingSignal[] = []
    if (!inboxSnap.empty) {
      const batch = writeBatch(db)
      let batchHasDeletes = false
      const sorted = [...inboxSnap.docs].sort(
        (a, b) =>
          ((a.data().createdAt as number) ?? 0) -
          ((b.data().createdAt as number) ?? 0),
      )
      for (const d of sorted) {
        const data = d.data()
        const createdAt = (data.createdAt as number) ?? 0
        const expired = now - createdAt > SIGNAL_TTL_MS
        if (String(data.toSession ?? '') === sessionId) {
          if (!expired) {
            inbox.push({
              id: d.id,
              kind: data.kind as 'offer' | 'answer' | 'ice',
              from: String(data.fromIdentity),
              fromSession: String(data.fromSession),
              payload: String(data.payload),
            })
          }
          batch.delete(d.ref)
          batchHasDeletes = true
        } else if (expired) {
          batch.delete(d.ref)
          batchHasDeletes = true
        }
      }
      if (batchHasDeletes) await batch.commit()
    }

    const peers: PeerInfo[] = []
    const waiting: WaitingParticipant[] = []
    for (const d of partSnap.docs) {
      const p = d.data() as ParticipantDoc
      if (p.status === 'waiting') {
        waiting.push({
          identity: p.identity,
          name: p.name,
          requestedAt: new Date(p.createdAt || now).toISOString(),
        })
      } else if (
        p.status === 'admitted' &&
        p.identity !== identity &&
        p.sessionId &&
        now - (p.lastSeen || 0) <= PRESENCE_WINDOW_MS
      ) {
        peers.push({
          identity: p.identity,
          session: p.sessionId,
          name: p.name,
          role: p.role,
          micOn: p.micOn,
          camOn: p.camOn,
          handRaised: p.handRaised,
          breakoutRoomId: p.breakoutRoomId ?? null,
        })
      }
    }
    waiting.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))

    return {
      status: 'ok',
      role: me.role,
      settings: settingsOf(meeting),
      peers,
      inbox,
      waiting: isModerator(me.role) ? waiting : null,
      spotlightId: meeting.spotlightId,
      breakout: meeting.breakout,
    }
  } catch (err) {
    handleFsError(`meetings/${meetingId}/signals`, err)
    // Graceful degradation: stay connected locally instead of kicking the user!
    return {
      status: 'ok',
      role: me.role,
      settings: settingsOf(meeting),
      peers: [],
      inbox: [],
      waiting: isModerator(me.role) ? [] : null,
      spotlightId: meeting.spotlightId,
      breakout: meeting.breakout,
    }
  }
}

export async function leaveRoomFirestore(input: {
  meetingId: string
  identity: string
  participantKey: string
}) {
  const local = getLocalParticipantsMap(input.meetingId).get(input.identity)
  if (local) {
    local.sessionId = null
    local.status = 'left'
    local.updatedAt = Date.now()
  }
  if (!(await requireAuth())) return { ok: true }
  try {
    await setDoc(
      doc(db, 'meetings', input.meetingId, 'participants', input.identity),
      { sessionId: null, status: 'left', updatedAt: Date.now() },
      { merge: true },
    )
  } catch (err) {
    handleFsError(
      `meetings/${input.meetingId}/participants/${input.identity}`,
      err,
    )
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Chat Messages (`meetings/{meetingId}/messages/{messageId}`)
// ---------------------------------------------------------------------------

export async function sendFirestoreMessage(
  meetingId: string,
  msg: ChatMessage,
) {
  if (!(await requireAuth())) return
  try {
    await setDoc(doc(db, 'meetings', meetingId, 'messages', msg.id), {
      id: msg.id,
      senderId: msg.authorId,
      sender: msg.authorName,
      recipientId: msg.toId ?? 'all',
      recipientName: msg.toName ?? null,
      text: msg.text,
      kind: msg.kind,
      timestamp: msg.at,
    })
  } catch (err) {
    handleFsError(`meetings/${meetingId}/messages/${msg.id}`, err)
  }
}

export function subscribeMeetingMessages(
  meetingId: string,
  localId: string | null,
  onMessages: (msgs: ChatMessage[]) => void,
): Unsubscribe {
  return subscribeAfterAuth(`meetings/${meetingId}/messages`, () =>
    onSnapshot(
      collection(db, 'meetings', meetingId, 'messages'),
      (snap) => {
        const list: ChatMessage[] = []
        for (const d of snap.docs) {
          const data = d.data()
          const recipientId = String(data.recipientId ?? 'all')
          const senderId = String(data.senderId ?? '')
          const kind = (data.kind as ChatMessage['kind']) ?? 'message'
          if (
            kind === 'private' &&
            localId &&
            senderId !== localId &&
            recipientId !== localId
          ) {
            continue
          }
          list.push({
            id: String(data.id ?? d.id),
            authorId: senderId,
            authorName: String(data.sender ?? 'Participant'),
            text: String(data.text ?? ''),
            at:
              typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
            kind,
            toId: recipientId === 'all' ? undefined : recipientId,
            toName:
              typeof data.recipientName === 'string'
                ? data.recipientName
                : undefined,
          })
        }
        list.sort((a, b) => a.at - b.at)
        onMessages(list)
      },
      (err) => {
        handleFsError(`meetings/${meetingId}/messages`, err)
      },
    ),
  )
}

// ---------------------------------------------------------------------------
// Live Polls (`meetings/{meetingId}/polls/{pollId}`)
// ---------------------------------------------------------------------------

export async function createMeetingPoll(
  meetingId: string,
  input: {
    question: string
    options: string[]
    anonymous: boolean
    createdBy: string
    createdByName: string
  },
): Promise<MeetingPoll> {
  const id = `poll-${randomToken(6)}`
  const options: PollOption[] = input.options
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text, idx) => ({ id: `opt-${idx + 1}-${randomToken(3)}`, text }))
  const poll: MeetingPoll = {
    id,
    question: input.question.trim(),
    options,
    votes: {},
    anonymous: input.anonymous,
    status: 'open',
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    createdAt: Date.now(),
  }
  if (await requireAuth()) {
    try {
      await setDoc(doc(db, 'meetings', meetingId, 'polls', id), poll)
    } catch (err) {
      handleFsError(`meetings/${meetingId}/polls/${id}`, err)
    }
  }
  return poll
}

export async function voteMeetingPoll(
  meetingId: string,
  pollId: string,
  voterId: string,
  optionId: string,
) {
  if (!(await requireAuth())) return
  try {
    await updateDoc(doc(db, 'meetings', meetingId, 'polls', pollId), {
      [`votes.${voterId}`]: optionId,
    })
  } catch (err) {
    handleFsError(`meetings/${meetingId}/polls/${pollId}`, err)
  }
}

export async function closeMeetingPoll(meetingId: string, pollId: string) {
  if (!(await requireAuth())) return
  try {
    await updateDoc(doc(db, 'meetings', meetingId, 'polls', pollId), {
      status: 'closed',
    })
  } catch (err) {
    handleFsError(`meetings/${meetingId}/polls/${pollId}`, err)
  }
}

export async function deleteMeetingPoll(meetingId: string, pollId: string) {
  if (!(await requireAuth())) return
  try {
    await deleteDoc(doc(db, 'meetings', meetingId, 'polls', pollId))
  } catch (err) {
    handleFsError(`meetings/${meetingId}/polls/${pollId}`, err)
  }
}

export function subscribeMeetingPolls(
  meetingId: string,
  onPolls: (polls: MeetingPoll[]) => void,
): Unsubscribe {
  return subscribeAfterAuth(`meetings/${meetingId}/polls`, () =>
    onSnapshot(
      collection(db, 'meetings', meetingId, 'polls'),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as MeetingPoll)
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
        onPolls(list)
      },
      (err) => {
        handleFsError(`meetings/${meetingId}/polls`, err)
      },
    ),
  )
}

// ---------------------------------------------------------------------------
// Whiteboard Elements (`meetings/{meetingId}/whiteboard/{elementId}`
// and standalone `whiteboards/{boardId}/elements/{elementId}`)
// ---------------------------------------------------------------------------

type WhiteboardScope =
  | { kind: 'meeting'; meetingId: string }
  | { kind: 'board'; boardId: string }

function whiteboardCollectionPath(scope: WhiteboardScope) {
  return scope.kind === 'meeting'
    ? (['meetings', scope.meetingId, 'whiteboard'] as const)
    : (['whiteboards', scope.boardId, 'elements'] as const)
}

function wbCacheKey(scope: WhiteboardScope): string | null {
  const uid = auth.currentUser?.uid ?? getActiveStorageUid()
  const ns =
    scope.kind === 'meeting'
      ? `wb_meeting_${scope.meetingId}`
      : `wb_board_${scope.boardId}`
  return scopedStorageKey(ns, uid)
}

function loadLocalWbElements<T extends { id: string }>(
  scope: WhiteboardScope,
): T[] {
  if (typeof window === 'undefined') return []
  const key = wbCacheKey(scope)
  if (!key) return []
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T[]) : []
  } catch {
    return []
  }
}

function saveLocalWbElements<T extends { id: string }>(
  scope: WhiteboardScope,
  elements: T[],
) {
  if (typeof window === 'undefined') return
  const key = wbCacheKey(scope)
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(elements))
  } catch {
    // ignore quota errors
  }
}

function patchLocalBoardMeta(
  boardId: string,
  patch: Partial<StandaloneBoardMeta>,
) {
  const list = loadLocalBoards()
  let found = false
  const next = list.map((b) => {
    if (b.id !== boardId) return b
    found = true
    return { ...b, ...patch }
  })
  if (found) saveLocalBoards(next)
}

export async function upsertWhiteboardElement<T extends { id: string }>(
  scope: WhiteboardScope,
  element: T,
) {
  const now = Date.now()
  const cleanElement = stripUndefined(element)
  const cached = loadLocalWbElements<T>(scope)
  const idx = cached.findIndex((e) => e.id === cleanElement.id)
  const nextCached =
    idx >= 0
      ? cached.map((e, i) => (i === idx ? cleanElement : e))
      : [...cached, cleanElement]
  saveLocalWbElements(scope, nextCached)
  if (scope.kind === 'board') {
    patchLocalBoardMeta(scope.boardId, {
      updatedAt: now,
      elementCount: nextCached.length,
    })
  }
  if (!(await requireAuth())) return
  const path = whiteboardCollectionPath(scope)
  try {
    await setDoc(
      doc(db, path[0], path[1], path[2], cleanElement.id),
      stripUndefined({
        ...cleanElement,
        updatedAt: now,
      }),
    )
  } catch (err) {
    handleFsError(`${path.join('/')}/${cleanElement.id}`, err)
  }
}

export async function upsertWhiteboardElementsBatch<T extends { id: string }>(
  scope: WhiteboardScope,
  elements: T[],
) {
  if (elements.length === 0) return
  const now = Date.now()
  const cleaned = elements.map((el) => stripUndefined(el))
  const map = new Map<string, T>()
  for (const el of loadLocalWbElements<T>(scope)) map.set(el.id, el)
  for (const el of cleaned) map.set(el.id, el)
  const merged = Array.from(map.values())
  saveLocalWbElements(scope, merged)
  if (scope.kind === 'board') {
    patchLocalBoardMeta(scope.boardId, {
      updatedAt: now,
      elementCount: merged.length,
    })
  }
  if (!(await requireAuth())) return
  const path = whiteboardCollectionPath(scope)
  try {
    const batch = writeBatch(db)
    for (const el of cleaned) {
      batch.set(
        doc(db, path[0], path[1], path[2], el.id),
        stripUndefined({
          ...el,
          updatedAt: now,
        }),
      )
    }
    await batch.commit()
    if (scope.kind === 'board') {
      void setDoc(
        doc(db, 'whiteboards', scope.boardId),
        { updatedAt: now, elementCount: merged.length },
        { merge: true },
      ).catch(() => {})
    }
  } catch (err) {
    handleFsError(path.join('/'), err)
  }
}

export async function deleteWhiteboardElements(
  scope: WhiteboardScope,
  ids: string[],
) {
  if (ids.length === 0) return
  const now = Date.now()
  const delSet = new Set(ids)
  const remaining = loadLocalWbElements<{ id: string }>(scope).filter(
    (e) => !delSet.has(e.id),
  )
  saveLocalWbElements(scope, remaining)
  if (scope.kind === 'board') {
    patchLocalBoardMeta(scope.boardId, {
      updatedAt: now,
      elementCount: remaining.length,
    })
  }
  if (!(await requireAuth())) return
  const path = whiteboardCollectionPath(scope)
  try {
    const batch = writeBatch(db)
    for (const id of ids) {
      batch.delete(doc(db, path[0], path[1], path[2], id))
    }
    await batch.commit()
    if (scope.kind === 'board') {
      void setDoc(
        doc(db, 'whiteboards', scope.boardId),
        { updatedAt: now, elementCount: remaining.length },
        { merge: true },
      ).catch(() => {})
    }
  } catch (err) {
    handleFsError(path.join('/'), err)
  }
}

export async function clearWhiteboardCollection(scope: WhiteboardScope) {
  const now = Date.now()
  saveLocalWbElements(scope, [])
  if (scope.kind === 'board') {
    patchLocalBoardMeta(scope.boardId, { updatedAt: now, elementCount: 0 })
  }
  if (!(await requireAuth())) return
  const path = whiteboardCollectionPath(scope)
  try {
    const snap = await getDocs(collection(db, path[0], path[1], path[2]))
    if (!snap.empty) {
      const batch = writeBatch(db)
      for (const d of snap.docs) {
        batch.delete(d.ref)
      }
      await batch.commit()
    }
    if (scope.kind === 'board') {
      void setDoc(
        doc(db, 'whiteboards', scope.boardId),
        { updatedAt: now, elementCount: 0 },
        { merge: true },
      ).catch(() => {})
    }
  } catch (err) {
    handleFsError(path.join('/'), err)
  }
}

export function subscribeWhiteboardElements<T extends { id: string }>(
  scope: WhiteboardScope,
  onElements: (elements: T[]) => void,
): Unsubscribe {
  const cached = loadLocalWbElements<T>(scope)
  if (cached.length > 0) {
    onElements(cached)
  }
  const path = whiteboardCollectionPath(scope)
  return subscribeAfterAuth(path.join('/'), () =>
    onSnapshot(
      collection(db, path[0], path[1], path[2]),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as T & { zIndex?: number; createdAt?: number })
          .sort(
            (a, b) =>
              (a.zIndex ?? 0) - (b.zIndex ?? 0) ||
              (a.createdAt ?? 0) - (b.createdAt ?? 0),
          )
        saveLocalWbElements(scope, list)
        if (scope.kind === 'board') {
          patchLocalBoardMeta(scope.boardId, { elementCount: list.length })
        }
        onElements(list)
      },
      (err) => {
        handleFsError(path.join('/'), err)
      },
    ),
  )
}

// ---------------------------------------------------------------------------
// Standalone Whiteboards metadata (`whiteboards/{boardId}`)
// ---------------------------------------------------------------------------

function loadLocalBoards(): StandaloneBoardMeta[] {
  if (typeof window === 'undefined') return []
  const key = localBoardsKey()
  if (!key) return []
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as StandaloneBoardMeta[]) : []
  } catch {
    return []
  }
}

function saveLocalBoards(list: StandaloneBoardMeta[]) {
  if (typeof window === 'undefined') return
  const key = localBoardsKey()
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch {
    // ignore
  }
}

/** Appends the current user's UID to a shared whiteboard's `memberIds` when opening it in a meeting. */
export async function joinWhiteboardMembership(boardId: string) {
  if (!boardId) return
  if (!(await requireAuth())) return
  const uid = auth.currentUser?.uid
  if (!uid) return
  try {
    await updateDoc(doc(db, 'whiteboards', boardId), {
      memberIds: arrayUnion(uid),
    })
  } catch {
    try {
      await setDoc(
        doc(db, 'whiteboards', boardId),
        { memberIds: arrayUnion(uid), updatedAt: Date.now() },
        { merge: true },
      )
    } catch {
      // Ignore if offline
    }
  }
}

/**
 * Ensures the unified default board `whiteboards/meeting-${meetingId}` exists
 * with the caller in `memberIds` and updates `meetings/{meetingId}` so all
 * participants read & write the EXACT same `whiteboards/{boardId}/elements` path.
 */
export async function ensureMeetingWhiteboard(
  meetingId: string,
  title: string,
  createdByName?: string,
): Promise<StandaloneBoardMeta> {
  const boardId = `meeting-${meetingId}`
  const uid = await ensureClientUid()
  const now = Date.now()
  const fallbackMeta: StandaloneBoardMeta = {
    id: boardId,
    title: title.trim() || 'Class Whiteboard',
    ownerId: uid,
    memberIds: [uid],
    createdBy: uid,
    createdByName,
    backgroundType: 'dots',
    boardTheme: 'light',
    createdAt: now,
    updatedAt: now,
    elementCount: 0,
  }
  if (await requireAuth()) {
    try {
      const ref = doc(db, 'whiteboards', boardId)
      const snap = await getDoc(ref)
      if (snap.exists()) {
        const existing = snap.data() as StandaloneBoardMeta
        await setDoc(
          ref,
          { memberIds: arrayUnion(uid), updatedAt: now },
          { merge: true },
        )
        return { ...fallbackMeta, ...existing, id: boardId }
      }
      await setDoc(
        ref,
        stripUndefined({
          ...fallbackMeta,
          memberIds: arrayUnion(uid),
        }),
        { merge: true },
      )
    } catch (err) {
      handleFsError(`whiteboards/${boardId}`, err)
    }
  }
  return fallbackMeta
}

/**
 * Streams live Laser Pointer presence into `whiteboards/{boardId}/presence/{uid}`.
 */
export async function updateWhiteboardPresence(
  boardId: string,
  uid: string,
  data: { name: string; x: number; y: number; at: number; active: boolean },
) {
  if (!boardId || !uid) return
  if (!(await requireAuth())) return
  try {
    await setDoc(
      doc(db, 'whiteboards', boardId, 'presence', uid),
      stripUndefined({ uid, ...data }),
      { merge: true },
    )
  } catch (err) {
    handleFsError(`whiteboards/${boardId}/presence/${uid}`, err)
  }
}

/**
 * Subscribes to all remote participants' live Laser Pointer positions on a board.
 */
export function subscribeWhiteboardPresence(
  boardId: string,
  onPresence: (entries: WhiteboardPresenceEntry[]) => void,
): Unsubscribe {
  if (!boardId) return () => {}
  return subscribeAfterAuth(`whiteboards/${boardId}/presence`, () =>
    onSnapshot(
      collection(db, 'whiteboards', boardId, 'presence'),
      (snap) => {
        const list: WhiteboardPresenceEntry[] = []
        for (const d of snap.docs) {
          const raw = d.data() as Partial<WhiteboardPresenceEntry>
          if (typeof raw.x === 'number' && typeof raw.y === 'number') {
            list.push({
              uid: raw.uid || d.id,
              name: raw.name || 'Participant',
              x: raw.x,
              y: raw.y,
              at: typeof raw.at === 'number' ? raw.at : Date.now(),
              active: Boolean(raw.active),
            })
          }
        }
        onPresence(list)
      },
      (err) => {
        handleFsError(`whiteboards/${boardId}/presence`, err)
      },
    ),
  )
}

export async function listStandaloneBoards(
  explicitUid?: string | null,
): Promise<StandaloneBoardMeta[]> {
  const uid =
    explicitUid !== undefined
      ? explicitUid
      : (auth.currentUser?.uid ?? getActiveStorageUid())
  if (!uid) return []
  const byId = new Map<string, StandaloneBoardMeta>()
  if (await requireAuth()) {
    try {
      const q = query(
        collection(db, 'whiteboards'),
        where('memberIds', 'array-contains', uid),
      )
      const snap = await getDocs(q)
      for (const d of snap.docs) {
        const b = d.data() as StandaloneBoardMeta
        byId.set(b.id || d.id, { ...b, id: b.id || d.id })
      }
      const list = Array.from(byId.values()).sort(
        (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
      )
      saveLocalBoards(list)
      return list
    } catch (err) {
      handleFsError('whiteboards', err)
    }
  }
  return loadLocalBoards()
    .filter((b) => b.ownerId === uid || Boolean(b.memberIds?.includes(uid)))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

/**
 * Real-time subscription to ONLY standalone whiteboards where `memberIds` contains `uid`.
 * Uses a single-field `array-contains` query and sorts in JavaScript (zero composite indexes).
 */
export function subscribeUserWhiteboards(
  uid: string | null,
  onBoards: (boards: StandaloneBoardMeta[]) => void,
): Unsubscribe {
  if (!uid || typeof window === 'undefined') {
    onBoards([])
    return () => {}
  }
  return subscribeAfterAuth('whiteboards', () => {
    const q = query(
      collection(db, 'whiteboards'),
      where('memberIds', 'array-contains', uid),
    )
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => {
            const b = d.data() as StandaloneBoardMeta
            return { ...b, id: b.id || d.id }
          })
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        saveLocalBoards(list)
        onBoards(list)
      },
      (err) => {
        handleFsError('whiteboards', err)
        onBoards([])
      },
    )
  })
}

export interface CreateBoardOptions {
  title?: string
  template?: TemplateKind | null
  backgroundType?: 'dots' | 'grid' | 'lined' | 'blank'
  boardTheme?: 'light' | 'dark'
  createdByName?: string
}

export async function createStandaloneBoard(
  input: string | CreateBoardOptions = 'Untitled whiteboard',
): Promise<StandaloneBoardMeta> {
  const opts: CreateBoardOptions =
    typeof input === 'string' ? { title: input } : input
  const uid = await ensureClientUid()
  const now = Date.now()
  const initialElements: BoardElement[] = opts.template
    ? createTemplateElements(opts.template, 0, 0, uid, 1)
    : []
  const board: StandaloneBoardMeta = {
    id: `wb-${randomToken(6)}`,
    title: opts.title?.trim() || 'Untitled whiteboard',
    ownerId: uid,
    memberIds: [uid],
    createdBy: uid,
    createdByName: opts.createdByName,
    backgroundType: opts.backgroundType ?? 'dots',
    boardTheme: opts.boardTheme ?? 'light',
    createdAt: now,
    updatedAt: now,
    elementCount: initialElements.length,
  }
  const existing = loadLocalBoards()
  saveLocalBoards([board, ...existing])
  if (initialElements.length > 0) {
    saveLocalWbElements({ kind: 'board', boardId: board.id }, initialElements)
  }
  if (await requireAuth()) {
    try {
      await setDoc(doc(db, 'whiteboards', board.id), stripUndefined(board))
      if (initialElements.length > 0) {
        await upsertWhiteboardElementsBatch(
          { kind: 'board', boardId: board.id },
          initialElements,
        )
      }
    } catch (err) {
      handleFsError(`whiteboards/${board.id}`, err)
    }
  }
  return board
}

export async function updateWhiteboardMeta(
  boardId: string,
  patch: Partial<{
    title: string
    backgroundType: 'dots' | 'grid' | 'lined' | 'blank'
    boardTheme: 'light' | 'dark'
    elementCount: number
    updatedAt: number
    presenterCamera: PresenterCameraState | null
    laser: BoardLaserState | null
  }>,
) {
  const payload = stripUndefined({
    ...patch,
    updatedAt: patch.updatedAt ?? Date.now(),
  })
  patchLocalBoardMeta(boardId, payload)
  if (!(await requireAuth())) return
  try {
    await setDoc(doc(db, 'whiteboards', boardId), payload, { merge: true })
  } catch (err) {
    handleFsError(`whiteboards/${boardId}`, err)
  }
}

export function subscribeWhiteboardMeta(
  boardId: string,
  onMeta: (meta: StandaloneBoardMeta) => void,
): Unsubscribe {
  return subscribeAfterAuth(`whiteboards/${boardId}`, () =>
    onSnapshot(
      doc(db, 'whiteboards', boardId),
      (snap) => {
        if (!snap.exists()) return
        const meta = snap.data() as StandaloneBoardMeta
        patchLocalBoardMeta(boardId, meta)
        onMeta(meta)
      },
      (err) => {
        handleFsError(`whiteboards/${boardId}`, err)
      },
    ),
  )
}

export async function duplicateStandaloneBoard(
  sourceId: string,
): Promise<StandaloneBoardMeta> {
  const uid = await ensureClientUid()
  const localBoards = loadLocalBoards()
  let sourceMeta = localBoards.find((b) => b.id === sourceId) ?? null
  let elements: BoardElement[] = loadLocalWbElements<BoardElement>({
    kind: 'board',
    boardId: sourceId,
  })

  if (await requireAuth()) {
    try {
      const metaSnap = await getDoc(doc(db, 'whiteboards', sourceId))
      if (metaSnap.exists()) {
        sourceMeta = metaSnap.data() as StandaloneBoardMeta
      }
      const elSnap = await getDocs(
        collection(db, 'whiteboards', sourceId, 'elements'),
      )
      if (!elSnap.empty) {
        elements = elSnap.docs.map((d) => d.data() as BoardElement)
      }
    } catch (err) {
      handleFsError(`whiteboards/${sourceId}`, err)
    }
  }

  const now = Date.now()
  const copyTitle = `${sourceMeta?.title || 'Whiteboard'} (Copy)`
  const newBoard: StandaloneBoardMeta = {
    id: `wb-${randomToken(6)}`,
    title: copyTitle,
    ownerId: uid,
    memberIds: [uid],
    createdBy: uid,
    createdByName: sourceMeta?.createdByName,
    backgroundType: sourceMeta?.backgroundType ?? 'dots',
    boardTheme: sourceMeta?.boardTheme ?? 'light',
    createdAt: now,
    updatedAt: now,
    elementCount: elements.length,
  }
  saveLocalBoards([newBoard, ...localBoards])
  saveLocalWbElements({ kind: 'board', boardId: newBoard.id }, elements)
  if (await requireAuth()) {
    try {
      await setDoc(doc(db, 'whiteboards', newBoard.id), stripUndefined(newBoard))
      if (elements.length > 0) {
        await upsertWhiteboardElementsBatch(
          { kind: 'board', boardId: newBoard.id },
          elements,
        )
      }
    } catch (err) {
      handleFsError(`whiteboards/${newBoard.id}`, err)
    }
  }
  return newBoard
}

export async function renameStandaloneBoard(id: string, title: string) {
  const trimmed = title.trim()
  if (!trimmed) return
  const now = Date.now()
  const next = loadLocalBoards().map((b) =>
    b.id === id ? { ...b, title: trimmed, updatedAt: now } : b,
  )
  saveLocalBoards(next)
  if (!(await requireAuth())) return
  try {
    await setDoc(
      doc(db, 'whiteboards', id),
      { title: trimmed, updatedAt: now },
      { merge: true },
    )
  } catch (err) {
    handleFsError(`whiteboards/${id}`, err)
  }
}

export async function deleteStandaloneBoard(id: string) {
  saveLocalBoards(loadLocalBoards().filter((b) => b.id !== id))
  if (typeof window !== 'undefined') {
    try {
      const k = wbCacheKey({ kind: 'board', boardId: id })
      if (k) localStorage.removeItem(k)
    } catch {
      // ignore
    }
  }
  if (!(await requireAuth())) return
  try {
    await clearWhiteboardCollection({ kind: 'board', boardId: id })
    await deleteDoc(doc(db, 'whiteboards', id))
  } catch (err) {
    handleFsError(`whiteboards/${id}`, err)
  }
}
