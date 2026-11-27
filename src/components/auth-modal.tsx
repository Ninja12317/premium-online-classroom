import { useState, type FormEvent } from 'react'
import { useRouter } from '@tanstack/react-router'
import { sendPasswordResetEmail } from 'firebase/auth'
import {
  ArrowLeft,
  BookOpen,
  GraduationCap,
  UserRound,
} from 'lucide-react'
import { toast } from 'sonner'

import { BackButton } from '@/components/back-button'
import { useIdentity } from '@/components/identity-provider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { describeAuthError } from '@/lib/auth-errors'
import { cn } from '@/lib/utils'
import { auth } from '@/services/firebase'

export type AuthModalMode = 'signin' | 'teacher' | 'student' | 'guest'

export function AuthFormPanel({
  initialMode = 'signin',
  onSuccess,
}: {
  initialMode?: AuthModalMode
  onSuccess?: () => void
}) {
  const { signInAccount, registerAccount, signInAsGuest } = useIdentity()
  const router = useRouter()

  const [mode, setMode] = useState<AuthModalMode>(initialMode)
  const [seenInitial, setSeenInitial] = useState(initialMode)
  if (initialMode !== seenInitial) {
    setSeenInitial(initialMode)
    setMode(initialMode)
  }

  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sign-in fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // Sign-up fields
  const [fullName, setFullName] = useState('')
  const [subjectOrInstitution, setSubjectOrInstitution] = useState('')
  const [classOrRollNo, setClassOrRollNo] = useState('')

  // Guest 1-field prompt
  const [guestName, setGuestName] = useState('')

  function switchMode(next: AuthModalMode) {
    setError(null)
    setMode(next)
  }

  async function handleSignIn(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    setError(null)
    setPending(true)
    try {
      const account = await signInAccount(email, password)
      await router.invalidate()
      toast.success(`Signed in as ${account.name}`)
      onSuccess?.()
    } catch (err) {
      setError(
        describeAuthError(
          err,
          'We couldn’t sign you in. Check your email and password and try again.',
        ).message,
      )
    } finally {
      setPending(false)
    }
  }

  async function handleRegister(e: FormEvent, role: 'teacher' | 'student') {
    e.preventDefault()
    if (pending) return
    setError(null)
    if (!fullName.trim()) {
      setError('Please enter your full name.')
      return
    }
    if (password.length < 8) {
      setError('Use at least 8 characters for your password.')
      return
    }
    setPending(true)
    try {
      const account = await registerAccount({
        role,
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        subjectOrInstitution:
          role === 'teacher' ? subjectOrInstitution.trim() : undefined,
        classOrRollNo: role === 'student' ? classOrRollNo.trim() : undefined,
      })
      await router.invalidate()
      toast.success(
        role === 'teacher'
          ? `Teacher account created for ${account.name}`
          : `Student account created for ${account.name}`,
      )
      onSuccess?.()
    } catch (err) {
      setError(
        describeAuthError(
          err,
          'We couldn’t create your account. Please try again.',
        ).message,
      )
    } finally {
      setPending(false)
    }
  }

  async function handleGuestContinue(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    setError(null)
    setPending(true)
    try {
      const guest = await signInAsGuest(guestName)
      await router.invalidate()
      toast.success(`Continuing as ${guest.name}`)
      onSuccess?.()
    } catch (err) {
      setError(
        describeAuthError(
          err,
          'Could not start a guest session right now. Please try again.',
        ).message,
      )
    } finally {
      setPending(false)
    }
  }

  async function handleForgot() {
    if (!email.trim()) {
      toast.error('Enter your email first, then tap “Forgot password”.')
      return
    }
    try {
      await sendPasswordResetEmail(auth, email.trim())
      toast.success('Check your inbox for a password reset link.')
    } catch (err) {
      toast.error(
        describeAuthError(err, 'Could not send a reset email right now.')
          .message,
      )
    }
  }

  const isSignup = mode === 'teacher' || mode === 'student'

  return (
    <div className="space-y-4">
      {mode === 'guest' ? (
        <form onSubmit={(e) => void handleGuestContinue(e)} className="space-y-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" /> Back to Sign In
            </button>
          </div>

          <div className="rounded-xl border bg-muted/40 p-3.5 text-xs text-muted-foreground">
            Join classes by link or meeting ID, chat, raise your hand, and
            collaborate on whiteboards right away. You can create a Teacher or
            Student account anytime.
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="auth-guest-name">Display Name</Label>
            <Input
              id="auth-guest-name"
              autoFocus
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Guest"
              maxLength={60}
              disabled={pending}
            />
            <p className="text-[11px] text-muted-foreground">
              Leave blank to continue as <strong>Guest</strong>.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Starting guest session…' : 'Continue'}
          </Button>
        </form>
      ) : (
        <>
          {/* Primary mode switcher: Sign In vs Create Account */}
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/70 p-1">
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm',
                mode === 'signin'
                  ? 'bg-card text-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => switchMode(isSignup ? mode : 'teacher')}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm',
                isSignup
                  ? 'bg-card text-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Create Account
            </button>
          </div>

          {mode === 'signin' ? (
            <form onSubmit={(e) => void handleSignIn(e)} className="space-y-4">
              <fieldset disabled={pending} className="space-y-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="auth-signin-email">Email</Label>
                  <Input
                    id="auth-signin-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@school.edu"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="auth-signin-password">Password</Label>
                    <button
                      type="button"
                      onClick={() => void handleForgot()}
                      className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Input
                    id="auth-signin-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full">
                  {pending ? 'Signing in…' : 'Sign In'}
                </Button>
              </fieldset>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </form>
          ) : (
            <div className="space-y-4">
              {/* Two distinct signup paths: Teacher vs Student */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => switchMode('teacher')}
                  aria-pressed={mode === 'teacher'}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors',
                    mode === 'teacher'
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                >
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <GraduationCap className="size-4 text-primary" />
                    Teacher
                  </span>
                  <span className="text-[11px] leading-snug text-muted-foreground">
                    Host classes, schedule & get a PMI
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('student')}
                  aria-pressed={mode === 'student'}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors',
                    mode === 'student'
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                >
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <BookOpen className="size-4 text-primary" />
                    Student
                  </span>
                  <span className="text-[11px] leading-snug text-muted-foreground">
                    Join classes, chat & collaborate
                  </span>
                </button>
              </div>

              <form
                onSubmit={(e) => void handleRegister(e, mode)}
                className="space-y-3.5"
              >
                <fieldset disabled={pending} className="space-y-3.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="auth-signup-name">Full Name</Label>
                    <Input
                      id="auth-signup-name"
                      autoComplete="name"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder={
                        mode === 'teacher'
                          ? 'e.g. Dr. Priya Sharma'
                          : 'e.g. Aarav Patel'
                      }
                      maxLength={60}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="auth-signup-email">Email</Label>
                    <Input
                      id="auth-signup-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@school.edu"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="auth-signup-password">Password</Label>
                    <Input
                      id="auth-signup-password"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                    />
                  </div>
                  {mode === 'teacher' ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="auth-signup-subject">
                        Subject / Institution{' '}
                        <span className="font-normal text-muted-foreground">
                          (optional)
                        </span>
                      </Label>
                      <Input
                        id="auth-signup-subject"
                        value={subjectOrInstitution}
                        onChange={(e) =>
                          setSubjectOrInstitution(e.target.value)
                        }
                        placeholder="e.g. Mathematics · St. Xavier's"
                        maxLength={80}
                      />
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Label htmlFor="auth-signup-class">
                        Class / Roll No.{' '}
                        <span className="font-normal text-muted-foreground">
                          (optional)
                        </span>
                      </Label>
                      <Input
                        id="auth-signup-class"
                        value={classOrRollNo}
                        onChange={(e) => setClassOrRollNo(e.target.value)}
                        placeholder="e.g. Grade 10-A · Roll 14"
                        maxLength={60}
                      />
                    </div>
                  )}
                  <Button type="submit" className="w-full">
                    {pending
                      ? 'Creating account…'
                      : mode === 'teacher'
                        ? 'Create Teacher Account'
                        : 'Create Student Account'}
                  </Button>
                </fieldset>
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </form>
            </div>
          )}

          {/* Clear "or" divider + prominent Continue as Guest option */}
          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center" aria-hidden>
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2.5 text-muted-foreground">or</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            onClick={() => switchMode('guest')}
            disabled={pending}
          >
            <UserRound className="size-4" />
            Continue as Guest
          </Button>
        </>
      )}
    </div>
  )
}

export function AuthModal({
  open,
  onOpenChange,
  initialMode = 'signin',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialMode?: AuthModalMode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2.5 pr-6">
            <BackButton
              onClick={() => onOpenChange(false)}
              ariaLabel="Close sign in dialog"
              className="size-9 min-h-9 min-w-9 sm:hidden"
            />
            <div>
              <DialogTitle>Welcome to Lectern</DialogTitle>
              <DialogDescription>
                Sign in, create a Teacher or Student account, or continue as a
                Guest.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <AuthFormPanel
          key={`${open ? 'open' : 'closed'}-${initialMode}`}
          initialMode={initialMode}
          onSuccess={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
