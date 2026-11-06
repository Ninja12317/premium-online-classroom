import { useSyncExternalStore } from 'react'

const noop = () => () => {}

/** True after hydration; use to render time- or storage-dependent UI client-side only. */
export function useMounted() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  )
}
