import { useState, type FormEvent } from 'react'
import {
  Link,
  createFileRoute,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { signup } from '@netlify/identity'
import { MailCheck } from 'lucide-react'

import { AuthShell } from '@/components/auth-shell'
import { useIdentity } from '@/components/identity-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { describeAuthError } from '@/lib/auth-errors'

export const Route = createFileRoute('/signup')({ component: SignupPage })

function SignupPage() {
  const [state, setState] = useState<
    'idle' | 'pending' | 'error' | 'check-email'
  >('idle')
  const [error, setError] = useState('')
  const router = useRouter()
  const navigate = useNavigate()
  const { refresh } = useIdentity()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state === 'pending') return
    const fields = new FormData(event.currentTarget)
    const password = String(fields.get('password'))
    if (password.length < 8) {
      setError('Use at least 8 characters for your password.')
      setState('error')
      return
    }
    setState('pending')
    try {
      const user = await signup(String(fields.get('email')), password, {
        full_name: String(fields.get('name')).trim(),
      })
      if (!user.confirmedAt) {
        setState('check-email')
        return
      }
      await refresh()
      await router.invalidate()
      await navigate({ to: '/' })
    } catch (err) {
      setError(
        describeAuthError(
          err,
          'We couldn’t create your account. Please try again.',
        ).message,
      )
      setState('error')
    }
  }

  if (state === 'check-email') {
    return (
      <AuthShell
        title="Check your inbox"
        subtitle="We sent you a confirmation link."
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
            <MailCheck className="size-6" />
          </span>
          <p className="text-sm text-muted-foreground">
            Open the email and tap the link to confirm your account. The link
            signs you in automatically, so stay in this browser if you can.
            Check your spam folder if it hasn’t arrived in a minute.
          </p>
          <Button asChild variant="outline" className="mt-2">
            <Link to="/login">Go to sign in</Link>
          </Button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Create a teacher account"
      subtitle="Accounts are for teachers. Students join classes with a link, no account needed."
    >
      <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={state === 'pending'} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Your name</Label>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              required
              placeholder="As students should see it"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
            />
          </div>
          <Button type="submit" className="w-full">
            {state === 'pending' ? 'Creating account…' : 'Create account'}
          </Button>
        </fieldset>
        {state === 'error' && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link
          to="/login"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthShell>
  )
}
