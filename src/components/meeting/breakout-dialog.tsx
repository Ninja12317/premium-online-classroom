import { useState } from 'react'
import { Megaphone, Plus, Shuffle, Users, DoorOpen, DoorClosed } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { BreakoutRoom, BreakoutState } from '@/lib/meeting-types'
import { cn } from '@/lib/utils'
import type { TileModel } from './types'

export function BreakoutDialog({
  open,
  onOpenChange,
  isModerator,
  localId,
  tiles,
  state,
  myRoomId,
  onUpdateState,
  onJoinRoom,
  onBroadcast,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  isModerator: boolean
  localId: string
  tiles: TileModel[]
  state: BreakoutState | null
  myRoomId: string | null
  onUpdateState: (next: BreakoutState) => Promise<void>
  onJoinRoom: (roomId: string | null) => Promise<void>
  onBroadcast: (text: string) => void
}) {
  const rooms: BreakoutRoom[] = state?.rooms ?? [
    { id: 'room-1', name: 'Room 1', assignedIds: [] },
    { id: 'room-2', name: 'Room 2', assignedIds: [] },
  ]
  const isOpen = state?.open ?? false
  const [broadcast, setBroadcast] = useState('')
  const [busy, setBusy] = useState(false)

  const students = tiles.filter((t) => t.role === 'student')

  async function save(next: BreakoutState) {
    setBusy(true)
    try {
      await onUpdateState(next)
    } finally {
      setBusy(false)
    }
  }

  function addRoom() {
    const idx = rooms.length + 1
    void save({
      open: isOpen,
      rooms: [
        ...rooms,
        { id: `room-${Date.now().toString(36)}`, name: `Room ${idx}`, assignedIds: [] },
      ],
    })
  }

  function autoAssign() {
    if (rooms.length === 0) return
    const cleared = rooms.map((r) => ({ ...r, assignedIds: [] as string[] }))
    students.forEach((s, i) => {
      cleared[i % cleared.length].assignedIds.push(s.id)
    })
    void save({ open: isOpen, rooms: cleared })
    toast.success('Participants assigned across rooms')
  }

  function toggleAssign(roomId: string, participantId: string) {
    const next = rooms.map((r) => {
      const without = r.assignedIds.filter((id) => id !== participantId)
      if (r.id === roomId) {
        const had = r.assignedIds.includes(participantId)
        return {
          ...r,
          assignedIds: had ? without : [...without, participantId],
        }
      }
      return { ...r, assignedIds: without }
    })
    void save({ open: isOpen, rooms: next })
  }

  async function toggleOpenRooms() {
    const nextOpen = !isOpen
    await save({ open: nextOpen, rooms })
    if (!nextOpen && myRoomId) {
      await onJoinRoom(null)
    }
    toast.success(
      nextOpen
        ? 'Breakout rooms are now open'
        : 'All participants returned to main room',
    )
  }

  function sendBroadcast() {
    const msg = broadcast.trim()
    if (!msg) return
    onBroadcast(msg)
    setBroadcast('')
    toast.success('Broadcast sent to all breakout rooms')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-5 text-primary" /> Breakout rooms
            {isOpen && (
              <Badge className="ml-1 bg-primary text-primary-foreground">
                Open
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Split the class into smaller groups. Participants can join their
            assigned room or return to the main room anytime.
          </DialogDescription>
        </DialogHeader>

        {isModerator && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={addRoom} disabled={busy}>
              <Plus className="size-4" /> Add room
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={autoAssign}
              disabled={busy || students.length === 0}
            >
              <Shuffle className="size-4" /> Auto-assign ({students.length})
            </Button>
            <Button
              size="sm"
              variant={isOpen ? 'destructive' : 'default'}
              className="ml-auto gap-1.5"
              onClick={() => void toggleOpenRooms()}
              disabled={busy}
            >
              {isOpen ? (
                <>
                  <DoorClosed className="size-4" /> Close all rooms
                </>
              ) : (
                <>
                  <DoorOpen className="size-4" /> Open all rooms
                </>
              )}
            </Button>
          </div>
        )}

        <div className="space-y-3">
          {rooms.map((room) => {
            const members = tiles.filter((t) => room.assignedIds.includes(t.id))
            const amHere = myRoomId === room.id
            const assignedToMe = room.assignedIds.includes(localId)
            return (
              <div
                key={room.id}
                className={cn(
                  'rounded-xl border p-3',
                  amHere && 'border-primary bg-primary/5',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{room.name}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {members.length} assigned
                    </Badge>
                    {assignedToMe && (
                      <Badge variant="outline" className="text-[10px]">
                        Your room
                      </Badge>
                    )}
                  </div>
                  {(isOpen || isModerator) && (
                    <Button
                      size="xs"
                      variant={amHere ? 'outline' : 'default'}
                      onClick={() => void onJoinRoom(amHere ? null : room.id)}
                    >
                      {amHere ? 'Return to main' : 'Join room'}
                    </Button>
                  )}
                </div>

                {isModerator && students.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {students.map((s) => {
                      const inThis = room.assignedIds.includes(s.id)
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleAssign(room.id, s.id)}
                          className={cn(
                            'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                            inThis
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted',
                          )}
                        >
                          {s.name}
                        </button>
                      )
                    })}
                  </div>
                )}

                {!isModerator && members.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {members.map((m) => m.name).join(', ')}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {isModerator && isOpen && (
          <div className="flex items-center gap-2 border-t pt-3">
            <Input
              value={broadcast}
              onChange={(e) => setBroadcast(e.target.value)}
              placeholder="Broadcast a message to all breakout rooms…"
              onKeyDown={(e) => {
                if (e.key === 'Enter') sendBroadcast()
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              className="gap-1.5 shrink-0"
              onClick={sendBroadcast}
              disabled={!broadcast.trim()}
            >
              <Megaphone className="size-4" /> Broadcast
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
