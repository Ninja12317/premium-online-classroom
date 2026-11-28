import { memo, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, CalendarDays, Clock, Sparkles } from 'lucide-react'

import { Brand } from '@/components/brand'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  formatScheduledCountdown,
  type MeetingSummary,
} from '@/lib/meeting-types'
import { useMounted } from '@/lib/use-mounted'

const CountdownTicker = memo(function CountdownTicker({
  scheduledAtIso,
}: {
  scheduledAtIso: string | null
}) {
  const mounted = useMounted()
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  if (!mounted) {
    return (
      <div className="rounded-xl border border-primary/20 bg-primary/8 px-4 py-3.5 text-center">
        <p className="font-mono text-base font-semibold tabular-nums text-primary sm:text-lg">
          Checking schedule…
        </p>
      </div>
    )
  }

  const parsedMs = scheduledAtIso ? Date.parse(scheduledAtIso) : Number.NaN
  if (Number.isNaN(parsedMs)) {
    return (
      <div className="rounded-xl border border-primary/20 bg-primary/8 px-4 py-3.5 text-center">
        <p className="text-sm font-semibold text-primary">
          Waiting for the host to start the meeting
        </p>
      </div>
    )
  }

  const countdown = formatScheduledCountdown(parsedMs, nowMs)
  const localTime = new Date(parsedMs).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/8 px-4 py-3.5 text-center">
      {countdown ? (
        <p
          data-testid="scheduled-countdown"
          className="font-mono text-lg font-semibold tabular-nums tracking-tight text-primary sm:text-xl"
        >
          {countdown}
        </p>
      ) : (
        <p
          data-testid="scheduled-waiting-host"
          className="text-sm font-semibold text-primary sm:text-base"
        >
          Scheduled for {localTime} — Waiting for the host to start the meeting
        </p>
      )}
    </div>
  )
})

export function ScheduledCountdownScreen({
  meeting,
  studentName,
  onStudentNameChange,
  transitioning = false,
}: {
  meeting: MeetingSummary
  studentName?: string
  onStudentNameChange?: (name: string) => void
  transitioning?: boolean
}) {
  const mounted = useMounted()
  const scheduledDate = meeting.scheduledAt ? new Date(meeting.scheduledAt) : null
  const formattedDateTime =
    mounted && scheduledDate && !Number.isNaN(scheduledDate.getTime())
      ? scheduledDate.toLocaleString(undefined, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : null

  return (
    <main className="relative grid min-h-svh place-items-center bg-background px-4 py-16">
      <div
        className="paper-grid pointer-events-none absolute inset-0 -z-10"
        aria-hidden
      />
      <div className="absolute left-4 top-4 flex items-center gap-2.5">
        <Brand />
      </div>
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <section
        aria-label="Scheduled meeting countdown"
        className="animate-fade-up motion-reduce:animate-none w-full max-w-lg rounded-2xl border border-border/80 bg-card p-6 shadow-sm sm:p-8"
      >
        <div className="flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1 text-xs font-medium text-primary">
            <span className="size-1.5 rounded-full bg-primary animate-pulse-dot motion-reduce:animate-none" />
            <span>Scheduled • Not started yet</span>
          </div>

          <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {meeting.title}
          </h1>

          <p className="mt-1.5 text-sm text-muted-foreground">
            Hosted by {meeting.hostName} ·{' '}
            <span className="font-mono font-medium text-foreground">
              {meeting.meetingId}
            </span>
          </p>
        </div>

        <div className="mt-6 space-y-3.5">
          {formattedDateTime && (
            <div className="flex items-center justify-center gap-2 rounded-xl border bg-muted/40 px-4 py-2.5 text-sm text-foreground">
              <CalendarDays className="size-4 shrink-0 text-primary" />
              <span className="font-medium">{formattedDateTime}</span>
            </div>
          )}

          <CountdownTicker scheduledAtIso={meeting.scheduledAt} />

          {transitioning ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-primary/25 bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary">
              <Sparkles className="size-4 animate-pulse motion-reduce:animate-none" />
              <span>Your teacher started the class — joining now…</span>
            </div>
          ) : (
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground sm:text-sm">
              <Clock className="size-3.5 shrink-0 text-primary" />
              <span>
                You’ll join automatically as soon as your teacher starts the
                class.
              </span>
            </p>
          )}
        </div>

        {onStudentNameChange && (
          <div className="mt-6 space-y-1.5 border-t pt-5">
            <Label htmlFor="scheduled-student-name" className="text-xs">
              Your display name (optional)
            </Label>
            <Input
              id="scheduled-student-name"
              value={studentName ?? ''}
              onChange={(e) => onStudentNameChange(e.target.value)}
              placeholder="How your teacher will see you"
              maxLength={60}
              autoComplete="name"
            />
          </div>
        )}

        <div className="mt-6 flex justify-center">
          <Button asChild variant="outline" className="gap-1.5">
            <Link to="/">
              <ArrowLeft className="size-4" />
              Back to Home
            </Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
