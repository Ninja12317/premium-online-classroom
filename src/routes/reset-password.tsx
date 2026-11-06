import { useState, type FormEvent } from 'react'
import {
  Link,
  createFileRoute,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { acceptInvite, updateUser } from '@netlify/identity'
import { toast } from 'sonner'

import { AuthShell } from '@/components/auth-shell'
import { useIdentity } from '@/components/identity-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { describeAuthError } from '@/lib/auth-errors'

export const Route = createFileRoute('/reset-password')({
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { user, ready, callback, clearCallback, refresh } = useIdentity()
  const [state, setState] = useState<'idle' | 'pending' | 'error'>('idle')
  const [error, setError] = useState('')
  const router = useRouter()
  const navigate = useNavigate()

  const invite = callback?.type === 'invite' ? callback : null
  const canSetPassword = !!invite || !!user

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state === 'pending') return
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
      if (invite?.token) {
        await acceptInvite(invite.token, password)
      } else {
        await updateUser({ password })
      }
      clearCallback()
      await refresh()
      await router.invalidate()
      toast.success(
        invite
          ? 'Your account is ready.'
          : 'Password updated. You are signed in.',
      )
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
      <AuthShell title="One moment" subtitle="Checking your link…">
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      </AuthShell>
    )
  }

  if (!canSetPassword) {
    return (
      <AuthShell
        title="Link needed"
        subtitle="To set a new password, open the reset link from your email."
      >
        <p className="text-sm text-muted-foreground">
          Reset links expire after a while. If yours no longer works, go to sign
          in and tap “Forgot password?” to get a new one.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link to="/login">Go to sign in</Link>
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title={invite ? 'Set your password' : 'Choose a new password'}
      subtitle={
        invite
          ? 'Finish setting up your teacher account.'
          : `Signed in as ${user?.email ?? 'you'}. Pick a password you’ll remember.`
      }
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
