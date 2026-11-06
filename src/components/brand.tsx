import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

export function Logo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none">
        <path
          d="M5 6h14v9H5z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M12 15v4M8 19h8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M8.5 9.5h7M8.5 12h4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity=".8"
        />
      </svg>
    </span>
  )
}

export function Brand({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      className={cn(
        'flex items-center gap-2.5 rounded-md font-display text-lg font-semibold tracking-tight',
        className,
      )}
    >
      <Logo />
      Lectern
    </Link>
  )
}
