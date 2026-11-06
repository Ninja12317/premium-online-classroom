import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Link,
  createFileRoute,
  notFound,
  useNavigate,
} from '@tanstack/react-router'
import {
  Clock,
  DoorClosed,
  Hourglass,
  KeyRound,
  LogOut,
  UserX,
  WifiOff,
} from 'lucide-react'

import { Brand } from '@/components/brand'
import { ThemeToggle } from '@/components/theme-toggle'
import { AvatarBubble } from '@/components/avatar-bubble'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  MeetingRoom,
  type LeaveReason,
} from '@/components/meeting/meeting-room'
import { useMeshAdapter } from '@/components/meeting/use-mesh-adapter'
import {
  getHostDetails,
  getMeeting,
  joinMeeting,
  type JoinResult,
} from '@/lib/meetings.functions'
import type { IceServer, MeetingSummary, Role } from '@/lib/meeting-types'
import {
  clearParticipant,
  loadHostKey,
  loadParticipant,
  saveParticipant,
} from '@/lib/host-keys'
import { loadPrefsCached, type JoinPrefs } from '@/lib/prefs'
import { useClientValue } from '@/lib/use-client-value'

export const Route = createFileRoute('/meet/$meetingId')({
  loader: async ({ params }) => {
    const meeting = await getMeeting({ data: { meetingId: params.meetingId } })
    if (!meeting) throw notFound()
    return meeting
  },
  head: ({ loaderData }) => ({
    meta: loaderData ? [{ title: `${loaderData.title} · Lectern` }] : [],
  }),
  component: MeetPage,
})

type Phase =
  | { kind: 'joining' }
  | { kind: 'result'; result: JoinResult }
  | { kind: 'left'; reason: LeaveReason; meeting: MeetingSummary }

