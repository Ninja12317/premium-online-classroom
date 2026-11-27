import { useState, type FormEvent } from 'react'
import {
  Link,
  createFileRoute,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth'

import { AuthShell } from '@/components/auth-shell'
import { useIdentity } from '@/components/identity-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { describeAuthError } from '@/lib/auth-errors'
import { auth } from '@/services/firebase'

export const Route = createFileRoute('/signup')({ component: SignupPage })

function SignupPage() {
  const [state, setState] = useState<'idle' | 'pending' | 'error'>('idle')
  const [error, setError] = useState('')
  const router = useRouter()
  const navigate = useNavigate()
  const { refresh } = useIdentity()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state === 'pending') return
    const fields = new FormData(event.currentTarget)
    const password = String(fields.get('password'))
    const name = String(fields.get('name')).trim()
    const email = String(fields.get('email')).trim()
    if (password.length < 8) {
      setError('Use at least 8 characters for your password.')
      setState('error')
      return
    }
    setState('pending')
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      if (name) {
        await updateProfile(cred.user, { displayName: name })
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
