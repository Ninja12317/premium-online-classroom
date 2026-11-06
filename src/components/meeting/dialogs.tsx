import {
  DeviceSettings,
  type DeviceSelection,
} from '@/components/device-settings'
import { MediaError } from '@/components/media-error'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SHORTCUTS } from '@/lib/use-hotkeys'
import type { DeviceLists, MediaErrorKind } from '@/lib/use-local-media'

export function SettingsDialog({
  open,
  onOpenChange,
  devices,
  selection,
  onChange,
  error,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  devices: DeviceLists
  selection: DeviceSelection
  onChange: (next: DeviceSelection) => void
  error: MediaErrorKind | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Audio and video</DialogTitle>
          <DialogDescription>
            Changes apply immediately for everyone in the class.
          </DialogDescription>
        </DialogHeader>
        {error && <MediaError kind={error} />}
        <DeviceSettings
          devices={devices}
          value={selection}
          onChange={onChange}
          idPrefix="meeting"
        />
      </DialogContent>
    </Dialog>
  )
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts work when you are not typing in a text field.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {SHORTCUTS.map((s) => (
            <div key={s.key} className="contents">
              <dt>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {s.key}
                </kbd>
              </dt>
              <dd className="text-muted-foreground">{s.label}</dd>
            </div>
          ))}
          <div className="contents">
            <dt>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                1–0
              </kbd>
            </dt>
            <dd className="text-muted-foreground">
              Whiteboard tools (pen, pencil, highlighter, eraser…)
            </dd>
          </div>
        </dl>
      </DialogContent>
    </Dialog>
  )
}

export function LeaveDialog({
  open,
  onOpenChange,
  isHost,
  onLeave,
  onEnd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  isHost: boolean
  onLeave: () => void
  onEnd: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {isHost ? 'Leave or end the class?' : 'Leave the class?'}
          </DialogTitle>
          <DialogDescription>
            {isHost
              ? 'If you leave, the class continues for everyone else. Ending it disconnects all students.'
              : 'You can rejoin from the same link while the class is running.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button variant="outline" onClick={onLeave}>
            Leave class
          </Button>
          {isHost && (
            <Button variant="destructive" onClick={onEnd}>
              End for everyone
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