function MeetPage() {
  const { meetingId } = Route.useParams()
  const navigate = useNavigate()
  const prefs = useClientValue<JoinPrefs | null>(loadPrefsCached, null)
  const [phase, setPhase] = useState<Phase>({ kind: 'joining' })
  const [passcode, setPasscode] = useState('')
  const [hostPasscode, setHostPasscode] = useState<string | null>(null)
  const hostKeyRef = useRef<string | null>(null)

  const join = useCallback(
    async (p: JoinPrefs, code?: string) => {
      const stored = loadParticipant(meetingId)
      const hostKey = hostKeyRef.current
      try {
        const result = await joinMeeting({
          data: {
            meetingId,
            name: p.name,
            passcode: code || undefined,
            hostKey: hostKey ?? undefined,
            identity: stored?.identity,
            participantKey: stored?.participantKey,
          },
        })
        if (result.status === 'joined' || result.status === 'waiting') {
          saveParticipant(meetingId, {
            identity: result.identity,
            participantKey: result.participantKey,
          })
        } else if (
          result.status === 'rejected' ||
          result.status === 'removed'
        ) {
          clearParticipant(meetingId)
        }
        setPhase({ kind: 'result', result })
      } catch {
        setPhase({ kind: 'result', result: { status: 'not-found' } })
      }
    },
    [meetingId],
  )

  // Boot: once lobby preferences are readable, attempt to join (or send them to the lobby).
  useEffect(() => {
    if (!prefs) return
    if (!prefs.name.trim()) {
      void navigate({
        to: '/join/$meetingId',
        params: { meetingId },
        replace: true,
      })
      return
    }
    hostKeyRef.current = loadHostKey(meetingId)
    let code: string | undefined
    try {
      code =
        sessionStorage.getItem(`lectern-passcode:${meetingId}`) ?? undefined
    } catch {
      // ignore
    }
    void join(prefs, code)
  }, [prefs, meetingId, navigate, join])

  // Waiting room: poll until admitted or turned away.
  useEffect(() => {
    if (phase.kind !== 'result' || phase.result.status !== 'waiting' || !prefs)
      return
    const t = window.setInterval(() => void join(prefs), 2500)
    return () => window.clearInterval(t)
  }, [phase, prefs, join])

  // Hosts see the passcode in the details panel.
  useEffect(() => {
    if (
      phase.kind !== 'result' ||
      phase.result.status !== 'joined' ||
      phase.result.role !== 'host'
    )
      return
    const key = phase.result.participantKey
    getHostDetails({ data: { meetingId, hostKey: key } })
      .then((d) => setHostPasscode(d.passcode))
      .catch(() => {})
  }, [phase, meetingId])

  const onLeft = useCallback(
    (reason: LeaveReason) => {
      setPhase((current) => {
        const meeting =
          current.kind === 'result' && current.result.status !== 'not-found'
            ? current.result.meeting
            : current.kind === 'left'
              ? current.meeting
              : null
        if (!meeting) return current
        if (reason === 'removed' || reason === 'ended')
          clearParticipant(meetingId)
        return { kind: 'left', reason, meeting }
      })
    },
    [meetingId],
  )

  if (phase.kind === 'joining' || !prefs) {
    return (
      <Screen
        icon={Hourglass}
        title="Joining the class…"
        subtitle="Checking your invitation."
        busy
      />
    )
  }

  if (phase.kind === 'left') {
    return (
      <LeftScreen
        reason={phase.reason}
        meeting={phase.meeting}
        meetingId={meetingId}
      />
    )
  }

  const { result } = phase
  switch (result.status) {
    case 'not-found':
      return (
        <Screen
          icon={DoorClosed}
          title="This class doesn’t exist"
          subtitle="Check the link or meeting ID with your teacher."
        >
          <Button asChild>
            <Link to="/">Go home</Link>
          </Button>
        </Screen>
      )
    case 'ended':
      return (
        <Screen
          icon={Clock}
          title="This class has ended"
          subtitle={`${result.meeting.title} is over. Thanks for joining.`}
        >
          <Button asChild>
            <Link to="/">Go home</Link>
          </Button>
        </Screen>
      )
    case 'locked':
      return (
        <Screen
          icon={DoorClosed}
          title="The class is locked"
          subtitle="The teacher has locked the meeting. Ask them to unlock it, then try again."
        >
          <Button onClick={() => void join(prefs)}>Try again</Button>
        </Screen>
      )
    case 'rejected':
      return (
        <Screen
          icon={UserX}
          title="You weren’t admitted"
          subtitle="The teacher didn’t let you in this time. Check with them if you think this is a mistake."
        />
      )
    case 'removed':
      return (
        <Screen
          icon={UserX}
          title="You were removed from the class"
          subtitle="The teacher removed you from this meeting."
        />
      )
    case 'passcode-required':
      return (
        <Screen
          icon={KeyRound}
          title="Enter the passcode"
          subtitle={`${result.meeting.title} needs a passcode from your teacher.`}
        >
          <form
            className="flex w-full max-w-xs flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!passcode.trim()) return
              try {
                sessionStorage.setItem(
                  `lectern-passcode:${meetingId}`,
                  passcode.trim(),
                )
              } catch {
                // ignore
              }
              setPhase({ kind: 'joining' })
              void join(prefs, passcode.trim())
            }}
          >
            <Label htmlFor="pc" className="sr-only">
              Passcode
            </Label>
            <Input
              id="pc"
              autoFocus
              inputMode="numeric"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="6-digit passcode"
              aria-invalid={result.wrong}
            />
            {result.wrong && (
              <p role="alert" className="text-sm text-destructive">
                That passcode isn’t right. Try again.
              </p>
            )}
            <Button type="submit">Continue</Button>
          </form>
        </Screen>
      )
    case 'waiting':
      return (
        <Screen
          icon={Hourglass}
          title="You’re in the waiting room"
          subtitle={`${result.meeting.hostName} will let you in shortly. Keep this page open.`}
          busy
        >
          <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
            <AvatarBubble
              name={prefs.name}
              seed={result.identity}
              className="size-9 text-xs"
            />
            <div className="text-left">
              <p className="font-medium">{prefs.name}</p>
              <p className="text-muted-foreground">{result.meeting.title}</p>
            </div>
          </div>
          <Button variant="ghost" asChild>
            <Link to="/">Leave</Link>
          </Button>
        </Screen>
      )
    case 'joined':
      return (
        <LiveMeeting
          key={result.identity}
          iceServers={result.iceServers}
          prefs={prefs}
          meeting={result.meeting}
          role={result.role}
          identity={result.identity}
          actorKey={result.participantKey}
          passcode={hostPasscode}
          onLeft={onLeft}
        />
      )
  }
}

