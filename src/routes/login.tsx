import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { AuthFormPanel } from '@/components/auth-modal'
import { AuthShell } from '@/components/auth-shell'

export const Route = createFileRoute('/login')({ component: LoginPage })

function LoginPage() {
  const navigate = useNavigate()

  return (
    <AuthShell
      title="Welcome to Lectern"
      subtitle="Sign in to your Teacher or Student account, or continue as a Guest."
    >
      <AuthFormPanel
        initialMode="signin"
        onSuccess={() => void navigate({ to: '/' })}
      />
    </AuthShell>
  )
}
