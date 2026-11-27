import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  Check,
  Copy,
  Download,
  FileText,
  Hand,
  Megaphone,
  Mic,
  MicOff,
  MonitorOff,
  MoreVertical,
  Pin,
  SendHorizonal,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  UserMinus,
  UserX,
  Video,
  VideoOff,
  VolumeX,
  X,
  Lock,
  LockOpen,
} from 'lucide-react'
import { toast } from 'sonner'

import { AvatarBubble } from '@/components/avatar-bubble'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { downloadTextFile, meetingUrl } from '@/lib/meeting'
import type {
  Connection,
  MeetingPoll,
  MeetingSettings,
  MeetingSummary,
  WaitingParticipant,
} from '@/lib/meeting-types'
import { cn } from '@/lib/utils'
import { PollsPane } from './polls-pane'
import type { ChatMessage, PanelTab, TileModel } from './types'

export type ModerateAction =
  | 'mute'
  | 'stop-share'
  | 'remove'
  | 'make-cohost'
  | 'revoke-cohost'
  | 'lower-hand'
  | 'spotlight'
  | 'unspotlight'

export interface SidePanelProps {
  tab: PanelTab
  onTab: (tab: PanelTab) => void
  onClose: () => void
  localId: string
  localName?: string
  isModerator: boolean
  isHost: boolean
  // chat
  messages: ChatMessage[]
  onSend: (text: string, toId: string | null, announcement: boolean) => void
  canChat: boolean
  canPrivate: boolean
  // people
  tiles: TileModel[]
  waiting: WaitingParticipant[]
  pinnedId?: string | null
  spotlightId?: string | null
  onPin?: (id: string | null) => void
  onAdmit: (identity: string, admit: boolean) => void
  onAdmitAll: () => void
  onModerate: (identity: string, action: ModerateAction) => void
  onMuteAll: () => void
  settings: MeetingSettings
  onSettings: (patch: Partial<MeetingSettings>) => void
  // polls & notes
  polls?: MeetingPoll[]
  notes?: string
  onNotesChange?: (text: string) => void
  // info
  meeting: MeetingSummary
  passcode: string | null
  duration: string
  quality: Connection
  realtime: boolean
}

