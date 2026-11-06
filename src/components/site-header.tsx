import { Link, useRouter } from '@tanstack/react-router'
import { LogOut, User as UserIcon } from 'lucide-react'
import { logout } from '@netlify/identity'
import { toast } from 'sonner'

import { Brand } from '@/components/brand'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { displayName, useIdentity } from '@/components/identity-provider'

export function SiteHeader() {
  const { user, ready, refresh } = useIdentity()
  const router = useRouter()

  async function signOut() {
    try {
      await logout()
      await refresh()
      await router.invalidate()
      toast.success('Signed out')
    } catch {
      toast.error('Could not sign out. Try again.')
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-content items-center justify-between gap-4 px-4 sm:px-6">
        <Brand />
        <nav className="flex items-center gap-1" aria-label="Account">
          <ThemeToggle />
          {!ready ? (
            <span className="ml-1 h-8 w-20 animate-pulse rounded-md bg-muted" />
          ) : user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="ml-1 gap-2">
                  <span className="grid size-5 place-items-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                    {displayName(user).slice(0, 1).toUpperCase()}
                  </span>
                  <span className="max-w-32 truncate">{displayName(user)}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                  {user.email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/">
                    <UserIcon className="size-4" /> My classes
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void signOut()}>
                  <LogOut className="size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="ml-1">
                <Link to="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/signup">Sign up</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
