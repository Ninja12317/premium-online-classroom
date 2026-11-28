import { useState } from 'react'
import {
  Calendar,
  Download,
  Film,
  Home,
  MessageSquare,
  PenTool,
  Settings,
} from 'lucide-react'

import { Brand } from '@/components/brand'
import { useIdentity } from '@/components/identity-provider'
import { InstallAppDialog } from '@/components/install-app-dialog'
import { ProfileMenu } from '@/components/profile-menu'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { usePWAInstall } from '@/lib/use-pwa-install'
import { cn } from '@/lib/utils'

export type DashboardTab =
  | 'home'
  | 'meetings'
  | 'chat'
  | 'whiteboards'
  | 'recordings'
  | 'settings'

export const DASHBOARD_NAV_ITEMS: {
  id: DashboardTab
  label: string
  icon: typeof Home
}[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'meetings', label: 'Meetings', icon: Calendar },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'whiteboards', label: 'Whiteboards', icon: PenTool },
  { id: 'recordings', label: 'Recordings', icon: Film },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export function SiteHeader({
  activeTab,
  onTabChange,
}: {
  activeTab?: DashboardTab
  onTabChange?: (tab: DashboardTab) => void
}) {
  const { ready } = useIdentity()
  const { isInstallable, showInstallOption, guidance, promptInstall } =
    usePWAInstall()
  const [installDialogOpen, setInstallDialogOpen] = useState(false)

  async function handleInstallClick() {
    if (isInstallable) {
      const result = await promptInstall()
      if (result !== 'unavailable') return
    }
    setInstallDialogOpen(true)
  }

  return (
    <>
      <header className="safe-top sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-14 max-w-content items-center justify-between gap-2 px-4 sm:px-6">
          <Brand />

          {/* Desktop & tablet navigation bar (hidden on mobile < 768px) */}
          {onTabChange && (
            <nav
              aria-label="Primary navigation"
              className="no-scrollbar hidden min-w-0 items-center gap-0.5 overflow-x-auto rounded-xl bg-muted/70 p-1 md:flex"
            >
              {DASHBOARD_NAV_ITEMS.map((item) => {
                const active = activeTab === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onTabChange(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-medium transition-colors motion-reduce:transition-none lg:px-3 lg:text-sm',
                      active
                        ? 'bg-card text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <item.icon className="hidden size-4 shrink-0 lg:block" />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </nav>
          )}

          <nav className="flex shrink-0 items-center gap-1" aria-label="Account">
            {showInstallOption && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Install App"
                title="Install Lectern app"
                onClick={() => void handleInstallClick()}
                className="inline-flex h-9 gap-1.5 rounded-full border-primary/30 bg-primary/8 px-2.5 text-xs font-medium text-primary hover:bg-primary/14 xl:px-3"
              >
                <Download className="size-3.5 shrink-0" />
                <span className="hidden sm:inline md:hidden xl:inline">
                  Install App
                </span>
              </Button>
            )}
            <ThemeToggle />
            {!ready ? (
              <span className="ml-1 h-9 w-9 animate-pulse rounded-full bg-muted sm:w-24" />
            ) : (
              <ProfileMenu
                onOpenSettings={
                  onTabChange ? () => onTabChange('settings') : undefined
                }
              />
            )}
          </nav>
        </div>
      </header>

      <InstallAppDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
        isInstallable={isInstallable}
        guidance={guidance}
        onInstallNow={promptInstall}
      />
    </>
  )
}

/**
 * Mobile-only 2026 SaaS floating rounded pill dock (< 768px) with all 6
 * dashboard tabs on a single crisp row using Lectern's exact theme tokens.
 */
export function MobileBottomNav({
  activeTab,
  onTabChange,
}: {
  activeTab: DashboardTab
  onTabChange: (tab: DashboardTab) => void
}) {
  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed bottom-3 left-3 right-3 z-40 mb-[env(safe-area-inset-bottom)] rounded-3xl border border-border/80 bg-card/90 p-1.5 shadow-[0_10px_30px_-8px_rgba(0,0,0,0.18)] backdrop-blur-xl supports-[backdrop-filter]:bg-card/75 dark:shadow-[0_12px_34px_-8px_rgba(0,0,0,0.55)] md:hidden"
    >
      <div className="grid grid-cols-6 gap-0.5">
        {DASHBOARD_NAV_ITEMS.map((item) => {
          const active = activeTab === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex min-h-[50px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-2xl px-0.5 py-1.5 transition-all duration-200 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'bg-primary/14 text-primary shadow-xs'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              <item.icon
                className={cn(
                  'size-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none',
                  active && 'scale-105',
                )}
              />
              <span
                className={cn(
                  'w-full truncate text-center text-[10px] leading-tight',
                  active ? 'font-semibold' : 'font-medium',
                )}
              >
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
