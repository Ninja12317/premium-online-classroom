// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncResult } from '@/lib/meeting-types'
import { MeshRoom } from './mesh-room'

/** Minimal RTCPeerConnection stand-in: enough to drive the signalling path. */
class FakePC {
  static instances: FakePC[] = []
  config: RTCConfiguration | undefined
  localDescription: { type: string; sdp: string } | null = null
  remoteDescription: { type: string; sdp: string } | null = null
  signalingState = 'stable'
  connectionState = 'new'
  iceConnectionState = 'new'
  iceGatheringState = 'gathering'
  restartIceCalls = 0
  addedIceCandidates: RTCIceCandidateInit[] = []
  transceivers: { sender: { replaceTrack: () => Promise<void> } }[] = []
  onicecandidate: ((ev: unknown) => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  ontrack: ((ev: unknown) => void) | null = null
  dc: FakeDC | null = null
  constructor(config?: RTCConfiguration) {
    this.config = config
    FakePC.instances.push(this)
  }
  restartIce() {
    this.restartIceCalls += 1
  }
  createDataChannel() {
    this.dc = new FakeDC()
    return this.dc
  }
  addTransceiver() {
    const t = { sender: { replaceTrack: () => Promise.resolve() } }
    this.transceivers.push(t)
    return t
  }
  getTransceivers() {
    return this.transceivers
  }
  async createOffer() {
    return { type: 'offer', sdp: 'v=0 offer' }
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'v=0 answer' }
  }
  async setLocalDescription(d: { type: string; sdp: string }) {
    this.localDescription = d
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'
  }
  async setRemoteDescription(d: { type: string; sdp: string }) {
    this.remoteDescription = d
    if (d.type === 'offer') {
      this.transceivers = [0, 1, 2, 3].map(() => ({
        sender: { replaceTrack: () => Promise.resolve() },
      }))
    } else {
      this.signalingState = 'stable'
    }
  }
  async addIceCandidate(c: RTCIceCandidateInit) {
    this.addedIceCandidates.push(c)
  }
  async getStats() {
    return new Map()
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.connectionState = 'closed'
  }
}

class FakeDC {
  readyState: 'connecting' | 'open' | 'closed' = 'connecting'
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  send(raw: string) {
    this.sent.push(raw)
  }
  close() {
    this.readyState = 'closed'
  }
  open() {
    this.readyState = 'open'
    this.onopen?.()
  }
}

class FakeStream {
  tracks: { kind: string }[] = []
  getTracks() {
    return this.tracks
  }
  addTrack(t: { kind: string }) {
    this.tracks.push(t)
  }
  removeTrack(t: { kind: string }) {
    this.tracks = this.tracks.filter((x) => x !== t)
  }
}

const ok = (over: Partial<Extract<SyncResult, { status: 'ok' }>> = {}) =>
  ({
    status: 'ok',
    role: 'host',
    settings: {
      locked: false,
      waitingRoom: true,
      allowStudentScreenShare: false,
      allowStudentDraw: false,
      allowChat: true,
      allowPrivateChat: true,
    },
    peers: [],
    inbox: [],
    waiting: [],
    ...over,
  }) satisfies SyncResult

function makeRoom(sync: ReturnType<typeof vi.fn>, identity = 'a-host') {
  const onMessage = vi.fn()
  const room = new MeshRoom({
    identity,
    name: 'Teacher',
    role: 'host',
    iceServers: [],
    initialSettings: ok().settings,
    sync: sync as never,
    leave: vi.fn(async () => ({ ok: true })),
    onChange: vi.fn(),
    onMessage,
  })
  return { room, onMessage }
}