interface MeetingProps {
  prefs: JoinPrefs
  meeting: MeetingSummary
  role: Role
  identity: string
  actorKey: string
  passcode: string | null
  onLeft: (reason: LeaveReason) => void
}

function LiveMeeting({
  iceServers,
  prefs,
  meeting,
  role,
  ...rest
}: MeetingProps & { iceServers: IceServer[] }) {
  const adapter = useMeshAdapter({
    meetingId: meeting.meetingId,
    identity: rest.identity,
    participantKey: rest.actorKey,
    name: prefs.name,
    role,
    prefs,
    iceServers,
    initialSettings: meeting,
  })
  return (
    <MeetingRoom
      adapter={adapter}
      meeting={meeting}
      name={prefs.name}
      role={adapter.localRole}
      {...rest}
    />
  )
}

function LeftScreen({
  reason,
  meeting,
  meetingId,
}: {
  reason: LeaveReason
  meeting: MeetingSummary
  meetingId: string
}) {
  const copy: Record<
    LeaveReason,
    { icon: typeof LogOut; title: string; subtitle: string; rejoin: boolean }
  > = {
    left: {
      icon: LogOut,
      title: 'You left the class',
      subtitle: `${meeting.title} may still be running.`,
      rejoin: true,
    },
    ended: {
      icon: Clock,
      title: 'The class has ended',
      subtitle: 'Thanks for joining. See you next time.',
      rejoin: false,
    },
    removed: {
      icon: UserX,
      title: 'You were removed from the class',
      subtitle: 'The teacher removed you from this meeting.',
      rejoin: false,
    },
    duplicate: {
      icon: WifiOff,
      title: 'You joined from another tab',
      subtitle:
        'This class is open in another window, so this one was disconnected.',
      rejoin: true,
    },
    lost: {
      icon: WifiOff,
      title: 'Connection lost',
      subtitle: 'We couldn’t reconnect you to the class.',
      rejoin: true,
    },
  }
  const c = copy[reason]
  return (
    <Screen icon={c.icon} title={c.title} subtitle={c.subtitle}>
      <div className="flex flex-wrap justify-center gap-2">
        {c.rejoin && (
          <Button asChild>
            <Link to="/join/$meetingId" params={{ meetingId }}>
              Rejoin
            </Link>
          </Button>
        )}
        <Button asChild variant={c.rejoin ? 'outline' : 'default'}>
          <Link to="/">Go home</Link>
        </Button>
      </div>
    </Screen>
  )
}

function Screen({
  icon: Icon,
  title,
  subtitle,
  busy,
  children,
}: {
  icon: typeof LogOut
  title: string
  subtitle?: string
  busy?: boolean
  children?: React.ReactNode
}) {
  return (
    <main className="relative grid min-h-svh place-items-center px-4 py-12">
      <div
        className="paper-grid pointer-events-none absolute inset-0 -z-10"
        aria-hidden
      />
      <div className="absolute left-4 top-4">
        <Brand />
      </div>
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="animate-fade-up motion-reduce:animate-none flex w-full max-w-md flex-col items-center gap-5 text-center">
        <span
          className={`grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary ${busy ? 'animate-pulse motion-reduce:animate-none' : ''}`}
          aria-hidden
        >
          <Icon className="size-8" />
        </span>
        <div>
          <h1 className="font-display text-2xl font-semibold sm:text-3xl">
            {title}
          </h1>
          {subtitle && <p className="mt-2 text-muted-foreground">{subtitle}</p>}
        </div>
        {children}
      </div>
    </main>
  )
}
