import { useEffect } from 'react'

type Handler = (event: KeyboardEvent) => void

/**
 * Single-key shortcuts that stay out of the way while typing. Keys are
 * matched case-insensitively against `event.key`.
 */
export function useHotkeys(map: Record<string, Handler>, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable
      ) {
        return
      }
      const handler = map[event.key] ?? map[event.key.toLowerCase()]
      if (handler) {
        event.preventDefault()
        handler(event)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [map, enabled])
}

export const SHORTCUTS: { key: string; label: string }[] = [
  { key: 'M', label: 'Mute / unmute microphone' },
  { key: 'V', label: 'Turn camera on / off' },
  { key: 'S', label: 'Start / stop screen share' },
  { key: 'W', label: 'Open / close whiteboard' },
  { key: 'C', label: 'Chat panel' },
  { key: 'P', label: 'Participants panel' },
  { key: 'H', label: 'Raise / lower hand' },
  { key: 'G', label: 'Switch gallery / speaker view' },
  { key: 'F', label: 'Toggle full screen' },
  { key: '?', label: 'Show keyboard shortcuts' },
  { key: 'Esc', label: 'Close panel or whiteboard' },
]
