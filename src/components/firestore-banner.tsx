import { useSyncExternalStore } from 'react'
import { AlertTriangle, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  clearFirestoreNotice,
  getFirestoreNotice,
  subscribeFirestoreNotice,
} from '@/services/firebase'

/**
 * Single non-blocking, dismissible banner shown if Cloud Firestore rejects
 * access, displaying the exact failing path without ever bouncing the user
 * out of their active meeting or dashboard.
 */
export function FirestoreNoticeBanner() {
  const notice = useSyncExternalStore(
    subscribeFirestoreNotice,
    getFirestoreNotice,
    () => null,
  )
  if (!notice) return null
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 border-b border-amber/50 bg-amber/15 px-4 py-2 text-xs text-foreground sm:items-center sm:text-sm"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-foreground dark:text-amber sm:mt-0" />
      <p className="min-w-0 flex-1 leading-snug">
        <span className="font-medium">Firestore access error on </span>
        <code className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-[11px]">
          {notice.path}
        </code>
        <span className="ml-1.5 text-muted-foreground">{notice.message}</span>
      </p>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        onClick={clearFirestoreNotice}
        aria-label="Dismiss Firebase notice"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  )
}
