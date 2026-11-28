import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  Captions,
  Circle,
  Loader2,
  MoreVertical,
  Split,
  WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatDuration, meetingUrl } from '@/lib/meeting'
import {
  isModerator as isModeratorRole,
  type BreakoutState,
  type MeetingPoll,
  type MeetingSettings,
  type MeetingSummary,
  type Role,
  type ScreenAnnStroke,
  type StandaloneBoardMeta,
  type WaitingParticipant,
} from '@/lib/meeting-types'
import {
  admitAll,
  decideAdmission,
  endMeeting,
  listWaiting,
  moderate,
  updateSettings,
} from '@/lib/meetings.functions'
import type { RealtimeMessage } from '@/lib/realtime'
import { useHotkeys } from '@/lib/use-hotkeys'
import { useTabRecorder } from '@/lib/use-tab-recorder'
import {
  ensureMeetingWhiteboard,
  joinWhiteboardMembership,
  sendFirestoreMessage,
  subscribeMeetingDoc,
  subscribeMeetingMessages,
  subscribeMeetingPolls,
  updateMeetingMeta,
  updateParticipantState,
} from '@/services/firestore-meetings'
import type { RemoteSender, RoomAdapter } from './adapter'
import { BreakoutDialog } from './breakout-dialog'
import { ControlBar } from './control-bar'
import { LeaveDialog, SettingsDialog, ShortcutsDialog } from './dialogs'
import { ReactionsOverlay } from './reactions-overlay'
import { ScreenAnnotateOverlay } from './screen-annotate'
import { ParticipantMenu, SidePanel, type ModerateAction } from './side-panel'
import { Stage } from './stage'
import type {
  ChatMessage,
  FloatingReaction,
  PanelTab,
  Presentation,
  TileModel,
  ViewMode,
} from './types'
import { useCaptions } from './use-captions'
import type { LaserTrail } from './whiteboard/infinite-engine'
import { Whiteboard, type WhiteboardHandle } from './whiteboard/whiteboard'
import { WhiteboardPickerDialog } from './whiteboard/whiteboard-picker'

export type LeaveReason = 'left' | 'ended' | 'removed' | 'duplicate' | 'lost'

export interface MeetingRoomProps {
  adapter: RoomAdapter
  meeting: MeetingSummary
  role: Role
  identity: string
  name: string
  actorKey: string
  passcode: string | null
  onLeft: (reason: LeaveReason) => void
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback
}

