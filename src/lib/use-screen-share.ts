import { useCallback, useEffect, useRef, useState } from 'react'
import { useClientValue } from '@/lib/use-client-value'

/**
 * Captures the screen, a window, or a browser tab with getDisplayMedia.
 * Stops cleanly when the user ends sharing from the browser's own UI.
 */
export function useScreenShare() {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const supported = useClientValue(
    () =>
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getDisplayMedia === 'function',
    true,
  )

  const stop = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
    setStream(null)
  }, [])

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('Screen sharing is not supported in this browser.')
      return false
    }
    try {
      const captured = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: true,
      })
      stop()
      streamRef.current = captured
      setStream(captured)
      setError(null)
      const [video] = captured.getVideoTracks()
      video?.addEventListener('ended', stop, { once: true })
      return true
    } catch (err) {
      const name = (err as { name?: string })?.name
      if (name !== 'NotAllowedError' && name !== 'AbortError') {
        setError('Could not start sharing. Try again or pick another window.')
      }
      return false
    }
  }, [stop])

  useEffect(() => stop, [stop])

  const sourceLabel = (() => {
    const settings = stream?.getVideoTracks()[0]?.getSettings() as
      (MediaTrackSettings & { displaySurface?: string }) | undefined
    switch (settings?.displaySurface) {
      case 'monitor':
        return 'entire screen'
      case 'window':
        return 'a window'
      case 'browser':
        return 'a browser tab'
      default:
        return 'your screen'
    }
  })()

  return { stream, start, stop, error, supported, sourceLabel }
}
