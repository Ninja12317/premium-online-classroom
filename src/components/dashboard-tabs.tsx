import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import {
  CalendarDays,
  CalendarPlus,
  Copy,
  Download,
  Film,
  KeyRound,
  MessageSquare,
  Pencil,
  Play,
  Search,
  SendHorizonal,
  Sparkles,
  Trash2,
  Video,
  VideoOff,
  Mic,
  MicOff,
  ArrowLeft,
} from 'lucide-react'
import { toast } from 'sonner'

import { AvatarBubble } from '@/components/avatar-bubble'
import { DeviceSettings } from '@/components/device-settings'
import { displayName, useIdentity } from '@/components/identity-provider'
import { MediaError } from '@/components/media-error'
import type { ChatMessage } from '@/components/meeting/types'
import { Whiteboard } from '@/components/meeting/whiteboard/whiteboard'
import { WhiteboardGallery } from '@/components/meeting/whiteboard/whiteboard-picker'
import { ScheduleDialog } from '@/components/schedule-dialog'
import { ThemeToggle } from '@/components/theme-toggle'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  buildIcs,
  downloadTextFile,
  formatDuration,
  meetingUrl,
} from '@/lib/meeting'
import type { MeetingSummary } from '@/lib/meeting-types'
import {
  defaultPrefs,
  loadPrefs,
  loadPrefsCached,
  savePrefs,
  type JoinPrefs,
} from '@/lib/prefs'
import { useClientValue } from '@/lib/use-client-value'
import { useAttachStream, useLocalMedia } from '@/lib/use-local-media'
import { useMounted } from '@/lib/use-mounted'
import { cn } from '@/lib/utils'
import {
  sendFirestoreMessage,
  subscribeMeetingMessages,
} from '@/services/firestore-meetings'
import {
  deleteRecording,
  listRecordings,
  renameRecording,
  type StoredRecording,
} from '@/services/recordings-db'

export type DashboardMeeting = MeetingSummary & { passcode: string | null }

// ---------------------------------------------------------------------------
// Meetings Tab
// ---------------------------------------------------------------------------

