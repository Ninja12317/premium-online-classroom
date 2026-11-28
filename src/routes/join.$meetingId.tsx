import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  Mic,
  MicOff,
  Settings2,
  Video,
  VideoOff,
  KeyRound,
  Clock,
  Sparkles,
  DoorClosed,
} from 'lucide-react'

import { SiteHeader } from '@/components/site-header'
import { BackButton } from '@/components/back-button'
import { DeviceSettings } from '@/components/device-settings'
import { MediaError } from '@/components/media-error'
import { AvatarBubble } from '@/components/avatar-bubble'
import { displayName, useIdentity } from '@/components/identity-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { getMeeting } from '@/lib/meetings.functions'
import { normalizeMeetingId } from '@/lib/meeting'
import type { MeetingSummary } from '@/lib/meeting-types'
import { useAttachStream, useLocalMedia } from '@/lib/use-local-media'
import { useSpeaking } from '@/lib/use-speaking'
import {
  savePrefs,
  useJoinPrefs,
  type JoinPrefs,
} from '@/lib/prefs'
import { useUserProfile } from '@/lib/profile'
import { useClientValue } from '@/lib/use-client-value'
import { loadHostKey } from '@/lib/host-keys'
import { useMounted } from '@/lib/use-mounted'
import { cn } from '@/lib/utils'
import { ensureAuth } from '@/services/firebase'

type LobbyMeeting = MeetingSummary & { youAreHost: boolean }

export const Route = createFileRoute('/join/$meetingId')({
  loader: async ({ params }) => {
    try {
      const id = normalizeMeetingId(params.meetingId) ?? params.meetingId
      return await getMeeting({ data: { meetingId: id } })
    } catch {
      return null
    }
  },
  head: ({ loaderData }) => ({
    meta: loaderData ? [{ title: `Join ${loaderData.title} · Lectern` }] : [],
  }),
  component: Lobby,
})

