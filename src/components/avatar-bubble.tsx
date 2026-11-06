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
  className,
}: {
  name: string
  seed?: string
  className?: string
}) {
  const hue = hueFor(seed ?? name)
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-display font-semibold text-white',
        className,
      )}
      style={{ background: `oklch(0.52 0.12 ${hue})` }}
    >
      {initials(name) || '?'}
    </span>
  )
}