export function MeetingsTab({
  meetings,
  onEdit,
  onDelete,
  onRefresh,
}: {
  meetings: DashboardMeeting[]
  onEdit: (m: DashboardMeeting) => void
  onDelete: (meetingId: string) => void
  onRefresh: () => void
}) {
  const mounted = useMounted()
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return meetings
    return meetings.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.meetingId.toLowerCase().includes(q),
    )
  }, [meetings, search])

  const upcoming = filtered.filter((m) => !m.endedAt)
  const past = filtered.filter((m) => m.endedAt)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Meetings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your upcoming scheduled classes and past sessions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search meetings…"
              className="h-9 w-56 pl-9"
            />
          </div>
          <ScheduleDialog
            onSaved={onRefresh}
            trigger={
              <Button size="sm" className="gap-1.5">
                <CalendarPlus className="size-4" /> Schedule a class
              </Button>
            }
          />
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Upcoming & Open ({upcoming.length})
        </h2>
        {upcoming.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-card/50 p-10 text-center text-sm text-muted-foreground">
            No upcoming classes match your filter. Schedule one to get a
            permanent link.
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((m) => (
              <li
                key={m.meetingId}
                className="flex flex-col rounded-2xl border bg-card p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold leading-snug">{m.title}</h3>
                  {m.startedAt && !m.endedAt && (
                    <Badge className="shrink-0 gap-1 bg-live text-white hover:bg-live">
                      <span className="size-1.5 rounded-full bg-white animate-pulse-dot" />{' '}
                      Live
                    </Badge>
                  )}
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CalendarDays className="size-3.5" />
                  {mounted && m.scheduledAt
                    ? new Date(m.scheduledAt).toLocaleString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })
                    : 'Open class, no fixed time'}
                  <span aria-hidden>·</span> {m.durationMin} min
                </p>
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
                  <span>{m.meetingId}</span>
                  {m.passcode && (
                    <span className="inline-flex items-center gap-1">
                      <KeyRound className="size-3" /> {m.passcode}
                    </span>
                  )}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  <Button asChild size="sm" className="gap-1.5">
                    <Link
                      to="/join/$meetingId"
                      params={{ meetingId: m.meetingId }}
                    >
                      <Video className="size-4" /> Start
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      const invite = [
                        `Join "${m.title}" on Lectern: ${meetingUrl(m.meetingId)}`,
                        `Meeting ID: ${m.meetingId}`,
                        m.passcode ? `Passcode: ${m.passcode}` : '',
                      ]
                        .filter(Boolean)
                        .join('\n')
                      void navigator.clipboard
                        .writeText(invite)
                        .then(() => toast.success('Invite copied'))
                    }}
                  >
                    <Copy className="size-3.5" /> Copy invite
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label={`Edit ${m.title}`}
                    onClick={() => onEdit(m)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  {m.scheduledAt && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={`Export calendar for ${m.title}`}
                      onClick={() =>
                        downloadTextFile(
                          `${m.title.replace(/[^\w-]+/g, '_')}.ics`,
                          buildIcs({
                            title: m.title,
                            startsAt: new Date(m.scheduledAt!),
                            durationMin: m.durationMin,
                            meetingId: m.meetingId,
                            passcode: m.passcode ?? undefined,
                          }),
                          'text/calendar',
                        )
                      }
                    >
                      <CalendarDays className="size-3.5" />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="ml-auto size-8 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${m.title}`}
                    onClick={() => onDelete(m.meetingId)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Past classes ({past.length})
          </h2>
          <ul className="divide-y rounded-2xl border bg-card">
            {past.map((m) => (
              <li
                key={m.meetingId}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{m.title}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {m.meetingId}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {mounted && m.endedAt
                      ? new Date(m.endedAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })
                      : ''}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${m.title}`}
                    onClick={() => onDelete(m.meetingId)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chat Tab (Synced to Firestore meetings/{meetingId}/messages)
// ---------------------------------------------------------------------------

export function ChatTab({ meetings }: { meetings: DashboardMeeting[] }) {
  const { user, clientUid } = useIdentity()
  const [selectedId, setSelectedId] = useState<string>(
    () => meetings[0]?.meetingId ?? '',
  )
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const activeId =
    selectedId && meetings.some((m) => m.meetingId === selectedId)
      ? selectedId
      : (meetings[0]?.meetingId ?? '')

  useEffect(() => {
    if (!activeId) return
    return subscribeMeetingMessages(activeId, clientUid, setMessages)
  }, [activeId, clientUid])

  async function send(e: FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || !activeId) return
    setDraft('')
    const authorName =
      displayName(user) || loadPrefs().name || 'Teacher'
    await sendFirestoreMessage(activeId, {
      id: crypto.randomUUID(),
      authorId: clientUid || 'local',
      authorName,
      text,
      at: Date.now(),
      kind: 'message',
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Class Chat
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Persistent chat channels synced live with your Lectern classes.
        </p>
      </div>

      {meetings.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">
          <MessageSquare className="mx-auto mb-2 size-8 opacity-40" />
          Start or schedule a class to unlock its persistent chat channel.
        </div>
      ) : (
        <div className="grid h-[68vh] min-h-[460px] overflow-hidden rounded-2xl border bg-card lg:grid-cols-[260px_1fr]">
          <aside className="flex flex-col border-b lg:border-b-0 lg:border-r">
            <div className="border-b px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Classrooms ({meetings.length})
            </div>
            <ul className="flex-1 divide-y overflow-y-auto scrollbar-thin">
              {meetings.map((m) => (
                <li key={m.meetingId}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(m.meetingId)}
                    className={cn(
                      'flex w-full flex-col items-start px-3 py-2.5 text-left transition-colors',
                      activeId === m.meetingId
                        ? 'bg-primary/10 text-foreground'
                        : 'hover:bg-muted/60',
                    )}
                  >
                    <span className="w-full truncate text-sm font-medium">
                      {m.title}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {m.meetingId}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <div className="flex min-h-0 flex-col">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <div>
                <p className="font-semibold text-sm">
                  {meetings.find((m) => m.meetingId === activeId)?.title}
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  {activeId}
                </p>
              </div>
              <Button asChild size="xs" variant="outline">
                <Link
                  to="/join/$meetingId"
                  params={{ meetingId: activeId }}
                >
                  Open class
                </Link>
              </Button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 scrollbar-thin">
              {messages.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No messages in this class yet.
                </p>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className="flex items-start gap-2.5">
                    <AvatarBubble
                      name={m.authorName}
                      seed={m.authorId}
                      className="size-8 text-xs"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {m.authorName}
                        </span>{' '}
                        ·{' '}
                        {new Date(m.at).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">
                        {m.text}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <form
              onSubmit={(e) => void send(e)}
              className="flex items-center gap-2 border-t p-3"
            >
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Post a message to this classroom…"
              />
              <Button type="submit" size="icon" disabled={!draft.trim()} aria-label="Send message">
                <SendHorizonal className="size-4" />
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Whiteboards Tab (Standalone & Meeting Infinite Whiteboards)
// ---------------------------------------------------------------------------

export function WhiteboardsTab({
  meetings,
  onFullscreenChange,
}: {
  meetings: DashboardMeeting[]
  onFullscreenChange?: (fullscreen: boolean) => void
}) {
  const { user, clientUid } = useIdentity()
  const [activeBoard, setActiveBoard] = useState<{
    scope:
      | { kind: 'board'; boardId: string }
      | { kind: 'meeting'; meetingId: string }
    title: string
  } | null>(null)

  useEffect(() => {
    onFullscreenChange?.(activeBoard !== null)
    return () => onFullscreenChange?.(false)
  }, [activeBoard, onFullscreenChange])

  if (activeBoard) {
    return (
      <div className="flex h-[calc(100svh-5rem)] min-h-[520px] flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 shrink-0"
              onClick={() => setActiveBoard(null)}
            >
              <ArrowLeft className="size-4" /> All whiteboards
            </Button>
            <h1 className="truncate font-display text-lg font-semibold sm:text-xl">
              {activeBoard.title}
            </h1>
          </div>
          <Badge variant="secondary" className="shrink-0">
            Auto-saved
          </Badge>
        </div>
        <div className="relative min-h-0 flex-1">
          <Whiteboard
            canDraw
            isTeacher
            author={clientUid || 'teacher'}
            authorName={displayName(user) || 'Teacher'}
            syncScope={activeBoard.scope}
            title={activeBoard.title}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Infinite Whiteboards
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Infinite pan & zoom canvases that auto-save continuously and reopen
          in any class.
        </p>
      </div>

      <WhiteboardGallery
        createdByName={displayName(user) || undefined}
        onSelectBoard={(b) =>
          setActiveBoard({
            scope: { kind: 'board', boardId: b.id },
            title: b.title,
          })
        }
      />

      {meetings.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Class whiteboards
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {meetings.slice(0, 6).map((m) => (
              <li
                key={m.meetingId}
                className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">{m.title}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {m.meetingId}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setActiveBoard({
                      scope: m.activeWhiteboardId
                        ? { kind: 'board', boardId: m.activeWhiteboardId }
                        : { kind: 'meeting', meetingId: m.meetingId },
                      title:
                        m.activeWhiteboardTitle || `${m.title} — Whiteboard`,
                    })
                  }
                >
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recordings Tab (IndexedDB Local MediaRecorder Library)
// ---------------------------------------------------------------------------

export function RecordingsTab() {
  const [items, setItems] = useState<StoredRecording[]>([])
  const [loading, setLoading] = useState(true)
  const [playing, setPlaying] = useState<{
    rec: StoredRecording
    url: string
  } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')

  useEffect(() => {
    void listRecordings().then((r) => {
      setItems(r)
      setLoading(false)
    })
  }, [])

  function openPlayer(rec: StoredRecording) {
    const url = URL.createObjectURL(rec.blob)
    setPlaying({ rec, url })
  }

  function closePlayer() {
    if (playing) URL.revokeObjectURL(playing.url)
    setPlaying(null)
  }

  async function remove(id: string) {
    await deleteRecording(id)
    setItems((prev) => prev.filter((r) => r.id !== id))
    toast.success('Recording deleted')
  }

  async function saveRename(id: string) {
    if (renameVal.trim()) {
      await renameRecording(id, renameVal.trim())
      setItems((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, title: renameVal.trim() } : r,
        ),
      )
    }
    setRenamingId(null)
  }

  function download(rec: StoredRecording) {
    const url = URL.createObjectURL(rec.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${rec.title.replace(/[^\w-]+/g, '_')}.webm`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Recordings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Local class recordings captured via MediaRecorder and stored privately
          in your browser.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading recordings…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">
          <Film className="mx-auto mb-2 size-8 opacity-40" />
          No recordings yet. Inside any meeting, open <strong>More → Record locally</strong>{' '}
          to save a class recording right here.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((rec) => (
            <li
              key={rec.id}
              className="flex flex-col justify-between rounded-2xl border bg-card p-4 shadow-sm"
            >
              <div>
                {renamingId === rec.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      void saveRename(rec.id)
                    }}
                  >
                    <Input
                      autoFocus
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onBlur={() => void saveRename(rec.id)}
                      className="h-8 text-sm"
                    />
                  </form>
                ) : (
                  <h3 className="font-semibold">{rec.title}</h3>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(rec.createdAt).toLocaleString()} ·{' '}
                  {formatDuration(rec.durationSec)} ·{' '}
                  {(rec.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                </p>
              </div>
              <div className="mt-4 flex items-center gap-1.5">
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => openPlayer(rec)}
                >
                  <Play className="size-3.5" /> Play
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => download(rec)}
                >
                  <Download className="size-3.5" /> Save
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={`Rename ${rec.title}`}
                  onClick={() => {
                    setRenamingId(rec.id)
                    setRenameVal(rec.title)
                  }}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="ml-auto size-8 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete ${rec.title}`}
                  onClick={() => void remove(rec.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!playing} onOpenChange={(o) => !o && closePlayer()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{playing?.rec.title}</DialogTitle>
            <DialogDescription>
              {playing &&
                `${new Date(playing.rec.createdAt).toLocaleString()} · ${formatDuration(playing.rec.durationSec)}`}
            </DialogDescription>
          </DialogHeader>
          {playing && (
            <video
              src={playing.url}
              controls
              autoPlay
              className="aspect-video w-full rounded-xl bg-black"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings Tab (Camera/Mic Preview, Device Defaults, Theme & Profile)
// ---------------------------------------------------------------------------

export function SettingsTab() {
  const { user, clientUid } = useIdentity()
  const stored = useClientValue(loadPrefsCached, defaultPrefs)
  const [edits, setEdits] = useState<Partial<JoinPrefs>>({})
  const videoRef = useRef<HTMLVideoElement>(null)

  const prefs: JoinPrefs = {
    ...stored,
    ...edits,
    name: edits.name ?? (stored.name || displayName(user)),
  }
  const blurOn = Boolean(prefs.blurOn)

  const media = useLocalMedia({
    micOn: prefs.micOn,
    camOn: prefs.camOn,
    cameraId: prefs.cameraId,
    micId: prefs.micId,
  })

  useAttachStream(videoRef, media.hasVideo ? media.stream : null)

  function patchPrefs(patch: Partial<JoinPrefs>) {
    const next = { ...prefs, ...patch }
    setEdits((e) => ({ ...e, ...patch }))
    savePrefs(next)
  }

  function saveName() {
    savePrefs({ ...prefs, name: prefs.name.trim() })
    toast.success('Default display name saved')
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure your camera, microphone, profile, and appearance.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Camera & Audio Preview */}
        <section className="space-y-4 rounded-2xl border bg-card p-5">
          <h2 className="font-display text-lg font-semibold">
            Audio & Video Preview
          </h2>
          <div className="relative aspect-video overflow-hidden rounded-xl bg-stage-tile">
            {prefs.camOn && media.hasVideo ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={cn(
                  'h-full w-full -scale-x-100 object-cover transition-[filter]',
                  blurOn && 'blur-[6px] scale-[1.03]',
                )}
              />
            ) : (
              <div className="grid h-full w-full place-items-center">
                <AvatarBubble
                  name={prefs.name || 'You'}
                  seed={clientUid || 'me'}
                  className="size-20 text-2xl"
                />
              </div>
            )}
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-black/55 p-1.5 backdrop-blur">
              <Button
                type="button"
                size="icon"
                variant={prefs.micOn ? 'secondary' : 'destructive'}
                className="size-9 rounded-lg"
                onClick={() => patchPrefs({ micOn: !prefs.micOn })}
                aria-label={
                  prefs.micOn ? 'Mute preview mic' : 'Unmute preview mic'
                }
              >
                {prefs.micOn ? (
                  <Mic className="size-4" />
                ) : (
                  <MicOff className="size-4" />
                )}
              </Button>
              <Button
                type="button"
                size="icon"
                variant={prefs.camOn ? 'secondary' : 'destructive'}
                className="size-9 rounded-lg"
                onClick={() => patchPrefs({ camOn: !prefs.camOn })}
                aria-label={
                  prefs.camOn
                    ? 'Turn preview camera off'
                    : 'Turn preview camera on'
                }
              >
                {prefs.camOn ? (
                  <Video className="size-4" />
                ) : (
                  <VideoOff className="size-4" />
                )}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={blurOn ? 'default' : 'secondary'}
                className="h-9 gap-1.5 rounded-lg"
                onClick={() => patchPrefs({ blurOn: !blurOn })}
              >
                <Sparkles className="size-3.5" /> Blur
              </Button>
            </div>
          </div>

          {media.error && <MediaError kind={media.error} />}

          <DeviceSettings
            devices={media.devices}
            value={{
              cameraId: prefs.cameraId,
              micId: prefs.micId,
              speakerId: prefs.speakerId,
            }}
            onChange={(next) =>
              patchPrefs({
                cameraId: next.cameraId,
                micId: next.micId,
                speakerId: next.speakerId,
              })
            }
            idPrefix="settings"
          />
        </section>

        {/* Profile & Appearance */}
        <div className="space-y-6">
          <section className="space-y-4 rounded-2xl border bg-card p-5">
            <h2 className="font-display text-lg font-semibold">
              Profile & Appearance
            </h2>
            <div className="space-y-1.5">
              <Label htmlFor="pref-name">Default display name</Label>
              <div className="flex gap-2">
                <Input
                  id="pref-name"
                  value={prefs.name}
                  onChange={(e) => setEdits((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Your name in class"
                />
                <Button variant="outline" onClick={saveName}>
                  Save
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3">
              <div>
                <p className="text-sm font-medium">Theme</p>
                <p className="text-xs text-muted-foreground">
                  Switch between warm paper light and deep chalkboard dark mode.
                </p>
              </div>
              <ThemeToggle />
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3">
              <div>
                <Label htmlFor="pref-blur">Default background blur</Label>
                <p className="text-xs text-muted-foreground">
                  Start new classes with background blur enabled.
                </p>
              </div>
              <Switch
                id="pref-blur"
                checked={blurOn}
                onCheckedChange={(v) => patchPrefs({ blurOn: v })}
              />
            </div>
          </section>
        </div>
      </div>

      <p className="pt-2 text-center text-xs text-muted-foreground">
        Built by Nihal Pawar
      </p>
    </div>
  )
}
