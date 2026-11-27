import { useState, type FormEvent } from 'react'
import {
  Link,
  createFileRoute,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { updatePassword } from 'firebase/auth'
import { toast } from 'sonner'

import { AuthShell } from '@/components/auth-shell'
import { useIdentity } from '@/components/identity-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { describeAuthError } from '@/lib/auth-errors'
import { auth } from '@/services/firebase'

export const Route = createFileRoute('/reset-password')({
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { user, ready, refresh } = useIdentity()
  const [state, setState] = useState<'idle' | 'pending' | 'error'>('idle')
  const [error, setError] = useState('')
  const router = useRouter()
  const navigate = useNavigate()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state === 'pending' || !auth.currentUser) return
    const fields = new FormData(event.currentTarget)
    const password = String(fields.get('password'))
    const confirm = String(fields.get('confirm'))
    if (password.length < 8) {
      setError('Use at least 8 characters for your password.')
      setState('error')
      return
    }
    if (password !== confirm) {
      setError('The two passwords don’t match.')
      setState('error')
      return
    }
    setState('pending')
    try {
      await updatePassword(auth.currentUser, password)
      await refresh()
      await router.invalidate()
      toast.success('Password updated. You are signed in.')
      await navigate({ to: '/' })
    } catch (err) {
      setError(
        describeAuthError(err, 'We couldn’t save your password. Try again.')
          .message,
      )
      setState('error')
    }
  }

  if (!ready) {
    return (
      <AuthShell title="One moment" subtitle="Checking your account…">
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      </AuthShell>
    )
  }

  if (!user) {
    return (
      <AuthShell
        title="Sign in needed"
        subtitle="Sign in or use “Forgot password?” on the sign-in screen to reset your password."
      >
        <p className="text-sm text-muted-foreground">
          You can request a password reset email directly from the sign-in form.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link to="/login">Go to sign in</Link>
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle={`Signed in as ${user.email ?? 'you'}. Pick a password you’ll remember.`}
    >
      <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={state === 'pending'} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Repeat password</Label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
            />
          </div>
          <Button type="submit" className="w-full">
            {state === 'pending' ? 'Saving…' : 'Save password'}
          </Button>
        </fieldset>
        {state === 'error' && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </AuthShell>
  )
}
