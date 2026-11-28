import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Clock,
  DoorClosed,
  Hourglass,
  KeyRound,
  LogOut,
  UserX,
  WifiOff,
} from 'lucide-react'

import { BackButton } from '@/components/back-button'
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
import { ScheduledCountdownScreen } from '@/components/meeting/scheduled-countdown'
import { useMeshAdapter } from '@/components/meeting/use-mesh-adapter'
import { normalizeMeetingId } from '@/lib/meeting'
import {
  getHostDetails,
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
import { ensureAuth } from '@/services/firebase'
import {
  subscribeMeetingDoc,
  subscribeParticipantDoc,
} from '@/services/firestore-meetings'

export const Route = createFileRoute('/meet/$meetingId')({
  // Non-blocking route entry: do not stall navigation on an extra sequential
  // Firestore round-trip before MeetPage runs parallel auth + join.
  loader: () => null,
  head: () => ({
    meta: [{ title: 'Class · Lectern' }],
  }),
  component: MeetPage,
})

type Phase =
  | { kind: 'joining' }
  | { kind: 'result'; result: JoinResult }
  | { kind: 'left'; reason: LeaveReason; meeting: MeetingSummary }

function MeetPage() {
  const { meetingId: rawMeetingId } = Route.useParams()
  const meetingId = normalizeMeetingId(rawMeetingId) ?? rawMeetingId
  const navigate = useNavigate()
  const [prefs, setPrefs] = useState<JoinPrefs | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'joining' })
  const [passcode, setPasscode] = useState('')
  const [hostPasscode, setHostPasscode] = useState<string | null>(null)
  const [joinedConfirmed, setJoinedConfirmed] = useState(false)
  const [autoStarting, setAutoStarting] = useState(false)
  const hostKeyRef = useRef<string | null>(null)
  const joinedIdentityRef = useRef<string | null>(null)
  const prefsRef = useRef<JoinPrefs | null>(null)

  const executeJoin = useCallback(
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
        if (result.status === 'joined') {
          if (typeof document !== 'undefined' && result.meeting.title) {
            document.title = `${result.meeting.title} · Lectern`
          }
          joinedIdentityRef.current = result.identity
          saveParticipant(meetingId, {
            activeMeetingId: meetingId,
            identity: result.identity,
            participantKey: result.participantKey,
            role: result.role,
            status: 'admitted',
            name: p.name,
          })
          setJoinedConfirmed(true)
        } else if (result.status === 'waiting') {
          joinedIdentityRef.current = result.identity
          saveParticipant(meetingId, {
            activeMeetingId: meetingId,
            identity: result.identity,
            participantKey: result.participantKey,
            role: 'student',
            status: 'waiting',
            name: p.name,
          })
          setJoinedConfirmed(true)
        } else if (
          result.status === 'rejected' ||
          result.status === 'removed'
        ) {
          clearParticipant(meetingId)
        }
        setPhase({ kind: 'result', result })
      } catch {
        // Never silently kick on a transient error if we already joined.
        setPhase((prev) =>
          prev.kind === 'result' && prev.result.status === 'joined'
            ? prev
            : { kind: 'result', result: { status: 'not-found' } },
        )
      }
    },
    [meetingId],
  )

  // Stable one-time parallel boot keyed ONLY on [meetingId].
  useEffect(() => {
    const loadedPrefs = loadPrefsCached()
    const stored = loadParticipant(meetingId)
    const resolvedName = loadedPrefs.name.trim() || stored?.name?.trim() || ''
    if (!resolvedName) {
      void navigate({
        to: '/join/$meetingId',
        params: { meetingId },
        replace: true,
      })
      return
    }
    const effectivePrefs: JoinPrefs = { ...loadedPrefs, name: resolvedName }
    prefsRef.current = effectivePrefs
    hostKeyRef.current = loadHostKey(meetingId)
    let code: string | undefined
    try {
      code =
        sessionStorage.getItem(`lectern-passcode:${meetingId}`) ?? undefined
    } catch {
      // ignore
    }
    void Promise.resolve().then(() => {
      setPrefs(effectivePrefs)
      return Promise.allSettled([
        ensureAuth(),
        executeJoin(effectivePrefs, code),
      ])
    })
  }, [meetingId, navigate, executeJoin])

  // Scheduled meeting not started yet: attach lightweight Firestore listener
  // on `meetings/{meetingId}` and auto-join the instant Host starts it.
  const notStartedId =
    phase.kind === 'result' && phase.result.status === 'not-started'
      ? phase.result.meeting.meetingId
      : null

  useEffect(() => {
    if (!notStartedId) return
    let active = true
    const unsub = subscribeMeetingDoc(meetingId, (summary) => {
      if (!active) return
      if (summary.endedAt || summary.status === 'ended') {
        setAutoStarting(false)
        setPhase({ kind: 'result', result: { status: 'ended', meeting: summary } })
        return
      }
      if (summary.status === 'live' && summary.hostStarted === true) {
        setAutoStarting(true)
        if (prefsRef.current) {
          void executeJoin(prefsRef.current)
        }
        return
      }
      setPhase((prev) =>
        prev.kind === 'result' && prev.result.status === 'not-started'
          ? {
              kind: 'result',
              result: { status: 'not-started', meeting: summary },
            }
          : prev,
      )
    })
    return () => {
      active = false
      unsub()
    }
  }, [meetingId, notStartedId, executeJoin])

  // Waiting room: listen via Firestore onSnapshot (plus gentle fallback poll)
  // keyed ONLY on [meetingId, waitingIdentity].
  const waitingIdentity =
    phase.kind === 'result' && phase.result.status === 'waiting'
      ? phase.result.identity
      : null

  useEffect(() => {
    if (!waitingIdentity || !joinedConfirmed) return
    let active = true
    const unsub = subscribeParticipantDoc(
      meetingId,
      waitingIdentity,
      (docData) => {
        if (!active || !prefsRef.current) return
        if (docData.status === 'admitted') {
          void executeJoin(prefsRef.current)
        } else if (
          docData.status === 'rejected' ||
          docData.status === 'removed'
        ) {
          clearParticipant(meetingId)
          setPhase((prev) =>
            prev.kind === 'result' && prev.result.status === 'waiting'
              ? {
                  kind: 'result',
                  result: {
                    status: docData.status as 'rejected' | 'removed',
                    meeting: prev.result.meeting,
                  },
                }
              : prev,
          )
        }
      },
    )
    const fallbackTimer = window.setInterval(() => {
      if (prefsRef.current) void executeJoin(prefsRef.current)
    }, 4000)
    return () => {
      active = false
      unsub()
      window.clearInterval(fallbackTimer)
    }
  }, [meetingId, waitingIdentity, joinedConfirmed, executeJoin])

  // Active meeting: once participant doc is confirmed, watch meeting ended/removal cleanly.
  const activeParticipantId =
    phase.kind === 'result' && phase.result.status === 'joined'
      ? phase.result.identity
      : null

  useEffect(() => {
    if (!activeParticipantId || !joinedConfirmed) return
    let active = true
    const unsubMeeting = subscribeMeetingDoc(meetingId, (summary) => {
      if (!active) return
      if (summary.endedAt || summary.status === 'ended') {
        clearParticipant(meetingId)
        setPhase({ kind: 'left', reason: 'ended', meeting: summary })
      }
    })
    const unsubMe = subscribeParticipantDoc(
      meetingId,
      activeParticipantId,
      (docData) => {
        if (!active) return
        if (docData.status === 'removed' || docData.status === 'rejected') {
          clearParticipant(meetingId)
          setPhase((prev) => {
            if (prev.kind === 'result' && prev.result.status === 'joined') {
              return {
                kind: 'left',
                reason: 'removed',
                meeting: prev.result.meeting,
              }
            }
            return prev
          })
        }
      },
    )
    return () => {
      active = false
      unsubMeeting()
      unsubMe()
    }
  }, [meetingId, activeParticipantId, joinedConfirmed])

  // Hosts see the passcode in the details panel.
  const hostRoleKey =
    phase.kind === 'result' &&
    phase.result.status === 'joined' &&
    phase.result.role === 'host'
      ? phase.result.participantKey
      : null

  useEffect(() => {
    if (!hostRoleKey) return
    getHostDetails({ data: { meetingId, hostKey: hostRoleKey } })
      .then((d) => setHostPasscode(d.passcode))
      .catch(() => {})
  }, [meetingId, hostRoleKey])

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
        if (reason === 'removed' || reason === 'ended' || reason === 'left') {
          clearParticipant(meetingId)
        }
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
    case 'not-started':
      return (
        <ScheduledCountdownScreen
          meeting={result.meeting}
          transitioning={autoStarting}
        />
      )
    case 'ended':
      return (
        <Screen
          icon={Clock}
          title="This class has ended"
          subtitle={`${result.meeting.title} is over. Thanks for joining.`}
        >
          <Button asChild>
            <Link to="/">Back to Home</Link>
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
          <Button onClick={() => void executeJoin(prefs)}>Try again</Button>
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
              void executeJoin(prefs, passcode.trim())
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

  // Apply blur preference picked in lobby once on mount.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(`lectern-blur:${meeting.meetingId}`) === '1') {
        adapter.setBlurOn?.(true)
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting.meetingId])

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
  const navigate = useNavigate()
  return (
    <main className="relative grid min-h-svh place-items-center px-4 py-12">
      <div
        className="paper-grid pointer-events-none absolute inset-0 -z-10"
        aria-hidden
      />
      <div className="absolute left-4 top-4 flex items-center gap-2.5">
        <BackButton
          onClick={() => void navigate({ to: '/' })}
          ariaLabel="Back to home"
        />
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
