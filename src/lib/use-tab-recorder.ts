import { useCallback, useEffect, useRef, useState } from 'react'
import { saveRecording } from '@/services/recordings-db'

export interface RecorderMeta {
  meetingId?: string
  title?: string
}

/**
 * Records the class as the teacher sees and hears it by capturing this tab
 * (video + the audio the tab plays) mixed with the local microphone. Saves a
 * WebM file into local IndexedDB (for the Recordings dashboard tab) and
 * downloads it when stopped.
 */
export function useTabRecorder(
  micTrack: MediaStreamTrack | null,
  meta?: RecorderMeta,
) {
  const [recording, setRecording] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef<number>(0)
  const metaRef = useRef(meta)
  useEffect(() => {
    metaRef.current = meta
  }, [meta])
  const cleanupRef = useRef<() => void>(() => {})

  const supported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getDisplayMedia &&
    typeof MediaRecorder !== 'undefined'

  const stop = useCallback(() => {
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
  }, [])

  const start = useCallback(async () => {
    if (!supported) {
      setError('Recording needs a desktop browser such as Chrome or Edge.')
      return false
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 24, max: 30 } },
        audio: true,
        ...({
          preferCurrentTab: true,
          selfBrowserSurface: 'include',
        } as object),
      })
      const ctx = new AudioContext()
      const dest = ctx.createMediaStreamDestination()
      let hasAudio = false
      if (display.getAudioTracks().length) {
        ctx
          .createMediaStreamSource(new MediaStream(display.getAudioTracks()))
          .connect(dest)
        hasAudio = true
      }
      if (micTrack && micTrack.readyState === 'live') {
        ctx.createMediaStreamSource(new MediaStream([micTrack])).connect(dest)
        hasAudio = true
      }
      const tracks = [
        ...display.getVideoTracks(),
        ...(hasAudio ? dest.stream.getAudioTracks() : []),
      ]
      const mixed = new MediaStream(tracks)
      const mime = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ].find((m) => MediaRecorder.isTypeSupported(m))
      const rec = new MediaRecorder(
        mixed,
        mime ? { mimeType: mime } : undefined,
      )
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        const mimeType = rec.mimeType || 'video/webm'
        const blob = new Blob(chunksRef.current, { type: mimeType })
        const now = Date.now()
        const durationSec = Math.max(
          1,
          Math.round((now - (startedAtRef.current || now)) / 1000),
        )
        const title = metaRef.current?.title || 'Lectern class recording'
        const meetingId = metaRef.current?.meetingId || 'local'

        // Save into IndexedDB so it appears in the Recordings dashboard tab
        void saveRecording({
          id: `rec-${now}-${Math.random().toString(36).slice(2, 6)}`,
          meetingId,
          title,
          createdAt: now,
          durationSec,
          sizeBytes: blob.size,
          mimeType,
          blob,
        }).catch(() => {})

        // Also offer immediate browser download
        const href = URL.createObjectURL(blob)
        const a = document.createElement('a')
        const stamp = new Date(now)
          .toISOString()
          .slice(0, 16)
          .replace(/[:T]/g, '-')
        a.href = href
        a.download = `lectern-${stamp}.webm`
        a.click()
        setTimeout(() => URL.revokeObjectURL(href), 2000)
        cleanupRef.current()
        setRecording(false)
        setStartedAt(null)
      }
      cleanupRef.current = () => {
        for (const t of display.getTracks()) t.stop()
        ctx.close().catch(() => {})
        recorderRef.current = null
      }
      display
        .getVideoTracks()[0]
        ?.addEventListener('ended', stop, { once: true })
      rec.start(1000)
      recorderRef.current = rec
      const startNow = Date.now()
      startedAtRef.current = startNow
      setRecording(true)
      setStartedAt(startNow)
      setError(null)
      return true
    } catch (err) {
      const name = (err as { name?: string })?.name
      if (name !== 'NotAllowedError' && name !== 'AbortError') {
        setError('Could not start recording in this browser.')
      }
      return false
    }
  }, [supported, micTrack, stop])

  useEffect(() => () => cleanupRef.current(), [])

  return { recording, startedAt, start, stop, error, supported }
}
