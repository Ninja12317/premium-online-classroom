import { initials } from '@/lib/meeting'
import { cn } from '@/lib/utils'

/** Deterministic hue from a name or identity so colours are stable. */
export function hueFor(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return h % 360
}

export function AvatarBubble({
  name,
  seed,
  color,
  photo,
  className,
}: {
  name: string
  seed?: string
  color?: string
  photo?: string | null
  className?: string
}) {
  const hue = hueFor(seed ?? name)
  if (photo) {
    return (
      <span
        aria-hidden
        className={cn(
          'inline-block shrink-0 overflow-hidden rounded-full bg-muted',
          className,
        )}
      >
        <img
          src={photo}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
        />
      </span>
    )
  }
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-display font-semibold text-white',
        className,
      )}
      style={{ background: color ?? `oklch(0.52 0.12 ${hue})` }}
    >
      {initials(name) || '?'}
    </span>
  )
}
