import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  Clock,
  Copy,
  Film,
  KeyRound,
  MessageSquare,
  MonitorUp,
  Pencil,
  PenTool,
  PlusSquare,
  ShieldCheck,
  Trash2,
  Video,
} from 'lucide-react'
import { toast } from 'sonner'

import { AuthModal, type AuthModalMode } from '@/components/auth-modal'
import { BackButton } from '@/components/back-button'
import {
  ChatTab,
  MeetingsTab,
  RecordingsTab,
  SettingsTab,
  WhiteboardsTab,
  type DashboardMeeting,
} from '@/components/dashboard-tabs'
import {
  displayName,
  useIdentity,
  type LecternUser,
} from '@/components/identity-provider'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  HOST_AUTH_REQUIRED_NOTICE,
  isAuthRequiredError,
  isRegisteredUser,
  type PendingHostAction,
} from '@/lib/auth-gate'
import {
  deleteMeeting,
  listMyMeetings,
  startInstantMeeting,
} from '@/lib/meetings.functions'
import { isUpcomingScheduledMeeting } from '@/lib/meeting-types'
import { useJoinPrefs } from '@/lib/prefs'
import { useUserProfile } from '@/lib/profile'
import { useMounted } from '@/lib/use-mounted'
import { auth } from '@/services/firebase'
import { subscribeUserMeetings } from '@/services/firestore-meetings'

export const Route = createFileRoute('/')({
  component: HomeDashboard,
})

