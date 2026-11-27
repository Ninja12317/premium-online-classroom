import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  Clock,
  Copy,
  KeyRound,
  Link2,
  MonitorUp,
  Pencil,
  PenTool,
  PlusSquare,
  ShieldCheck,
  Trash2,
  Video,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  ChatTab,
  MeetingsTab,
  RecordingsTab,
  SettingsTab,
  WhiteboardsTab,
  type DashboardMeeting,
} from '@/components/dashboard-tabs'
import { displayName, useIdentity } from '@/components/identity-provider'
import { ScheduleDialog } from '@/components/schedule-dialog'
import {
  MobileBottomNav,
  SiteHeader,
  type DashboardTab,
} from '@/components/site-header'
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
import { Skeleton } from '@/components/ui/skeleton'
import { saveHostKey } from '@/lib/host-keys'
import {
  buildIcs,
  downloadTextFile,
  meetingUrl,
  parseMeetingInput,
} from '@/lib/meeting'
import {
  createMeeting,
  deleteMeeting,
  listMyMeetings,
} from '@/lib/meetings.functions'
import { useMounted } from '@/lib/use-mounted'

export const Route = createFileRoute('/')({
  component: HomeDashboard,
})

function HomeDashboard() {
  const { user, ready } = useIdentity()
  const navigate = useNavigate()
  const mounted = useMounted()

  const [activeTab, setActiveTab] = useState<DashboardTab>('home')
  const [meetings, setMeetings] = useState<DashboardMeeting[]>([])
  const [loadingMeetings, setLoadingMeetings] = useState(true)
  const [starting, setStarting] = useState(false)
  const [sharingStart, setSharingStart] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [joinValue, setJoinValue] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [editingMeeting, setEditingMeeting] = useState<DashboardMeeting | null>(
    null,
  )
  const [whiteboardFullscreen, setWhiteboardFullscreen] = useState(false)
  const [clock, setClock] = useState(() => new Date())

  useEffect(() => {
    const t = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const refreshMeetings = useCallback(async () => {
    try {
      const list = await listMyMeetings()
      setMeetings(list ?? [])
    } catch {
      // Non-blocking banner already shown on Firestore error
    } finally {
      setLoadingMeetings(false)
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    let active = true
    void listMyMeetings()
      .then((list) => {
        if (active) setMeetings(list ?? [])
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingMeetings(false)
      })
    return () => {
      active = false
    }
  }, [ready, user?.id])

  async function startNewMeeting(mode: 'instant' | 'share' = 'instant') {
    if (starting || sharingStart) return
    if (mode === 'share') setSharingStart(true)
    else setStarting(true)
    try {
      const result = await createMeeting({
        data: {
          title: mode === 'share' ? 'Screen share session' : 'Live class',
          hostName: displayName(user) || undefined,
          waitingRoom: mode === 'instant',
        },
      })
      saveHostKey(result.meetingId, result.hostKey)
      await navigate({
        to: '/join/$meetingId',
        params: { meetingId: result.meetingId },
      })
    } catch {
      toast.error('Could not start a class right now. Please try again.')
      setStarting(false)
      setSharingStart(false)
    }
  }

  function handleJoinSubmit(event: FormEvent) {
    event.preventDefault()
    const id = parseMeetingInput(joinValue)
    if (!id) {
      setJoinError('Paste the invite link or type the 10-letter meeting ID.')
      return
    }
    setJoinError(null)
    setJoinOpen(false)
    void navigate({ to: '/join/$meetingId', params: { meetingId: id } })
  }

  async function handleDeleteMeeting(meetingId: string) {
    setMeetings((prev) => prev.filter((m) => m.meetingId !== meetingId))
    try {
      await deleteMeeting({ data: { meetingId } })
      toast.success('Class deleted')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not delete that class.',
      )
      void refreshMeetings()
    }
  }

  const upcoming = useMemo(
    () =>
      meetings
        .filter((m) => !m.endedAt)
        .sort((a, b) => {
          const ta = a.scheduledAt ? Date.parse(a.scheduledAt) : Infinity
          const tb = b.scheduledAt ? Date.parse(b.scheduledAt) : Infinity
          return ta - tb
        }),
    [meetings],
  )

  const nextScheduled = useMemo(
    () =>
      upcoming.find(
        (m) => m.scheduledAt && Date.parse(m.scheduledAt) >= clock.getTime() - 30 * 60_000,
      ) ?? upcoming[0] ?? null,
    [upcoming, clock],
  )

  return (
    <div
      className={
        whiteboardFullscreen
          ? 'min-h-svh bg-background'
          : 'min-h-svh bg-background pb-24 md:pb-0'
      }
    >
      <SiteHeader activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="relative">
        {activeTab === 'home' && (
          <>
            <section className="relative overflow-hidden">
              <div
                className="paper-grid pointer-events-none absolute inset-0 -z-10"
                aria-hidden
              />
              <div className="mx-auto max-w-content px-4 py-10 sm:px-6 lg:py-14">
                {/* Headline preserving Lectern identity */}
                <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
                  <div className="animate-fade-up motion-reduce:animate-none">
                    <Badge
                      variant="secondary"
                      className="mb-3 gap-1.5 rounded-full px-3 py-1"
                    >
                      <span className="size-1.5 rounded-full bg-live animate-pulse-dot" />
                      Live classes, zero setup for students
                    </Badge>
                    <h1 className="font-display text-3xl font-semibold leading-[1.08] tracking-tight sm:text-4xl lg:text-5xl">
                      Your classroom,{' '}
                      <span className="text-primary">one link away.</span>
                    </h1>
                  </div>
                  <p className="max-w-md text-sm text-muted-foreground">
                    Start a class in one click, teach with video, screen share,
                    an infinite synced whiteboard, live polls, breakout rooms
                    and chat.
                  </p>
                </div>

                {/* Zoom-ergonomics Dashboard Grid styled 100% with Lectern tokens */}
                <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
                  {/* Left: 4 Quick-Action Tiles + Inline Student Join */}
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-3.5 sm:gap-4">
                      <QuickActionCard
                        icon={Video}
                        title={starting ? 'Preparing room…' : 'New Meeting'}
                        description="Start an instant live class right now"
                        primary
                        disabled={starting}
                        onClick={() => void startNewMeeting('instant')}
                      />
                      <QuickActionCard
                        icon={PlusSquare}
                        title="Join"
                        description="Enter a meeting ID or invite link"
                        onClick={() => {
                          setJoinError(null)
                          setJoinOpen(true)
                        }}
                      />
                      <QuickActionCard
                        icon={CalendarPlus}
                        title="Schedule"
                        description="Plan a class with permanent link & passcode"
                        onClick={() => {
                          setEditingMeeting(null)
                          setScheduleOpen(true)
                        }}
                      />
                      <QuickActionCard
                        icon={MonitorUp}
                        title={sharingStart ? 'Starting…' : 'Share Screen'}
                        description="Open a room ready to present immediately"
                        disabled={sharingStart}
                        onClick={() => void startNewMeeting('share')}
                      />
                    </div>

                    {/* Preserved direct Student Join bar */}
                    <form
                      onSubmit={handleJoinSubmit}
                      className="rounded-2xl border bg-card p-4 shadow-sm"
                      noValidate
                    >
                      <label
                        htmlFor="join-code"
                        className="mb-1.5 block text-sm font-medium"
                      >
                        Joining as a student?
                      </label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            id="join-code"
                            value={joinValue}
                            onChange={(e) => {
                              setJoinValue(e.target.value)
                              if (joinError) setJoinError(null)
                            }}
                            placeholder="Paste the class link or meeting ID"
                            className="h-10 pl-9"
                            autoComplete="off"
                            aria-invalid={!!joinError}
                            aria-describedby={
                              joinError ? 'join-error' : undefined
                            }
                          />
                        </div>
                        <Button
                          type="submit"
                          variant="secondary"
                          className="h-10 gap-1.5 px-4"
                        >
                          Join <ArrowRight className="size-4" />
                        </Button>
                      </div>
                      {joinError && (
                        <p
                          id="join-error"
                          role="alert"
                          className="mt-1.5 text-sm text-destructive"
                        >
                          {joinError}
                        </p>
                      )}
                    </form>
                  </div>

                  {/* Right: Live Clock Card + Upcoming Scheduled Meetings */}
                  <div className="space-y-4">
                    {/* Live Clock Card */}
                    <div className="relative overflow-hidden rounded-2xl border bg-stage p-5 text-stage-tile-foreground shadow-sm">
                      <div
                        className="pointer-events-none absolute inset-0 opacity-35"
                        style={{
                          background:
                            'radial-gradient(circle at 85% 20%, var(--primary), transparent 65%)',
                        }}
                      />
                      <div className="relative flex items-start justify-between gap-4">
                        <div>
                          <p className="font-display text-4xl font-semibold tabular-nums tracking-tight sm:text-5xl">
                            {mounted
                              ? clock.toLocaleTimeString(undefined, {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })
                              : '--:--'}
                            <span className="ml-1.5 text-lg font-normal opacity-70">
                              {mounted
                                ? clock.toLocaleTimeString(undefined, {
                                    second: '2-digit',
                                  })
                                : ''}
                            </span>
                          </p>
                          <p className="mt-1 text-sm opacity-80">
                            {mounted
                              ? clock.toLocaleDateString(undefined, {
                                  weekday: 'long',
                                  month: 'long',
                                  day: 'numeric',
                                  year: 'numeric',
                                })
                              : 'Loading date…'}
                          </p>
                        </div>
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10">
                          <Clock className="size-5" />
                        </span>
                      </div>
                      {nextScheduled && (
                        <div className="relative mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/10 px-3.5 py-2.5 text-xs backdrop-blur-sm">
                          <div className="min-w-0">
                            <span className="opacity-75">Up next: </span>
                            <span className="font-semibold">
                              {nextScheduled.title}
                            </span>
                            {mounted && nextScheduled.scheduledAt && (
                              <span className="ml-1.5 opacity-80">
                                ·{' '}
                                {new Date(
                                  nextScheduled.scheduledAt,
                                ).toLocaleTimeString(undefined, {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </span>
                            )}
                          </div>
                          <Button
                            asChild
                            size="xs"
                            className="bg-primary text-primary-foreground hover:bg-primary/90"
                          >
                            <Link
                              to="/join/$meetingId"
                              params={{ meetingId: nextScheduled.meetingId }}
                            >
                              Start
                            </Link>
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Upcoming Scheduled Meetings List */}
                    <div className="rounded-2xl border bg-card p-4 shadow-sm">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div>
                          <h2 className="font-display text-lg font-semibold">
                            Upcoming meetings
                          </h2>
                          <p className="text-xs text-muted-foreground">
                            Start, copy invite, edit, or delete anytime.
                          </p>
                        </div>
                        <Button
                          size="xs"
                          variant="outline"
                          className="gap-1"
                          onClick={() => {
                            setEditingMeeting(null)
                            setScheduleOpen(true)
                          }}
                        >
                          <CalendarPlus className="size-3.5" /> Schedule
                        </Button>
                      </div>

                      {loadingMeetings ? (
                        <div className="space-y-2">
                          <Skeleton className="h-20 rounded-xl" />
                          <Skeleton className="h-20 rounded-xl" />
                        </div>
                      ) : upcoming.length === 0 ? (
                        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                          No upcoming classes scheduled yet. Click{' '}
                          <button
                            type="button"
                            className="font-medium text-primary underline underline-offset-4"
                            onClick={() => {
                              setEditingMeeting(null)
                              setScheduleOpen(true)
                            }}
                          >
                            Schedule
                          </button>{' '}
                          to create one.
                        </div>
                      ) : (
                        <ul className="space-y-2.5">
                          {upcoming.slice(0, 5).map((m) => (
                            <li
                              key={m.meetingId}
                              className="rounded-xl border bg-background/60 p-3 transition-colors hover:bg-muted/40"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate font-semibold text-sm">
                                    {m.title}
                                  </p>
                                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                                    <span className="inline-flex items-center gap-1">
                                      <CalendarDays className="size-3" />
                                      {mounted && m.scheduledAt
                                        ? new Date(m.scheduledAt).toLocaleString(
                                            undefined,
                                            {
                                              weekday: 'short',
                                              month: 'short',
                                              day: 'numeric',
                                              hour: 'numeric',
                                              minute: '2-digit',
                                            },
                                          )
                                        : 'Open class'}
                                    </span>
                                    <span>· {m.durationMin} min</span>
                                    <span className="font-mono">
                                      {m.meetingId}
                                    </span>
                                    {m.passcode && (
                                      <span className="inline-flex items-center gap-0.5 font-mono">
                                        <KeyRound className="size-3" />{' '}
                                        {m.passcode}
                                      </span>
                                    )}
                                  </p>
                                </div>
                                {m.startedAt && !m.endedAt && (
                                  <Badge className="shrink-0 gap-1 bg-live text-white hover:bg-live">
                                    <span className="size-1.5 rounded-full bg-white animate-pulse-dot" />{' '}
                                    Live
                                  </Badge>
                                )}
                              </div>
                              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                                <Button asChild size="xs" className="gap-1">
                                  <Link
                                    to="/join/$meetingId"
                                    params={{ meetingId: m.meetingId }}
                                  >
                                    <Video className="size-3.5" /> Start
                                  </Link>
                                </Button>
                                <Button
                                  size="xs"
                                  variant="outline"
                                  className="gap-1"
                                  onClick={() => {
                                    const invite = [
                                      `Join "${m.title}" on Lectern: ${meetingUrl(m.meetingId)}`,
                                      `Meeting ID: ${m.meetingId}`,
                                      m.passcode
                                        ? `Passcode: ${m.passcode}`
                                        : '',
                                    ]
                                      .filter(Boolean)
                                      .join('\n')
                                    void navigator.clipboard
                                      .writeText(invite)
                                      .then(() =>
                                        toast.success('Invite copied'),
                                      )
                                  }}
                                >
                                  <Copy className="size-3" /> Copy Invite
                                </Button>
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  className="gap-1"
                                  onClick={() => {
                                    setEditingMeeting(m)
                                    setScheduleOpen(true)
                                  }}
                                >
                                  <Pencil className="size-3" /> Edit
                                </Button>
                                {m.scheduledAt && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="size-7"
                                    aria-label={`Download calendar invite for ${m.title}`}
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
                                  className="ml-auto size-7 text-muted-foreground hover:text-destructive"
                                  aria-label={`Delete ${m.title}`}
                                  onClick={() =>
                                    void handleDeleteMeeting(m.meetingId)
                                  }
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}

                      {upcoming.length > 5 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2 w-full"
                          onClick={() => setActiveTab('meetings')}
                        >
                          View all {upcoming.length} meetings
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="border-t bg-muted/40">
              <div className="mx-auto grid max-w-content gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
                <Feature icon={Video} title="Real video and audio">
                  Multi-participant video with speaker, gallery & side-by-side
                  views, pinning, spotlight, blur and device pickers.
                </Feature>
                <Feature icon={MonitorUp} title="Screen share & annotate">
                  Share your screen, window or tab and draw live annotations
                  right over your presentation.
                </Feature>
                <Feature icon={PenTool} title="Infinite whiteboard">
                  Infinite pan & zoom canvas with shapes, sticky notes,
                  templates, laser pointer, minimap and PNG/SVG/PDF export.
                </Feature>
                <Feature icon={ShieldCheck} title="Full classroom controls">
                  Waiting room, passcodes, security lock, live polls, breakout
                  rooms, live captions, notes and local recordings.
                </Feature>
              </div>
            </section>
          </>
        )}

        {activeTab === 'meetings' && (
          <div className="mx-auto max-w-content px-4 py-8 sm:px-6">
            <MeetingsTab
              meetings={meetings}
              onEdit={(m) => {
                setEditingMeeting(m)
                setScheduleOpen(true)
              }}
              onDelete={(id) => void handleDeleteMeeting(id)}
              onRefresh={() => void refreshMeetings()}
            />
          </div>
        )}

        {activeTab === 'chat' && (
          <div className="mx-auto max-w-content px-4 py-8 sm:px-6">
            <ChatTab meetings={meetings} />
          </div>
        )}

        {activeTab === 'whiteboards' && (
          <div className="mx-auto max-w-content px-4 py-6 sm:px-6">
            <WhiteboardsTab
              meetings={meetings}
              onFullscreenChange={setWhiteboardFullscreen}
            />
          </div>
        )}

        {activeTab === 'recordings' && (
          <div className="mx-auto max-w-content px-4 py-8 sm:px-6">
            <RecordingsTab />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="mx-auto max-w-content px-4 py-8 sm:px-6">
            <SettingsTab />
          </div>
        )}
      </main>

      {!whiteboardFullscreen && (
        <footer className="mx-auto flex max-w-content flex-wrap items-center justify-between gap-2 border-t px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <span>Lectern, a live classroom for teachers.</span>
          <span className="text-xs">Built by Nihal Pawar</span>
        </footer>
      )}

      {/* Mobile-only fixed bottom navigation (auto-hidden during full-screen whiteboard; never mounted in meetings/lobbies) */}
      {!whiteboardFullscreen && (
        <MobileBottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      )}

      {/* Controlled Schedule / Edit Meeting Dialog */}
      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        editing={editingMeeting}
        onSaved={() => void refreshMeetings()}
      />

      {/* Join Meeting Dialog */}
      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Join a class</DialogTitle>
            <DialogDescription>
              Paste the invite link or enter the 10-letter meeting ID shared by
              your teacher.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleJoinSubmit} className="space-y-4">
            <Input
              autoFocus
              value={joinValue}
              onChange={(e) => {
                setJoinValue(e.target.value)
                if (joinError) setJoinError(null)
              }}
              placeholder="e.g. abc-defg-hij or full invite URL"
            />
            {joinError && (
              <p role="alert" className="text-sm text-destructive">
                {joinError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setJoinOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="gap-1.5">
                Continue to lobby <ArrowRight className="size-4" />
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function QuickActionCard({
  icon: Icon,
  title,
  description,
  primary,
  disabled,
  onClick,
}: {
  icon: typeof Video
  title: string
  description: string
  primary?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        primary
          ? 'group flex flex-col items-start justify-between rounded-2xl border border-primary/20 bg-primary p-5 text-left text-primary-foreground shadow-md shadow-primary/15 transition-all hover:bg-primary/95 disabled:opacity-60'
          : 'group flex flex-col items-start justify-between rounded-2xl border bg-card p-5 text-left text-card-foreground shadow-sm transition-all hover:border-primary/40 hover:bg-muted/40 disabled:opacity-60'
      }
    >
      <span
        className={
          primary
            ? 'mb-4 grid size-11 place-items-center rounded-xl bg-primary-foreground/15 text-primary-foreground'
            : 'mb-4 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary'
        }
      >
        <Icon className="size-5" />
      </span>
      <div>
        <span className="block font-display text-lg font-semibold leading-tight">
          {title}
        </span>
        <span
          className={
            primary
              ? 'mt-1 block text-xs text-primary-foreground/80'
              : 'mt-1 block text-xs text-muted-foreground'
          }
        >
          {description}
        </span>
      </div>
    </button>
  )
}

function Feature({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Video
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="animate-fade-up motion-reduce:animate-none">
      <span className="mb-3 inline-grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-5" />
      </span>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  )
}
