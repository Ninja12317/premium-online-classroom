import type { FloatingReaction } from './types'

/** Emoji that float up from the bottom of the stage and fade away. */
export function ReactionsOverlay({ items }: { items: FloatingReaction[] }) {
  if (items.length === 0) return null
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-live="polite"
    >
      {items.map((r) => (
        <div
          key={r.id}
          className="absolute bottom-20 flex animate-float-up flex-col items-center motion-reduce:animate-none"
          style={{ left: `${r.x}%` }}
        >
          <span className="text-4xl drop-shadow">{r.emoji}</span>
          <span className="mt-1 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-medium text-white">
            {r.name}
          </span>
        </div>
      ))}
    </div>
  )
}
