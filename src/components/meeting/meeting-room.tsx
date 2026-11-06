import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { Circle, Loader2, WifiOff } from 'lucide-react'
import { toast } from 'sonner'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatDuration, meetingUrl } from '@/lib/meeting'
import {
  isModerator as isModeratorRole,
  type MeetingSettings,
  type MeetingSummary,
  type Role,
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
import type { RemoteSender, RoomAdapter } from './adapter'
import { ControlBar } from './control-bar'
import { LeaveDialog, SettingsDialog, ShortcutsDialog } from './dialogs'
import { ReactionsOverlay } from './reactions-overlay'
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
import { Whiteboard, type WhiteboardHandle } from './whiteboard/whiteboard'
import { MoreVertical } from 'lucide-react'

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

  // ---- settings (DB is the source of truth; the room metadata mirrors it) --
  const [settings, setSettings] = useState<MeetingSettings>(meeting)
  const [seenRoomSettings, setSeenRoomSettings] = useState(adapter.roomSettings)
  if (adapter.roomSettings !== seenRoomSettings) {
    // Room metadata changed: adopt it (React allows adjusting state during render).
    setSeenRoomSettings(adapter.roomSettings)
    if (adapter.roomSettings) setSettings(adapter.roomSettings)
  }

  // ---- UI state -------------------------------------------------------------
  const [panel, setPanel] = useState<PanelTab | null>(null)
  const [view, setView] = useState<ViewMode>('gallery')
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const [whiteboardOpen, setWhiteboardOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [unread, setUnread] = useState(0)
  const [reactions, setReactions] = useState<FloatingReaction[]>([])
  const [waiting, setWaiting] = useState<WaitingParticipant[]>([])
  const [remoteRecording, setRemoteRecording] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const rootRef = useRef<HTMLDivElement>(null)
  const whiteboardRef = useRef<WhiteboardHandle>(null)
  const panelRef = useRef(panel)
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  // ---- timer ----------------------------------------------------------------
  const [joinedAt] = useState(() => Date.now())
  const startedAt = meeting.startedAt ? Date.parse(meeting.startedAt) : joinedAt
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  const duration = formatDuration(
    Math.max(0, Math.floor((now - startedAt) / 1000)),
  )

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

  const showReaction = useCallback((emoji: string, who: string) => {
    const id = crypto.randomUUID()
    setReactions((list) => [
      ...list.slice(-11),
      { id, emoji, name: who, x: 12 + Math.random() * 70 },
    ])
    window.setTimeout(
      () => setReactions((list) => list.filter((r) => r.id !== id)),
      2600,
    )
  }, [])

  // ---- incoming real-time messages -----------------------------------------
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
          showReaction(msg.emoji, from.name)
          return
        case 'hand':
          if (msg.raised && isModerator)
            toast(`✋ ${from.name} raised their hand`)
          return
        case 'lower-hand':
          if (fromModerator) adapter.setHand(false)
          return
        case 'wb':
          if (!fromModerator && !settingsRef.current.allowStudentDraw) return
          if (
            !fromModerator &&
            (msg.op.type === 'goto' ||
              msg.op.type === 'sync' ||
              msg.op.type.startsWith('page'))
          )
            return
          whiteboardRef.current?.apply(msg.op)
          return
        case 'wb-request':
          if (isHost) {
            adapter.send({ t: 'wb-open', open: whiteboardOpenRef.current }, [
              from.id,
            ])
            const snap = whiteboardRef.current?.snapshot()
            if (snap && whiteboardOpenRef.current) {
              adapter.send(
                {
                  t: 'wb',
                  op: {
                    type: 'sync',
                    pages: snap.pages,
                    current: snap.current,
                  },
                },
                [from.id],
              )
            }
          }
          return
        case 'wb-open':
          if (fromModerator) {
            setWhiteboardOpen(msg.open)
            if (msg.open) toast(`${from.name} opened the whiteboard`)
          }
          return
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
    isHost,
    onLeft,
  ])

  // Greet each peer as their connection opens, and ask the teacher for the
  // current whiteboard so late joiners see the same board.
  const greeted = useRef(new Set<string>())
  useEffect(() => {
    if (!adapter.realtime) return
    for (const tile of adapter.tiles) {
      if (tile.isLocal || greeted.current.has(tile.id)) continue
      greeted.current.add(tile.id)
      adapter.send({ t: 'announce-join' }, [tile.id])
      if (!isHost && tile.role === 'host') {
        adapter.send({ t: 'wb-request' }, [tile.id])
      }
    }
    const present = new Set(adapter.tiles.map((t) => t.id))
    for (const id of Array.from(greeted.current)) {
      if (!present.has(id)) greeted.current.delete(id)
    }
  }, [adapter, adapter.tiles, isHost])

  // Track joins/leaves for the chat log.
  const knownIds = useRef<Set<string> | null>(null)
  useEffect(() => {
    const ids = new Set(adapter.tiles.map((t) => t.id))
    if (knownIds.current) {
      for (const id of knownIds.current) {
        if (!ids.has(id)) {
          systemMessage('A participant left')
        }
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

  // ---- media errors ---------------------------------------------------------
  const lastError = useRef<string | null>(null)
  useEffect(() => {
    if (adapter.mediaError && adapter.mediaError !== lastError.current) {
      lastError.current = adapter.mediaError
      toast.error(
        adapter.mediaError === 'denied'
          ? 'Camera or microphone is blocked. Allow access in the address bar.'
          : adapter.mediaError === 'in-use'
            ? 'Another app is using your camera or microphone.'
            : adapter.mediaError === 'not-found'
              ? 'No camera or microphone was found.'
              : 'Could not access your camera or microphone.',
        { action: { label: 'Settings', onClick: () => setSettingsOpen(true) } },
      )
    }
  }, [adapter.mediaError])

  // ---- waiting room polling (moderators) -----------------------------------
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
    // The room sync already carries the queue; only poll when it doesn't.
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
        // Keep polling; transient errors are expected on flaky networks.
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
  const toggleWhiteboard = useCallback(() => {
    const next = !whiteboardOpen
    setWhiteboardOpen(next)
    if (isModerator) {
      adapter.send({ t: 'wb-open', open: next })
      if (next) {
        const snap = whiteboardRef.current?.snapshot()
        if (snap)
          adapter.send({
            t: 'wb',
            op: { type: 'sync', pages: snap.pages, current: snap.current },
          })
      }
    }
  }, [adapter, isModerator, whiteboardOpen])

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
      addMessage({
        id,
        authorId: identity,
        authorName: name,
        text,
        at,
        kind,
        toId: toId ?? undefined,
        toName,
      })
      adapter.send({ t: 'chat', id, text, at, kind }, toId ? [toId] : undefined)
    },
    [adapter, addMessage, identity, name],
  )

  const sendReaction = useCallback(
    (emoji: string) => {
      showReaction(emoji, 'You')
      adapter.send({ t: 'reaction', emoji })
    },
    [adapter, showReaction],
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

  const doModerate = async (id: string, action: ModerateAction) => {
    const target = adapter.tiles.find((t) => t.id === id)?.name ?? 'Participant'
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
    adapter.send({ t: 'force-mute' })
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
    // Give the message a moment to flush before closing the connections.
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

  // ---- recording (host, tab capture) ---------------------------------------
  const recorder = useTabRecorder(adapter.micTrack)
  const toggleRecording = async () => {
    if (recorder.recording) {
      recorder.stop()
      adapter.send({ t: 'recording', on: false })
      return
    }
    const ok = await recorder.start()
    if (ok) {
      adapter.send({ t: 'recording', on: true })
      toast.success(
        'Recording started. Stop it from the More menu to save the file.',
      )
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
  useHotkeys(
    useMemo(
      () => ({
        m: toggleMic,
        v: toggleCam,
        s: () => void toggleShare(),
        w: () => canDraw && toggleWhiteboard(),
        c: () => openPanel('chat'),
        p: () => openPanel('people'),
        h: toggleHand,
        g: () => setView((v) => (v === 'gallery' ? 'speaker' : 'gallery')),
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
        toggleHand,
        openPanel,
        canDraw,
        isModerator,
      ],
    ),
  )

  // ---- presentation ---------------------------------------------------------
  const presentation = useMemo<Presentation | null>(() => {
    if (whiteboardOpen) {
      return {
        kind: 'whiteboard',
        label: 'Whiteboard',
        node: (
          <Whiteboard
            handle={whiteboardRef}
            canDraw={canDraw}
            isTeacher={isModerator}
            author={identity}
            onOp={(op) => adapter.send({ t: 'wb', op })}
            onClose={isModerator ? toggleWhiteboard : undefined}
            className="rounded-none"
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
          <div className="grid h-full w-full place-items-center bg-black">
            {s.node}
          </div>
        ),
      }
    }
    return null
  }, [
    whiteboardOpen,
    canDraw,
    isModerator,
    identity,
    adapter,
    toggleWhiteboard,
  ])

  const tileMenu = useCallback(
    (tile: TileModel) =>
      isModerator ? (
        <ParticipantMenu
          tile={tile}
          isHost={isHost}
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
    [isModerator, isHost],
  )

  const handsUp = adapter.tiles.filter((t) => t.handRaised && !t.isLocal).length
  const recordingOn = recorder.recording || remoteRecording

  const sidePanel = panel && (
    <SidePanel
      tab={panel}
      onTab={switchTab}
      onClose={() => setPanel(null)}
      localId={identity}
      isModerator={isModerator}
      isHost={isHost}
      messages={messages}
      onSend={sendChat}
      canChat={settings.allowChat}
      canPrivate={settings.allowPrivateChat}
      tiles={adapter.tiles}
      waiting={waiting}
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
            onPin={setPinnedId}
            activeSpeakerId={adapter.activeSpeakerId}
          />
          <ReactionsOverlay items={reactions} />
        </div>
        {isDesktop && panel && (
          <div className="w-[340px] shrink-0 border-l xl:w-[380px]">
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
              Chat, participants and meeting details
            </SheetDescription>
            {sidePanel}
          </SheetContent>
        </Sheet>
      )}

      <ControlBar
        title={meeting.title}
        duration={duration}
        participantCount={adapter.tiles.length}
        micOn={adapter.micOn}
        camOn={adapter.camOn}
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
        locked={settings.locked}
        panel={panel}
        unread={unread}
        peopleBadge={waiting.length + handsUp}
        view={view}
        isModerator={isModerator}
        isHost={isHost}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onToggleShare={() => void toggleShare()}
        onToggleWhiteboard={toggleWhiteboard}
        onToggleHand={toggleHand}
        onPanel={openPanel}
        onReaction={sendReaction}
        onToggleView={() =>
          setView((v) => (v === 'gallery' ? 'speaker' : 'gallery'))
        }
        onFullscreen={toggleFullscreen}
        onSettings={() => setSettingsOpen(true)}
        onShortcuts={() => setShortcutsOpen(true)}
        onToggleRecording={() => void toggleRecording()}
        onToggleLock={() => void patchSettings({ locked: !settings.locked })}
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
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
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
