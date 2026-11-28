import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import {
  BookOpen,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronRight,
  Copy,
  Download,
  Film,
  GraduationCap,
  KeyRound,
  LogIn,
  MessageSquare,
  Mic,
  MicOff,
  Pencil,
  Play,
  PlusSquare,
  RefreshCw,
  Search,
  SendHorizonal,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  Video,
  VideoOff,
} from 'lucide-react'
import { toast } from 'sonner'

import type { AuthModalMode } from '@/components/auth-modal'
import { AvatarBubble } from '@/components/avatar-bubble'
import { BackButton } from '@/components/back-button'
import { DeviceSettings } from '@/components/device-settings'
import { displayName, useIdentity } from '@/components/identity-provider'
import { MediaError } from '@/components/media-error'
import type { ChatMessage } from '@/components/meeting/types'
import { Whiteboard } from '@/components/meeting/whiteboard/whiteboard'
import { WhiteboardGallery } from '@/components/meeting/whiteboard/whiteboard-picker'
import { useBackNavigationGuard } from '@/lib/use-back-navigation-guard'
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
import {
  isUpcomingScheduledMeeting,
  type MeetingSummary,
} from '@/lib/meeting-types'
import {
  patchStoredPrefs,
  savePrefs,
  useJoinPrefs,
  type JoinPrefs,
} from '@/lib/prefs'
import { statusMeta, useUserProfile } from '@/lib/profile'
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
  onBack,
  onEdit,
  onDelete,
  onRefresh,
  onStartWithPmi,
  onSchedule,
  onOpenJoin,
  onOpenAuth,
}: {
  meetings: DashboardMeeting[]
  onBack?: () => void
  onEdit: (m: DashboardMeeting) => void
  onDelete: (meetingId: string) => void
  onRefresh: () => void
  onStartWithPmi?: () => void
  onSchedule?: () => void
  onOpenJoin?: () => void
  onOpenAuth?: (mode: AuthModalMode) => void
}) {
  const { user, authStatus, role } = useIdentity()
  const profile = useUserProfile()
  const mounted = useMounted()
  const [search, setSearch] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [copiedPmi, setCopiedPmi] = useState(false)
  const isTeacher = authStatus === 'authenticated' && role === 'teacher'
  const teacherPmi = isTeacher ? user?.pmi || profile.pmi || '' : ''

  function copyTeacherPmi() {
    if (!teacherPmi) return
    void navigator.clipboard.writeText(teacherPmi).then(() => {
      setCopiedPmi(true)
      toast.success(`Copied PMI: ${teacherPmi}`)
      window.setTimeout(() => setCopiedPmi(false), 2000)
    })
  }
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return meetings
    return meetings.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.meetingId.toLowerCase().includes(q),
    )
  }, [meetings, search])

  const selectedMeeting = detailId
    ? (meetings.find((m) => m.meetingId === detailId) ?? null)
    : null

  const upcoming = filtered
    .filter((m) => isUpcomingScheduledMeeting(m))
    .sort((a, b) => {
      const ta = a.scheduledAt ? Date.parse(a.scheduledAt) : Infinity
      const tb = b.scheduledAt ? Date.parse(b.scheduledAt) : Infinity
      return ta - tb
    })
  const past = filtered.filter((m) => m.status === 'ended' || Boolean(m.endedAt))

  if (selectedMeeting) {
    const invite = [
      `Join "${selectedMeeting.title}" on Lectern: ${meetingUrl(selectedMeeting.meetingId)}`,
      `Meeting ID: ${selectedMeeting.meetingId}`,
      selectedMeeting.passcode
        ? `Passcode: ${selectedMeeting.passcode}`
        : '',
    ]
      .filter(Boolean)
      .join('\n')

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <BackButton
            onClick={() => setDetailId(null)}
            label="Meetings"
          />
          <h1 className="truncate font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            {selectedMeeting.title}
          </h1>
        </div>

        <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            {selectedMeeting.startedAt && !selectedMeeting.endedAt && (
              <Badge className="gap-1 bg-live text-white hover:bg-live">
                <span className="size-1.5 rounded-full bg-white animate-pulse-dot" />{' '}
                Live
              </Badge>
            )}
            {selectedMeeting.endedAt && (
              <Badge variant="outline">Ended</Badge>
            )}
            {selectedMeeting.waitingRoom && (
              <Badge variant="secondary">Waiting room enabled</Badge>
            )}
          </div>

          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl border bg-muted/40 p-3">
              <dt className="text-xs font-medium text-muted-foreground">
                Schedule
              </dt>
              <dd className="mt-1 font-medium text-foreground">
                {mounted && selectedMeeting.scheduledAt
                  ? new Date(selectedMeeting.scheduledAt).toLocaleString(
                      undefined,
                      {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      },
                    )
                  : 'Open class, no fixed time'}{' '}
                · {selectedMeeting.durationMin} min
              </dd>
            </div>
            <div className="rounded-xl border bg-muted/40 p-3">
              <dt className="text-xs font-medium text-muted-foreground">
                Meeting ID & Passcode
              </dt>
              <dd className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-sm font-medium text-foreground">
                <span>{selectedMeeting.meetingId}</span>
                {selectedMeeting.passcode && (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <KeyRound className="size-3.5" /> {selectedMeeting.passcode}
                  </span>
                )}
              </dd>
            </div>
          </dl>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {!selectedMeeting.endedAt && (
              <Button asChild size="sm" className="gap-1.5">
                <Link
                  to="/join/$meetingId"
                  params={{ meetingId: selectedMeeting.meetingId }}
                >
                  <Video className="size-4" /> Start class
                </Link>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                void navigator.clipboard
                  .writeText(invite)
                  .then(() => toast.success('Invite copied'))
              }}
            >
              <Copy className="size-3.5" /> Copy invite
            </Button>
            {!selectedMeeting.endedAt && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => onEdit(selectedMeeting)}
              >
                <Pencil className="size-3.5" /> Edit
              </Button>
            )}
            {selectedMeeting.scheduledAt && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() =>
                  downloadTextFile(
                    `${selectedMeeting.title.replace(/[^\w-]+/g, '_')}.ics`,
                    buildIcs({
                      title: selectedMeeting.title,
                      startsAt: new Date(selectedMeeting.scheduledAt!),
                      durationMin: selectedMeeting.durationMin,
                      meetingId: selectedMeeting.meetingId,
                      passcode: selectedMeeting.passcode ?? undefined,
                    }),
                    'text/calendar',
                  )
                }
              >
                <CalendarDays className="size-3.5" /> Export calendar
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto gap-1.5 text-muted-foreground hover:text-destructive"
              onClick={() => {
                const id = selectedMeeting.meetingId
                setDetailId(null)
                onDelete(id)
              }}
            >
              <Trash2 className="size-3.5" /> Delete
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-start gap-3">
          {onBack && (
            <BackButton
              onClick={onBack}
              ariaLabel="Back"
              className="mt-0.5 md:hidden"
            />
          )}
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              Meetings
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage your upcoming scheduled classes and past sessions.
            </p>
          </div>
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
          {isTeacher ? (
            onSchedule ? (
              <Button size="sm" className="gap-1.5" onClick={onSchedule}>
                <CalendarPlus className="size-4" /> Schedule a class
              </Button>
            ) : (
              <ScheduleDialog
                onSaved={onRefresh}
                trigger={
                  <Button size="sm" className="gap-1.5">
                    <CalendarPlus className="size-4" /> Schedule a class
                  </Button>
                }
              />
            )
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {onSchedule && role !== 'student' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={onSchedule}
                >
                  <CalendarPlus className="size-4" /> Schedule a class
                </Button>
              )}
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => onOpenJoin?.()}
              >
                <PlusSquare className="size-4" /> Join a class
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Teacher Personal Meeting ID (PMI) Card */}
      {isTeacher && teacherPmi && (
        <section className="rounded-2xl border border-primary/20 bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className="gap-1 rounded-full px-2.5 py-0.5 text-[11px]"
                >
                  <GraduationCap className="size-3 text-primary" /> Personal
                  Meeting Room
                </Badge>
              </div>
              <p className="mt-2 font-mono text-xl font-semibold tracking-wide text-foreground">
                {teacherPmi}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Share this permanent room ID with students for office hours or
                recurring lessons.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {onStartWithPmi && (
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={onStartWithPmi}
                >
                  <Video className="size-4" /> Start with PMI
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={copyTeacherPmi}
              >
                {copiedPmi ? (
                  <>
                    <Check className="size-3.5 text-primary" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="size-3.5" /> Copy PMI
                  </>
                )}
              </Button>
            </div>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Upcoming meetings ({upcoming.length})
        </h2>
        {authStatus === 'loggedOut' ? (
          <div className="rounded-2xl border border-dashed bg-card/50 p-10 text-center text-sm text-muted-foreground">
            <p>
              Sign in as a Teacher to schedule and manage classes, or join any
              live class with a meeting ID.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => onOpenAuth?.('signin')}>
                Sign In
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenJoin?.()}
              >
                Join by Meeting ID
              </Button>
            </div>
          </div>
        ) : upcoming.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-card/50 p-10 text-center text-sm text-muted-foreground">
            {isTeacher
              ? 'No upcoming classes match your filter. Schedule one to get a permanent link.'
              : 'No classes listed yet. Use Join a class with your teacher’s link or meeting ID.'}
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((m) => (
              <li
                key={m.meetingId}
                className="flex flex-col rounded-2xl border bg-card p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setDetailId(m.meetingId)}
                    className="min-w-0 text-left font-semibold leading-snug hover:text-primary hover:underline underline-offset-4"
                  >
                    {m.title}
                  </button>
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

export function ChatTab({
  meetings,
  onBack,
}: {
  meetings: DashboardMeeting[]
  onBack?: () => void
}) {
  const { user, clientUid } = useIdentity()
  const profile = useUserProfile()
  const prefs = useJoinPrefs()
  const [selectedId, setSelectedId] = useState<string>(
    () => meetings[0]?.meetingId ?? '',
  )
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const activeId =
    selectedId && meetings.some((m) => m.meetingId === selectedId)
      ? selectedId
      : (meetings[0]?.meetingId ?? '')

  const resolvedAuthorName = user
    ? user.name ||
      profile.displayName.trim() ||
      prefs.name.trim() ||
      displayName(user) ||
      'Guest'
    : 'Guest'

  const chatKey = `${activeId}:${clientUid ?? ''}`
  const [seenChatKey, setSeenChatKey] = useState(chatKey)
  if (chatKey !== seenChatKey) {
    setSeenChatKey(chatKey)
    setMessages([])
  }

  useEffect(() => {
    if (!activeId || !clientUid) return
    return subscribeMeetingMessages(activeId, clientUid, setMessages)
  }, [activeId, clientUid])

  async function send(e: FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || !activeId) return
    setDraft('')
    await sendFirestoreMessage(activeId, {
      id: crypto.randomUUID(),
      authorId: clientUid || 'local',
      authorName: resolvedAuthorName,
      text,
      at: Date.now(),
      kind: 'message',
    })
  }

  return (
    <div className="space-y-4">
      <div
        className={cn(
          'flex items-start gap-3',
          mobileThreadOpen && 'hidden lg:flex',
        )}
      >
        {onBack && (
          <BackButton
            onClick={onBack}
            ariaLabel="Back"
            className="mt-0.5 md:hidden"
          />
        )}
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Class Chat
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Persistent chat channels synced live with your Lectern classes.
          </p>
        </div>
      </div>

      {meetings.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">
          <MessageSquare className="mx-auto mb-2 size-8 opacity-40" />
          Start or schedule a class to unlock its persistent chat channel.
        </div>
      ) : (
        <div className="grid h-[70vh] min-h-[460px] overflow-hidden rounded-2xl border bg-card lg:grid-cols-[260px_1fr]">
          {/* Channel list: full width on mobile when not in a thread, sidebar on desktop */}
          <aside
            className={cn(
              'flex min-h-0 flex-col lg:border-r',
              mobileThreadOpen ? 'hidden lg:flex' : 'flex',
            )}
          >
            <div className="border-b px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Classrooms ({meetings.length})
            </div>
            <ul className="flex-1 divide-y overflow-y-auto scrollbar-thin">
              {meetings.map((m) => (
                <li key={m.meetingId}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(m.meetingId)
                      setMobileThreadOpen(true)
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3 py-3 text-left transition-colors',
                      activeId === m.meetingId
                        ? 'bg-primary/10 text-foreground'
                        : 'hover:bg-muted/60',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block w-full truncate text-sm font-medium">
                        {m.title}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {m.meetingId}
                      </span>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground lg:hidden" />
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {/* Conversation thread: shown on mobile only when a thread is open, always on desktop */}
          <div
            className={cn(
              'min-h-0 flex-col',
              mobileThreadOpen ? 'flex' : 'hidden lg:flex',
            )}
          >
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5 sm:px-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <BackButton
                  onClick={() => setMobileThreadOpen(false)}
                  ariaLabel="Back to classrooms"
                  className="lg:hidden"
                />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-sm">
                    {meetings.find((m) => m.meetingId === activeId)?.title}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {activeId}
                  </p>
                </div>
              </div>
              <Button asChild size="xs" variant="outline" className="shrink-0">
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
                messages.map((m) => {
                  const isMe = m.authorId === (clientUid || 'local')
                  return (
                    <div key={m.id} className="flex items-start gap-2.5">
                      <AvatarBubble
                        name={isMe ? resolvedAuthorName : m.authorName}
                        seed={m.authorId}
                        color={isMe ? profile.avatarColor : undefined}
                        photo={isMe ? profile.avatarPhoto : undefined}
                        className="size-8 text-xs"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {isMe ? resolvedAuthorName : m.authorName}
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
                  )
                })
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
              <Button
                type="submit"
                size="icon"
                disabled={!draft.trim()}
                aria-label="Send message"
              >
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
  onBack,
  onFullscreenChange,
}: {
  meetings: DashboardMeeting[]
  onBack?: () => void
  onFullscreenChange?: (fullscreen: boolean) => void
}) {
  const { user, role, clientUid } = useIdentity()
  const profile = useUserProfile()
  const prefs = useJoinPrefs()
  const [activeBoard, setActiveBoard] = useState<{
    scope:
      | { kind: 'board'; boardId: string }
      | { kind: 'meeting'; meetingId: string }
    title: string
  } | null>(null)

  const resolvedAuthorName = user
    ? user.name ||
      profile.displayName.trim() ||
      prefs.name.trim() ||
      displayName(user) ||
      'Guest'
    : 'Guest'

  const { releaseGuard: releaseBoardBackGuard } = useBackNavigationGuard(
    activeBoard !== null,
    'Use the Whiteboards back button to close this board',
  )

  useEffect(() => {
    onFullscreenChange?.(activeBoard !== null)
    return () => onFullscreenChange?.(false)
  }, [activeBoard, onFullscreenChange])

  if (activeBoard) {
    return (
      <div
        className="flex h-[calc(100dvh-5.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-h-[420px] flex-col gap-3 overscroll-none overscroll-x-none"
        style={{ overscrollBehavior: 'none', overscrollBehaviorX: 'none' }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <BackButton
              onClick={() => {
                releaseBoardBackGuard()
                setActiveBoard(null)
              }}
              label="Whiteboards"
              className="shrink-0"
            />
            <h1 className="truncate font-display text-lg font-semibold sm:text-xl">
              {activeBoard.title}
            </h1>
          </div>
          <Badge variant="secondary" className="shrink-0">
            Auto-saved
          </Badge>
        </div>
        <div className="relative min-h-0 flex-1 overscroll-none overscroll-x-none">
          <Whiteboard
            canDraw
            isTeacher={role === 'teacher'}
            author={clientUid || 'guest'}
            authorName={resolvedAuthorName}
            syncScope={activeBoard.scope}
            title={activeBoard.title}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start gap-3">
        {onBack && (
          <BackButton
            onClick={onBack}
            ariaLabel="Back"
            className="mt-0.5 md:hidden"
          />
        )}
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Infinite Whiteboards
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Infinite pan & zoom canvases that auto-save continuously and reopen
            in any class.
          </p>
        </div>
      </div>

      <WhiteboardGallery
        createdByName={resolvedAuthorName}
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

export function RecordingsTab({ onBack }: { onBack?: () => void }) {
  const { authStatus, clientUid, ready } = useIdentity()
  const activeUid =
    ready && (authStatus === 'authenticated' || authStatus === 'guest')
      ? clientUid
      : null
  const [items, setItems] = useState<StoredRecording[]>([])
  const [loading, setLoading] = useState(() => Boolean(activeUid))
  const [playing, setPlaying] = useState<{
    rec: StoredRecording
    url: string
  } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')

  const [seenRecUid, setSeenRecUid] = useState<string | null>(activeUid)
  if (activeUid !== seenRecUid) {
    setSeenRecUid(activeUid)
    setItems([])
    setLoading(Boolean(activeUid))
  }

  useEffect(() => {
    let active = true
    if (!activeUid) return
    void listRecordings(activeUid).then((r) => {
      if (!active) return
      setItems(r)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [activeUid])

  function openPlayer(rec: StoredRecording) {
    const url = URL.createObjectURL(rec.blob)
    setPlaying({ rec, url })
  }

  function closePlayer() {
    if (playing) URL.revokeObjectURL(playing.url)
    setPlaying(null)
  }

  async function remove(id: string) {
    await deleteRecording(id, activeUid)
    setItems((prev) => prev.filter((r) => r.id !== id))
    toast.success('Recording deleted')
  }

  async function saveRename(id: string) {
    if (renameVal.trim()) {
      await renameRecording(id, renameVal.trim(), activeUid)
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
      <div className="flex items-start gap-3">
        {onBack && (
          <BackButton
            onClick={onBack}
            ariaLabel="Back"
            className="mt-0.5 md:hidden"
          />
        )}
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Recordings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Local class recordings captured via MediaRecorder and stored
            privately in your browser.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading recordings…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">
          <Film className="mx-auto mb-2 size-8 opacity-40" />
          No recordings yet. Inside any meeting, open{' '}
          <strong>More → Record locally</strong> to save a class recording right
          here.
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
            <div className="flex items-center gap-2.5 pr-6">
              <BackButton
                onClick={closePlayer}
                ariaLabel="Back to recordings"
                className="size-10"
              />
              <div className="min-w-0">
                <DialogTitle className="truncate">
                  {playing?.rec.title}
                </DialogTitle>
                <DialogDescription>
                  {playing &&
                    `${new Date(playing.rec.createdAt).toLocaleString()} · ${formatDuration(playing.rec.durationSec)}`}
                </DialogDescription>
              </div>
            </div>
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

type SettingsSection = 'media' | 'profile' | 'defaults'

export function SettingsTab({
  onBack,
  onOpenAuth,
}: {
  onBack?: () => void
  onOpenAuth?: (mode: AuthModalMode) => void
}) {
  const {
    user,
    authStatus,
    role,
    isGuest,
    clientUid,
    updateAccountProfile,
    renameGuest,
    regeneratePmi,
  } = useIdentity()
  const profile = useUserProfile()
  const stored = useJoinPrefs()
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [extraDraft, setExtraDraft] = useState<string | null>(null)
  const [savingProfile, setSavingProfile] = useState(false)
  const [copiedPmi, setCopiedPmi] = useState(false)
  const [regeneratingPmi, setRegeneratingPmi] = useState(false)
  const [mobileSection, setMobileSection] = useState<SettingsSection | null>(
    null,
  )
  const videoRef = useRef<HTMLVideoElement>(null)

  const isTeacher = authStatus === 'authenticated' && role === 'teacher'
  const isStudent = authStatus === 'authenticated' && role === 'student'
  const teacherPmi = isTeacher ? user?.pmi || profile.pmi || '' : ''

  const resolvedName =
    nameDraft ??
    (user
      ? user.name || profile.displayName.trim() || stored.name || displayName(user)
      : '')
  const resolvedExtra =
    extraDraft ??
    (isStudent
      ? (user?.classOrRollNo ?? profile.classOrRollNo ?? '')
      : (user?.subjectOrInstitution ?? profile.subjectOrInstitution ?? ''))

  const prefs: JoinPrefs = {
    ...stored,
    name: resolvedName,
  }
  const blurOn = Boolean(prefs.blurOn)
  const currentStatus = statusMeta(profile.status)

  const media = useLocalMedia({
    micOn: prefs.micOn,
    camOn: prefs.camOn,
    cameraId: prefs.cameraId,
    micId: prefs.micId,
  })

  useAttachStream(videoRef, media.hasVideo ? media.stream : null)

  function patchPrefs(patch: Partial<JoinPrefs>) {
    patchStoredPrefs(patch)
  }

  async function saveProfileFields() {
    if (savingProfile) return
    const clean = resolvedName.trim()
    if (isGuest) {
      renameGuest(clean || 'Guest')
      setNameDraft(null)
      toast.success('Guest display name updated')
      return
    }
    setSavingProfile(true)
    try {
      await updateAccountProfile({
        displayName: clean || (isStudent ? 'Student' : 'Teacher'),
        ...(isStudent
          ? { classOrRollNo: resolvedExtra.trim() || undefined }
          : { subjectOrInstitution: resolvedExtra.trim() || undefined }),
      })
      savePrefs({ ...prefs, name: clean })
      setNameDraft(null)
      setExtraDraft(null)
      toast.success('Profile saved')
    } catch {
      toast.error('Could not save profile right now.')
    } finally {
      setSavingProfile(false)
    }
  }

  function copyPmi() {
    if (!teacherPmi) return
    void navigator.clipboard.writeText(teacherPmi).then(() => {
      setCopiedPmi(true)
      toast.success('Personal Meeting ID copied')
      window.setTimeout(() => setCopiedPmi(false), 2000)
    })
  }

  async function handleRegeneratePmi() {
    if (!isTeacher || regeneratingPmi) return
    setRegeneratingPmi(true)
    try {
      const next = await regeneratePmi()
      if (next) {
        toast.success(`New Personal Meeting ID: ${next}`)
      }
    } catch {
      toast.error('Could not regenerate Personal Meeting ID right now.')
    } finally {
      setRegeneratingPmi(false)
    }
  }

  const mediaCard = (
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
              color={user ? profile.avatarColor : undefined}
              photo={user ? profile.avatarPhoto : undefined}
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
  )

  const profileCard = (
    <section className="space-y-4 rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">
          Profile & Appearance
        </h2>
        {isTeacher && (
          <Badge variant="secondary" className="gap-1 rounded-full">
            <GraduationCap className="size-3 text-primary" /> Teacher
          </Badge>
        )}
        {isStudent && (
          <Badge variant="secondary" className="gap-1 rounded-full">
            <BookOpen className="size-3 text-primary" /> Student
          </Badge>
        )}
        {isGuest && (
          <Badge variant="outline" className="gap-1 rounded-full">
            <UserRound className="size-3" /> Guest
          </Badge>
        )}
      </div>

      {authStatus === 'loggedOut' || !user ? (
        <div className="rounded-xl border border-dashed bg-muted/30 p-4 text-sm">
          <p className="font-medium text-foreground">You’re not signed in</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Sign in with a Teacher or Student account to sync your profile and
            classes, or continue as a Guest.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="xs"
              className="gap-1.5"
              onClick={() => onOpenAuth?.('signin')}
            >
              <LogIn className="size-3.5" /> Sign In
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => onOpenAuth?.('teacher')}
            >
              Create Account
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => onOpenAuth?.('guest')}
            >
              Continue as Guest
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="pref-name">
              {isGuest ? 'Guest display name' : 'Default display name'}
            </Label>
            <div className="flex gap-2">
              <Input
                id="pref-name"
                value={prefs.name}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Your name in class"
                maxLength={60}
              />
              <Button
                type="button"
                variant="outline"
                disabled={savingProfile}
                onClick={() => void saveProfileFields()}
              >
                {savingProfile ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>

          {!isGuest && (
            <div className="space-y-1.5">
              <Label htmlFor="pref-extra">
                {isStudent ? 'Class / Roll No.' : 'Subject / Institution'}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="pref-extra"
                  value={resolvedExtra}
                  onChange={(e) => setExtraDraft(e.target.value)}
                  placeholder={
                    isStudent
                      ? 'e.g. Grade 10-A · Roll 14'
                      : 'e.g. Mathematics · St. Xavier’s'
                  }
                  maxLength={80}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={savingProfile}
                  onClick={() => void saveProfileFields()}
                >
                  Save
                </Button>
              </div>
            </div>
          )}

          {isGuest && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/30 p-3 text-xs">
              <span className="text-muted-foreground">
                Want to host classes or save your profile across devices?
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => onOpenAuth?.('signin')}
              >
                Sign In / Create Account
              </Button>
            </div>
          )}

          {isTeacher && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">
                  Personal Meeting ID
                </p>
                <p className="font-mono text-sm font-semibold text-foreground">
                  {teacherPmi || 'Generating…'}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={copyPmi}
                  disabled={!teacherPmi}
                  className="shrink-0 gap-1"
                >
                  {copiedPmi ? (
                    <>
                      <Check className="size-3 text-primary" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-3" /> Copy PMI
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => void handleRegeneratePmi()}
                  disabled={regeneratingPmi}
                  aria-label="Regenerate Personal Meeting ID"
                  className="shrink-0 gap-1"
                >
                  <RefreshCw
                    className={cn('size-3', regeneratingPmi && 'animate-spin')}
                  />
                  Regenerate
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex items-center justify-between rounded-xl border p-3">
        <div>
          <p className="text-sm font-medium">Theme</p>
          <p className="text-xs text-muted-foreground">
            Switch between warm paper light and deep chalkboard dark mode.
          </p>
        </div>
        <ThemeToggle />
      </div>
    </section>
  )

  const defaultsCard = (
    <section className="space-y-3 rounded-2xl border bg-card p-5">
      <h2 className="font-display text-lg font-semibold">
        Default Join Preferences
      </h2>
      <div className="flex items-center justify-between rounded-xl border p-3">
        <div>
          <Label htmlFor="pref-mute-join">Mute mic on join</Label>
          <p className="text-xs text-muted-foreground">
            Enter new classrooms with your microphone muted.
          </p>
        </div>
        <Switch
          id="pref-mute-join"
          checked={!prefs.micOn}
          onCheckedChange={(muted) => patchPrefs({ micOn: !muted })}
        />
      </div>
      <div className="flex items-center justify-between rounded-xl border p-3">
        <div>
          <Label htmlFor="pref-cam-join">Turn off camera on join</Label>
          <p className="text-xs text-muted-foreground">
            Enter new classrooms with your camera turned off.
          </p>
        </div>
        <Switch
          id="pref-cam-join"
          checked={!prefs.camOn}
          onCheckedChange={(off) => patchPrefs({ camOn: !off })}
        />
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
  )

  const sectionLabels: Record<SettingsSection, string> = {
    media: 'Audio & Video',
    profile: 'Profile & Appearance',
    defaults: 'Join Defaults',
  }

  return (
    <div className="space-y-8">
      {/* Header (on mobile sub-section, shows back arrow to Settings overview) */}
      {mobileSection ? (
        <div className="flex items-center gap-3 lg:hidden">
          <BackButton
            onClick={() => setMobileSection(null)}
            label="Settings"
          />
          <h1 className="truncate font-display text-2xl font-semibold tracking-tight">
            {sectionLabels[mobileSection]}
          </h1>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          {onBack && (
            <BackButton
              onClick={onBack}
              ariaLabel="Back"
              className="mt-0.5 md:hidden"
            />
          )}
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              Settings
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Configure your camera, microphone, profile, and appearance.
            </p>
          </div>
        </div>
      )}

      {/* Desktop heading when mobileSection was selected before resize */}
      {mobileSection && (
        <div className="hidden lg:block">
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Settings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure your camera, microphone, profile, and appearance.
          </p>
        </div>
      )}

      {/* Mobile sub-section overview list (< 1024px) */}
      {!mobileSection && (
        <div className="space-y-2.5 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileSection('media')}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border bg-card p-4 text-left shadow-xs transition-colors hover:bg-muted/50"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Video className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-sm text-foreground">
                  Audio & Video
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  Camera preview, microphone, speaker & blur
                </p>
              </div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </button>

          <button
            type="button"
            onClick={() => setMobileSection('profile')}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border bg-card p-4 text-left shadow-xs transition-colors hover:bg-muted/50"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <UserRound className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-sm text-foreground">
                  Profile & Appearance
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {authStatus === 'loggedOut' || !user
                    ? 'Not signed in · Theme'
                    : isGuest
                      ? `${user.name || 'Guest'} · Guest`
                      : `${prefs.name || (isStudent ? 'Student' : 'Teacher')} · ${isStudent ? 'Student' : 'Teacher'} · ${currentStatus.label}`}
                </p>
              </div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </button>

          <button
            type="button"
            onClick={() => setMobileSection('defaults')}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border bg-card p-4 text-left shadow-xs transition-colors hover:bg-muted/50"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <SlidersHorizontal className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-sm text-foreground">
                  Default Join Preferences
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  Mic {prefs.micOn ? 'on' : 'muted'} · Camera{' '}
                  {prefs.camOn ? 'on' : 'off'} on join
                </p>
              </div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </div>
      )}

      {/* Mobile active sub-section (< 1024px) */}
      {mobileSection && (
        <div className="lg:hidden">
          {mobileSection === 'media' && mediaCard}
          {mobileSection === 'profile' && profileCard}
          {mobileSection === 'defaults' && defaultsCard}
        </div>
      )}

      {/* Desktop full 2-column grid (>= 1024px) */}
      <div className="hidden gap-6 lg:grid lg:grid-cols-2">
        {mediaCard}
        <div className="space-y-6">
          {profileCard}
          {defaultsCard}
        </div>
      </div>

      <p className="pt-2 text-center text-xs text-muted-foreground">
        Built by Nihal Pawar
      </p>
    </div>
  )
}
