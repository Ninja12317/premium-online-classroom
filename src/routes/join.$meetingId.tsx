import { useRef, useState } from 'react'
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import {
  Mic,
  MicOff,
  Settings2,
  Video,
  VideoOff,
  KeyRound,
  Clock,
} from 'lucide-react'

import { SiteHeader } from '@/components/site-header'
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
import { useAttachStream, useLocalMedia } from '@/lib/use-local-media'
import { useSpeaking } from '@/lib/use-speaking'
import {
  loadPrefsCached,
  savePrefs,
  type JoinPrefs,
  defaultPrefs,
} from '@/lib/prefs'
import { useClientValue } from '@/lib/use-client-value'
import { loadHostKey } from '@/lib/host-keys'
import { useMounted } from '@/lib/use-mounted'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/join/$meetingId')({
  loader: async ({ params }) => {
    const meeting = await getMeeting({ data: { meetingId: params.meetingId } })
    if (!meeting) throw notFound()
    return meeting
  },
  head: ({ loaderData }) => ({
    meta: loaderData ? [{ title: `Join ${loaderData.title} · Lectern` }] : [],
  }),
  component: Lobby,
})

function Lobby() {
  const meeting = Route.useLoaderData()
  const { meetingId } = Route.useParams()
  const navigate = useNavigate()
  const mounted = useMounted()
  const { user, ready } = useIdentity()

  const stored = useClientValue(loadPrefsCached, defaultPrefs)
  const hostKey = useClientValue(() => loadHostKey(meetingId), null)
  const [edits, setEdits] = useState<Partial<JoinPrefs>>({})
  const [passcode, setPasscode] = useState('')
  // Saved preferences, overlaid with this visit's edits; teachers get their account name prefilled.
  const prefs: JoinPrefs = {
    ...stored,
    ...edits,
    name:
      edits.name ?? (stored.name || (ready && user ? displayName(user) : '')),
  }
  const setPrefs = (update: (p: JoinPrefs) => JoinPrefs) => {
    const next = update(prefs)
    setEdits((e) => ({ ...e, ...next }))
  }

  const isHost = !!hostKey || meeting.youAreHost
  const media = useLocalMedia({
    micOn: prefs.micOn,
    camOn: prefs.camOn,
    cameraId: prefs.cameraId,
    micId: prefs.micId,
  })
  const { level } = useSpeaking(media.stream, prefs.micOn)
  const videoRef = useRef<HTMLVideoElement>(null)
  useAttachStream(videoRef, media.hasVideo ? media.stream : null)

  const name = prefs.name.trim()
  const canJoin =
    name.length > 0 &&
    (!meeting.hasPasscode || isHost || passcode.trim().length > 0)

  function join() {
    if (!canJoin) return
    savePrefs({ ...prefs, name })
    try {
      if (passcode.trim())
        sessionStorage.setItem(`lectern-passcode:${meetingId}`, passcode.trim())
    } catch {
      // ignore
    }
    void navigate({ to: '/meet/$meetingId', params: { meetingId } })
  }

  const ended = !!meeting.endedAt
  const scheduled = meeting.scheduledAt ? new Date(meeting.scheduledAt) : null

  return (
    <div className="min-h-svh bg-background">
      <SiteHeader />
      <main className="mx-auto grid max-w-content gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[1.25fr_1fr] lg:items-start lg:py-14">
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
              {isHost && <Badge variant="secondary">You are the teacher</Badge>}
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
                join()
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
