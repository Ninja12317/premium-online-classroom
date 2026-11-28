import { useState, type ReactNode } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { CalendarDays, Check, Copy, Video } from 'lucide-react'
import { toast } from 'sonner'

import { BackButton } from '@/components/back-button'
import { displayName, useIdentity } from '@/components/identity-provider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  HOST_AUTH_REQUIRED_NOTICE,
  isAuthRequiredError,
  isRegisteredUser,
} from '@/lib/auth-gate'
import { scheduleMeeting, updateMeeting } from '@/lib/meetings.functions'
import type { MeetingSummary } from '@/lib/meeting-types'
import {
  buildIcs,
  downloadTextFile,
  generatePasscode,
  meetingUrl,
} from '@/lib/meeting'
import { saveHostKey } from '@/lib/host-keys'
import { useJoinPrefs } from '@/lib/prefs'
import { useUserProfile } from '@/lib/profile'
import { auth } from '@/services/firebase'

interface Created {
  meetingId: string
  passcode: string | null
  title: string
  startsAt: Date
  durationMin: number
}

function formatDateInputs(iso?: string | null) {
  const d = iso ? new Date(iso) : new Date(Date.now() + 60 * 60_000)
  if (!iso) d.setMinutes(0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

export function ScheduleDialog({
  trigger,
  editing,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  onSaved,
  onAuthRequired,
}: {
  trigger?: ReactNode
  editing?: (MeetingSummary & { passcode?: string | null }) | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSaved?: () => void
  onAuthRequired?: () => void
}) {
  const { user } = useIdentity()
  const profile = useUserProfile()
  const prefs = useJoinPrefs()
  const router = useRouter()
  const navigate = useNavigate()
  const resolvedHostName =
    profile.displayName.trim() ||
    prefs.name.trim() ||
    displayName(user) ||
    undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const canHost = isRegisteredUser(user) && isRegisteredUser(auth.currentUser)
  const open = canHost
    ? controlledOpen !== undefined
      ? controlledOpen
      : internalOpen
    : false
  const setOpen = (next: boolean) => {
    if (next && !canHost) {
      if (onAuthRequired) onAuthRequired()
      else toast.info(HOST_AUTH_REQUIRED_NOTICE)
      return
    }
    if (controlledOnOpenChange) controlledOnOpenChange(next)
    else setInternalOpen(next)
  }

  const [pending, setPending] = useState(false)
  const [created, setCreated] = useState<Created | null>(null)
  const [title, setTitle] = useState('')
  const [{ date, time }, setWhen] = useState(() => formatDateInputs())
  const [duration, setDuration] = useState('60')
  const [passcode, setPasscode] = useState(true)
  const [waitingRoom, setWaitingRoom] = useState(true)
  const [copied, setCopied] = useState(false)

  const formKey = `${open ? 'open' : 'closed'}:${editing?.meetingId ?? 'new'}`
  const [seenKey, setSeenKey] = useState(formKey)
  if (formKey !== seenKey) {
    setSeenKey(formKey)
    if (open) {
      setCreated(null)
      setCopied(false)
      if (editing) {
        setTitle(editing.title)
        setWhen(formatDateInputs(editing.scheduledAt))
        setDuration(String(editing.durationMin || 60))
        setPasscode(Boolean(editing.passcode || editing.hasPasscode))
        setWaitingRoom(editing.waitingRoom)
      } else {
        setTitle('')
        setWhen(formatDateInputs())
        setDuration('60')
        setPasscode(true)
        setWaitingRoom(true)
      }
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pending) return
    if (!isRegisteredUser(user) || !isRegisteredUser(auth.currentUser)) {
      setOpen(false)
      if (onAuthRequired) onAuthRequired()
      else toast.info(HOST_AUTH_REQUIRED_NOTICE)
      return
    }
    const startsAt = new Date(`${date}T${time}`)
    if (Number.isNaN(startsAt.getTime())) {
      toast.error('Pick a valid date and time.')
      return
    }
    setPending(true)
    try {
      if (editing) {
        const nextPasscode = passcode
          ? editing.passcode || generatePasscode()
          : null
        await updateMeeting({
          data: {
            meetingId: editing.meetingId,
            title: title.trim() || 'Live class',
            scheduledAt: startsAt.toISOString(),
            durationMin: Number(duration),
            waitingRoom,
            passcode: nextPasscode,
          },
        })
        toast.success('Class updated')
        await router.invalidate()
        onSaved?.()
        setOpen(false)
      } else {
        const result = await scheduleMeeting({
          data: {
            title: title.trim() || 'Live class',
            hostName: resolvedHostName,
            passcode,
            waitingRoom,
            scheduledAt: startsAt.toISOString(),
            durationMin: Number(duration),
          },
        })
        saveHostKey(result.meetingId, result.hostKey)
        setCreated({
          meetingId: result.meetingId,
          passcode: result.passcode,
          title: title.trim() || 'Live class',
          startsAt,
          durationMin: Number(duration),
        })
        await router.invalidate()
        onSaved?.()
      }
    } catch (err) {
      if (isAuthRequiredError(err)) {
        setOpen(false)
        if (onAuthRequired) onAuthRequired()
        else toast.info(HOST_AUTH_REQUIRED_NOTICE)
      } else {
        toast.error('Could not save the class. Please try again.')
      }
    } finally {
      setPending(false)
    }
  }

  function inviteText(c: Created) {
    return [
      `${c.title}`,
      `${c.startsAt.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}`,
      '',
      `Join: ${meetingUrl(c.meetingId)}`,
      `Meeting ID: ${c.meetingId}`,
      c.passcode ? `Passcode: ${c.passcode}` : null,
    ]
      .filter((l) => l !== null)
      .join('\n')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-md">
        {created ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2.5 pr-6">
                <BackButton
                  onClick={() => setOpen(false)}
                  ariaLabel="Back to meetings"
                  className="size-10"
                />
                <div>
                  <DialogTitle>Class scheduled</DialogTitle>
                  <DialogDescription>
                    Share the invitation with your students. The link works from
                    any browser.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="rounded-xl border bg-muted/50 p-4 text-sm">
              <p className="font-semibold">{created.title}</p>
              <p className="text-muted-foreground">
                {created.startsAt.toLocaleString(undefined, {
                  dateStyle: 'full',
                  timeStyle: 'short',
                })}{' '}
                · {created.durationMin} min
              </p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
                <dt className="font-sans text-muted-foreground">Link</dt>
                <dd className="truncate">{meetingUrl(created.meetingId)}</dd>
                <dt className="font-sans text-muted-foreground">ID</dt>
                <dd>{created.meetingId}</dd>
                {created.passcode && (
                  <>
                    <dt className="font-sans text-muted-foreground">
                      Passcode
                    </dt>
                    <dd>{created.passcode}</dd>
                  </>
                )}
              </dl>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                className="gap-1.5"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(inviteText(created))
                    .then(() => {
                      setCopied(true)
                      toast.success('Invitation copied')
                      setTimeout(() => setCopied(false), 2000)
                    })
                }}
              >
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                Copy invitation
              </Button>
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={() =>
                  downloadTextFile(
                    `${created.title.replace(/[^\w-]+/g, '_')}.ics`,
                    buildIcs({
                      title: created.title,
                      startsAt: created.startsAt,
                      durationMin: created.durationMin,
                      meetingId: created.meetingId,
                      passcode: created.passcode ?? undefined,
                    }),
                    'text/calendar',
                  )
                }
              >
                <CalendarDays className="size-4" /> Add to calendar
              </Button>
              <Button
                variant="ghost"
                className="gap-1.5"
                onClick={() => {
                  setOpen(false)
                  void navigate({
                    to: '/join/$meetingId',
                    params: { meetingId: created.meetingId },
                  })
                }}
              >
                <Video className="size-4" /> Start now
              </Button>
            </div>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <div className="flex items-center gap-2.5 pr-6">
                <BackButton
                  onClick={() => setOpen(false)}
                  ariaLabel="Back to meetings"
                  className="size-10"
                />
                <div>
                  <DialogTitle>
                    {editing ? 'Edit scheduled class' : 'Schedule a class'}
                  </DialogTitle>
                  <DialogDescription>
                    {editing
                      ? 'Update the title, schedule, or room security settings.'
                      : 'You get a permanent link and ID you can send ahead of time.'}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="sched-title">Class title</Label>
              <Input
                id="sched-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Grade 10 Algebra: quadratics"
                maxLength={120}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sched-date">Date</Label>
                <Input
                  id="sched-date"
                  type="date"
                  required
                  value={date}
                  onChange={(e) =>
                    setWhen((w) => ({ ...w, date: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sched-time">Time</Label>
                <Input
                  id="sched-time"
                  type="time"
                  required
                  value={time}
                  onChange={(e) =>
                    setWhen((w) => ({ ...w, time: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sched-duration">Duration</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger id="sched-duration" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['30', '45', '60', '90', '120'].map((d) => (
                    <SelectItem key={d} value={d}>
                      {d} minutes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="sched-passcode">Require a passcode</Label>
                <p className="text-xs text-muted-foreground">
                  A 6-digit code students enter to join.
                </p>
              </div>
              <Switch
                id="sched-passcode"
                checked={passcode}
                onCheckedChange={setPasscode}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="sched-waiting">Waiting room</Label>
                <p className="text-xs text-muted-foreground">
                  You admit students before they can join.
                </p>
              </div>
              <Switch
                id="sched-waiting"
                checked={waitingRoom}
                onCheckedChange={setWaitingRoom}
              />
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending
                ? 'Saving…'
                : editing
                  ? 'Save changes'
                  : 'Schedule class'}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
