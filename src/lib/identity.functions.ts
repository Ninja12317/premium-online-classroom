import { createServerFn } from '@tanstack/react-start'
import { getUser } from '@netlify/identity'

export interface SessionUser {
  id: string
  name: string
  email: string
}

/** The signed-in teacher, or null. Only exposes what the UI needs. */
export const getServerUser = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionUser | null> => {
    try {
      const user = await getUser()
      if (!user) return null
      return {
        id: user.id,
        name: user.name ?? user.email?.split('@')[0] ?? 'Teacher',
        email: user.email ?? '',
      }
    } catch {
      return null
    }
  },
)
