import { useEffect } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { useIdentity } from '@/components/identity-provider'

/**
 * Reacts to an emailed Identity link once `IdentityProvider` has processed
 * it: confirmation signs the teacher in, recovery and invites go to the
 * set-password page, and a bad link shows an error. Rendered inside the
 * router so it can navigate.
 */
export function AuthCallbackHandler() {
  const { callback, callbackError, clearCallback } = useIdentity()
  const router = useRouter()
  const navigate = useNavigate()

  useEffect(() => {
    if (callbackError) {
      toast.error(
        `${callbackError.replace(/\.?$/, '.')} Request a new link and try again.`,
        { duration: 8000 },
      )
      clearCallback()
      return
    }
    if (!callback) return

    switch (callback.type) {
      case 'confirmation':
        toast.success('Email confirmed. You are signed in.')
        clearCallback()
        void router.invalidate().then(() => navigate({ to: '/' }))
        break
      case 'oauth':
        toast.success('Signed in.')
        clearCallback()
        void router.invalidate().then(() => navigate({ to: '/' }))
        break
      case 'email_change':
        toast.success('Email address updated.')
        clearCallback()
        void router.invalidate()
        break
      case 'recovery':
      case 'invite':
        // The reset-password page reads `callback` and clears it when done.
        void navigate({ to: '/reset-password' })
        break
    }
  }, [callback, callbackError, clearCallback, navigate, router])

  return null
}
