import { memo, type ReactNode } from 'react'
import {
  BarChart3,
  Captions,
  Check,
  Circle,
  Columns2,
  Copy,
  FileText,
  Hand,
  Info,
  Keyboard,
  LayoutGrid,
  Link2,
  Lock,
  LockOpen,
  Maximize,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MoreHorizontal,
  PenTool,
  PhoneOff,
  Settings2,
  Shield,
  ShieldAlert,
  SmilePlus,
  Sparkles,
  Split,
  Square,
  Users,
  Video,
  VideoOff,
  VolumeX,
  UserSquare2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { REACTIONS } from '@/lib/fixtures'
import type { MeetingSettings } from '@/lib/meeting-types'
import { cn } from '@/lib/utils'
import type { PanelTab, ViewMode } from './types'

export interface ControlBarProps {
  title: string
  duration: string
  participantCount: number
  micOn: boolean
  camOn: boolean
  blurOn?: boolean
  sharing: boolean
  shareSupported: boolean
  canShare: boolean
  whiteboardOpen: boolean
  canWhiteboard: boolean
  handRaised: boolean
  recording: boolean
  recordingSupported: boolean
  captionsOn?: boolean
  captionsSupported?: boolean
  locked: boolean
  settings?: MeetingSettings
  panel: PanelTab | null
  unread: number
  peopleBadge: number
  pollsBadge?: number
  view: ViewMode
  isModerator: boolean
  isHost: boolean
  onToggleMic: () => void
  onToggleCam: () => void
  onToggleBlur?: () => void
  onToggleShare: () => void
  onToggleWhiteboard: () => void
  onToggleHand: () => void
  onToggleCaptions?: () => void
  onPanel: (tab: PanelTab) => void
  onOpenBreakout?: () => void
  onReaction: (emoji: string) => void
  onToggleView: () => void
  onSetView?: (view: ViewMode) => void
  onFullscreen: () => void
  onSettings: () => void
  onShortcuts: () => void
  onToggleRecording: () => void
  onToggleLock: () => void
  onPatchSettings?: (patch: Partial<MeetingSettings>) => void
  onSuspendActivities?: () => void
  onMuteAll: () => void
  onCopyLink: () => void
  onLeave: () => void
  onEnd: () => void
}

function Ctl({
  label,
  shortcut,
  active,
  danger,
  badge,
  onClick,
  children,
  className,
  disabled,
}: {
  label: string
  shortcut?: string
  active?: boolean
  danger?: boolean
  badge?: number
  onClick: () => void
  children: ReactNode
  className?: string
  disabled?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            'relative grid size-11 shrink-0 place-items-center rounded-xl transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 sm:size-12',
            danger
              ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              : active
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-foreground/8 text-foreground hover:bg-foreground/14 dark:bg-white/10 dark:hover:bg-white/18',
            className,
          )}
        >
          {children}
          {!!badge && badge > 0 && (
            <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-live px-1 text-[10px] font-semibold text-white">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {label}
        {shortcut && (
          <span className="ml-2 rounded bg-foreground/10 px-1 font-mono text-[10px]">
            {shortcut}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

export const ControlBar = memo(function ControlBar(p: ControlBarProps) {
  const icon = 'size-5'
  const setView = (v: ViewMode) => {
    if (p.onSetView) p.onSetView(v)
    else p.onToggleView()
  }

  return (
    <div className="safe-bottom flex items-center gap-2 border-t bg-background/95 px-2 pt-2 backdrop-blur sm:gap-3 sm:px-4 sm:pt-3">
      {/* meeting info (desktop) */}
      <div className="hidden min-w-0 flex-1 items-center gap-3 text-sm md:flex">
        <span className="truncate font-medium">{p.title}</span>
        <span
          className="font-mono tabular-nums text-muted-foreground"
          aria-label="Elapsed time"
        >
          {p.duration}
        </span>
        {p.recording && (
          <span className="flex items-center gap-1 text-xs font-medium text-live">
            <Circle className="size-2 fill-current animate-pulse-dot" /> REC
          </span>
        )}
        {p.locked && (
          <Lock
            className="size-3.5 text-muted-foreground"
            aria-label="Meeting locked"
          />
        )}
      </div>

      {/* controls */}
      <div className="flex flex-1 items-center justify-center gap-1.5 sm:gap-2 md:flex-none">
        <Ctl
          label={p.micOn ? 'Mute' : 'Unmute'}
          shortcut="M"
          onClick={p.onToggleMic}
          danger={!p.micOn}
        >
          {p.micOn ? <Mic className={icon} /> : <MicOff className={icon} />}
        </Ctl>
        <Ctl
          label={p.camOn ? 'Stop video' : 'Start video'}
          shortcut="V"
          onClick={p.onToggleCam}
          danger={!p.camOn}
        >
          {p.camOn ? <Video className={icon} /> : <VideoOff className={icon} />}
        </Ctl>

        {/* Security menu (Moderators) */}
        {p.isModerator && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Security"
                    className={cn(
                      'hidden size-11 shrink-0 place-items-center rounded-xl transition-colors sm:grid sm:size-12',
                      p.locked
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-foreground/8 text-foreground hover:bg-foreground/14 dark:bg-white/10 dark:hover:bg-white/18',
                    )}
                  >
                    <Shield className={icon} />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top">Security</TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="top" align="center" className="w-64">
              <DropdownMenuLabel>Security & Permissions</DropdownMenuLabel>
              <DropdownMenuItem onSelect={p.onToggleLock}>
                {p.locked ? <LockOpen /> : <Lock />}
                {p.locked ? 'Unlock meeting' : 'Lock meeting'}
              </DropdownMenuItem>
              {p.settings && p.onPatchSettings && (
                <>
                  <DropdownMenuItem
                    onSelect={() =>
                      p.onPatchSettings!({
                        waitingRoom: !p.settings!.waitingRoom,
                      })
                    }
                  >
                    <Check
                      className={cn(
                        'size-4',
                        !p.settings.waitingRoom && 'opacity-0',
                      )}
                    />
                    Enable waiting room
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Allow students to</DropdownMenuLabel>
                  <DropdownMenuItem
                    onSelect={() =>
                      p.onPatchSettings!({
                        allowStudentScreenShare:
                          !p.settings!.allowStudentScreenShare,
                      })
                    }
                  >
                    <Check
                      className={cn(
                        'size-4',
                        !p.settings.allowStudentScreenShare && 'opacity-0',
                      )}
                    />
                    Share screen
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      p.onPatchSettings!({
                        allowStudentDraw: !p.settings!.allowStudentDraw,
                      })
                    }
                  >
                    <Check
                      className={cn(
                        'size-4',
                        !p.settings.allowStudentDraw && 'opacity-0',
                      )}
                    />
                    Draw on whiteboard
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      p.onPatchSettings!({
                        allowChat: !p.settings!.allowChat,
                      })
                    }
                  >
                    <Check
                      className={cn('size-4', !p.settings.allowChat && 'opacity-0')}
                    />
                    Chat
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      p.onPatchSettings!({
                        allowPrivateChat: !p.settings!.allowPrivateChat,
                      })
                    }
                  >
                    <Check
                      className={cn(
                        'size-4',
                        !p.settings.allowPrivateChat && 'opacity-0',
                      )}
                    />
                    Private messages
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={p.onMuteAll}>
                <VolumeX /> Mute all students
              </DropdownMenuItem>
              {p.onSuspendActivities && (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={p.onSuspendActivities}
                >
                  <ShieldAlert /> Suspend student activities
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Ctl
          label={
            !p.shareSupported
              ? 'Screen sharing is not available on this device'
              : !p.canShare
                ? 'Your teacher has turned off screen sharing'
                : p.sharing
                  ? 'Stop sharing'
                  : 'Share screen'
          }
          shortcut="S"
          onClick={p.onToggleShare}
          active={p.sharing}
          disabled={!p.shareSupported || !p.canShare}
          className="hidden sm:grid"
        >
          <MonitorUp className={icon} />
        </Ctl>
        <Ctl
          label={p.whiteboardOpen ? 'Close whiteboard' : 'Whiteboard'}
          shortcut="W"
          onClick={p.onToggleWhiteboard}
          active={p.whiteboardOpen}
          disabled={!p.canWhiteboard}
          className="hidden sm:grid"
        >
          <PenTool className={icon} />
        </Ctl>
        <Ctl
          label="Chat"
          shortcut="C"
          onClick={() => p.onPanel('chat')}
          active={p.panel === 'chat'}
          badge={p.unread}
        >
          <MessageSquare className={icon} />
        </Ctl>
        <Ctl
          label="Participants"
          shortcut="P"
          onClick={() => p.onPanel('people')}
          active={p.panel === 'people'}
          badge={p.peopleBadge}
          className="hidden sm:grid"
        >
          <Users className={icon} />
        </Ctl>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Reactions"
              className="hidden size-11 shrink-0 place-items-center rounded-xl bg-foreground/8 text-foreground transition-colors hover:bg-foreground/14 dark:bg-white/10 dark:hover:bg-white/18 sm:grid sm:size-12"
            >
              <SmilePlus className={icon} />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" className="w-auto p-2">
            <ReactionGrid
              onPick={p.onReaction}
              handRaised={p.handRaised}
              onHand={p.onToggleHand}
            />
          </PopoverContent>
        </Popover>
        <Ctl
          label={p.handRaised ? 'Lower hand' : 'Raise hand'}
          shortcut="H"
          onClick={p.onToggleHand}
          active={p.handRaised}
          className="sm:hidden"
        >
          <Hand className={icon} />
        </Ctl>

        {p.onToggleCaptions && (
          <Ctl
            label={
              !p.captionsSupported
                ? 'Live captions not supported in this browser'
                : p.captionsOn
                  ? 'Hide live captions'
                  : 'Live captions (CC)'
            }
            shortcut="L"
            onClick={p.onToggleCaptions}
            active={p.captionsOn}
            className="hidden lg:grid"
          >
            <Captions className={icon} />
          </Ctl>
        )}

        {/* View switcher */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Change view"
                  className="hidden size-11 shrink-0 place-items-center rounded-xl bg-foreground/8 text-foreground transition-colors hover:bg-foreground/14 dark:bg-white/10 dark:hover:bg-white/18 lg:grid lg:size-12"
                >
                  {p.view === 'gallery' ? (
                    <LayoutGrid className={icon} />
                  ) : p.view === 'side-by-side' ? (
                    <Columns2 className={icon} />
                  ) : (
                    <UserSquare2 className={icon} />
                  )}
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">View</TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="top" align="center" className="w-48">
            <DropdownMenuLabel>Stage layout</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setView('gallery')}>
              <LayoutGrid /> Gallery view
              {p.view === 'gallery' && <Check className="ml-auto size-4" />}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setView('speaker')}>
              <UserSquare2 /> Speaker view
              {p.view === 'speaker' && <Check className="ml-auto size-4" />}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setView('side-by-side')}>
              <Columns2 /> Side-by-side
              {p.view === 'side-by-side' && <Check className="ml-auto size-4" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={p.onFullscreen}>
              <Maximize /> Full screen
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* More options */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More options"
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-foreground/8 text-foreground transition-colors hover:bg-foreground/14 dark:bg-white/10 dark:hover:bg-white/18 sm:size-12"
                >
                  <MoreHorizontal className={icon} />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">More</TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="top" align="center" className="w-64">
            <DropdownMenuLabel className="truncate md:hidden">
              {p.title} · {p.duration}
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="md:hidden" />
            <DropdownMenuItem
              className="sm:hidden"
              disabled={!p.shareSupported || !p.canShare}
              onSelect={p.onToggleShare}
            >
              <MonitorUp /> {p.sharing ? 'Stop sharing' : 'Share screen'}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="sm:hidden"
              disabled={!p.canWhiteboard}
              onSelect={p.onToggleWhiteboard}
            >
              <PenTool /> {p.whiteboardOpen ? 'Close whiteboard' : 'Whiteboard'}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="sm:hidden"
              onSelect={() => p.onPanel('people')}
            >
              <Users /> Participants {p.peopleBadge > 0 && `(${p.peopleBadge})`}
            </DropdownMenuItem>
            <div className="px-2 py-1.5 sm:hidden">
              <ReactionGrid
                onPick={p.onReaction}
                handRaised={p.handRaised}
                onHand={p.onToggleHand}
                compact
              />
            </div>
            <DropdownMenuSeparator className="sm:hidden" />
            <DropdownMenuItem onSelect={() => p.onPanel('polls')}>
              <BarChart3 /> Live polls
              {!!p.pollsBadge && p.pollsBadge > 0 && (
                <span className="ml-auto rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                  {p.pollsBadge}
                </span>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => p.onPanel('notes')}>
              <FileText /> Shared class notes
            </DropdownMenuItem>
            {p.onOpenBreakout && (
              <DropdownMenuItem onSelect={p.onOpenBreakout}>
                <Split /> Breakout rooms
              </DropdownMenuItem>
            )}
            {p.onToggleCaptions && (
              <DropdownMenuItem onSelect={p.onToggleCaptions}>
                <Captions /> {p.captionsOn ? 'Hide captions' : 'Live captions (CC)'}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => p.onPanel('info')}>
              <Info /> Meeting details
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={p.onCopyLink}>
              <Link2 /> Copy invite link
            </DropdownMenuItem>
            {p.onToggleBlur && (
              <DropdownMenuItem onSelect={p.onToggleBlur}>
                <Sparkles />{' '}
                {p.blurOn ? 'Disable background blur' : 'Enable background blur'}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={p.onToggleView}>
              {p.view === 'gallery' ? <UserSquare2 /> : <LayoutGrid />}
              {p.view === 'gallery' ? 'Speaker view' : 'Gallery view'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={p.onFullscreen}>
              <Maximize /> Full screen
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={p.onSettings}>
              <Settings2 /> Audio and video settings
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={p.onShortcuts}>
              <Keyboard /> Keyboard shortcuts
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={p.onToggleRecording}
              disabled={!p.recordingSupported}
            >
              {p.recording ? <Square /> : <Circle className="text-live" />}
              {p.recording ? 'Stop recording' : 'Record locally'}
            </DropdownMenuItem>
            {p.isModerator && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Host tools</DropdownMenuLabel>
                <DropdownMenuItem onSelect={p.onMuteAll}>
                  <VolumeX /> Mute all students
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={p.onToggleLock}>
                  {p.locked ? <LockOpen /> : <Lock />}
                  {p.locked ? 'Unlock meeting' : 'Lock meeting'}
                </DropdownMenuItem>
                {p.isHost && (
                  <DropdownMenuItem variant="destructive" onSelect={p.onEnd}>
                    <PhoneOff /> End class for everyone
                  </DropdownMenuItem>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* leave */}
      <div className="flex flex-1 justify-end md:flex-1">
        <Button
          variant="destructive"
          className="h-11 gap-2 rounded-xl px-3 sm:h-12 sm:px-5"
          onClick={p.onLeave}
          aria-label="Leave class"
        >
          <PhoneOff className="size-5" />
          <span className="hidden sm:inline">Leave</span>
        </Button>
      </div>
    </div>
  )
})

function ReactionGrid({
  onPick,
  handRaised,
  onHand,
  compact,
}: {
  onPick: (emoji: string) => void
  handRaised: boolean
  onHand: () => void
  compact?: boolean
}) {
  return (
    <div className="flex items-center gap-1">
      {REACTIONS.map((r) => (
        <button
          key={r.key}
          type="button"
          aria-label={r.label}
          onClick={() => onPick(r.emoji)}
          className={cn(
            'grid place-items-center rounded-lg transition-transform hover:scale-125 motion-reduce:transition-none motion-reduce:hover:scale-100',
            compact ? 'size-8 text-lg' : 'size-10 text-2xl',
          )}
        >
          {r.emoji}
        </button>
      ))}
      {!compact && (
        <>
          <span className="mx-1 h-6 w-px bg-border" />
          <Button
            variant={handRaised ? 'default' : 'outline'}
            size="sm"
            className="gap-1.5"
            onClick={onHand}
          >
            <Hand className="size-4" />{' '}
            {handRaised ? 'Lower hand' : 'Raise hand'}
          </Button>
        </>
      )}
    </div>
  )
}

export { Copy }