export function MeetingRoom({
  adapter,
  meeting,
  role,
  identity,
  name,
  actorKey,
  passcode,
  onLeft,
}: MeetingRoomProps) {
  const isModerator = isModeratorRole(role)
  const isHost = role === 'host'

  // ---- settings -------------------------------------------------------------
  const [settings, setSettings] = useState<MeetingSettings>(meeting)
  const [seenRoomSettings, setSeenRoomSettings] = useState(adapter.roomSettings)
  if (adapter.roomSettings !== seenRoomSettings) {
    setSeenRoomSettings(adapter.roomSettings)
    if (adapter.roomSettings) setSettings(adapter.roomSettings)
  }

  // ---- UI state -------------------------------------------------------------
  const [panel, setPanel] = useState<PanelTab | null>(null)
  const [view, setView] = useState<ViewMode>('gallery')
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const [spotlightId, setSpotlightId] = useState<string | null>(
    meeting.spotlightId ?? null,
  )
  const [whiteboardOpen, setWhiteboardOpen] = useState(
    meeting.whiteboardOpen ?? false,
  )
  const [activeWhiteboardId, setActiveWhiteboardId] = useState<string | null>(
    meeting.activeWhiteboardId ?? null,
  )
  const [activeWhiteboardTitle, setActiveWhiteboardTitle] = useState<
    string | null
  >(meeting.activeWhiteboardTitle ?? null)
  const [wbPickerOpen, setWbPickerOpen] = useState(false)
  const [remotePresenterCamera, setRemotePresenterCamera] = useState<{
    cx: number
    cy: number
    zoom: number
    at: number
    force?: boolean
  } | null>(null)
  const [screenAnnotations, setScreenAnnotations] = useState<ScreenAnnStroke[]>(
    meeting.screenAnnotations ?? [],
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [breakoutOpen, setBreakoutOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [polls, setPolls] = useState<MeetingPoll[]>([])
  const [notes, setNotes] = useState(meeting.notes ?? '')
  const [breakout, setBreakout] = useState<BreakoutState | null>(
    meeting.breakout ?? null,
  )
  const [myBreakoutId, setMyBreakoutId] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)
  const [reactions, setReactions] = useState<FloatingReaction[]>([])
  const [waiting, setWaiting] = useState<WaitingParticipant[]>([])
  const [remoteRecording, setRemoteRecording] = useState(false)
  const [remoteLasers, setRemoteLasers] = useState<LaserTrail[]>([])
  const [captionLine, setCaptionLine] = useState<{
    who: string
    text: string
    at: number
  } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const [joinedAt] = useState(() => Date.now())
  const rootRef = useRef<HTMLDivElement>(null)
  const whiteboardRef = useRef<WhiteboardHandle>(null)
  const panelRef = useRef(panel)
  const notesTimerRef = useRef<number | null>(null)
  const lastViewportSyncRef = useRef<number>(0)
  const seenReactionIdsRef = useRef<Set<string>>(new Set())
  const lastMuteAllAtRef = useRef<number>(meeting.muteAllAt ?? joinedAt)
  const lastBroadcastAtRef = useRef<number>(
    meeting.breakout?.broadcastAt ?? joinedAt,
  )
  const screenAnnotationsRef = useRef(screenAnnotations)
  useEffect(() => {
    screenAnnotationsRef.current = screenAnnotations
  }, [screenAnnotations])
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  // ---- timer ----------------------------------------------------------------
  const startedAt = meeting.startedAt ? Date.parse(meeting.startedAt) : joinedAt
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  const duration = formatDuration(
    Math.max(0, Math.floor((now - startedAt) / 1000)),
  )

  const showReaction = useCallback((emoji: string, who: string, dedupeId?: string) => {
    if (dedupeId) {
      if (seenReactionIdsRef.current.has(dedupeId)) return
      seenReactionIdsRef.current.add(dedupeId)
      if (seenReactionIdsRef.current.size > 60) {
        const first = seenReactionIdsRef.current.values().next().value
        if (first) seenReactionIdsRef.current.delete(first)
      }
    }
    const id = dedupeId ?? crypto.randomUUID()
    setReactions((list) => [
      ...list.slice(-11),
      { id, emoji, name: who, x: 12 + Math.random() * 70 },
    ])
    window.setTimeout(
      () => setReactions((list) => list.filter((r) => r.id !== id)),
      2600,
    )
  }, [])

  // ---- Firestore live subscriptions (stable on [meeting.meetingId, identity]) -
  useEffect(() => {
    const unsubDoc = subscribeMeetingDoc(meeting.meetingId, (m) => {
      if (m.spotlightId !== undefined) setSpotlightId(m.spotlightId ?? null)
      if (m.breakout !== undefined) {
        setBreakout(m.breakout ?? null)
        if (
          m.breakout?.broadcastMessage &&
          m.breakout.broadcastAt &&
          m.breakout.broadcastAt > lastBroadcastAtRef.current
        ) {
          lastBroadcastAtRef.current = m.breakout.broadcastAt
          if (!isModerator) {
            toast(`📣 Broadcast: ${m.breakout.broadcastMessage}`, {
              duration: 7000,
            })
          }
        }
      }
      if (m.notes !== undefined) setNotes(m.notes)
      if (m.whiteboardOpen !== undefined) setWhiteboardOpen(m.whiteboardOpen)
      if (m.activeWhiteboardId !== undefined) {
        setActiveWhiteboardId(m.activeWhiteboardId ?? null)
      }
      if (m.activeWhiteboardTitle !== undefined) {
        setActiveWhiteboardTitle(m.activeWhiteboardTitle ?? null)
      }
      const remoteCam = m.presenterCamera
      const remoteVp = m.presenterViewport
      if (remoteCam && remoteCam.by !== identity) {
        setRemotePresenterCamera({
          cx: remoteCam.cx,
          cy: remoteCam.cy,
          zoom: remoteCam.zoom,
          at: remoteCam.at,
          force: remoteCam.force,
        })
      } else if (
        remoteVp &&
        remoteVp.by !== identity &&
        remoteVp.cx !== undefined &&
        remoteVp.cy !== undefined
      ) {
        setRemotePresenterCamera({
          cx: remoteVp.cx,
          cy: remoteVp.cy,
          zoom: remoteVp.zoom,
          at: remoteVp.at ?? Date.now(),
          force: remoteVp.force,
        })
      }
      if (m.screenAnnotations !== undefined) {
        setScreenAnnotations(m.screenAnnotations)
      }
      if (
        m.muteAllAt &&
        m.muteAllAt > lastMuteAllAtRef.current
      ) {
        lastMuteAllAtRef.current = m.muteAllAt
        if (!isModerator) {
          adapter.setMicOn(false).catch(() => {})
          toast('Your teacher muted everyone')
        }
      }
      if (
        m.lastReaction &&
        m.lastReaction.by !== identity &&
        Date.now() - m.lastReaction.at < 8000
      ) {
        showReaction(
          m.lastReaction.emoji,
          m.lastReaction.name,
          m.lastReaction.id,
        )
      }
      setSettings({
        locked: m.locked,
        waitingRoom: m.waitingRoom,
        allowStudentScreenShare: m.allowStudentScreenShare,
        allowStudentDraw: m.allowParticipantAnnotate ?? m.allowStudentDraw,
        allowChat: m.allowChat,
        allowPrivateChat: m.allowPrivateChat,
      })
    })
    const unsubMsgs = subscribeMeetingMessages(
      meeting.meetingId,
      identity,
      (remoteMsgs) => {
        setMessages((prev) => {
          const map = new Map<string, ChatMessage>()
          for (const m of prev) {
            if (m.kind === 'system') map.set(m.id, m)
          }
          for (const m of remoteMsgs) map.set(m.id, m)
          return Array.from(map.values()).sort((a, b) => a.at - b.at)
        })
      },
    )
    const unsubPolls = subscribeMeetingPolls(meeting.meetingId, setPolls)
    return () => {
      unsubDoc()
      unsubMsgs()
      unsubPolls()
    }
  }, [meeting.meetingId, identity, isModerator, adapter, showReaction])

  // Clear stale caption after 6 seconds
  useEffect(() => {
    if (!captionLine) return
    const t = window.setTimeout(() => {
      setCaptionLine((cur) => (cur && cur.at === captionLine.at ? null : cur))
    }, 6000)
    return () => window.clearTimeout(t)
  }, [captionLine])

  // ---- Live captions (Web Speech API) ---------------------------------------
  const captions = useCaptions(
    useCallback(
      (text: string, final: boolean) => {
        setCaptionLine({ who: name, text, at: Date.now() })
        adapter.send({ t: 'caption', text, final })
      },
      [adapter, name],
    ),
  )

  const toggleCaptions = useCallback(() => {
    const res = captions.toggle()
    if (res === false && captions.error) {
      toast.error(captions.error)
    }
  }, [captions])

  // ---- chat helpers ---------------------------------------------------------
  const addMessage = useCallback((m: ChatMessage) => {
    setMessages((list) =>
      list.some((x) => x.id === m.id) ? list : [...list, m],
    )
    if (m.kind !== 'system' && panelRef.current !== 'chat')
      setUnread((n) => n + 1)
  }, [])
  const systemMessage = useCallback(
    (text: string) =>
      addMessage({
        id: crypto.randomUUID(),
        authorId: 'system',
        authorName: 'Lectern',
        text,
        at: Date.now(),
        kind: 'system',
      }),
    [addMessage],
  )



  // ---- incoming real-time WebRTC messages -----------------------------------
  const settingsRef = useRef(settings)
  const whiteboardOpenRef = useRef(whiteboardOpen)
  useEffect(() => {
    panelRef.current = panel
    settingsRef.current = settings
    whiteboardOpenRef.current = whiteboardOpen
  }, [panel, settings, whiteboardOpen])

  useEffect(() => {
    return adapter.subscribe((from: RemoteSender, msg: RealtimeMessage) => {
      const fromModerator = isModeratorRole(from.role)
      switch (msg.t) {
        case 'chat': {
          if (!fromModerator && !settingsRef.current.allowChat) return
          if (msg.kind === 'announcement' && !fromModerator) return
          addMessage({
            id: msg.id,
            authorId: from.id,
            authorName: from.name,
            text: msg.text,
            at: msg.at,
            kind: msg.kind,
          })
          if (msg.kind === 'announcement')
            toast(`📣 ${from.name}: ${msg.text.slice(0, 120)}`)
          else if (panelRef.current !== 'chat')
            toast(`${from.name}: ${msg.text.slice(0, 80)}`, { duration: 2500 })
          return
        }
        case 'reaction':
          showReaction(msg.emoji, from.name, msg.id)
          return
        case 'hand':
          if (msg.raised && isModerator)
            toast(`✋ ${from.name} raised their hand`)
          return
        case 'lower-hand':
          if (fromModerator) adapter.setHand(false)
          return
        case 'wb-open':
          if (fromModerator) {
            if (msg.boardId !== undefined) {
              setActiveWhiteboardId(msg.boardId ?? null)
            }
            if (msg.boardTitle !== undefined) {
              setActiveWhiteboardTitle(msg.boardTitle ?? null)
            }
            setWhiteboardOpen(msg.open)
            if (msg.open) {
              toast(
                msg.boardTitle
                  ? `${from.name} opened "${msg.boardTitle}"`
                  : `${from.name} opened the whiteboard`,
              )
            }
          }
          return
        case 'wb-camera':
          if (fromModerator) {
            setRemotePresenterCamera({
              cx: msg.cx,
              cy: msg.cy,
              zoom: msg.zoom,
              at: Date.now(),
              force: msg.force,
            })
          }
          return
        case 'screen-ann':
          if (msg.op === 'add') {
            setScreenAnnotations((prev) =>
              prev.some((s) => s.id === msg.stroke.id)
                ? prev
                : [...prev, msg.stroke],
            )
          } else if (msg.op === 'undo') {
            setScreenAnnotations((prev) => prev.slice(0, -1))
          } else if (msg.op === 'clear') {
            setScreenAnnotations([])
          }
          return
        case 'wb-laser': {
          const nowTs = Date.now()
          setRemoteLasers((prev) => {
            const others = prev.filter((l) => l.id !== from.id)
            const cur = prev.find((l) => l.id === from.id)
            const pts = [
              ...(cur?.points.filter((pt) => nowTs - pt.at < 1500) ?? []),
              { x: msg.x, y: msg.y, at: nowTs },
            ]
            return [...others, { id: from.id, name: from.name, points: pts }]
          })
          return
        }
        case 'recording':
          if (fromModerator) {
            setRemoteRecording(msg.on)
            toast(
              msg.on ? '⏺ This class is being recorded' : 'Recording stopped',
            )
          }
          return
        case 'announce-join':
          systemMessage(`${from.name} joined`)
          return
        case 'force-mute':
          if (fromModerator && !isModerator) {
            adapter.setMicOn(false).catch(() => {})
            toast(`${from.name} muted you`)
          }
          return
        case 'stop-share':
          if (fromModerator && !isModerator) {
            adapter.stopShare().catch(() => {})
            toast(`${from.name} stopped your screen share`)
          }
          return
        case 'settings':
          if (fromModerator) setSettings(msg.settings)
          return
        case 'spotlight':
          if (fromModerator) setSpotlightId(msg.targetId)
          return
        case 'caption':
          setCaptionLine({ who: from.name, text: msg.text, at: Date.now() })
          return
        case 'breakout-broadcast':
          if (fromModerator) {
            lastBroadcastAtRef.current = Date.now()
            toast(`📣 Broadcast from ${from.name}: ${msg.text}`, {
              duration: 7000,
            })
          }
          return
        case 'kick':
          if (fromModerator) {
            void adapter.leave().then(() => onLeft('removed'))
          }
          return
        case 'ended':
          if (from.role === 'host') {
            void adapter.leave().then(() => onLeft('ended'))
          }
          return
      }
    })
  }, [
    adapter,
    addMessage,
    showReaction,
    systemMessage,
    isModerator,
    onLeft,
  ])

  // Greet each peer as their connection opens
  const greeted = useRef(new Set<string>())
  useEffect(() => {
    if (!adapter.realtime) return
    for (const tile of adapter.tiles) {
      if (tile.isLocal || greeted.current.has(tile.id)) continue
      greeted.current.add(tile.id)
      adapter.send({ t: 'announce-join' }, [tile.id])
    }
    const present = new Set(adapter.tiles.map((t) => t.id))
    for (const id of Array.from(greeted.current)) {
      if (!present.has(id)) greeted.current.delete(id)
    }
  }, [adapter, adapter.tiles])

  // Track joins/leaves for the chat log
  const knownIds = useRef<Set<string> | null>(null)
  useEffect(() => {
    const ids = new Set(adapter.tiles.map((t) => t.id))
    if (knownIds.current) {
      for (const id of knownIds.current) {
        if (!ids.has(id)) systemMessage('A participant left')
      }
    }
    knownIds.current = ids
  }, [adapter.tiles, systemMessage])

  // ---- disconnects ----------------------------------------------------------
  useEffect(() => {
    if (adapter.state !== 'disconnected') return
    const cause = adapter.disconnectCause
    onLeft(cause ?? 'left')
  }, [adapter.state, adapter.disconnectCause, onLeft])

  // ---- media errors (never kick user out of room!) --------------------------
  const lastError = useRef<string | null>(null)
  useEffect(() => {
    if (adapter.mediaError && adapter.mediaError !== lastError.current) {
      lastError.current = adapter.mediaError
      toast.error(
        adapter.mediaError === 'denied'
          ? 'Camera or microphone is blocked. You remain in the class with audio/video muted.'
          : adapter.mediaError === 'in-use'
            ? 'Another app is using your camera or microphone.'
            : adapter.mediaError === 'not-found'
              ? 'No camera or microphone was found. Showing your avatar tile.'
              : 'Could not access your camera or microphone.',
        { action: { label: 'Settings', onClick: () => setSettingsOpen(true) } },
      )
    }
  }, [adapter.mediaError])

  // ---- waiting room queue (moderators) --------------------------------------
  const admit = useCallback(
    async (id: string, yes: boolean) => {
      setWaiting((list) => list.filter((w) => w.identity !== id))
      try {
        await decideAdmission({
          data: {
            meetingId: meeting.meetingId,
            actorKey,
            identity: id,
            admit: yes,
          },
        })
      } catch (err) {
        toast.error(errorMessage(err, 'Could not update the waiting room.'))
      }
    },
    [meeting.meetingId, actorKey],
  )
  const waitingIds = useRef(new Set<string>())
  const adapterWaiting = adapter.waiting
  useEffect(() => {
    if (!isModerator) return
    let active = true
    const apply = (list: WaitingParticipant[]) => {
      setWaiting(list)
      for (const w of list) {
        if (!waitingIds.current.has(w.identity)) {
          waitingIds.current.add(w.identity)
          toast(`${w.name} is waiting to join`, {
            action: {
              label: 'Admit',
              onClick: () => void admit(w.identity, true),
            },
            duration: 8000,
          })
        }
      }
      for (const id of Array.from(waitingIds.current)) {
        if (!list.some((w) => w.identity === id)) waitingIds.current.delete(id)
      }
    }
    if (adapterWaiting !== undefined) {
      apply(adapterWaiting ?? [])
      return
    }
    const poll = async () => {
      try {
        const list = await listWaiting({
          data: { meetingId: meeting.meetingId, actorKey },
        })
        if (active) apply(list)
      } catch {
        // transient
      }
    }
    void poll()
    const t = window.setInterval(() => void poll(), 4000)
    return () => {
      active = false
      window.clearInterval(t)
    }
  }, [isModerator, meeting.meetingId, actorKey, admit, adapterWaiting])

  // ---- actions --------------------------------------------------------------
  const toggleMic = useCallback(() => {
    adapter.setMicOn(!adapter.micOn).catch(() => {})
  }, [adapter])
  const toggleCam = useCallback(() => {
    adapter.setCamOn(!adapter.camOn).catch(() => {})
  }, [adapter])
  const toggleBlur = useCallback(() => {
    adapter.setBlurOn?.(!adapter.blurOn)
  }, [adapter])

  const canShare = isModerator || settings.allowStudentScreenShare
  const toggleShare = useCallback(async () => {
    if (adapter.sharing) {
      await adapter.stopShare()
      return
    }
    if (!canShare) {
      toast('Your teacher has turned off screen sharing for students.')
      return
    }
    try {
      const ok = await adapter.startShare()
      if (ok && whiteboardOpen) setWhiteboardOpen(false)
    } catch {
      toast.error(
        'Could not start sharing. Check that your browser allows screen capture.',
      )
    }
  }, [adapter, canShare, whiteboardOpen])

  const canDraw = isModerator || settings.allowStudentDraw
  const openBoardForClass = useCallback(
    (board: StandaloneBoardMeta) => {
      setActiveWhiteboardId(board.id)
      setActiveWhiteboardTitle(board.title)
      setWhiteboardOpen(true)
      void joinWhiteboardMembership(board.id)
      if (isModerator) {
        adapter.send({
          t: 'wb-open',
          open: true,
          boardId: board.id,
          boardTitle: board.title,
        })
        void updateMeetingMeta(meeting.meetingId, {
          whiteboardOpen: true,
          activeWhiteboardId: board.id,
          activeWhiteboardTitle: board.title,
          allowParticipantAnnotate: settingsRef.current.allowStudentDraw,
        })
      }
    },
    [adapter, isModerator, meeting.meetingId],
  )

  const closeWhiteboard = useCallback(() => {
    setWhiteboardOpen(false)
    if (isModerator) {
      adapter.send({
        t: 'wb-open',
        open: false,
        boardId: activeWhiteboardId,
        boardTitle: activeWhiteboardTitle,
      })
      void updateMeetingMeta(meeting.meetingId, { whiteboardOpen: false })
    }
  }, [
    adapter,
    isModerator,
    meeting.meetingId,
    activeWhiteboardId,
    activeWhiteboardTitle,
  ])

  const toggleWhiteboard = useCallback(() => {
    if (whiteboardOpen) {
      closeWhiteboard()
      return
    }
    if (isModerator) {
      setWbPickerOpen(true)
      return
    }
    setWhiteboardOpen(true)
  }, [whiteboardOpen, closeWhiteboard, isModerator])

  const toggleHand = useCallback(() => {
    const next = !adapter.handRaised
    adapter.setHand(next)
    adapter.send({ t: 'hand', raised: next })
  }, [adapter])

  const sendChat = useCallback(
    (text: string, toId: string | null, announcement: boolean) => {
      const id = crypto.randomUUID()
      const at = Date.now()
      const kind = toId ? 'private' : announcement ? 'announcement' : 'message'
      const toName = toId
        ? adapter.tiles.find((t) => t.id === toId)?.name
        : undefined
      const message: ChatMessage = {
        id,
        authorId: identity,
        authorName: name,
        text,
        at,
        kind,
        toId: toId ?? undefined,
        toName,
      }
      addMessage(message)
      adapter.send({ t: 'chat', id, text, at, kind }, toId ? [toId] : undefined)
      void sendFirestoreMessage(meeting.meetingId, message)
    },
    [adapter, addMessage, identity, name, meeting.meetingId],
  )

  const sendReaction = useCallback(
    (emoji: string) => {
      const id = crypto.randomUUID()
      showReaction(emoji, 'You', id)
      adapter.send({ t: 'reaction', emoji, id })
      void updateMeetingMeta(meeting.meetingId, {
        lastReaction: { id, emoji, name, by: identity, at: Date.now() },
      })
    },
    [adapter, showReaction, meeting.meetingId, name, identity],
  )

  const addScreenAnnStroke = useCallback(
    (stroke: ScreenAnnStroke) => {
      const next = [...screenAnnotationsRef.current, stroke]
      setScreenAnnotations(next)
      adapter.send({ t: 'screen-ann', op: 'add', stroke })
      void updateMeetingMeta(meeting.meetingId, { screenAnnotations: next })
    },
    [adapter, meeting.meetingId],
  )

  const undoScreenAnnStroke = useCallback(() => {
    const next = screenAnnotationsRef.current.slice(0, -1)
    setScreenAnnotations(next)
    adapter.send({ t: 'screen-ann', op: 'undo' })
    void updateMeetingMeta(meeting.meetingId, { screenAnnotations: next })
  }, [adapter, meeting.meetingId])

  const clearScreenAnnStrokes = useCallback(() => {
    setScreenAnnotations([])
    adapter.send({ t: 'screen-ann', op: 'clear' })
    void updateMeetingMeta(meeting.meetingId, { screenAnnotations: [] })
  }, [adapter, meeting.meetingId])

  const handleNotesChange = useCallback(
    (next: string) => {
      setNotes(next)
      if (notesTimerRef.current) window.clearTimeout(notesTimerRef.current)
      notesTimerRef.current = window.setTimeout(() => {
        void updateMeetingMeta(meeting.meetingId, { notes: next })
      }, 450)
    },
    [meeting.meetingId],
  )

  const patchSettings = async (patch: Partial<MeetingSettings>) => {
    const previous = settings
    setSettings((s) => ({ ...s, ...patch }))
    try {
      const next = await updateSettings({
        data: { meetingId: meeting.meetingId, actorKey, patch },
      })
      setSettings(next)
      adapter.send({ t: 'settings', settings: next })
    } catch (err) {
      setSettings(previous)
      toast.error(errorMessage(err, 'Could not update the setting.'))
    }
  }

  const suspendActivities = async () => {
    await patchSettings({
      locked: true,
      allowStudentScreenShare: false,
      allowStudentDraw: false,
      allowChat: false,
      allowPrivateChat: false,
    })
    adapter.send({ t: 'force-mute' })
    adapter.send({ t: 'stop-share' })
    toast.success('Student activities suspended & meeting locked')
  }

  const doModerate = async (id: string, action: ModerateAction) => {
    const target = adapter.tiles.find((t) => t.id === id)?.name ?? 'Participant'
    if (action === 'spotlight' || action === 'unspotlight') {
      const nextSpot = action === 'spotlight' ? id : null
      setSpotlightId(nextSpot)
      adapter.send({ t: 'spotlight', targetId: nextSpot })
      await updateMeetingMeta(meeting.meetingId, { spotlightId: nextSpot })
      toast.success(
        nextSpot ? `${target} spotlighted for everyone` : 'Spotlight removed',
      )
      return
    }
    if (action === 'lower-hand') {
      adapter.send({ t: 'lower-hand' }, [id])
      return
    }
    if (action === 'mute') {
      adapter.send({ t: 'force-mute' }, [id])
      toast.success(`${target} muted`)
      return
    }
    if (action === 'stop-share') {
      adapter.send({ t: 'stop-share' }, [id])
      toast.success(`Stopped ${target}'s screen share`)
      return
    }
    try {
      await moderate({
        data: { meetingId: meeting.meetingId, actorKey, identity: id, action },
      })
      if (action === 'remove') adapter.send({ t: 'kick' }, [id])
      toast.success(
        action === 'remove'
          ? `${target} removed`
          : action === 'make-cohost'
            ? `${target} is now a co-host`
            : `${target} is no longer a co-host`,
      )
    } catch (err) {
      toast.error(errorMessage(err, 'That action failed.'))
    }
  }

  const doMuteAll = () => {
    const ts = Date.now()
    lastMuteAllAtRef.current = ts
    adapter.send({ t: 'force-mute' })
    void updateMeetingMeta(meeting.meetingId, { muteAllAt: ts })
    toast.success('All students muted')
  }

  const leave = async () => {
    setLeaveOpen(false)
    await adapter.leave()
    onLeft('left')
  }
  const end = async () => {
    setLeaveOpen(false)
    try {
      await endMeeting({ data: { meetingId: meeting.meetingId, actorKey } })
    } catch (err) {
      toast.error(errorMessage(err, 'Could not end the class.'))
      return
    }
    adapter.send({ t: 'ended' })
    await new Promise((r) => window.setTimeout(r, 150))
    await adapter.leave()
    onLeft('ended')
  }

  const copyLink = () => {
    void navigator.clipboard
      .writeText(meetingUrl(meeting.meetingId))
      .then(() => toast.success('Invite link copied'))
  }

  const toggleFullscreen = () => {
    const el = rootRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else
      void el
        .requestFullscreen?.()
        .catch(() => toast('Full screen is not available here.'))
  }

  // ---- local recording saved to IndexedDB Recordings tab --------------------
  const recorder = useTabRecorder(adapter.micTrack, {
    meetingId: meeting.meetingId,
    title: meeting.title,
  })
  const toggleRecording = async () => {
    if (recorder.recording) {
      recorder.stop()
      adapter.send({ t: 'recording', on: false })
      toast.success('Recording saved to your Recordings library & downloaded')
      return
    }
    const ok = await recorder.start()
    if (ok) {
      adapter.send({ t: 'recording', on: true })
      toast.success('Recording started. Stop it anytime to save.')
    } else if (recorder.error) {
      toast.error(recorder.error)
    }
  }

  // ---- shortcuts ------------------------------------------------------------
  const openPanel = useCallback((tab: PanelTab) => {
    if (tab === 'chat') setUnread(0)
    setPanel((p) => (p === tab ? null : tab))
  }, [])
  const switchTab = useCallback((tab: PanelTab) => {
    if (tab === 'chat') setUnread(0)
    setPanel(tab)
  }, [])

  const cycleView = useCallback(() => {
    setView((v) =>
      v === 'gallery'
        ? 'speaker'
        : v === 'speaker'
          ? 'side-by-side'
          : 'gallery',
    )
  }, [])

  useHotkeys(
    useMemo(
      () => ({
        m: toggleMic,
        v: toggleCam,
        s: () => void toggleShare(),
        w: () => canDraw && toggleWhiteboard(),
        c: () => openPanel('chat'),
        p: () => openPanel('people'),
        n: () => openPanel('notes'),
        l: toggleCaptions,
        h: toggleHand,
        g: cycleView,
        f: toggleFullscreen,
        '?': () => setShortcutsOpen(true),
        Escape: () => {
          if (panelRef.current) setPanel(null)
          else if (whiteboardOpenRef.current && isModerator) toggleWhiteboard()
        },
      }),
      [
        toggleMic,
        toggleCam,
        toggleShare,
        toggleWhiteboard,
        toggleCaptions,
        toggleHand,
        cycleView,
        openPanel,
        canDraw,
        isModerator,
      ],
    ),
  )

  // Canonical shared board ID so Host and remote Joiners ALWAYS subscribe to
  // the exact same `whiteboards/{activeWhiteboardId}/elements` subcollection.
  const effectiveWhiteboardId =
    activeWhiteboardId || `wb-meet-${meeting.meetingId}`

  // Ensure the whiteboard doc exists and current user is in `memberIds`.
  useEffect(() => {
    if (!whiteboardOpen) return
    if (activeWhiteboardId) {
      void joinWhiteboardMembership(activeWhiteboardId)
      return
    }
    let cancelled = false
    void ensureMeetingWhiteboard(meeting.meetingId, meeting.title, name).then(
      (board) => {
        if (cancelled) return
        setActiveWhiteboardId(board.id)
        setActiveWhiteboardTitle(board.title)
        if (isModerator) {
          adapter.send({
            t: 'wb-open',
            open: true,
            boardId: board.id,
            boardTitle: board.title,
          })
          void updateMeetingMeta(meeting.meetingId, {
            whiteboardOpen: true,
            activeWhiteboardId: board.id,
            activeWhiteboardTitle: board.title,
            allowParticipantAnnotate: settingsRef.current.allowStudentDraw,
          })
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [
    whiteboardOpen,
    activeWhiteboardId,
    meeting.meetingId,
    meeting.title,
    name,
    isModerator,
    adapter,
  ])

  // ---- presentation ---------------------------------------------------------
  const broadcastCamera = useCallback(
    (
      cx: number,
      cy: number,
      zoom: number,
      force?: boolean,
      panX?: number,
      panY?: number,
    ) => {
      adapter.send({ t: 'wb-camera', cx, cy, zoom, force })
      const nowTs = Date.now()
      if (force || nowTs - lastViewportSyncRef.current >= 300) {
        lastViewportSyncRef.current = nowTs
        void updateMeetingMeta(meeting.meetingId, {
          presenterViewport: {
            panX: panX ?? 0,
            panY: panY ?? 0,
            zoom,
            cx,
            cy,
            by: identity,
            at: nowTs,
            force: Boolean(force),
          },
          presenterCamera: {
            cx,
            cy,
            zoom,
            by: identity,
            at: nowTs,
            force: Boolean(force),
          },
        })
      }
    },
    [adapter, meeting.meetingId, identity],
  )

  const presentation = useMemo<Presentation | null>(() => {
    if (whiteboardOpen) {
      const scope = {
        kind: 'board',
        boardId: effectiveWhiteboardId,
      } as const
      const boardLabel = activeWhiteboardTitle || `${meeting.title} Whiteboard`
      return {
        kind: 'whiteboard',
        label: boardLabel,
        node: (
          <Whiteboard
            handle={whiteboardRef}
            syncScope={scope}
            title={boardLabel}
            canDraw={canDraw}
            isTeacher={isModerator}
            author={identity}
            authorName={name}
            onOp={(op) => adapter.send({ t: 'wb', op })}
            onLaser={(x, y) => adapter.send({ t: 'wb-laser', x, y })}
            remoteLasers={remoteLasers}
            allowParticipantsAnnotate={settings.allowStudentDraw}
            onToggleParticipantsAnnotate={
              isModerator
                ? (allowed) => void patchSettings({ allowStudentDraw: allowed })
                : undefined
            }
            onOpenBoardPicker={
              isModerator ? () => setWbPickerOpen(true) : undefined
            }
            onCameraBroadcast={isModerator ? broadcastCamera : undefined}
            remotePresenterCamera={remotePresenterCamera}
            onClose={isModerator ? closeWhiteboard : undefined}
            className="rounded-none border-0"
          />
        ),
      }
    }
    if (adapter.screenShare) {
      const s = adapter.screenShare
      return {
        kind: 'screen',
        label:
          s.ownerId === identity
            ? 'You are sharing your screen'
            : `${s.ownerName} is sharing`,
        node: (
          <div className="relative grid h-full w-full place-items-center bg-black">
            {s.node}
            <ScreenAnnotateOverlay
              canAnnotate={canDraw}
              strokes={screenAnnotations}
              authorId={identity}
              onAddStroke={addScreenAnnStroke}
              onUndoStroke={undoScreenAnnStroke}
              onClearStrokes={clearScreenAnnStrokes}
            />
          </div>
        ),
      }
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    whiteboardOpen,
    activeWhiteboardId,
    activeWhiteboardTitle,
    meeting.meetingId,
    meeting.title,
    canDraw,
    isModerator,
    identity,
    name,
    adapter,
    remoteLasers,
    settings.allowStudentDraw,
    broadcastCamera,
    remotePresenterCamera,
    closeWhiteboard,
    screenAnnotations,
    addScreenAnnStroke,
    undoScreenAnnStroke,
    clearScreenAnnStrokes,
  ])

  const tileMenu = useCallback(
    (tile: TileModel) =>
      isModerator ? (
        <ParticipantMenu
          tile={tile}
          isHost={isHost}
          pinned={pinnedId === tile.id}
          spotlighted={spotlightId === tile.id}
          onPin={setPinnedId}
          onModerate={(id, action) => void doModerate(id, action)}
          trigger={
            <button
              type="button"
              aria-label={`Actions for ${tile.name}`}
              className="grid size-7 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              <MoreVertical className="size-3.5" />
            </button>
          }
        />
      ) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isModerator, isHost, pinnedId, spotlightId],
  )

  const handsUp = adapter.tiles.filter((t) => t.handRaised && !t.isLocal).length
  const openPollsCount = polls.filter((p) => p.status === 'open').length
  const recordingOn = recorder.recording || remoteRecording
  const activeBreakoutName = breakout?.rooms.find(
    (r) => r.id === myBreakoutId,
  )?.name

  const sidePanel = panel && (
    <SidePanel
      tab={panel}
      onTab={switchTab}
      onClose={() => setPanel(null)}
      localId={identity}
      localName={name}
      isModerator={isModerator}
      isHost={isHost}
      messages={messages}
      onSend={sendChat}
      canChat={settings.allowChat}
      canPrivate={settings.allowPrivateChat}
      tiles={adapter.tiles}
      waiting={waiting}
      pinnedId={pinnedId}
      spotlightId={spotlightId}
      onPin={setPinnedId}
      onAdmit={(id, yes) => void admit(id, yes)}
      onAdmitAll={() => {
        setWaiting([])
        admitAll({ data: { meetingId: meeting.meetingId, actorKey } }).catch(
          (err) => toast.error(errorMessage(err, 'Could not admit everyone.')),
        )
      }}
      onModerate={(id, action) => void doModerate(id, action)}
      onMuteAll={doMuteAll}
      settings={settings}
      onSettings={(patch) => void patchSettings(patch)}
      polls={polls}
      notes={notes}
      onNotesChange={handleNotesChange}
      meeting={{ ...meeting, ...settings }}
      passcode={passcode}
      duration={duration}
      quality={adapter.quality}
      realtime={adapter.realtime}
    />
  )

  return (
    <div ref={rootRef} className="flex h-svh flex-col bg-stage text-foreground">
      {adapter.audioNode}

      {/* banners */}
      {(adapter.connectingNames?.length ?? 0) > 0 &&
        adapter.state === 'connected' && (
          <Banner tone="muted" icon={Loader2} spin>
            Connecting to {adapter.connectingNames!.join(', ')}…
          </Banner>
        )}
      {adapter.state === 'reconnecting' && (
        <Banner tone="live" icon={WifiOff}>
          Connection lost. Reconnecting…
        </Banner>
      )}
      {adapter.state === 'connecting' && (
        <Banner tone="muted" icon={Circle}>
          Connecting to the class…
        </Banner>
      )}
      {activeBreakoutName && (
        <Banner tone="amber" icon={Split}>
          <span className="flex flex-wrap items-center gap-2">
            You are in breakout room <strong>{activeBreakoutName}</strong>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setMyBreakoutId(null)
                void updateParticipantState(meeting.meetingId, identity, {
                  breakoutRoomId: null,
                })
              }}
            >
              Return to main room
            </Button>
          </span>
        </Banner>
      )}
      {recordingOn && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur md:hidden">
          <Circle className="size-2 fill-live text-live animate-pulse-dot" />{' '}
          Recording
        </div>
      )}

      {/* main */}
      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <Stage
            tiles={adapter.tiles}
            renderVideo={adapter.renderVideo}
            tileMenu={tileMenu}
            presentation={presentation}
            view={view}
            pinnedId={pinnedId}
            spotlightId={spotlightId}
            onPin={setPinnedId}
            activeSpeakerId={adapter.activeSpeakerId}
          />
          <ReactionsOverlay items={reactions} />

          {/* Live Captions Overlay */}
          {(captions.enabled || captionLine) && (
            <div
              role="region"
              aria-live="polite"
              aria-label="Live captions"
              className="pointer-events-none absolute bottom-4 left-1/2 z-20 max-w-2xl -translate-x-1/2 rounded-xl bg-black/75 px-4 py-2 text-center text-sm text-white shadow-lg backdrop-blur"
            >
              {captionLine ? (
                <span>
                  <span className="mr-1.5 font-semibold text-amber">
                    {captionLine.who}:
                  </span>
                  {captionLine.text}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-white/75">
                  <Captions className="size-3.5" /> Listening for speech…
                </span>
              )}
            </div>
          )}
        </div>
        {isDesktop && panel && (
          <div className="w-[350px] shrink-0 border-l xl:w-[390px]">
            {sidePanel}
          </div>
        )}
      </div>

      {!isDesktop && (
        <Sheet open={!!panel} onOpenChange={(open) => !open && setPanel(null)}>
          <SheetContent
            side="right"
            className="w-full p-0 sm:max-w-md [&>button]:hidden"
          >
            <SheetTitle className="sr-only">Meeting panel</SheetTitle>
            <SheetDescription className="sr-only">
              Chat, participants, polls, notes and meeting details
            </SheetDescription>
            {sidePanel}
          </SheetContent>
        </Sheet>
      )}

      <ControlBar
        meetingId={meeting.meetingId}
        title={meeting.title}
        duration={duration}
        participantCount={adapter.tiles.length}
        micOn={adapter.micOn}
        camOn={adapter.camOn}
        blurOn={adapter.blurOn}
        sharing={adapter.sharing}
        shareSupported={adapter.shareSupported}
        canShare={canShare}
        whiteboardOpen={whiteboardOpen}
        canWhiteboard={
          isModerator || whiteboardOpen || settings.allowStudentDraw
        }
        handRaised={adapter.handRaised}
        recording={recordingOn}
        recordingSupported={recorder.supported}
        captionsOn={captions.enabled}
        captionsSupported={captions.supported}
        locked={settings.locked}
        settings={settings}
        panel={panel}
        unread={unread}
        peopleBadge={waiting.length + handsUp}
        pollsBadge={openPollsCount}
        view={view}
        isModerator={isModerator}
        isHost={isHost}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onToggleBlur={adapter.setBlurOn ? toggleBlur : undefined}
        onToggleShare={() => void toggleShare()}
        onToggleWhiteboard={toggleWhiteboard}
        onToggleHand={toggleHand}
        onToggleCaptions={toggleCaptions}
        onPanel={openPanel}
        onOpenBreakout={() => setBreakoutOpen(true)}
        onReaction={sendReaction}
        onToggleView={cycleView}
        onSetView={setView}
        onFullscreen={toggleFullscreen}
        onSettings={() => setSettingsOpen(true)}
        onShortcuts={() => setShortcutsOpen(true)}
        onToggleRecording={() => void toggleRecording()}
        onToggleLock={() => void patchSettings({ locked: !settings.locked })}
        onPatchSettings={(patch) => void patchSettings(patch)}
        onSuspendActivities={() => void suspendActivities()}
        onMuteAll={doMuteAll}
        onCopyLink={copyLink}
        onLeave={() => setLeaveOpen(true)}
        onEnd={() => setLeaveOpen(true)}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        devices={adapter.devices}
        selection={adapter.selection}
        onChange={(next) => void adapter.setDevices(next)}
        error={adapter.mediaError}
        blurOn={adapter.blurOn}
        onBlurChange={adapter.setBlurOn}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <BreakoutDialog
        open={breakoutOpen}
        onOpenChange={setBreakoutOpen}
        isModerator={isModerator}
        localId={identity}
        tiles={adapter.tiles}
        state={breakout}
        myRoomId={myBreakoutId}
        onUpdateState={async (next) => {
          setBreakout(next)
          await updateMeetingMeta(meeting.meetingId, { breakout: next })
        }}
        onJoinRoom={async (roomId) => {
          setMyBreakoutId(roomId)
          await updateParticipantState(meeting.meetingId, identity, {
            breakoutRoomId: roomId,
          })
          setBreakoutOpen(false)
        }}
        onBroadcast={(text) => {
          adapter.send({ t: 'breakout-broadcast', text })
          void updateMeetingMeta(meeting.meetingId, {
            breakout: {
              open: breakout?.open ?? true,
              rooms: breakout?.rooms ?? [],
              broadcastMessage: text,
              broadcastAt: Date.now(),
            },
          })
        }}
      />
      <WhiteboardPickerDialog
        open={wbPickerOpen}
        onOpenChange={setWbPickerOpen}
        activeBoardId={activeWhiteboardId}
        createdByName={name}
        onSelectBoard={openBoardForClass}
      />
      <LeaveDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        isHost={isHost}
        onLeave={() => void leave()}
        onEnd={() => void end()}
      />
    </div>
  )
}

function Banner({
  tone,
  icon: Icon,
  spin,
  children,
}: {
  tone: 'amber' | 'live' | 'muted'
  icon: typeof Circle
  spin?: boolean
  children: React.ReactNode
}) {
  const cls =
    tone === 'amber'
      ? 'bg-amber/20 text-foreground border-amber/40'
      : tone === 'live'
        ? 'bg-live/15 text-foreground border-live/40'
        : 'bg-muted text-muted-foreground border-border'
  return (
    <div
      role="status"
      className={`flex items-center gap-2 border-b px-4 py-2 text-sm ${cls}`}
    >
      <Icon
        className={`size-4 shrink-0 ${spin ? 'animate-spin motion-reduce:animate-none' : ''}`}
      />
      <span className="min-w-0">{children}</span>
    </div>
  )
}

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
