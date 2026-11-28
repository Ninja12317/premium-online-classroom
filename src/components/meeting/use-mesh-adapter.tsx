import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { DeviceSelection } from '@/components/device-settings'
import type { IceServer, MeetingSettings, Role } from '@/lib/meeting-types'
import { MeshRoom, type MeshPeer } from '@/lib/mesh/mesh-room'
import type { JoinPrefs } from '@/lib/prefs'
import { leaveRoom, syncRoom } from '@/lib/signaling.functions'
import {
  subscribeMeetingParticipants,
  subscribeMeetingSignals,
  updateParticipantState,
} from '@/services/firestore-meetings'
import { useAttachStream, useLocalMedia } from '@/lib/use-local-media'
import { useNetwork } from '@/lib/use-network'
import { useScreenShare } from '@/lib/use-screen-share'
import { useSpeaking } from '@/lib/use-speaking'
import type { DisconnectCause, RoomAdapter, RoomState } from './adapter'
import type { TileModel } from './types'

function StreamVideo({
  stream,
  contain,
  mirror,
  blur,
}: {
  stream: MediaStream
  contain?: boolean
  mirror?: boolean
  blur?: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useAttachStream(ref, stream)
  return (
    <video
      ref={ref}
      autoPlay
      muted
      playsInline
      className={[
        contain ? 'h-full w-full object-contain' : '',
        mirror ? '-scale-x-100' : '',
        blur ? 'blur-[6px] scale-[1.04]' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    />
  )
}

/** Plays a remote audio stream, honouring the chosen speaker when supported. */
function StreamAudio({
  stream,
  sinkId,
}: {
  stream: MediaStream
  sinkId?: string
}) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    el.play().catch(() => {})
    return () => {
      el.srcObject = null
    }
  }, [stream])
  useEffect(() => {
    const el = ref.current as
      | (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> })
      | null
    if (!el || !sinkId || typeof el.setSinkId !== 'function') return
    el.setSinkId(sinkId).catch(() => {})
  }, [sinkId])
  return <audio ref={ref} autoPlay />
}

export interface MeshAdapterOptions {
  meetingId: string
  identity: string
  participantKey: string
  name: string
  role: Role
  prefs: JoinPrefs
  iceServers: IceServer[]
  initialSettings: MeetingSettings
}

/**
 * Multi-party room over direct WebRTC connections (full mesh) backed by Cloud
 * Firestore signaling. StrictMode-safe: bare useEffect cleanup calls `pause()`
 * instead of `stop('left')` so React dev double-mounts never kick the user.
 * Media errors never disconnect or exit the room.
 */
