import { useCallback, useEffect, useRef, useState } from 'react'

export interface DeviceLists {
  cameras: MediaDeviceInfo[]
  microphones: MediaDeviceInfo[]
  speakers: MediaDeviceInfo[]
}

export type MediaErrorKind =
  'denied' | 'not-found' | 'in-use' | 'unsupported' | 'unknown'

export interface LocalMediaOptions {
  micOn: boolean
  camOn: boolean
  cameraId?: string
  micId?: string
}

const emptyDevices: DeviceLists = { cameras: [], microphones: [], speakers: [] }

export function classifyMediaError(err: unknown): MediaErrorKind {
  const name = (err as { name?: string })?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'not-found'
  if (name === 'NotReadableError' || name === 'AbortError') return 'in-use'
  return 'unknown'
}

/**
 * Owns the local camera and microphone for a screen. Camera off releases the
 * video track so the hardware light turns off; mic off disables the track so
 * unmuting is instant. All tracks stop on unmount.
 */
export function useLocalMedia(options: LocalMediaOptions) {
  const { micOn, camOn, cameraId, micId } = options
  const streamRef = useRef<MediaStream | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [devices, setDevices] = useState<DeviceLists>(emptyDevices)
  const [error, setError] = useState<MediaErrorKind | null>(null)
  const [pending, setPending] = useState(true)
  const [supported, setSupported] = useState(true)
  const [hasVideo, setHasVideo] = useState(false)

  const publish = useCallback(() => {
    const s = streamRef.current
    setHasVideo(!!s && s.getVideoTracks().some((t) => t.readyState === 'live'))
    // Clone the reference so consumers re-render when tracks change.
    setStream(s ? new MediaStream(s.getTracks()) : null)
  }, [])

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setDevices({
        cameras: all.filter((d) => d.kind === 'videoinput'),
        microphones: all.filter((d) => d.kind === 'audioinput'),
        speakers: all.filter((d) => d.kind === 'audiooutput'),
      })
    } catch {
      // Device listing is best effort.
    }
  }, [])

  const ensureStream = () => {
    if (!streamRef.current) streamRef.current = new MediaStream()
    return streamRef.current
  }

  const stopKind = (kind: 'audio' | 'video') => {
    const s = streamRef.current
    if (!s) return
    for (const track of s.getTracks()) {
      if (track.kind === kind) {
        track.stop()
        s.removeTrack(track)
      }
    }
  }

  const acquire = useCallback(
    async (kind: 'audio' | 'video', deviceId?: string) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setSupported(false)
        setError('unsupported')
        return
      }
      const constraint: MediaTrackConstraints = deviceId
        ? { deviceId: { exact: deviceId } }
        : kind === 'video'
          ? {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: 'user',
            }
          : {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }
      try {
        const fresh = await navigator.mediaDevices.getUserMedia(
          kind === 'video' ? { video: constraint } : { audio: constraint },
        )
        stopKind(kind)
        const target = ensureStream()
        for (const track of fresh.getTracks()) target.addTrack(track)
        setError(null)
        await refreshDevices()
      } catch (err) {
        if (deviceId) {
          // Fall back to any device of that kind when the chosen one is gone.
          try {
            const fallback = await navigator.mediaDevices.getUserMedia(
              kind === 'video' ? { video: true } : { audio: true },
            )
            stopKind(kind)
            const target = ensureStream()
            for (const track of fallback.getTracks()) target.addTrack(track)
            setError(null)
            return
          } catch (inner) {
            setError(classifyMediaError(inner))
            return
          }
        }
        setError(classifyMediaError(err))
      }
    },
    [refreshDevices],
  )

  // Camera lifecycle.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setPending(true)
      if (camOn) {
        await acquire('video', cameraId)
      } else {
        stopKind('video')
      }
      if (!cancelled) {
        publish()
        setPending(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [camOn, cameraId, acquire, publish])

  // Microphone lifecycle: acquire once, then toggle `enabled`.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const s = streamRef.current
      const existing = s?.getAudioTracks().find((t) => t.readyState === 'live')
      if (!existing || micId) {
        const currentId = existing?.getSettings().deviceId
        if (!existing || (micId && currentId !== micId)) {
          await acquire('audio', micId)
        }
      }
      for (const track of streamRef.current?.getAudioTracks() ?? []) {
        track.enabled = micOn
      }
      if (!cancelled) publish()
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [micOn, micId, acquire, publish])

  // Keep the device list fresh when hardware is plugged in or removed.
  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md?.enumerateDevices) return
    let active = true
    const update = () => {
      md.enumerateDevices()
        .then((all) => {
          if (!active) return
          setDevices({
            cameras: all.filter((d) => d.kind === 'videoinput'),
            microphones: all.filter((d) => d.kind === 'audioinput'),
            speakers: all.filter((d) => d.kind === 'audiooutput'),
          })
        })
        .catch(() => {})
    }
    update()
    md.addEventListener?.('devicechange', update)
    return () => {
      active = false
      md.removeEventListener?.('devicechange', update)
    }
  }, [])

  // Release hardware when the screen unmounts.
  useEffect(() => {
    return () => {
      for (const track of streamRef.current?.getTracks() ?? []) track.stop()
      streamRef.current = null
    }
  }, [])

  return {
    stream,
    hasVideo,
    devices,
    error,
    pending,
    supported,
    refreshDevices,
  }
}

/** Attaches a MediaStream to a <video> element and detaches on change. */
export function useAttachStream(
  ref: React.RefObject<HTMLVideoElement | null>,
  stream: MediaStream | null,
) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    if (stream) {
      el.play().catch(() => {
        // Autoplay can be blocked until the user interacts; the element retries.
      })
    }
    return () => {
      el.srcObject = null
    }
  }, [ref, stream])
}
