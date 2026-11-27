import { useState, type FormEvent } from 'react'
import { BarChart3, CheckCircle2, Lock, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { MeetingPoll } from '@/lib/meeting-types'
import { cn } from '@/lib/utils'
import {
  closeMeetingPoll,
  createMeetingPoll,
  deleteMeetingPoll,
  voteMeetingPoll,
} from '@/services/firestore-meetings'

export function PollsPane({
  meetingId,
  localId,
  localName,
  isModerator,
  polls,
}: {
  meetingId: string
  localId: string
  localName: string
  isModerator: boolean
  polls: MeetingPoll[]
}) {
  const [creating, setCreating] = useState(false)
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [anonymous, setAnonymous] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function submitPoll(e: FormEvent) {
    e.preventDefault()
    const q = question.trim()
    const cleanOpts = options.map((o) => o.trim()).filter(Boolean)
    if (!q || cleanOpts.length < 2) {
      toast.error('Enter a question and at least two answer choices.')
      return
    }
    setSubmitting(true)
    try {
      await createMeetingPoll(meetingId, {
        question: q,
        options: cleanOpts,
        anonymous,
        createdBy: localId,
        createdByName: localName,
      })
      setQuestion('')
      setOptions(['', ''])
      setAnonymous(false)
      setCreating(false)
      toast.success('Poll launched')
    } catch {
      toast.error('Could not create poll.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {isModerator && (
        <div className="border-b px-3 py-2.5">
          {!creating ? (
            <Button
              size="sm"
              className="w-full gap-1.5"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-4" /> Create a poll
            </Button>
          ) : (
            <form onSubmit={submitPoll} className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  New live poll
                </span>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  aria-label="Cancel poll"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask the class a question…"
                maxLength={200}
              />
              <div className="space-y-1.5">
                {options.map((opt, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <Input
                      value={opt}
                      onChange={(e) =>
                        setOptions((prev) =>
                          prev.map((v, i) => (i === idx ? e.target.value : v)),
                        )
                      }
                      placeholder={`Option ${idx + 1}`}
                      maxLength={120}
                    />
                    {options.length > 2 && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8 shrink-0"
                        onClick={() =>
                          setOptions((prev) => prev.filter((_, i) => i !== idx))
                        }
                        aria-label={`Remove option ${idx + 1}`}
                      >
                        <X className="size-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
                {options.length < 6 && (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="gap-1"
                    onClick={() => setOptions((prev) => [...prev, ''])}
                  >
                    <Plus className="size-3.5" /> Add option
                  </Button>
                )}
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="poll-anon" className="text-xs font-normal">
                  Anonymous responses
                </Label>
                <Switch
                  id="poll-anon"
                  checked={anonymous}
                  onCheckedChange={setAnonymous}
                />
              </div>
              <Button
                type="submit"
                size="sm"
                className="w-full"
                disabled={submitting}
              >
                {submitting ? 'Launching…' : 'Launch poll'}
              </Button>
            </form>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 scrollbar-thin">
        {polls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-muted-foreground">
            <BarChart3 className="mb-2 size-8 opacity-40" />
            <p>No polls yet.</p>
            {isModerator && (
              <p className="mt-1 text-xs">
                Create a live poll to check understanding in real time.
              </p>
            )}
          </div>
        ) : (
          polls.map((poll) => {
            const votes = poll.votes ?? {}
            const totalVotes = Object.keys(votes).length
            const myVote = votes[localId]
            return (
              <div
                key={poll.id}
                className="space-y-2.5 rounded-xl border bg-background/60 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold leading-snug">
                    {poll.question}
                  </p>
                  <Badge
                    variant={poll.status === 'open' ? 'default' : 'secondary'}
                    className="shrink-0 text-[10px]"
                  >
                    {poll.status === 'open' ? 'Live' : 'Closed'}
                  </Badge>
                </div>

                <div className="space-y-1.5">
                  {poll.options.map((opt) => {
                    const count = Object.values(votes).filter(
                      (v) => v === opt.id,
                    ).length
                    const pct =
                      totalVotes > 0
                        ? Math.round((count / totalVotes) * 100)
                        : 0
                    const chosen = myVote === opt.id
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={poll.status !== 'open'}
                        onClick={() =>
                          void voteMeetingPoll(
                            meetingId,
                            poll.id,
                            localId,
                            opt.id,
                          )
                        }
                        className={cn(
                          'relative flex w-full items-center justify-between overflow-hidden rounded-lg border px-2.5 py-2 text-left text-xs transition-colors',
                          chosen
                            ? 'border-primary bg-primary/10 font-medium'
                            : 'border-border hover:bg-muted/60',
                          poll.status !== 'open' && 'cursor-default',
                        )}
                      >
                        <span
                          className="pointer-events-none absolute inset-y-0 left-0 bg-primary/15 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                        <span className="relative flex items-center gap-1.5">
                          {chosen && (
                            <CheckCircle2 className="size-3.5 text-primary" />
                          )}
                          {opt.text}
                        </span>
                        <span className="relative font-mono tabular-nums text-muted-foreground">
                          {count} ({pct}%)
                        </span>
                      </button>
                    )
                  })}
                </div>

                <div className="flex items-center justify-between pt-1 text-[11px] text-muted-foreground">
                  <span>
                    {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
                    {poll.anonymous ? ' · Anonymous' : ''}
                  </span>
                  {isModerator && (
                    <div className="flex items-center gap-1">
                      {poll.status === 'open' && (
                        <Button
                          size="xs"
                          variant="ghost"
                          className="h-6 gap-1 text-[11px]"
                          onClick={() =>
                            void closeMeetingPoll(meetingId, poll.id)
                          }
                        >
                          <Lock className="size-3" /> Close
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-6 text-muted-foreground hover:text-destructive"
                        aria-label="Delete poll"
                        onClick={() =>
                          void deleteMeetingPoll(meetingId, poll.id)
                        }
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
