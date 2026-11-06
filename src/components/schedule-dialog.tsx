import { useState, type ReactNode } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { CalendarDays, Check, Copy, Video } from 'lucide-react'
import { toast } from 'sonner'

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
import { createMeeting } from '@/lib/meetings.functions'
import { buildIcs, downloadTextFile, meetingUrl } from '@/lib/meeting'
import { saveHostKey } from '@/lib/host-keys'

interface Created {
  meetingId: string
  passcode: string | null
  title: string
  startsAt: Date
  durationMin: number
}

function defaultDate() {
  const d = new Date(Date.now() + 60 * 60_000)
  d.setMinutes(0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

export function ScheduleDialog({ trigger }: { trigger: ReactNode }) {
  const { user } = useIdentity()
  const router = useRouter()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [created, setCreated] = useState<Created | null>(null)
  const [title, setTitle] = useState('')
  const [{ date, time }, setWhen] = useState(defaultDate)
  const [duration, setDuration] = useState('60')
  const [passcode, setPasscode] = useState(true)
  const [waitingRoom, setWaitingRoom] = useState(true)
  const [copied, setCopied] = useState(false)

  function reset() {
    setCreated(null)
    setTitle('')
    setWhen(defaultDate())
    setDuration('60')
    setPasscode(true)
    setWaitingRoom(true)
    setCopied(false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pending) return
    const startsAt = new Date(`${date}T${time}`)
    if (Number.isNaN(startsAt.getTime())) {
      toast.error('Pick a valid date and time.')
      return
    }
    setPending(true)
    try {
      const result = await createMeeting({
        data: {
          title: title.trim() || 'Live class',
          hostName: displayName(user) || undefined,
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
    } catch {
      toast.error('Could not schedule the class. Please try again.')
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setTimeout(reset, 200)
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Class scheduled</DialogTitle>
              <DialogDescription>
                Share the invitation with your students. The link works from any
                browser.
              </DialogDescription>
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
              <DialogTitle>Schedule a class</DialogTitle>
              <DialogDescription>
                You get a permanent link and ID you can send ahead of time.
              </DialogDescription>
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
              {pending ? 'Scheduling…' : 'Schedule class'}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
