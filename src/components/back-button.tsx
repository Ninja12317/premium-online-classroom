import { ArrowLeft } from 'lucide-react'

import { cn } from '@/lib/utils'

export function BackButton({
  onClick,
  label,
  ariaLabel = 'Go back',
  className,
}: {
  onClick: () => void
  label?: string
  ariaLabel?: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label ? undefined : ariaLabel}
      className={cn(
        'inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-border/70 bg-card/85 text-sm font-medium text-foreground shadow-2xs transition-colors duration-150 motion-reduce:transition-none hover:bg-muted active:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        label ? 'px-3' : 'px-0',
        className,
      )}
    >
      <ArrowLeft className="size-4 shrink-0" />
      {label && <span className="truncate">{label}</span>}
    </button>
  )
}
