import { useEffect, useState } from 'react'

/**
 * Real active-speaker detection for a local stream: samples microphone
 * loudness ~10x a second with an AnalyserNode and reports a level (0-1).
 */
export function useSpeaking(stream: MediaStream | null, enabled: boolean) {
  const [level, setLevel] = useState(0)
  const [speaking, setSpeaking] = useState(false)

  useEffect(() => {
    const track = stream?.getAudioTracks()[0]
    if (!stream || !track || !enabled || typeof AudioContext === 'undefined')
      return
    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(new MediaStream([track]))
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.6
    source.connect(analyser)
    const buffer = new Uint8Array(analyser.frequencyBinCount)
    let quietSince = 0
    let lastSpeaking = false

    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(buffer)
      let sum = 0
      for (let i = 0; i < buffer.length; i++) {
        const v = (buffer[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / buffer.length)
      const normalized = Math.min(1, rms * 4)
      setLevel(normalized)
      const now = performance.now()
      if (normalized > 0.08) {
        quietSince = now
        if (!lastSpeaking) {
          lastSpeaking = true
          setSpeaking(true)
        }
      } else if (lastSpeaking && now - quietSince > 600) {
        lastSpeaking = false
        setSpeaking(false)
      }
    }, 100)

    if (ctx.state === 'suspended') ctx.resume().catch(() => {})

    return () => {
      window.clearInterval(timer)
      source.disconnect()
      analyser.disconnect()
      ctx.close().catch(() => {})
    }
  }, [stream, enabled])

  const active = !!stream && enabled
  return { level: active ? level : 0, speaking: active ? speaking : false }
}
