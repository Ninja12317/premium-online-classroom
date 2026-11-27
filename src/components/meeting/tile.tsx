import { memo, type ReactNode } from 'react'
import {
  Hand,
  MicOff,
  MonitorUp,
  Pin,
  Signal,
  SignalLow,
  SignalMedium,
  SignalZero,
  Sparkles,
} from 'lucide-react'

import { AvatarBubble } from '@/components/avatar-bubble'
import { cn } from '@/lib/utils'
import type { TileModel } from './types'

function QualityIcon({ quality }: { quality: TileModel['quality'] }) {
  const cls = 'size-3.5'
  switch (quality) {
    case 'good':
      return (
        <Signal
          className={cn(cls, 'text-primary')}
          aria-label="Good connection"
        />
      )
    case 'fair':
      return (
        <SignalMedium
          className={cn(cls, 'text-amber')}
          aria-label="Fair connection"
        />
      )
    case 'poor':
      return (
        <SignalLow
          className={cn(cls, 'text-live')}
          aria-label="Poor connection"
        />
      )
    default:
      return (
        <SignalZero
          className={cn(cls, 'text-live')}
          aria-label="Connection lost"
        />
      )
  }
}

export interface TileProps {
  tile: TileModel
  video: ReactNode | null
  pinned?: boolean
  spotlighted?: boolean
  onPin?: (id: string | null) => void
  menu?: ReactNode
  large?: boolean
  className?: string
}

/** A participant's video (or avatar) with name, mic, hand and quality badges. */
export const ParticipantTile = memo(function ParticipantTile({
  tile,
  video,
  pinned,
  spotlighted,
  onPin,
  menu,
  large,
  className,
}: TileProps) {
  const showVideo = tile.camOn && video
  return (
    <div
      className={cn(
        'group relative aspect-video w-full overflow-hidden rounded-xl bg-stage-tile text-stage-tile-foreground transition-shadow duration-200 motion-reduce:transition-none',
        tile.speaking && 'ring-2 ring-primary ring-offset-2 ring-offset-stage',
        spotlighted && 'ring-2 ring-amber ring-offset-2 ring-offset-stage',
        className,
      )}
      data-identity={tile.id}
    >
      {showVideo ? (
        <div
          className={cn(
            'absolute inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-cover',
            tile.isLocal && !tile.sharing && '[&_video]:-scale-x-100',
          )}
        >
          {video}
        </div>
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <AvatarBubble
            name={tile.name}
            seed={tile.id}
            className={cn(
              large
                ? 'size-24 text-3xl'
                : 'size-12 text-base sm:size-16 sm:text-xl',
              tile.speaking && 'animate-speaking motion-reduce:animate-none',
            )}
          />
        </div>
      )}

      {/* top-right badges */}
      <div className="absolute right-2 top-2 flex items-center gap-1.5">
        {spotlighted && (
          <span
            className="flex h-7 items-center gap-1 rounded-full bg-amber px-2 text-[11px] font-semibold text-amber-foreground shadow"
            aria-label="Spotlighted"
          >
            <Sparkles className="size-3.5" /> Spotlight
          </span>
        )}
        {tile.handRaised && (
          <span
            className="grid size-7 place-items-center rounded-full bg-amber text-amber-foreground shadow"
            aria-label="Hand raised"
          >
            <Hand className="size-4" />
          </span>
        )}
        {tile.sharing && (
          <span
            className="grid size-7 place-items-center rounded-full bg-black/50 text-white"
            aria-label="Sharing screen"
          >
            <MonitorUp className="size-4" />
          </span>
        )}
        {pinned && (
          <span
            className="grid size-7 place-items-center rounded-full bg-black/50 text-white"
            aria-label="Pinned"
          >
            <Pin className="size-4" />
          </span>
        )}
      </div>

      {/* bottom label */}
      <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 rounded-md bg-black/50 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
          {!tile.micOn && (
            <MicOff
              className="size-3.5 shrink-0 text-live"
              aria-label="Muted"
            />
          )}
          <span className="truncate">
            {tile.name}
            {tile.isLocal && ' (you)'}
          </span>
          {tile.role !== 'student' && (
            <span className="shrink-0 rounded bg-white/20 px-1 text-[10px] uppercase tracking-wide">
              {tile.role === 'host' ? 'Teacher' : 'Co-host'}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1 rounded-md bg-black/50 px-1.5 py-1 backdrop-blur-sm">
          <QualityIcon quality={tile.quality} />
        </span>
      </div>

      {/* hover actions */}
      {(onPin || menu) && (
        <div className="absolute left-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none">
          {onPin && (
            <button
              type="button"
              onClick={() => onPin(pinned ? null : tile.id)}
              aria-label={pinned ? `Unpin ${tile.name}` : `Pin ${tile.name}`}
              className="grid size-7 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              <Pin className={cn('size-3.5', pinned && 'rotate-45')} />
            </button>
          )}
          {menu}
        </div>
      )}
    </div>
  )
})