export function useMeshAdapter(opts: MeshAdapterOptions): RoomAdapter & {
  localRole: Role
} {
  const { meetingId, identity, participantKey, name, role, prefs } = opts
  const [micOn, setMic] = useState(prefs.micOn)
  const [camOn, setCam] = useState(prefs.camOn)
  const [blurOn, setBlurOn] = useState(false)
  const [selection, setSelection] = useState<DeviceSelection>({
    cameraId: prefs.cameraId,
    micId: prefs.micId,
    speakerId: prefs.speakerId,
  })
  const [handRaised, setHandRaised] = useState(false)
  const media = useLocalMedia({
    micOn,
    camOn,
    cameraId: selection.cameraId,
    micId: selection.micId,
  })
  const { speaking } = useSpeaking(media.stream, micOn)
  const share = useScreenShare()
  const { online, quality: netQuality } = useNetwork()

  const [version, bump] = useState(0)
  const [subscribers] = useState(
    () => new Set<Parameters<RoomAdapter['subscribe']>[0]>(),
  )
  const [room] = useState(
    () =>
      new MeshRoom({
        identity,
        name,
        role,
        iceServers: opts.iceServers,
        initialSettings: opts.initialSettings,
        sync: (input) =>
          syncRoom({
            data: {
              meetingId,
              identity,
              participantKey,
              sessionId: input.sessionId,
              outbox: input.outbox,
            },
          }),
        leave: () =>
          leaveRoom({ data: { meetingId, identity, participantKey } }),
        onChange: () => bump((v) => v + 1),
        onMessage: (from, message) => {
          for (const cb of subscribers) cb(from, message)
        },
      }),
  )

  // StrictMode-safe lifecycle: only depends on [room, meetingId, identity].
  // Real-time signal & participant listeners nudge MeshRoom immediately (<150ms)
  // so WebRTC offers/answers/ICE candidates never wait on poll intervals.
  useEffect(() => {
    room.start()
    const unsubSignals = subscribeMeetingSignals(meetingId, identity, () => {
      room.nudge()
    })
    const unsubParticipants = subscribeMeetingParticipants(meetingId, () => {
      room.nudge()
    })
    const onBeforeUnload = () => {
      void room.stop('left')
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      unsubSignals()
      unsubParticipants()
      room.pause()
    }
  }, [room, meetingId, identity])

  // Publish local tracks whenever they change.
  const camTrack = media.hasVideo
    ? (media.stream?.getVideoTracks()[0] ?? null)
    : null
  const micTrack = media.stream?.getAudioTracks()[0] ?? null
  const screenTrack = share.stream?.getVideoTracks()[0] ?? null
  const screenAudioTrack = share.stream?.getAudioTracks()[0] ?? null
  useEffect(() => {
    room.setLocalTracks({
      mic: micTrack,
      cam: camTrack,
      screen: screenTrack,
      screenAudio: screenAudioTrack,
    })
  }, [room, micTrack, camTrack, screenTrack, screenAudioTrack])

  const sharing = !!share.stream
  useEffect(() => {
    room.setLocalState({
      micOn,
      camOn: camOn && media.hasVideo,
      sharing,
      handRaised,
      speaking,
    })
  }, [room, micOn, camOn, media.hasVideo, sharing, handRaised, speaking])

  // Mirror mic/cam/hand status to Firestore participant document.
  useEffect(() => {
    void updateParticipantState(meetingId, identity, {
      micOn,
      camOn: camOn && media.hasVideo,
      handRaised,
    })
  }, [meetingId, identity, micOn, camOn, media.hasVideo, handRaised])

  // ---- view model -------------------------------------------------------------

  const peers = Array.from(room.peers.values())
  const connected = peers.filter((p) => p.link === 'connected')
  const localQuality = online ? netQuality : 'lost'

  const tiles = useMemo<TileModel[]>(() => {
    const local: TileModel = {
      id: identity,
      name,
      role: room.role,
      isLocal: true,
      micOn,
      camOn: camOn && media.hasVideo,
      speaking,
      handRaised,
      quality: room.status === 'reconnecting' ? 'lost' : localQuality,
      sharing,
    }
    const remote = connected.map<TileModel>((p) => ({
      id: p.identity,
      name: p.name,
      role: p.role,
      isLocal: false,
      micOn: p.state.micOn,
      camOn: p.state.camOn && p.hasCamTrack,
      speaking: p.state.speaking,
      handRaised: p.state.handRaised,
      quality: p.quality,
      sharing: p.state.sharing && p.hasScreenTrack,
    }))
    return [local, ...remote]
    // `version` bumps whenever the room engine reports a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    version,
    identity,
    name,
    room.role,
    room.status,
    micOn,
    camOn,
    media.hasVideo,
    speaking,
    handRaised,
    localQuality,
    sharing,
  ])

  const activeSpeakerId = (() => {
    let best: { id: string; at: number } | null = null
    if (speaking) best = { id: identity, at: Number.MAX_SAFE_INTEGER }
    for (const p of connected) {
      if (p.state.speaking && (!best || p.lastSpokeAt > best.at)) {
        best = { id: p.identity, at: p.lastSpokeAt }
      }
    }
    return best?.id ?? null
  })()

  const localStream = media.stream
  const renderVideo = useCallback(
    (tile: TileModel) => {
      if (tile.isLocal) {
        return localStream && media.hasVideo ? (
          <StreamVideo stream={localStream} mirror blur={blurOn} />
        ) : null
      }
      const peer = room.peers.get(tile.id)
      return peer && peer.hasCamTrack && peer.state.camOn ? (
        <StreamVideo stream={peer.camStream} />
      ) : null
    },
    [room, localStream, media.hasVideo, blurOn],
  )

  const presenter: MeshPeer | undefined = connected.find(
    (p) => p.state.sharing && p.hasScreenTrack,
  )
  const screenShare = presenter
    ? {
        ownerId: presenter.identity,
        ownerName: presenter.name,
        node: (
          <StreamVideo
            key={presenter.identity}
            stream={presenter.screenStream}
            contain
          />
        ),
      }
    : share.stream
      ? {
          ownerId: identity,
          ownerName: name,
          node: <StreamVideo key="local" stream={share.stream} contain />,
        }
      : null

  const audioNode = (
    <>
      {connected.map((p) => (
        <StreamAudio
          key={p.identity}
          stream={p.micStream}
          sinkId={selection.speakerId}
        />
      ))}
      {presenter && (
        <StreamAudio
          key={`${presenter.identity}-screen`}
          stream={presenter.screenStream}
          sinkId={selection.speakerId}
        />
      )}
    </>
  )

  const subscribe = useCallback<RoomAdapter['subscribe']>(
    (cb) => {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    [subscribers],
  )

  const send = useCallback<RoomAdapter['send']>(
    (message, to) => room.send(message, to),
    [room],
  )

  const state: RoomState = room.status
  const disconnectCause: DisconnectCause =
    room.cause === 'left' ? null : room.cause

  return {
    realtime: true,
    state,
    disconnectCause,
    localId: identity,
    localRole: room.role,
    tiles,
    activeSpeakerId,
    renderVideo,
    screenShare,
    audioNode,
    micOn,
    camOn: camOn && media.hasVideo,
    blurOn,
    setBlurOn,
    setMicOn: async (on) => setMic(on),
    setCamOn: async (on) => setCam(on),
    sharing,
    shareSupported: share.supported,
    startShare: share.start,
    stopShare: async () => share.stop(),
    devices: media.devices,
    selection,
    setDevices: async (next) => setSelection(next),
    micTrack,
    mediaError: media.error,
    quality: room.status === 'reconnecting' ? 'lost' : localQuality,
    roomSettings: room.settings,
    waiting: room.waiting,
    connectingNames: room.connectingNames,
    spotlightId: room.spotlightId,
    breakout: room.breakout,
    send,
    subscribe,
    handRaised,
    setHand: setHandRaised,
    leave: async () => {
      await room.stop('left')
    },
  }
}