function HomeDashboard() {
  const { user, authStatus, role, ready, clientUid } = useIdentity()
  const profile = useUserProfile()
  const prefs = useJoinPrefs()
  const navigate = useNavigate()
  const mounted = useMounted()

  const [activeTab, setActiveTab] = useState<DashboardTab>('home')
  const [tabHistory, setTabHistory] = useState<DashboardTab[]>([])
  const [meetings, setMeetings] = useState<DashboardMeeting[]>([])
  const [loadingMeetings, setLoadingMeetings] = useState(false)
  const [starting, setStarting] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [joinValue, setJoinValue] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [editingMeeting, setEditingMeeting] = useState<DashboardMeeting | null>(
    null,
  )
  const [whiteboardFullscreen, setWhiteboardFullscreen] = useState(false)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>('signin')
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  const [authHideGuest, setAuthHideGuest] = useState(false)
  const [pendingReturnAction, setPendingReturnAction] =
    useState<PendingHostAction | null>(null)
  const [clock, setClock] = useState(() => new Date())

  const isTeacher = authStatus === 'authenticated' && role === 'teacher'
  const isStudent = authStatus === 'authenticated' && role === 'student'
  const teacherPmi = isTeacher ? user?.pmi || profile.pmi || '' : ''

  const resolvedHostName = user
    ? user.name ||
      profile.displayName.trim() ||
      prefs.name.trim() ||
      displayName(user) ||
      undefined
    : undefined

  const openAuthModal = useCallback(
    (
      mode: AuthModalMode,
      opts?: {
        notice?: string | null
        hideGuestOption?: boolean
        returnAction?: PendingHostAction | null
      },
    ) => {
      setAuthModalMode(mode)
      setAuthNotice(opts?.notice ?? null)
      setAuthHideGuest(Boolean(opts?.hideGuestOption))
      setPendingReturnAction(opts?.returnAction ?? null)
      setAuthModalOpen(true)
    },
    [],
  )

  const handleTabChange = useCallback(
    (next: DashboardTab) => {
      if (next === activeTab) return
      setTabHistory((prev) => [...prev.slice(-19), activeTab])
      setActiveTab(next)
    },
    [activeTab],
  )

  const handleBackTab = useCallback(() => {
    if (tabHistory.length === 0) {
      setActiveTab('home')
      return
    }
    const nextTab = tabHistory[tabHistory.length - 1]
    setTabHistory((prev) => prev.slice(0, -1))
    setActiveTab(nextTab)
  }, [tabHistory])

  // Honor cross-route deep link hint (e.g. clicking "All Settings" from the pre-join lobby)
  useEffect(() => {
    try {
      const requested = sessionStorage.getItem('lectern-open-tab')
      if (
        requested &&
        [
          'home',
          'meetings',
          'chat',
          'whiteboards',
          'recordings',
          'settings',
        ].includes(requested)
      ) {
        sessionStorage.removeItem('lectern-open-tab')
        queueMicrotask(() => setActiveTab(requested as DashboardTab))
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    const t = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const activeProfileUid =
    ready && (authStatus === 'authenticated' || authStatus === 'guest')
      ? clientUid || user?.id || null
      : null

  const refreshMeetings = useCallback(async () => {
    if (!activeProfileUid) {
      setMeetings([])
      setLoadingMeetings(false)
      return
    }
    try {
      const list = await listMyMeetings()
      setMeetings(list ?? [])
    } catch {
      // Non-blocking error handling
    } finally {
      setLoadingMeetings(false)
    }
  }, [activeProfileUid])

  const [seenProfileUid, setSeenProfileUid] = useState<string | null>(
    activeProfileUid,
  )
  if (activeProfileUid !== seenProfileUid) {
    setSeenProfileUid(activeProfileUid)
    setMeetings([])
    setLoadingMeetings(Boolean(activeProfileUid))
  }

  // Real-time UID-scoped Firestore listener: immediately clears on logout or UID switch
  useEffect(() => {
    if (!ready || !activeProfileUid) return
    const unsub = subscribeUserMeetings(activeProfileUid, (list) => {
      setMeetings(list)
      setLoadingMeetings(false)
    })
    return () => {
      unsub()
    }
  }, [ready, activeProfileUid])

  function requireRegisteredHost(action: PendingHostAction, overrideUser?: LecternUser | null): boolean {
    const activeUser = overrideUser ?? user
    if (!isRegisteredUser(activeUser) || !isRegisteredUser(auth.currentUser)) {
      toast.info(HOST_AUTH_REQUIRED_NOTICE)
      openAuthModal('signin', {
        notice: HOST_AUTH_REQUIRED_NOTICE,
        hideGuestOption: true,
        returnAction: action,
      })
      return false
    }
    if (activeUser?.role === 'student') {
      toast.info('Switch to a Teacher account to host a live class.')
      openAuthModal('teacher', {
        notice: HOST_AUTH_REQUIRED_NOTICE,
        hideGuestOption: true,
        returnAction: action,
      })
      return false
    }
    return true
  }

  async function startNewMeeting(
    mode: 'instant' | 'pmi' = 'instant',
    overrideUser?: LecternUser | null,
  ) {
    const action: PendingHostAction =
      mode === 'pmi' ? 'new-meeting-pmi' : 'new-meeting'
    if (!requireRegisteredHost(action, overrideUser)) return
    if (starting) return
    setStarting(true)
    try {
      const effectiveUser = overrideUser ?? user
      const hostName =
        effectiveUser?.name ||
        resolvedHostName ||
        profile.displayName.trim() ||
        undefined
      const effectivePmi = effectiveUser?.pmi || teacherPmi
      const result = await startInstantMeeting({
        data: {
          title: mode === 'pmi' ? 'Personal Meeting Room' : 'Live class',
          hostName,
          waitingRoom: true,
          customMeetingId:
            mode === 'pmi' && effectivePmi ? effectivePmi : undefined,
        },
      })
      saveHostKey(result.meetingId, result.hostKey)
      await navigate({
        to: '/join/$meetingId',
        params: { meetingId: result.meetingId },
      })
    } catch (err) {
      if (isAuthRequiredError(err)) {
        toast.info(HOST_AUTH_REQUIRED_NOTICE)
        openAuthModal('signin', {
          notice: HOST_AUTH_REQUIRED_NOTICE,
          hideGuestOption: true,
          returnAction: action,
        })
      } else {
        toast.error('Could not start a class right now. Please try again.')
      }
      setStarting(false)
    }
  }

  function handleOpenSchedule(overrideUser?: LecternUser | null) {
    if (!requireRegisteredHost('schedule', overrideUser)) return
    setEditingMeeting(null)
    setScheduleOpen(true)
  }

  function handleAuthSuccess(account: LecternUser) {
    const action = pendingReturnAction
    setPendingReturnAction(null)
    setAuthNotice(null)
    setAuthHideGuest(false)
    if (!action || !isRegisteredUser(account)) return
    if (action === 'schedule') {
      handleOpenSchedule(account)
    } else if (action === 'new-meeting') {
      void startNewMeeting('instant', account)
    } else if (action === 'new-meeting-pmi') {
      void startNewMeeting('pmi', account)
    }
  }

  function handleCopyPmi() {
    if (!teacherPmi) return
    void navigator.clipboard
      .writeText(teacherPmi)
      .then(() => toast.success(`Copied PMI: ${teacherPmi}`))
  }

  function handleJoinSubmit(event: FormEvent) {
    event.preventDefault()
    const id = parseMeetingInput(joinValue)
    if (!id) {
      setJoinError(
        'Paste an invite link or enter a meeting ID like LEC-4829-7315.',
      )
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
        .filter((m) => isUpcomingScheduledMeeting(m))
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
        (m) =>
          m.scheduledAt &&
          Date.parse(m.scheduledAt) >= clock.getTime() - 30 * 60_000,
      ) ??
      upcoming[0] ??
      null,
    [upcoming, clock],
  )

  const todaysClassCount = useMemo(() => {
    const todayKey = clock.toDateString()
    return upcoming.filter(
      (m) => m.scheduledAt && new Date(m.scheduledAt).toDateString() === todayKey,
    ).length
  }, [upcoming, clock])

  const hasLiveClass = useMemo(
    () => upcoming.some((m) => Boolean(m.startedAt && !m.endedAt)),
    [upcoming],
  )

  return (
    <div
      className={
        whiteboardFullscreen
          ? 'min-h-svh bg-background'
          : 'min-h-svh bg-background pb-24 md:pb-0'
      }
    >
      <SiteHeader activeTab={activeTab} onTabChange={handleTabChange} />

      <main className="relative">
        {activeTab === 'home' && (
          <>
            <section className="relative overflow-hidden">
              <div
                className="paper-grid pointer-events-none absolute inset-0 -z-10"
                aria-hidden
              />
              <div className="mx-auto max-w-content px-4 py-6 sm:px-6 sm:py-8">
                {/* Editorial Lectern Hero */}
                <div className="relative mb-6 overflow-hidden rounded-2xl border border-border/80 bg-card/95 px-5 py-5 shadow-xs sm:px-7 sm:py-6">
                  <div
                    className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_100%_at_92%_10%,var(--primary),transparent_72%)] opacity-15 dark:opacity-25"
                    aria-hidden
                  />
                  <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
                    <div className="max-w-2xl space-y-2.5">
                      <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                        <span className="size-1.5 rounded-full bg-live animate-pulse-dot motion-reduce:animate-none" />
                        <span>Interactive Classroom &amp; Meeting Studio</span>
                      </div>
                      <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl lg:text-[2rem] lg:leading-[1.15]">
                        Your classroom,{' '}
                        <span className="text-primary">one link away.</span>
                      </h1>
                      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
                        Live video sessions, real-time infinite whiteboards, and
                        seamless classroom collaboration in one quiet workspace.
                      </p>
                    </div>

                    <div
                      aria-label="Workspace overview"
                      className="hidden shrink-0 items-center divide-x divide-border/80 rounded-xl border border-border/80 bg-background/80 px-5 py-3.5 shadow-2xs backdrop-blur-sm lg:flex"
                    >
                      <div className="pr-5">
                        <div className="flex items-center gap-2">
                          <span className="size-2 rounded-full bg-live animate-pulse-dot motion-reduce:animate-none" />
                          <span className="font-display text-base font-semibold tracking-tight text-foreground">
                            {hasLiveClass ? 'In Session' : 'Studio Ready'}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Video · Whiteboard
                        </p>
                      </div>
                      <div className="pl-5">
                        <p className="font-display text-base font-semibold tabular-nums tracking-tight text-foreground">
                          {mounted ? todaysClassCount : 0}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {mounted && todaysClassCount === 1
                            ? 'Class today'
                            : 'Classes today'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Zoom-ergonomics Dashboard Grid styled 100% with Lectern tokens */}
                <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
                  {/* Left: Role-Aware Quick-Action Tiles */}
                  <div className="space-y-6">
                    {!isStudent ? (
                      <div className="grid grid-cols-2 gap-3.5 sm:gap-4">
                        {/* New Meeting primary hero card spanning full width so Join + Schedule pair cleanly below */}
                        <div className="relative col-span-2 flex flex-col justify-between rounded-2xl border border-primary/20 bg-primary text-primary-foreground shadow-md shadow-primary/15 transition-all hover:bg-primary/95">
                          <button
                            type="button"
                            disabled={starting}
                            onClick={() => void startNewMeeting('instant')}
                            className="flex flex-1 flex-col items-start justify-between gap-4 rounded-2xl p-5 text-left disabled:opacity-60 sm:flex-row sm:items-center sm:p-6"
                          >
                            <div className="flex items-start gap-4 sm:items-center">
                              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary-foreground/15 text-primary-foreground">
                                <Video className="size-5" />
                              </span>
                              <div className={isTeacher ? 'pr-8 sm:pr-10' : undefined}>
                                <span className="block font-display text-lg font-semibold leading-tight sm:text-xl">
                                  {starting ? 'Preparing room…' : 'New Meeting'}
                                </span>
                                <span className="mt-1 block text-xs text-primary-foreground/80 sm:text-sm">
                                  Start an instant live class right now
                                </span>
                              </div>
                            </div>
                          </button>
                          {isTeacher && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  aria-label="New meeting options and Personal Meeting ID"
                                  className="absolute right-3.5 top-3.5 grid size-8 place-items-center rounded-lg bg-primary-foreground/15 text-primary-foreground transition-colors hover:bg-primary-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground sm:right-4 sm:top-1/2 sm:-translate-y-1/2"
                                >
                                  <ChevronDown className="size-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                className="w-64 rounded-xl"
                              >
                                <DropdownMenuItem
                                  onClick={() => void startNewMeeting('instant')}
                                >
                                  <Video className="size-4 text-primary" />
                                  Start Instant Meeting
                                </DropdownMenuItem>
                                {teacherPmi && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <div className="px-2 py-1.5">
                                      <p className="text-[11px] font-medium text-muted-foreground">
                                        Personal Meeting ID
                                      </p>
                                      <p className="font-mono text-xs font-semibold text-foreground">
                                        {teacherPmi}
                                      </p>
                                    </div>
                                    <DropdownMenuItem
                                      onClick={() => void startNewMeeting('pmi')}
                                    >
                                      <Video className="size-4 text-primary" />
                                      Start with PMI
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={handleCopyPmi}>
                                      <Copy className="size-4 text-muted-foreground" />
                                      Copy Personal Meeting ID
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>

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
                          onClick={() => handleOpenSchedule()}
                        />
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3.5 sm:gap-4">
                        <QuickActionCard
                          icon={PlusSquare}
                          title="Join Meeting"
                          description="Enter a meeting ID or invite link"
                          primary
                          onClick={() => {
                            setJoinError(null)
                            setJoinOpen(true)
                          }}
                        />
                        <QuickActionCard
                          icon={PenTool}
                          title="My Whiteboards"
                          description="Open infinite canvases & collaborate"
                          onClick={() => handleTabChange('whiteboards')}
                        />
                        <QuickActionCard
                          icon={MessageSquare}
                          title="Class Chat"
                          description="Catch up on classroom messages"
                          onClick={() => handleTabChange('chat')}
                        />
                        <QuickActionCard
                          icon={Film}
                          title="Recordings"
                          description="Replay saved local class recordings"
                          onClick={() => handleTabChange('recordings')}
                        />
                      </div>
                    )}
                  </div>

                  {/* Right: Live Clock Card + Upcoming Scheduled Meetings */}
                  <div className="space-y-4">
                    {/* Live Clock Card */}
                    <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-stage p-5 text-foreground shadow-sm">
                      <div
                        className="pointer-events-none absolute inset-0 opacity-20 dark:opacity-35"
                        style={{
                          background:
                            'radial-gradient(circle at 85% 20%, var(--primary), transparent 65%)',
                        }}
                      />
                      <div className="relative flex items-start justify-between gap-4">
                        <div>
                          <p className="font-display text-4xl font-semibold tabular-nums tracking-tight text-foreground sm:text-5xl">
                            {mounted
                              ? clock.toLocaleTimeString(undefined, {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })
                              : '--:--'}
                            <span className="ml-1.5 text-lg font-normal text-foreground/65 dark:text-foreground/70">
                              {mounted
                                ? clock.toLocaleTimeString(undefined, {
                                    second: '2-digit',
                                  })
                                : ''}
                            </span>
                          </p>
                          <p className="mt-1 text-sm font-medium text-foreground/75 dark:text-foreground/80">
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
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/12 text-primary dark:border-white/10 dark:bg-white/10 dark:text-foreground">
                          <Clock className="size-5" />
                        </span>
                      </div>
                      {nextScheduled && (
                        <div className="relative mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-card/85 px-3.5 py-2.5 text-xs text-foreground shadow-2xs backdrop-blur-sm dark:border-white/10 dark:bg-white/10 dark:text-foreground">
                          <div className="min-w-0">
                            <span className="text-muted-foreground dark:text-foreground/75">
                              Up next:{' '}
                            </span>
                            <span className="font-semibold text-foreground">
                              {nextScheduled.title}
                            </span>
                            {mounted && nextScheduled.scheduledAt && (
                              <span className="ml-1.5 text-muted-foreground dark:text-foreground/80">
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
                              {isTeacher ? 'Start' : 'Join'}
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
                            {isStudent
                              ? 'Your upcoming classroom sessions.'
                              : 'Start, copy invite, edit, or delete anytime.'}
                          </p>
                        </div>
                        {!isStudent && (
                          <Button
                            size="xs"
                            variant="outline"
                            className="gap-1"
                            onClick={() => handleOpenSchedule()}
                          >
                            <CalendarPlus className="size-3.5" /> Schedule
                          </Button>
                        )}
                      </div>

                      {!ready || loadingMeetings ? (
                        <div className="space-y-2">
                          <Skeleton className="h-20 rounded-xl" />
                          <Skeleton className="h-20 rounded-xl" />
                        </div>
                      ) : upcoming.length === 0 ? (
                        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                          {isStudent ? (
                            <>
                              No classes scheduled today. Select Join Meeting to
                              enter a live room.
                            </>
                          ) : (
                            <>
                              No upcoming classes scheduled yet. Click{' '}
                              <button
                                type="button"
                                className="font-medium text-primary underline underline-offset-4"
                                onClick={() => handleOpenSchedule()}
                              >
                                Schedule
                              </button>{' '}
                              to create one.
                            </>
                          )}
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
                                        ? new Date(
                                            m.scheduledAt,
                                          ).toLocaleString(undefined, {
                                            weekday: 'short',
                                            month: 'short',
                                            day: 'numeric',
                                            hour: 'numeric',
                                            minute: '2-digit',
                                          })
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
                                    <Video className="size-3.5" />{' '}
                                    {isTeacher ? 'Start' : 'Join'}
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
                                {isTeacher && (
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
                                )}
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
                                {isTeacher && (
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
                                )}
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
                          onClick={() => handleTabChange('meetings')}
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
              onBack={handleBackTab}
              onEdit={(m) => {
                setEditingMeeting(m)
                setScheduleOpen(true)
              }}
              onDelete={(id) => void handleDeleteMeeting(id)}
              onRefresh={() => void refreshMeetings()}
              onStartWithPmi={() => void startNewMeeting('pmi')}
              onSchedule={() => handleOpenSchedule()}
              onOpenJoin={() => {
                setJoinError(null)
                setJoinOpen(true)
              }}
              onOpenAuth={openAuthModal}
            />
          </div>
        )}

        {activeTab === 'chat' && (
          <div className="mx-auto max-w-content px-4 py-8 sm:px-6">
            <ChatTab meetings={meetings} onBack={handleBackTab} />
          </div>
        )}

        {activeTab === 'whiteboards' && (
          <div className="mx-auto max-w-content px-4 py-6 sm:px-6">
            <WhiteboardsTab
              meetings={meetings}
              onBack={handleBackTab}
              onFullscreenChange={setWhiteboardFullscreen}
            />
          </div>
        )}

        {activeTab === 'recordings' && (
          <div className="mx-auto max-w-content px-4 py-8 sm:px-6">
            <RecordingsTab onBack={handleBackTab} />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="mx-auto max-w-content px-4 py-8 sm:px-6">
            <SettingsTab onBack={handleBackTab} onOpenAuth={openAuthModal} />
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
        <MobileBottomNav activeTab={activeTab} onTabChange={handleTabChange} />
      )}

      {/* Controlled Schedule / Edit Meeting Dialog */}
      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        editing={editingMeeting}
        onSaved={() => void refreshMeetings()}
        onAuthRequired={() => {
          setScheduleOpen(false)
          toast.info(HOST_AUTH_REQUIRED_NOTICE)
          openAuthModal('signin', {
            notice: HOST_AUTH_REQUIRED_NOTICE,
            hideGuestOption: true,
            returnAction: 'schedule',
          })
        }}
      />

      {/* Unified Auth Modal (Teacher, Student & Guest) */}
      <AuthModal
        open={authModalOpen}
        onOpenChange={(open) => {
          setAuthModalOpen(open)
          if (!open) {
            setAuthNotice(null)
            setAuthHideGuest(false)
            setPendingReturnAction(null)
          }
        }}
        initialMode={authModalMode}
        notice={authNotice}
        hideGuestOption={authHideGuest}
        onAuthenticated={handleAuthSuccess}
      />

      {/* Join Meeting Dialog */}
      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2.5 pr-6">
              <BackButton
                onClick={() => setJoinOpen(false)}
                ariaLabel="Back to dashboard"
                className="size-10 sm:hidden"
              />
              <div>
                <DialogTitle>Join a class</DialogTitle>
                <DialogDescription>
                  Paste an invite link or enter the meeting ID (such as
                  LEC-4829-7315) shared by your teacher.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <form onSubmit={handleJoinSubmit} className="space-y-4">
            <Input
              autoFocus
              value={joinValue}
              onChange={(e) => {
                setJoinValue(e.target.value)
                if (joinError) setJoinError(null)
              }}
              placeholder="e.g. LEC-4829-7315 or full invite URL"
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
