import { useCallback, useEffect, useRef, useState } from 'react'

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: {
    length: number
    [index: number]: {
      isFinal: boolean
      0: { transcript: string }
    }
  }
}

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null
  onerror: ((ev: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechCtor = new () => SpeechRecognitionLike

function getSpeechCtor(): SpeechCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechCtor
    webkitSpeechRecognition?: SpeechCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/**
 * Browser Web Speech API live captions hook. Gracefully reports unsupported
 * browsers without throwing.
 */
export function useCaptions(
  onCaption?: (text: string, final: boolean) => void,
) {
  const [enabled, setEnabled] = useState(false)
  const [supported] = useState(() => !!getSpeechCtor())
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const enabledRef = useRef(false)
  const cbRef = useRef(onCaption)

  useEffect(() => {
    cbRef.current = onCaption
  }, [onCaption])

  const stop = useCallback(() => {
    enabledRef.current = false
    setEnabled(false)
    try {
      recRef.current?.stop()
    } catch {
      // ignore
    }
    recRef.current = null
  }, [])

  const start = useCallback(() => {
    const Ctor = getSpeechCtor()
    if (!Ctor) {
      setError('Live captions require Chrome, Edge, or Safari speech recognition.')
      return false
    }
    setError(null)
    enabledRef.current = true
    setEnabled(true)

    const launch = () => {
      if (!enabledRef.current) return
      const rec = new Ctor()
      rec.continuous = true
      rec.interimResults = true
      rec.lang = navigator.language || 'en-US'
      rec.onresult = (ev) => {
        let interim = ''
        let finalText = ''
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const res = ev.results[i]
          const transcript = res[0]?.transcript ?? ''
          if (res.isFinal) finalText += transcript
          else interim += transcript
        }
        if (finalText.trim()) cbRef.current?.(finalText.trim(), true)
        else if (interim.trim()) cbRef.current?.(interim.trim(), false)
      }
      rec.onerror = (ev) => {
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
          setError('Microphone permission is required for live captions.')
          stop()
        }
      }
      rec.onend = () => {
        if (enabledRef.current) {
          window.setTimeout(launch, 350)
        }
      }
      recRef.current = rec
      try {
        rec.start()
      } catch {
        // ignore double-start
      }
    }
    launch()
    return true
  }, [stop])

  useEffect(() => () => stop(), [stop])

  return {
    enabled,
    supported,
    error,
    toggle: () => (enabled ? stop() : start()),
    stop,
  }
}