type SyncCall = { sessionId: string; outbox: { kind: string; to: string }[] }
const callArg = (sync: ReturnType<typeof vi.fn>, n: number) =>
  (sync.mock.calls as unknown as [SyncCall][])[n]?.[0]

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('MeshRoom', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakePC.instances = []
    vi.stubGlobal('RTCPeerConnection', FakePC)
    vi.stubGlobal('MediaStream', FakeStream)
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      cb()
      return 1
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('connects after the first successful sync and adopts settings', async () => {
    const sync = vi.fn(async () =>
      ok({ settings: { ...ok().settings, locked: true } }),
    )
    const { room } = makeRoom(sync)
    expect(room.status).toBe('connecting')
    room.start()
    await flush()
    expect(room.status).toBe('connected')
    expect(room.settings.locked).toBe(true)
    expect(sync).toHaveBeenCalledTimes(1)
    await room.stop()
  })

  it('leaves with the right cause when the server says removed or ended', async () => {
    const sync = vi.fn(async () => ({ status: 'removed' }) as SyncResult)
    const { room } = makeRoom(sync)
    room.start()
    await flush()
    expect(room.status).toBe('disconnected')
    expect(room.cause).toBe('removed')

    const ended = makeRoom(vi.fn(async () => ({ status: 'ended' })))
    ended.room.start()
    await flush()
    expect(ended.room.cause).toBe('ended')
  })

  it('offers to peers it leads and queues the offer for the next sync', async () => {
    const sync = vi.fn(async () =>
      ok({
        peers: [
          {
            identity: 'b-student',
            session: 's1',
            name: 'Sam',
            role: 'student',
          },
        ],
      }),
    )
    const { room } = makeRoom(sync, 'a-host')
    room.start()
    await flush()
    expect(room.peers.get('b-student')?.link).toBe('connecting')
    expect(room.connectingNames).toEqual(['Sam'])
    expect(FakePC.instances).toHaveLength(1)
    // The offer is sent on the quick follow-up sync.
    await vi.advanceTimersByTimeAsync(60)
    const second = callArg(sync, 1)
    expect(second.outbox).toHaveLength(1)
    expect(second.outbox[0]).toMatchObject({ kind: 'offer', to: 'b-student' })
    await room.stop()
  })

  it('answers offers from peers that lead, and delivers app messages', async () => {
    let calls = 0
    const sync = vi.fn(async () => {
      calls += 1
      return ok({
        peers: [
          { identity: 'a-teacher', session: 's9', name: 'Zoe', role: 'host' },
        ],
        inbox:
          calls === 1
            ? [
                {
                  id: 1,
                  kind: 'offer' as const,
                  from: 'a-teacher',
                  fromSession: 's9',
                  payload: JSON.stringify({ type: 'offer', sdp: 'v=0' }),
                },
              ]
            : [],
      })
    })
    const { room, onMessage } = makeRoom(sync, 'z-student')
    room.start()
    await flush()
    await vi.advanceTimersByTimeAsync(60)
    const second = callArg(sync, 1)
    expect(second.outbox[0]).toMatchObject({ kind: 'answer' })

    const pc = FakePC.instances[0]
    pc.dc!.open()
    expect(room.peers.get('a-teacher')?.link).toBe('connected')
    pc.dc!.onmessage?.({
      data: JSON.stringify({
        k: 'app',
        m: JSON.stringify({ t: 'reaction', emoji: '👏' }),
      }),
    })
    expect(onMessage).toHaveBeenCalledWith(
      { id: 'a-teacher', name: 'Zoe', role: 'host' },
      { t: 'reaction', emoji: '👏' },
    )
    pc.dc!.onmessage?.({
      data: JSON.stringify({
        k: 'state',
        s: { micOn: true, handRaised: true },
      }),
    })
    expect(room.peers.get('a-teacher')?.state).toMatchObject({
      micOn: true,
      handRaised: true,
    })
    await room.stop()
  })

  it('ignores offers from peers it should lead (glare guard)', async () => {
    const sync = vi.fn(async () =>
      ok({
        peers: [
          {
            identity: 'b-student',
            session: 's1',
            name: 'Sam',
            role: 'student',
          },
        ],
        inbox: [
          {
            id: 1,
            kind: 'offer' as const,
            from: 'b-student',
            fromSession: 's1',
            payload: JSON.stringify({ type: 'offer', sdp: 'v=0' }),
          },
        ],
      }),
    )
    const { room } = makeRoom(sync, 'a-host')
    room.start()
    await flush()
    // Only our own offer connection exists; the incoming offer was dropped.
    expect(FakePC.instances).toHaveLength(1)
    expect(FakePC.instances[0].localDescription?.type).toBe('offer')
    await room.stop()
  })

  it('uses iceCandidatePoolSize: 4 and Trickle ICE without waiting for gathering', async () => {
    const sentSignals: { kind: string; to: string; payload: string }[] = []
    const cleanupSignals = vi.fn(async () => {})
    const sync = vi.fn(async () =>
      ok({
        peers: [
          {
            identity: 'b-student',
            session: 's1',
            name: 'Sam',
            role: 'student',
          },
        ],
      }),
    )
    const room = new MeshRoom({
      identity: 'a-host',
      name: 'Teacher',
      role: 'host',
      iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
      initialSettings: ok().settings,
      sync: sync as never,
      leave: vi.fn(async () => ({ ok: true })),
      sendSignal: async (_sid, sig) => {
        sentSignals.push(sig)
      },
      cleanupSignals,
      onChange: vi.fn(),
      onMessage: vi.fn(),
    })
    room.start()
    await flush()
    expect(cleanupSignals).toHaveBeenCalledWith(room.sessionId)
    expect(FakePC.instances).toHaveLength(1)
    const pc = FakePC.instances[0]
    expect(pc.config?.iceCandidatePoolSize).toBe(4)
    // Offer was sent immediately even though iceGatheringState is still 'gathering'
    expect(sentSignals.some((s) => s.kind === 'offer')).toBe(true)

    // Trickle ICE candidate emits immediately without waiting for poll loop
    pc.onicecandidate?.({
      candidate: {
        toJSON: () => ({ candidate: 'candidate:1 1 udp 1 127.0.0.1 9 typ host' }),
      },
    })
    expect(sentSignals.some((s) => s.kind === 'ice')).toBe(true)
    await room.stop()
  })

  it('queues early remote ICE candidates before offer arrives and flushes after setRemoteDescription', async () => {
    let pushSignals: ((sigs: import('@/lib/meeting-types').IncomingSignal[]) => void) | null = null
    let pushParticipants:
      | ((u: {
          peers: import('@/lib/meeting-types').PeerInfo[]
          waiting: import('@/lib/meeting-types').WaitingParticipant[]
          leftIds: string[]
        }) => void)
      | null = null
    const sync = vi.fn(async () => ok())
    const room = new MeshRoom({
      identity: 'z-student',
      name: 'Student',
      role: 'student',
      iceServers: [],
      initialSettings: ok().settings,
      sync: sync as never,
      leave: vi.fn(async () => ({ ok: true })),
      sendSignal: async () => {},
      subscribeSignals: (_sid, cb) => {
        pushSignals = cb
        return () => {}
      },
      subscribeParticipants: (cb) => {
        pushParticipants = cb
        return () => {}
      },
      onChange: vi.fn(),
      onMessage: vi.fn(),
    })
    room.start()
    await flush()

    // Early ICE candidate arrives BEFORE participant discovery or Offer
    pushSignals!([
      {
        id: 'ice-early-1',
        kind: 'ice',
        from: 'a-teacher',
        fromSession: 's9',
        payload: JSON.stringify({ candidate: 'candidate:early', sdpMid: '0' }),
      },
    ])
    await flush()
    expect(FakePC.instances).toHaveLength(0)

    // Participant arrives, then Offer arrives
    pushParticipants!({
      peers: [{ identity: 'a-teacher', session: 's9', name: 'Zoe', role: 'host' }],
      waiting: [],
      leftIds: [],
    })
    pushSignals!([
      {
        id: 'offer-1',
        kind: 'offer',
        from: 'a-teacher',
        fromSession: 's9',
        payload: JSON.stringify({ type: 'offer', sdp: 'v=0' }),
      },
    ])
    await flush()
    expect(FakePC.instances).toHaveLength(1)
    expect(FakePC.instances[0].addedIceCandidates).toEqual([
      { candidate: 'candidate:early', sdpMid: '0' },
    ])

    // Immediate peer drop when leftIds reports departure
    pushParticipants!({
      peers: [],
      waiting: [],
      leftIds: ['a-teacher'],
    })
    await flush()
    expect(room.peers.has('a-teacher')).toBe(false)
    expect(FakePC.instances[0].connectionState).toBe('closed')
    await room.stop()
  })

  it('generates a fresh UUID sessionId per instance and tears down completely on stop()', async () => {
    const unsubSignals = vi.fn()
    const unsubParticipants = vi.fn()
    const leave = vi.fn(async () => ({ ok: true }))
    const sync = vi.fn(async () =>
      ok({
        peers: [
          { identity: 'b-student', session: 's1', name: 'Sam', role: 'student' },
        ],
      }),
    )
    const room1 = new MeshRoom({
      identity: 'a-host',
      name: 'Teacher',
      role: 'host',
      iceServers: [],
      initialSettings: ok().settings,
      sync: sync as never,
      leave,
      subscribeSignals: () => unsubSignals,
      subscribeParticipants: () => unsubParticipants,
      onChange: vi.fn(),
      onMessage: vi.fn(),
    })
    const room2 = new MeshRoom({
      identity: 'a-host',
      name: 'Teacher',
      role: 'host',
      iceServers: [],
      initialSettings: ok().settings,
      sync: sync as never,
      leave,
      onChange: vi.fn(),
      onMessage: vi.fn(),
    })
    expect(room1.sessionId).not.toBe(room2.sessionId)
    expect(room1.sessionId.length).toBeGreaterThanOrEqual(20)

    room1.setLocalTracks({
      mic: { kind: 'audio' } as MediaStreamTrack,
      cam: { kind: 'video' } as MediaStreamTrack,
      screen: null,
      screenAudio: null,
    })
    room1.start()
    await flush()
    expect(FakePC.instances).toHaveLength(1)
    expect(room1.peers.size).toBe(1)

    await room1.stop('left')
    expect(FakePC.instances[0].connectionState).toBe('closed')
    expect(unsubSignals).toHaveBeenCalledTimes(1)
    expect(unsubParticipants).toHaveBeenCalledTimes(1)
    expect(leave).toHaveBeenCalledTimes(1)
    expect(room1.peers.size).toBe(0)
    expect(room1.localTracks).toEqual({
      mic: null,
      cam: null,
      screen: null,
      screenAudio: null,
    })
  })

  it('tears down stale RTCPeerConnection and renegotiates when a remote peer rejoins with a new sessionId', async () => {
    let pushParticipants:
      | ((u: {
          peers: import('@/lib/meeting-types').PeerInfo[]
          waiting: import('@/lib/meeting-types').WaitingParticipant[]
          leftIds: string[]
        }) => void)
      | null = null
    const sentSignals: { kind: string; to: string; toSession: string }[] = []
    const sync = vi.fn(async () => ok())
    const room = new MeshRoom({
      identity: 'a-host',
      name: 'Teacher',
      role: 'host',
      iceServers: [],
      initialSettings: ok().settings,
      sync: sync as never,
      leave: vi.fn(async () => ({ ok: true })),
      sendSignal: async (_sid, sig) => {
        sentSignals.push(sig)
      },
      subscribeParticipants: (cb) => {
        pushParticipants = cb
        return () => {}
      },
      onChange: vi.fn(),
      onMessage: vi.fn(),
    })
    room.start()
    await flush()

    // Initial peer session
    pushParticipants!({
      peers: [{ identity: 'b-student', session: 'sess-old', name: 'Sam', role: 'student' }],
      waiting: [],
      leftIds: [],
    })
    await flush()
    expect(FakePC.instances).toHaveLength(1)
    const firstPc = FakePC.instances[0]
    firstPc.dc!.open()
    expect(room.peers.get('b-student')?.link).toBe('connected')

    // Peer rejoins with a brand-new sessionId
    pushParticipants!({
      peers: [{ identity: 'b-student', session: 'sess-new', name: 'Sam', role: 'student' }],
      waiting: [],
      leftIds: [],
    })
    await flush()
    expect(firstPc.connectionState).toBe('closed')
    expect(FakePC.instances).toHaveLength(2)
    expect(
      sentSignals.some(
        (s) => s.kind === 'offer' && s.to === 'b-student' && s.toSession === 'sess-new',
      ),
    ).toBe(true)
    await room.stop()
  })

  it('calls restartIce() on disconnected peer connections and rebuilds if unrecovered', async () => {
    const sync = vi.fn(async () =>
      ok({
        peers: [
          { identity: 'b-student', session: 's1', name: 'Sam', role: 'student' },
        ],
      }),
    )
    const { room } = makeRoom(sync, 'a-host')
    room.start()
    await flush()
    expect(FakePC.instances).toHaveLength(1)
    const pc1 = FakePC.instances[0]
    pc1.connectionState = 'connected'
    pc1.dc!.open()
    expect(room.peers.get('b-student')?.quality).toBe('good')

    // Simulate network drop -> disconnected triggers restartIce() immediately
    pc1.connectionState = 'disconnected'
    pc1.onconnectionstatechange?.()
    expect(pc1.restartIceCalls).toBe(1)
    expect(room.peers.get('b-student')?.quality).toBe('lost')

    // If still disconnected after recovery grace (3s), stale PC closes and a fresh PC opens
    await vi.advanceTimersByTimeAsync(3100)
    await flush()
    expect(pc1.connectionState).toBe('closed')
    expect(FakePC.instances).toHaveLength(2)
    await room.stop()
  })
})
