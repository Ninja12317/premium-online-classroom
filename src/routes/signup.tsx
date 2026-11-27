import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { AuthFormPanel, type AuthModalMode } from '@/components/auth-modal'
import { AuthShell } from '@/components/auth-shell'

export const Route = createFileRoute('/signup')({
  validateSearch: (search: Record<string, unknown>): { role?: string } => ({
    role: typeof search.role === 'string' ? search.role : undefined,
  }),
  component: SignupPage,
})

function SignupPage() {
  const navigate = useNavigate()
  const { role } = Route.useSearch()
  const initialMode: AuthModalMode =
    role === 'student' ? 'student' : 'teacher'

  return (
    <AuthShell
      title="Create your Lectern account"
      subtitle="Choose Teacher to host and schedule classes, or Student to join and collaborate."
    >
      <AuthFormPanel
        initialMode={initialMode}
        onSuccess={() => void navigate({ to: '/' })}
      />
    </AuthShell>
  )
}
