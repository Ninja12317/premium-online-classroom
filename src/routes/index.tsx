import { useEffect, useState, type FormEvent } from 'react'
import {
  Link,
  createFileRoute,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import {
  ArrowRight,
  CalendarPlus,
  Copy,
  KeyRound,
  Link2,
  MonitorUp,
  PenTool,
  ShieldCheck,
  Trash2,
  Video,
  Users,
  CalendarDays,
} from 'lucide-react'
import { toast } from 'sonner'

import { SiteHeader } from '@/components/site-header'
import { ScheduleDialog } from '@/components/schedule-dialog'
import { displayName, useIdentity } from '@/components/identity-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  createMeeting,
  deleteMeeting,
  listMyMeetings,
} from '@/lib/meetings.functions'
import {
  buildIcs,
  downloadTextFile,
  meetingUrl,
  parseMeetingInput,
} from '@/lib/meeting'
import { saveHostKey } from '@/lib/host-keys'
import { useMounted } from '@/lib/use-mounted'

export const Route = createFileRoute('/')({
  loader: () => listMyMeetings(),
  component: Home,
})

function Home() {
  const myMeetings = Route.useLoaderData()
  const { user } = useIdentity()
  const navigate = useNavigate()
  const [starting, setStarting] = useState(false)
  const [joinValue, setJoinValue] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)

  async function startNow() {
    if (starting) return
    setStarting(true)
    try {
      const result = await createMeeting({
        data: { hostName: displayName(user) || undefined, waitingRoom: true },
      })
      saveHostKey(result.meetingId, result.hostKey)
      await navigate({
        to: '/join/$meetingId',
        params: { meetingId: result.meetingId },
      })
    } catch {
      toast.error('Could not start a class right now. Please try again.')
      setStarting(false)
    }
  }

  function join(event: FormEvent) {
    event.preventDefault()
    const id = parseMeetingInput(joinValue)
    if (!id) {
      setJoinError('Paste the invite link or type the 10-letter meeting ID.')
      return
    }
    setJoinError(null)
    void navigate({ to: '/join/$meetingId', params: { meetingId: id } })
  }

  return (
    <div className="min-h-svh bg-background">
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden">
          <div
            className="paper-grid pointer-events-none absolute inset-0 -z-10"
            aria-hidden
          />
          <div className="mx-auto grid max-w-content gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-24">
            <div className="animate-fade-up motion-reduce:animate-none">
              <Badge
                variant="secondary"
                className="mb-5 gap-1.5 rounded-full px-3 py-1"
              >
                <span className="size-1.5 rounded-full bg-live animate-pulse-dot" />
                Live classes, zero setup for students
              </Badge>
              <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
                Your classroom,
                <br />
                <span className="text-primary">one link away.</span>
              </h1>
              <p className="mt-5 max-w-reading text-lg text-muted-foreground">
                Lectern is a live video classroom built for teachers. Start a
                class in one click, share the link, and teach with video, screen
                share, a synced whiteboard and chat. Students join from any
                browser, no account needed.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  size="lg"
                  className="h-12 gap-2 px-6 text-base shadow-md shadow-primary/20"
                  onClick={() => void startNow()}
                  disabled={starting}
                >
                  <Video className="size-5" />
                  {starting ? 'Preparing your room…' : 'Start a class now'}
                </Button>
                <ScheduleDialog
                  trigger={
                    <Button
                      size="lg"
                      variant="outline"
                      className="h-12 gap-2 px-6 text-base"
                    >
                      <CalendarPlus className="size-5" />
                      Schedule a class
                    </Button>
                  }
                />
              </div>

              <form onSubmit={join} className="mt-6 max-w-lg" noValidate>
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
                      className="h-11 pl-9"
                      autoComplete="off"
                      aria-invalid={!!joinError}
                      aria-describedby={joinError ? 'join-error' : undefined}
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="secondary"
                    className="h-11 gap-1.5 px-4"
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

            <HeroPreview />
          </div>
        </section>

        <section className="mx-auto max-w-content px-4 pb-16 sm:px-6">
          <MyClasses meetings={myMeetings} signedIn={!!user} />
        </section>

        <section className="border-t bg-muted/40">
          <div className="mx-auto grid max-w-content gap-8 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            <Feature icon={Video} title="Real video and audio">
              Multi-participant video with active-speaker view, pinning,
              full-screen and device pickers.
            </Feature>
            <Feature icon={MonitorUp} title="Share your screen">
              Share your whole screen, a window or a tab. Students see it large
              and clear.
            </Feature>
            <Feature icon={PenTool} title="Synced whiteboard">
              Pen, shapes, text, pages, undo and export. Students follow along
              live; you decide who can draw.
            </Feature>
            <Feature icon={ShieldCheck} title="You stay in control">
              Waiting room, passcodes, lock, mute, remove, co-hosts and
              permissions, all one tap away.
            </Feature>
          </div>
        </section>
      </main>
      <footer className="mx-auto flex max-w-content flex-wrap items-center justify-between gap-2 px-4 py-8 text-sm text-muted-foreground sm:px-6">
        <span>Lectern, a live classroom for teachers.</span>
        <span>Works best in Chrome, Edge, Safari and Firefox.</span>
      </footer>
    </div>
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

/** Decorative stage illustration; nothing here is live data. */
function HeroPreview() {
  const tiles = [
    { label: 'You', hue: 160, big: true },
    { label: 'AO', hue: 300 },
    { label: 'PR', hue: 22 },
    { label: 'MR', hue: 205 },
    { label: 'LH', hue: 260 },
  ]
  return (
    <div
      aria-hidden
      className="animate-fade-up stagger-2 motion-reduce:animate-none relative mx-auto w-full max-w-xl rounded-2xl border bg-stage p-3 shadow-xl shadow-foreground/5"
    >
      <div className="mb-3 flex items-center justify-between px-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5 font-medium">
          <span className="size-2 rounded-full bg-live animate-pulse-dot" />{' '}
          Grade 10 Algebra
        </span>
        <span>24 in class · 00:12:41</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <div
            key={t.label}
            className={`relative aspect-video overflow-hidden rounded-xl bg-stage-tile ${t.big ? 'col-span-2 row-span-2 aspect-auto' : ''}`}
          >
            <div
              className="absolute inset-0 opacity-70"
              style={{
                background: `radial-gradient(circle at 30% 20%, oklch(0.6 0.12 ${t.hue} / .6), transparent 60%)`,
              }}
            />
            <span
              className="absolute left-1/2 top-1/2 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-sm font-semibold text-stage-tile-foreground"
              style={{ background: `oklch(0.5 0.12 ${t.hue})` }}
            >
              {t.label}
            </span>
            <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/40 px-1.5 py-0.5 text-[10px] text-white">
              {t.label}
            </span>
          </div>
        ))}
        <div className="relative aspect-video overflow-hidden rounded-xl border border-dashed border-border bg-background/60 p-2">
          <div className="absolute inset-x-2 top-2 h-1.5 w-2/3 rounded bg-primary/60" />
          <div className="absolute inset-x-2 top-5 h-1.5 w-1/2 rounded bg-amber/80" />
          <div className="absolute bottom-2 left-2 h-6 w-6 rounded-full border-2 border-primary/70" />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-center gap-2">
        {['Mic', 'Cam', 'Share', 'Board', 'Chat'].map((label) => (
          <span
            key={label}
            className="rounded-lg bg-background/80 px-2.5 py-1.5 text-[11px] font-medium shadow-sm"
          >
            {label}
          </span>
        ))}
        <span className="rounded-lg bg-destructive px-2.5 py-1.5 text-[11px] font-medium text-destructive-foreground">
          Leave
        </span>
      </div>
    </div>
  )
}