export function SidePanel(p: SidePanelProps) {
  return (
    <aside
      className="flex h-full w-full flex-col bg-card text-card-foreground"
      aria-label="Meeting panel"
    >
      <div className="flex items-center gap-1.5 border-b px-2.5 py-2">
        <Tabs
          value={p.tab}
          onValueChange={(v) => p.onTab(v as PanelTab)}
          className="min-w-0 flex-1"
        >
          <TabsList className="grid w-full grid-cols-5 h-8">
            <TabsTrigger value="chat" className="px-1 text-xs">
              Chat
            </TabsTrigger>
            <TabsTrigger value="people" className="px-1 text-xs">
              People
              <span className="ml-0.5 hidden rounded-full bg-foreground/10 px-1 text-[10px] tabular-nums sm:inline">
                {p.tiles.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="polls" className="px-1 text-xs">
              Polls
            </TabsTrigger>
            <TabsTrigger value="notes" className="px-1 text-xs">
              Notes
            </TabsTrigger>
            <TabsTrigger value="info" className="px-1 text-xs">
              Details
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={p.onClose}
          aria-label="Close panel"
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {p.tab === 'chat' && <ChatPane {...p} />}
        {p.tab === 'people' && <PeoplePane {...p} />}
        {p.tab === 'polls' && (
          <PollsPane
            meetingId={p.meeting.meetingId}
            localId={p.localId}
            localName={
              p.localName ??
              p.tiles.find((t) => t.isLocal)?.name ??
              'Participant'
            }
            isModerator={p.isModerator}
            polls={p.polls ?? []}
          />
        )}
        {p.tab === 'notes' && <NotesPane {...p} />}
        {p.tab === 'info' && <InfoPane {...p} />}
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------

function formatTime(at: number) {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function ChatPane(p: SidePanelProps) {
  const [text, setText] = useState('')
  const [to, setTo] = useState<string>('everyone')
  const [announce, setAnnounce] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    const el = listRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [p.messages.length])

  const recipients = p.tiles.filter((t) => !t.isLocal)
  const allowPrivate = p.canPrivate || p.isModerator
  const effectiveTo =
    to !== 'everyone' && !recipients.some((r) => r.id === to) ? 'everyone' : to

  function submit(e: FormEvent) {
    e.preventDefault()
    const value = text.trim()
    if (!value) return
    p.onSend(
      value,
      effectiveTo === 'everyone' ? null : effectiveTo,
      announce && effectiveTo === 'everyone',
    )
    setText('')
    stickToBottom.current = true
  }

  function saveChatTranscript() {
    if (p.messages.length === 0) {
      toast('No chat messages to save yet.')
      return
    }
    const lines = [
      `Lectern Chat Transcript — ${p.meeting.title} (${p.meeting.meetingId})`,
      `Exported ${new Date().toLocaleString()}`,
      '',
      ...p.messages.map((m) => {
        const ts = formatTime(m.at)
        const tag =
          m.kind === 'announcement'
            ? '[Announcement] '
            : m.kind === 'private'
              ? `[Private${m.toName ? ` -> ${m.toName}` : ''}] `
              : ''
        return `[${ts}] ${m.authorName}: ${tag}${m.text}`
      }),
    ]
    downloadTextFile(
      `${p.meeting.title.replace(/[^\w-]+/g, '_')}-chat.txt`,
      lines.join('\n'),
      'text/plain;charset=utf-8',
    )
    toast.success('Chat transcript saved')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs text-muted-foreground">
        <span>Synced with class history</span>
        <Button
          size="xs"
          variant="ghost"
          className="h-7 gap-1 text-xs"
          onClick={saveChatTranscript}
          disabled={p.messages.length === 0}
        >
          <Download className="size-3.5" /> Save chat
        </Button>
      </div>
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 scrollbar-thin"
        role="log"
        aria-live="polite"
      >
        {p.messages.length === 0 && (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">
            No messages yet. Say hello to the class.
          </p>
        )}
        {p.messages.map((m, i) => {
          const prev = p.messages[i - 1]
          const grouped =
            prev &&
            prev.authorId === m.authorId &&
            prev.kind === m.kind &&
            m.at - prev.at < 90_000
          const mine = m.authorId === p.localId
          if (m.kind === 'system') {
            return (
              <p
                key={m.id}
                className="text-center text-xs text-muted-foreground"
              >
                {m.text}
              </p>
            )
          }
          if (m.kind === 'announcement') {
            return (
              <div
                key={m.id}
                className="rounded-xl border border-amber/60 bg-amber/10 p-3 text-sm"
              >
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-foreground dark:text-amber">
                  <Megaphone className="size-3.5" /> Announcement ·{' '}
                  {m.authorName} · {formatTime(m.at)}
                </p>
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
              </div>
            )
          }
          return (
            <div
              key={m.id}
              className={cn('flex gap-2', mine && 'flex-row-reverse')}
            >
              {!grouped ? (
                <AvatarBubble
                  name={m.authorName}
                  seed={m.authorId}
                  className="mt-5 size-7 text-[10px]"
                />
              ) : (
                <span className="w-7 shrink-0" />
              )}
              <div className={cn('min-w-0 max-w-[85%]', mine && 'text-right')}>
                {!grouped && (
                  <p className="mb-0.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {mine ? 'You' : m.authorName}
                    </span>
                    {m.kind === 'private' && (
                      <span className="ml-1 text-primary">
                        {mine
                          ? `→ ${m.toName ?? 'someone'} (private)`
                          : '→ you (private)'}
                      </span>
                    )}{' '}
                    · {formatTime(m.at)}
                  </p>
                )}
                <p
                  className={cn(
                    'inline-block whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-left text-sm',
                    mine ? 'bg-primary text-primary-foreground' : 'bg-muted',
                    m.kind === 'private' && 'ring-1 ring-primary/40',
                  )}
                >
                  {m.text}
                </p>
              </div>
            </div>
          )
        })}
      </div>
      <form onSubmit={submit} className="border-t p-3">
        {!p.canChat && !p.isModerator ? (
          <p className="text-center text-sm text-muted-foreground">
            Your teacher has turned off chat for students.
          </p>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-2">
              <Select
                value={effectiveTo}
                onValueChange={setTo}
                disabled={!allowPrivate || recipients.length === 0}
              >
                <SelectTrigger
                  className="h-8 flex-1 text-xs"
                  aria-label="Send to"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="everyone">To everyone</SelectItem>
                  {allowPrivate &&
                    recipients.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        Privately to {r.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {p.isModerator && effectiveTo === 'everyone' && (
                <label className="flex items-center gap-1.5 text-xs">
                  <Switch
                    checked={announce}
                    onCheckedChange={setAnnounce}
                    aria-label="Send as announcement"
                  />
                  <Megaphone className="size-3.5" />
                </label>
              )}
            </div>
            <div className="flex items-end gap-2">
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    submit(e)
                  }
                }}
                placeholder={
                  effectiveTo === 'everyone'
                    ? 'Message everyone…'
                    : 'Private message…'
                }
                rows={1}
                maxLength={2000}
                aria-label="Message"
                className="min-h-9 max-h-32 resize-none"
              />
              <Button
                type="submit"
                size="icon"
                aria-label="Send"
                disabled={!text.trim()}
              >
                <SendHorizonal className="size-4" />
              </Button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------

function NotesPane(p: SidePanelProps) {
  const value = p.notes ?? ''
  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <FileText className="size-3.5" /> Shared class notes
        </div>
        <Button
          size="xs"
          variant="outline"
          className="gap-1"
          onClick={() => {
            downloadTextFile(
              `${p.meeting.title.replace(/[^\w-]+/g, '_')}-notes.md`,
              `# ${p.meeting.title}\n\n${value}`,
              'text/markdown;charset=utf-8',
            )
            toast.success('Notes exported')
          }}
        >
          <Download className="size-3.5" /> Export .md
        </Button>
      </div>
      <Textarea
        value={value}
        onChange={(e) => p.onNotesChange?.(e.target.value)}
        placeholder="Jot down lesson outlines, key formulas, homework, or action items… Notes sync live for everyone in this class."
        className="min-h-0 flex-1 resize-none font-sans text-sm leading-relaxed"
        aria-label="Shared class notes"
      />
      <p className="mt-2 text-[11px] text-muted-foreground">
        Synced in real time for everyone in this class.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------

export function ParticipantMenu({
  tile,
  isHost,
  spotlighted,
  pinned,
  onPin,
  onModerate,
  trigger,
}: {
  tile: TileModel
  isHost: boolean
  spotlighted?: boolean
  pinned?: boolean
  onPin?: (id: string | null) => void
  onModerate: (identity: string, action: ModerateAction) => void
  trigger?: ReactNode
}) {
  const canModerateTarget = !tile.isLocal && tile.role !== 'host'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Actions for ${tile.name}`}
          >
            <MoreVertical className="size-4" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {onPin && (
          <DropdownMenuItem
            onSelect={() => onPin(pinned ? null : tile.id)}
          >
            <Pin /> {pinned ? 'Unpin for me' : 'Pin for me'}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={() =>
            onModerate(tile.id, spotlighted ? 'unspotlight' : 'spotlight')
          }
        >
          <Sparkles />{' '}
          {spotlighted ? 'Remove spotlight' : 'Spotlight for everyone'}
        </DropdownMenuItem>

        {canModerateTarget && (
          <>
            <DropdownMenuSeparator />
            {tile.micOn && (
              <DropdownMenuItem onSelect={() => onModerate(tile.id, 'mute')}>
                <MicOff /> Mute
              </DropdownMenuItem>
            )}
            {tile.sharing && (
              <DropdownMenuItem
                onSelect={() => onModerate(tile.id, 'stop-share')}
              >
                <MonitorOff /> Stop their screen share
              </DropdownMenuItem>
            )}
            {tile.handRaised && (
              <DropdownMenuItem
                onSelect={() => onModerate(tile.id, 'lower-hand')}
              >
                <Hand /> Lower hand
              </DropdownMenuItem>
            )}
            {isHost &&
              (tile.role === 'cohost' ? (
                <DropdownMenuItem
                  onSelect={() => onModerate(tile.id, 'revoke-cohost')}
                >
                  <ShieldOff /> Remove co-host
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onSelect={() => onModerate(tile.id, 'make-cohost')}
                >
                  <ShieldCheck /> Make co-host
                </DropdownMenuItem>
              ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onModerate(tile.id, 'remove')}
            >
              <UserMinus /> Remove from class
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PeoplePane(p: SidePanelProps) {
  const sorted = useMemo(() => {
    const rank = (t: TileModel) =>
      (t.isLocal ? 0 : 10) +
      (t.role === 'host' ? 0 : t.role === 'cohost' ? 1 : 2) +
      (t.handRaised ? -5 : 0)
    return [...p.tiles].sort(
      (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
    )
  }, [p.tiles])

  return (
    <div className="h-full space-y-5 overflow-y-auto px-3 py-3 scrollbar-thin">
      {p.isModerator && p.waiting.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Waiting room ({p.waiting.length})
            </h3>
            <Button size="xs" variant="outline" onClick={p.onAdmitAll}>
              Admit all
            </Button>
          </div>
          <ul className="space-y-1">
            {p.waiting.map((w) => (
              <li
                key={w.identity}
                className="flex items-center gap-2 rounded-lg bg-amber/10 px-2 py-1.5"
              >
                <AvatarBubble
                  name={w.name}
                  seed={w.identity}
                  className="size-7 text-[10px]"
                />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {w.name}
                </span>
                <Button size="xs" onClick={() => p.onAdmit(w.identity, true)}>
                  Admit
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label={`Reject ${w.name}`}
                  onClick={() => p.onAdmit(w.identity, false)}
                >
                  <UserX className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            In class ({p.tiles.length})
          </h3>
          {p.isModerator && p.tiles.length > 1 && (
            <Button
              size="xs"
              variant="outline"
              className="gap-1"
              onClick={p.onMuteAll}
            >
              <VolumeX className="size-3" /> Mute all
            </Button>
          )}
        </div>
        <ul className="space-y-0.5">
          {sorted.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60"
            >
              <AvatarBubble
                name={t.name}
                seed={t.id}
                className="size-7 text-[10px]"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {t.name}
                  {t.isLocal && (
                    <span className="text-muted-foreground"> (you)</span>
                  )}
                </p>
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {t.role !== 'student' && (
                    <span>{t.role === 'host' ? 'Teacher' : 'Co-host'}</span>
                  )}
                  {p.spotlightId === t.id && (
                    <span className="text-amber font-medium">Spotlight</span>
                  )}
                </p>
              </div>
              {t.handRaised && (
                <Hand className="size-4 text-amber" aria-label="Hand raised" />
              )}
              {t.micOn ? (
                <Mic
                  className="size-4 text-muted-foreground"
                  aria-label="Mic on"
                />
              ) : (
                <MicOff className="size-4 text-live" aria-label="Muted" />
              )}
              {t.camOn ? (
                <Video
                  className="size-4 text-muted-foreground"
                  aria-label="Camera on"
                />
              ) : (
                <VideoOff
                  className="size-4 text-muted-foreground/60"
                  aria-label="Camera off"
                />
              )}
              {p.isModerator ? (
                <ParticipantMenu
                  tile={t}
                  isHost={p.isHost}
                  pinned={p.pinnedId === t.id}
                  spotlighted={p.spotlightId === t.id}
                  onPin={p.onPin}
                  onModerate={p.onModerate}
                />
              ) : (
                <span className="w-8" />
              )}
            </li>
          ))}
        </ul>
      </section>

      {p.isModerator && (
        <section className="space-y-1 rounded-xl border p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Class settings
          </h3>
          <SettingRow
            id="s-lock"
            label={p.settings.locked ? 'Meeting locked' : 'Lock meeting'}
            hint="Nobody new can join while locked."
            icon={p.settings.locked ? Lock : LockOpen}
            checked={p.settings.locked}
            onChange={(v) => p.onSettings({ locked: v })}
          />
          <SettingRow
            id="s-wait"
            label="Waiting room"
            hint="Admit students before they join."
            checked={p.settings.waitingRoom}
            onChange={(v) => p.onSettings({ waitingRoom: v })}
          />
          <SettingRow
            id="s-share"
            label="Students can share screen"
            checked={p.settings.allowStudentScreenShare}
            onChange={(v) => p.onSettings({ allowStudentScreenShare: v })}
          />
          <SettingRow
            id="s-draw"
            label="Students can draw on the whiteboard"
            checked={p.settings.allowStudentDraw}
            onChange={(v) => p.onSettings({ allowStudentDraw: v })}
          />
          <SettingRow
            id="s-chat"
            label="Students can chat"
            checked={p.settings.allowChat}
            onChange={(v) => p.onSettings({ allowChat: v })}
          />
          <SettingRow
            id="s-private"
            label="Students can message privately"
            checked={p.settings.allowPrivateChat}
            onChange={(v) => p.onSettings({ allowPrivateChat: v })}
          />
        </section>
      )}
    </div>
  )
}

function SettingRow({
  id,
  label,
  hint,
  checked,
  onChange,
  icon: Icon,
}: {
  id: string
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
  icon?: typeof Lock
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <Label
        htmlFor={id}
        className="flex flex-col items-start gap-0 text-sm font-normal"
      >
        <span className="flex items-center gap-1.5">
          {Icon && <Icon className="size-3.5 text-muted-foreground" />} {label}
        </span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

// ---------------------------------------------------------------------------

function InfoPane(p: SidePanelProps) {
  const [copied, setCopied] = useState<string | null>(null)
  const url = meetingUrl(p.meeting.meetingId)
  function copy(key: string, value: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(key)
      toast.success('Copied')
      setTimeout(() => setCopied(null), 1500)
    })
  }
  const qualityLabel: Record<Connection, string> = {
    good: 'Good',
    fair: 'Fair',
    poor: 'Poor',
    lost: 'Reconnecting…',
  }
  return (
    <div className="h-full space-y-5 overflow-y-auto px-4 py-4 text-sm scrollbar-thin">
      <div>
        <h3 className="font-display text-lg font-semibold">
          {p.meeting.title}
        </h3>
        <p className="text-muted-foreground">Hosted by {p.meeting.hostName}</p>
      </div>
      <dl className="space-y-3">
        <InfoRow
          label="Invite link"
          value={url}
          mono
          copied={copied === 'url'}
          onCopy={() => copy('url', url)}
        />
        <InfoRow
          label="Meeting ID"
          value={p.meeting.meetingId}
          mono
          copied={copied === 'id'}
          onCopy={() => copy('id', p.meeting.meetingId)}
        />
        {p.passcode && (
          <InfoRow
            label="Passcode"
            value={p.passcode}
            mono
            copied={copied === 'pc'}
            onCopy={() => copy('pc', p.passcode!)}
          />
        )}
        {!p.passcode && p.meeting.hasPasscode && (
          <InfoRow label="Passcode" value="Required (ask the teacher)" />
        )}
        <InfoRow label="Elapsed" value={p.duration} mono />
        <InfoRow label="Participants" value={String(p.tiles.length)} />
        <InfoRow label="Your connection" value={qualityLabel[p.quality]} />
        <InfoRow
          label="Connection type"
          value={p.realtime ? 'Direct (peer-to-peer)' : 'Local only'}
        />
      </dl>
      {p.isModerator && (
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={() =>
            copy(
              'invite',
              [
                `Join my class "${p.meeting.title}" on Lectern:`,
                url,
                `Meeting ID: ${p.meeting.meetingId}`,
                p.passcode ? `Passcode: ${p.passcode}` : '',
              ]
                .filter(Boolean)
                .join('\n'),
            )
          }
        >
          {copied === 'invite' ? (
            <Check className="size-4" />
          ) : (
            <Copy className="size-4" />
          )}
          Copy full invitation
        </Button>
      )}
    </div>
  )
}

function InfoRow({
  label,
  value,
  mono,
  copied,
  onCopy,
}: {
  label: string
  value: string
  mono?: boolean
  copied?: boolean
  onCopy?: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className={cn('break-all', mono && 'font-mono text-xs')}>
          {value}
        </dd>
      </div>
      {onCopy && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={onCopy}
          aria-label={`Copy ${label}`}
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </Button>
      )}
    </div>
  )
}
