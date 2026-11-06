import { useSyncExternalStore } from 'react'
import type { Connection } from '@/lib/meeting-types'

interface NetworkInformationLike {
  effectiveType?: string
  downlink?: number
  rtt?: number
  addEventListener?: (type: 'change', cb: () => void) => void
  removeEventListener?: (type: 'change', cb: () => void) => void
}

function connection() {
  return (navigator as Navigator & { connection?: NetworkInformationLike })
    .connection
}

function rate(info: NetworkInformationLike | undefined): Connection {
  if (!info) return 'good'
  if (info.effectiveType === 'slow-2g' || info.effectiveType === '2g')
    return 'poor'
  if (info.effectiveType === '3g' || (info.rtt ?? 0) > 400) return 'fair'
  if ((info.downlink ?? 10) < 1.5) return 'fair'
  return 'good'
}

function subscribe(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  connection()?.addEventListener?.('change', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
    connection()?.removeEventListener?.('change', cb)
  }
}

/** Online/offline state plus a coarse quality rating from the Network Information API. */
export function useNetwork() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
  const quality = useSyncExternalStore(
    subscribe,
    () => rate(connection()),
    () => 'good' as Connection,
  )
  return { online, quality }
}