type MyMeeting = NonNullable<Awaited<ReturnType<typeof listMyMeetings>>>[number]

function MyClasses({
  meetings,
  signedIn,
}: {
  meetings: MyMeeting[] | null
  signedIn: boolean
}) {
  const router = useRouter()
  const mounted = useMounted()
  const { ready } = useIdentity()
  const [now] = useState(() => Date.now())

  // Refresh once the browser session is known: the SSR pass may have had no cookie.
  useEffect(() => {
    if (ready && signedIn && meetings === null) void router.invalidate()
  }, [ready, signedIn, meetings, router])

  if (!ready) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-36 rounded-2xl" />
        ))}
      </div>
    )
  }

  if (!signedIn) {
    return (
      <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border bg-card p-6 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-xl font-semibold">
            Keep your classes in one place
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to see scheduled classes here, reuse links, and start them
            from any device.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild>
            <Link to="/signup">Create a teacher account</Link>
          </Button>
        </div>
      </div>
    )
  }

  const list = meetings ?? []
  const upcoming = list
    .filter((m) => !m.endedAt)
    .sort((a, b) => {
      const ta = a.scheduledAt ? Date.parse(a.scheduledAt) : 0
      const tb = b.scheduledAt ? Date.parse(b.scheduledAt) : 0
      return ta - tb
    })
  const past = list.filter((m) => m.endedAt).slice(0, 6)

  async function remove(meetingId: string) {
    try {
      await deleteMeeting({ data: { meetingId } })
      toast.success('Class deleted')
      await router.invalidate()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not delete that class.',
      )
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-semibold">
              Your classes
            </h2>
            <p className="text-sm text-muted-foreground">
              Scheduled and open classes you can start any time.
            </p>
          </div>
          <ScheduleDialog
            trigger={
              <Button variant="outline" size="sm" className="gap-1.5">
                <CalendarPlus className="size-4" /> Schedule
              </Button>
            }
          />
        </div>
        {upcoming.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No upcoming classes yet. Start one now or schedule it for later.
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
                  {m.startedAt && !m.endedAt ? (
                    <Badge className="shrink-0 gap-1 bg-live text-white hover:bg-live">
                      <span className="size-1.5 rounded-full bg-white animate-pulse-dot" />{' '}
                      Live
                    </Badge>
                  ) : m.scheduledAt && Date.parse(m.scheduledAt) < now ? (
                    <Badge variant="secondary" className="shrink-0">
                      Ready
                    </Badge>
                  ) : null}
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
                    variant="ghost"
                    className="gap-1.5"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(meetingUrl(m.meetingId))
                        .then(() => toast.success('Invite link copied'))
                    }}
                  >
                    <Copy className="size-4" /> Link
                  </Button>
                  {m.scheduledAt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5"
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
                      <CalendarDays className="size-4" /> Calendar
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="ml-auto size-8 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${m.title}`}
                    onClick={() => void remove(m.meetingId)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {past.length > 0 && (
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Users className="size-4" /> Recent classes
          </h2>
          <ul className="divide-y rounded-2xl border bg-card">
            {past.map((m) => (
              <li
                key={m.meetingId}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <span className="truncate">{m.title}</span>
                <span className="shrink-0 text-muted-foreground">
                  {mounted && m.endedAt
                    ? new Date(m.endedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