function Lobby() {
  const initialMeeting = Route.useLoaderData()
  const { meetingId: rawMeetingId } = Route.useParams()
  const meetingId = normalizeMeetingId(rawMeetingId) ?? rawMeetingId
  const navigate = useNavigate()
  const mounted = useMounted()
  const { user, authStatus, ready, signInAsGuest } = useIdentity()

  const [meeting, setMeeting] = useState<LobbyMeeting | null>(initialMeeting)
  const [loadingMeeting, setLoadingMeeting] = useState(!initialMeeting)
  const [joiningGuest, setJoiningGuest] = useState(false)

  // Client-side fetch runs in parallel with Firebase Auth warmup so clicking Join is instant.
  useEffect(() => {
    void ensureAuth().catch(() => {})
    if (initialMeeting) return
    let active = true
    Promise.allSettled([ensureAuth(), getMeeting({ data: { meetingId } })])
      .then(([, res]) => {
        if (active && res.status === 'fulfilled') setMeeting(res.value)
      })
      .finally(() => {
        if (active) setLoadingMeeting(false)
      })
    return () => {
      active = false
    }
  }, [meetingId, initialMeeting])

  const stored = useJoinPrefs()
  const profile = useUserProfile()
  const hostKey = useClientValue(() => loadHostKey(meetingId), null)
  const [edits, setEdits] = useState<Partial<JoinPrefs>>({})
  const [passcode, setPasscode] = useState('')
  const [blurPreview, setBlurPreview] = useState(false)

  const isLoggedOut = ready && authStatus === 'loggedOut'
  const prefs: JoinPrefs = {
    ...stored,
    ...edits,
    name:
      edits.name ??
      (isLoggedOut
        ? ''
        : profile.displayName.trim() ||
          stored.name ||
          (ready && user ? displayName(user) : '')),
  }
  const setPrefs = (update: (p: JoinPrefs) => JoinPrefs) => {
    const next = update(prefs)
    setEdits((e) => ({ ...e, ...next }))
  }

  function handleBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
    } else {
      void navigate({ to: '/' })
    }
  }

  const isHost = !!hostKey || !!meeting?.youAreHost
  const media = useLocalMedia({
    micOn: prefs.micOn,
    camOn: prefs.camOn,
    cameraId: prefs.cameraId,
    micId: prefs.micId,
  })
  const { level } = useSpeaking(media.stream, prefs.micOn)
  const videoRef = useRef<HTMLVideoElement>(null)
  useAttachStream(videoRef, media.hasVideo ? media.stream : null)

  if (loadingMeeting) {
    return (
      <div className="min-h-svh bg-background">
        <SiteHeader />
        <main className="mx-auto grid max-w-content place-items-center px-4 py-24 text-center">
          <p className="text-sm text-muted-foreground">Loading class lobby…</p>
        </main>
      </div>
    )
  }

  if (!meeting) {
    return (
      <div className="min-h-svh bg-background">
        <SiteHeader />
        <div className="mx-auto max-w-content px-4 pt-4 sm:px-6">
          <BackButton onClick={handleBack} label="Back" />
        </div>
        <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-20 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <DoorClosed className="size-7" />
          </span>
          <h1 className="font-display text-2xl font-semibold">
            This class doesn’t exist
          </h1>
          <p className="text-sm text-muted-foreground">
            Double-check the invite link or meeting ID with your teacher.
          </p>
          <Button asChild>
            <Link to="/">Go home</Link>
          </Button>
        </main>
      </div>
    )
  }

  const name = prefs.name.trim()
  const canJoin =
    !joiningGuest &&
    name.length > 0 &&
    (!meeting.hasPasscode || isHost || passcode.trim().length > 0)

  async function join() {
    if (!canJoin) return
    setJoiningGuest(true)
    try {
      // Direct meeting link opened while logged out: establish an explicit Guest session smoothly.
      if (authStatus === 'loggedOut' || !user) {
        await signInAsGuest(name)
      }
      savePrefs({ ...prefs, name })
      try {
        if (passcode.trim())
          sessionStorage.setItem(
            `lectern-passcode:${meetingId}`,
            passcode.trim(),
          )
        if (blurPreview) {
          sessionStorage.setItem(`lectern-blur:${meetingId}`, '1')
        } else {
          sessionStorage.removeItem(`lectern-blur:${meetingId}`)
        }
      } catch {
        // ignore
      }
      await navigate({ to: '/meet/$meetingId', params: { meetingId } })
    } finally {
      setJoiningGuest(false)
    }
  }

  const ended = !!meeting.endedAt
  const scheduled = meeting.scheduledAt ? new Date(meeting.scheduledAt) : null

  return (
    <div className="min-h-svh bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-content px-4 pt-4 sm:px-6 lg:pt-6">
        <BackButton onClick={handleBack} label="Back" />
      </div>
      <main className="mx-auto grid max-w-content gap-8 px-4 pb-10 pt-4 sm:px-6 lg:grid-cols-[1.25fr_1fr] lg:items-start lg:py-8">
        <section
          aria-label="Camera preview"
          className="animate-fade-up motion-reduce:animate-none"
        >
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-stage-tile shadow-lg">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className={cn(
                'h-full w-full -scale-x-100 object-cover transition-opacity duration-300',
                media.hasVideo && prefs.camOn ? 'opacity-100' : 'opacity-0',
                blurPreview && 'blur-[6px] scale-[1.04]',
              )}
            />
            {(!media.hasVideo || !prefs.camOn) && (
              <div className="absolute inset-0 grid place-items-center">
                {media.pending && prefs.camOn ? (
                  <div className="h-20 w-20 animate-pulse rounded-full bg-stage-tile-foreground/10" />
                ) : (
                  <div className="flex flex-col items-center gap-3 text-stage-tile-foreground">
                    <AvatarBubble
                      name={name || 'You'}
                      seed={name || 'you'}
                      color={profile.avatarColor}
                      photo={profile.avatarPhoto}
                      className="size-20 text-2xl"
                    />
                    <span className="text-sm opacity-80">
                      {prefs.camOn ? 'Starting camera…' : 'Camera is off'}
                    </span>
                  </div>
                )}
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-gradient-to-t from-black/60 to-transparent p-4">
              <PreviewToggle
                on={prefs.micOn}
                onIcon={Mic}
                offIcon={MicOff}
                label={prefs.micOn ? 'Mute microphone' : 'Unmute microphone'}
                onClick={() => setPrefs((p) => ({ ...p, micOn: !p.micOn }))}
                level={level}
              />
              <PreviewToggle
                on={prefs.camOn}
                onIcon={Video}
                offIcon={VideoOff}
                label={prefs.camOn ? 'Turn camera off' : 'Turn camera on'}
                onClick={() => setPrefs((p) => ({ ...p, camOn: !p.camOn }))}
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label={blurPreview ? 'Disable video blur' : 'Enable video blur'}
                aria-pressed={blurPreview}
                onClick={() => setBlurPreview((b) => !b)}
                className={cn(
                  'size-11 rounded-full transition-colors',
                  blurPreview
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-white/15 text-white hover:bg-white/25',
                )}
              >
                <Sparkles className="size-5" />
              </Button>
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="size-11 rounded-full bg-white/15 text-white hover:bg-white/25"
                    aria-label="Audio and video settings"
                  >
                    <Settings2 className="size-5" />
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Audio and video</DialogTitle>
                    <DialogDescription>
                      Pick which devices to use in class.
                    </DialogDescription>
                  </DialogHeader>
                  <DeviceSettings
                    devices={media.devices}
                    value={{
                      cameraId: prefs.cameraId,
                      micId: prefs.micId,
                      speakerId: prefs.speakerId,
                    }}
                    onChange={(v) => setPrefs((p) => ({ ...p, ...v }))}
                    idPrefix="lobby"
                  />
                </DialogContent>
              </Dialog>
            </div>
          </div>
          {media.error && (
            <div className="mt-4">
              <MediaError kind={media.error} />
            </div>
          )}
        </section>

        <section className="animate-fade-up stagger-1 motion-reduce:animate-none rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="mb-6">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {meeting.startedAt && !ended && (
                <Badge className="gap-1 bg-live text-white hover:bg-live">
                  <span className="size-1.5 rounded-full bg-white animate-pulse-dot" />{' '}
                  In progress
                </Badge>
              )}
              {isHost && <Badge variant="secondary">Teacher · Host</Badge>}
              {!isHost && user?.role === 'student' && (
                <Badge variant="secondary">Student</Badge>
              )}
              {!isHost && (isLoggedOut || user?.isGuest) && (
                <Badge variant="secondary">Joining as Guest</Badge>
              )}
              {ended && <Badge variant="outline">Ended</Badge>}
            </div>
            <h1 className="font-display text-2xl font-semibold leading-tight sm:text-3xl">
              {meeting.title}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Hosted by {meeting.hostName} · ID{' '}
              <span className="font-mono">{meeting.meetingId}</span>
            </p>
            {scheduled && mounted && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="size-3.5" />
                {scheduled.toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}{' '}
                · {meeting.durationMin} min
              </p>
            )}
          </div>

          {ended ? (
            <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
              This class has ended. Ask your teacher for a new link.
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void join()
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label htmlFor="join-name">Your name</Label>
                <Input
                  id="join-name"
                  value={prefs.name}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, name: e.target.value }))
                  }
                  placeholder="How others will see you"
                  maxLength={60}
                  autoComplete="name"
                  required
                />
              </div>
              {meeting.hasPasscode && !isHost && (
                <div className="space-y-1.5">
                  <Label
                    htmlFor="join-passcode"
                    className="flex items-center gap-1.5"
                  >
                    <KeyRound className="size-3.5" /> Passcode
                  </Label>
                  <Input
                    id="join-passcode"
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    inputMode="numeric"
                    placeholder="6-digit code from your teacher"
                    maxLength={12}
                    required
                  />
                </div>
              )}
              <Button
                type="submit"
                size="lg"
                className="h-12 w-full text-base"
                disabled={!canJoin}
              >
                {isHost
                  ? meeting.startedAt
                    ? 'Rejoin class'
                    : 'Start class'
                  : 'Join class'}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                {isHost
                  ? 'Students wait in the waiting room until you admit them.'
                  : meeting.waitingRoom
                    ? 'Your teacher will let you in from the waiting room.'
                    : 'You will join as soon as you tap the button.'}
              </p>
            </form>
          )}
        </section>
      </main>
    </div>
  )
}

function PreviewToggle({
  on,
  onIcon: OnIcon,
  offIcon: OffIcon,
  label,
  onClick,
  level,
}: {
  on: boolean
  onIcon: typeof Mic
  offIcon: typeof Mic
  label: string
  onClick: () => void
  level?: number
}) {
  return (
    <Button
      type="button"
      size="icon"
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'relative size-11 rounded-full transition-colors',
        on
          ? 'bg-white/15 text-white hover:bg-white/25'
          : 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      )}
    >
      {on && level !== undefined && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full ring-2 ring-primary transition-opacity motion-reduce:transition-none"
          style={{ opacity: Math.min(1, level * 2.5) }}
        />
      )}
      {on ? <OnIcon className="size-5" /> : <OffIcon className="size-5" />}
    </Button>
  )
}
