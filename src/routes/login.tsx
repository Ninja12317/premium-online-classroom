import { useState, type FormEvent } from 'react'
import {
  Link,
  createFileRoute,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { login, requestPasswordRecovery, signup } from '@netlify/identity'
import { toast } from 'sonner'

import { AuthShell } from '@/components/auth-shell'
import { useIdentity } from '@/components/identity-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { describeAuthError, type AuthErrorKind } from '@/lib/auth-errors'

export const Route = createFileRoute('/login')({ component: LoginPage })

const FALLBACK = 'We couldn’t sign you in. Check your details and try again.'

function LoginPage() {
  const [state, setState] = useState<'idle' | 'pending' | 'error'>('idle')
  const [error, setError] = useState(FALLBACK)
  const [errorKind, setErrorKind] = useState<AuthErrorKind>('unknown')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [resending, setResending] = useState(false)
  const router = useRouter()
  const navigate = useNavigate()
  const { refresh } = useIdentity()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state === 'pending') return
    setState('pending')
    try {
      await login(email.trim(), password)
      await refresh()
      await router.invalidate()
      await navigate({ to: '/' })
    } catch (err) {
      const info = describeAuthError(err, FALLBACK)
      setError(info.message)
      setErrorKind(info.kind)
      setState('error')
    }
  }

  /** Signing up again with the same details re-sends the confirmation email. */
  async function resendConfirmation() {
    if (resending) return
    setResending(true)
    try {
      await signup(email.trim(), password)
      toast.success('Confirmation email sent again. Check your inbox and spam.')
    } catch (err) {
      const info = describeAuthError(err, 'Could not resend the email.')
      toast.error(
        info.kind === 'exists'
          ? 'This email is already confirmed. Try signing in again.'
          : info.message,
      )
    } finally {
      setResending(false)
    }
  }

  async function forgot() {
    if (!email) {
      toast.error('Enter your email first, then tap “Forgot password”.')
      return
    }
    try {
      await requestPasswordRecovery(email.trim())
      toast.success('Check your inbox for a reset link.')
    } catch (err) {
      toast.error(
        describeAuthError(err, 'Could not send a reset email right now.')
          .message,
      )
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to see your scheduled classes and start them from anywhere."
    >
      <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={state === 'pending'} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <button
                type="button"
                onClick={() => void forgot()}
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                Forgot password?
              </button>
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full">
            {state === 'pending' ? 'Signing in…' : 'Sign in'}
          </Button>
        </fieldset>
        {state === 'error' && (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{error}</p>
            {errorKind === 'unconfirmed' && (
              <p className="text-muted-foreground">
                Didn’t get it?{' '}
                <button
                  type="button"
                  onClick={() => void resendConfirmation()}
                  disabled={resending}
                  className="font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-60"
                >
                  {resending ? 'Sending…' : 'Resend the confirmation email'}
                </button>
              </p>
            )}
          </div>
        )}
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New here?{' '}
        <Link
          to="/signup"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Create a teacher account
        </Link>
      </p>
    </AuthShell>
  )
}
