import type { ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { BackButton } from '@/components/back-button'
import { Brand } from '@/components/brand'
import { ThemeToggle } from '@/components/theme-toggle'

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <main className="relative grid min-h-svh place-items-center px-4 py-12">
      <div
        className="paper-grid pointer-events-none absolute inset-0 -z-10"
        aria-hidden
      />
      <div className="absolute left-4 top-4">
        <BackButton
          onClick={() => {
            if (typeof window !== 'undefined' && window.history.length > 1) {
              window.history.back()
            } else {
              void navigate({ to: '/' })
            }
          }}
          label="Back"
        />
      </div>
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="animate-fade-up motion-reduce:animate-none w-full max-w-sm">
        <Brand className="mb-8 justify-center" />
        <div className="rounded-2xl border bg-card p-6 shadow-lg shadow-foreground/5 sm:p-8">
          <h1 className="font-display text-2xl font-semibold">{title}</h1>
          <p className="mb-6 mt-1 text-sm text-muted-foreground">{subtitle}</p>
          {children}
        </div>
      </div>
    </main>
  )
}
