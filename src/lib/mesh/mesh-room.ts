import type {
  Connection,
  IceServer,
  IncomingSignal,
  MeetingSettings,
  OutgoingSignal,
  PeerInfo,
  Role,
  SyncResult,
  WaitingParticipant,
} from '@/lib/meeting-types'
import { decode, encode, type RealtimeMessage } from '@/lib/realtime'

/**
 * Peer-to-peer meeting engine. Every participant keeps one RTCPeerConnection
 * to every other participant (a full mesh), which is the right shape for a
 * small class: no media server, no third-party account, and the lowest
 * possible latency. Discovery and the SDP/ICE handshake go through the
 * `sync` server function (backed by Netlify Database); after that, audio,
 * video and all messages travel directly between browsers.
 *
 * Each connection carries four fixed transceivers, in this order:
 * microphone, camera, screen video, screen audio. Tracks are swapped in and
 * out with `replaceTrack`, so turning the camera or screen share on or off
 * never requires renegotiation.
 */

export interface LocalTracks {
  mic: MediaStreamTrack | null
  cam: MediaStreamTrack | null
  screen: MediaStreamTrack | null
  screenAudio: MediaStreamTrack | null
}

export interface PeerState {
  micOn: boolean
  camOn: boolean
  sharing: boolean
  handRaised: boolean
  speaking: boolean
}

export type PeerLink = 'connecting' | 'connected' | 'failed'

export interface MeshPeer {
  identity: string
  session: string
  name: string
  role: Role
  link: PeerLink
  quality: Connection
  state: PeerState
  lastSpokeAt: number
  /** Camera video only; stable object so <video> elements can hold on to it. */
  camStream: MediaStream
  /** Microphone audio only. */
  micStream: MediaStream
  /** Screen video plus screen audio. */
  screenStream: MediaStream
  hasCamTrack: boolean
  hasScreenTrack: boolean
}

export type MeshStatus =
  'connecting' | 'connected' | 'reconnecting' | 'disconnected'
export type MeshDisconnectCause = 'removed' | 'ended' | 'lost' | 'left' | null

export interface MeshRoomOptions {
  identity: string
  name: string
  role: Role
  iceServers: IceServer[]
  initialSettings: MeetingSettings
  sync: (input: {
    sessionId: string
    outbox: OutgoingSignal[]
  }) => Promise<SyncResult>
  leave: () => Promise<unknown>
  /** Optional real-time fast path: immediately writes a Trickle ICE or SDP signal. */
  sendSignal?: (sessionId: string, signal: OutgoingSignal) => Promise<unknown>
  /** Optional startup hook: deletes stale signals from prior sessions. */
  cleanupSignals?: (sessionId: string) => Promise<unknown>
  /** Optional real-time push listener for incoming signals (<100ms). */
  subscribeSignals?: (
    sessionId: string,
    onSignals: (signals: IncomingSignal[]) => void,
  ) => () => void
  /** Optional real-time push listener for participants, waiting queue, and departures. */
  subscribeParticipants?: (
    onUpdate: (data: {
      peers: PeerInfo[]
      waiting: WaitingParticipant[]
      leftIds: string[]
    }) => void,
  ) => () => void
  onChange: () => void
  onMessage: (
    from: { id: string; name: string; role: Role },
    message: RealtimeMessage,
  ) => void
}

type Wire =
  { k: 'state'; s: Partial<PeerState> } | { k: 'app'; m: string } | { k: 'bye' }

interface Link {
  pc: RTCPeerConnection
  dc: RTCDataChannel
  initiator: boolean
  session: string
  makingOffer: boolean
  descriptionSent: boolean
  pendingIce: RTCIceCandidateInit[]
  openedAt: number
  createdAt: number
  statsTimer: number
  lastStats: { lost: number; received: number } | null
}

const SLOTS = ['mic', 'cam', 'screen', 'screenAudio'] as const
type Slot = (typeof SLOTS)[number]
const SLOT_KIND: Record<Slot, 'audio' | 'video'> = {
  mic: 'audio',
  cam: 'video',
  screen: 'video',
  screenAudio: 'audio',
}

const IMMEDIATE_MS = 50
const FAST_POLL_MS = 1000
const SLOW_POLL_MS = 4000
const CONNECT_TIMEOUT_MS = 15_000
const RETRY_AFTER_FAIL_MS = 4000
const PRESENCE_GRACE_MS = 12_000
const SYNC_FAILS_BEFORE_RECONNECTING = 2
const SYNC_GIVE_UP_MS = 60_000

export function newSessionId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 20)
    : Math.random().toString(36).slice(2, 14) + Date.now().toString(36)
}

export class MeshRoom {
  readonly sessionId = newSessionId()
  status: MeshStatus = 'connecting'
  cause: MeshDisconnectCause = null
  role: Role
  settings: MeetingSettings
  waiting: WaitingParticipant[] | null = null
  spotlightId: string | null = null
  breakout: import('@/lib/meeting-types').BreakoutState | null = null
  peers = new Map<string, MeshPeer>()
  localState: PeerState = {
    micOn: false,
    camOn: false,
    sharing: false,
    handRaised: false,
    speaking: false,
  }
  localTracks: LocalTracks = {
    mic: null,
    cam: null,
    screen: null,
    screenAudio: null,
  }

  private links = new Map<string, Link>()
  private outbox: OutgoingSignal[] = []
  private lastSeen = new Map<string, number>()
  private failedAt = new Map<string, number>()
  /** Sessions that said goodbye; ignored until presence shows a new one. */
  private gone = new Map<string, string>()
  /** Early ICE candidates received before a peer's Link or remoteDescription exists. */
  private earlyIceByPeer = new Map<
    string,
    { session: string; candidates: RTCIceCandidateInit[] }
  >()
  /** Early offers received via push signaling before participant discovery completes. */
  private pendingOffersByPeer = new Map<string, IncomingSignal>()
  private seenSignalIds = new Set<string>()
  private unsubSignals: (() => void) | null = null
  private unsubParticipants: (() => void) | null = null
  private running = false
  private syncing = false
  private timer = 0
  private syncFailures = 0
  private firstFailureAt = 0
  private changeFrame = 0
  private hasSyncedOnce = false
  private initialMisses = 0

  constructor(private opts: MeshRoomOptions) {
    this.role = opts.role
    this.settings = opts.initialSettings
  }

  // ---- lifecycle ------------------------------------------------------------

  start() {
    if (this.running) return
    this.running = true
    if (this.status === 'disconnected') {
      this.status = 'connecting'
      this.cause = null
    }
    // Purge stale signals from any prior session so fresh handshakes never stall.
    void this.opts.cleanupSignals?.(this.sessionId).catch(() => {})

    if (this.opts.subscribeSignals) {
      this.unsubSignals?.()
      this.unsubSignals = this.opts.subscribeSignals(
        this.sessionId,
        (signals) => {
          if (!this.running) return
          void (async () => {
            for (const signal of signals) {
              if (!this.running) return
              await this.handleSignal(signal)
            }
          })()
        },
      )
    }

    if (this.opts.subscribeParticipants) {
      this.unsubParticipants?.()
      this.unsubParticipants = this.opts.subscribeParticipants((update) => {
        if (!this.running) return
        // Immediately drop dead/stale peer connections for departed participants.
        for (const leftId of update.leftIds) {
          if (this.peers.has(leftId) || this.links.has(leftId)) {
            this.removePeer(leftId)
          }
        }
        if (this.role === 'host' || this.role === 'cohost') {
          if (JSON.stringify(update.waiting) !== JSON.stringify(this.waiting)) {
            this.waiting = update.waiting
          }
        }
        this.reconcilePeers(update.peers)
        this.emit()
      })
    }

    void this.sync()
  }

  /**
   * Pauses local timers and peer connections on React unmount (including
   * StrictMode double-mount) WITHOUT marking the participant as left or
   * emitting a disconnect cause.
   */
  pause() {
    if (!this.running) return
    this.running = false
    window.clearTimeout(this.timer)
    this.unsubSignals?.()
    this.unsubSignals = null
    this.unsubParticipants?.()
    this.unsubParticipants = null
    if (this.changeFrame) {
      window.cancelAnimationFrame(this.changeFrame)
      this.changeFrame = 0
    }
    for (const link of this.links.values()) {
      this.closeLink(link)
    }
    this.links.clear()
  }

  /** Leaves the room: tells peers, closes connections, clears presence. */
  async stop(cause: MeshDisconnectCause = 'left') {
    if (!this.running && this.status === 'disconnected') return
    this.running = false
    window.clearTimeout(this.timer)
    this.unsubSignals?.()
    this.unsubSignals = null
    this.unsubParticipants?.()
    this.unsubParticipants = null
    for (const link of this.links.values()) {
      try {
        if (link.dc.readyState === 'open')
          link.dc.send(JSON.stringify({ k: 'bye' } satisfies Wire))
      } catch {
        // Closing anyway.
      }
      this.closeLink(link)
    }
    this.links.clear()
    this.peers.clear()
    this.earlyIceByPeer.clear()
    this.pendingOffersByPeer.clear()
    this.seenSignalIds.clear()
    this.status = 'disconnected'
    this.cause = cause
    this.emit()
    if (cause === 'left') await this.opts.leave().catch(() => {})
  }

  private emit() {
    if (this.changeFrame) return
    this.changeFrame = window.requestAnimationFrame(() => {
      this.changeFrame = 0
      this.opts.onChange()
    })
  }

  // ---- local media and state -------------------------------------------------

  setLocalTracks(next: LocalTracks) {
    const changed = SLOTS.filter((s) => this.localTracks[s] !== next[s])
    this.localTracks = next
    if (changed.length === 0) return
    for (const link of this.links.values()) {
      for (const slot of changed) this.attachSlot(link, slot)
    }
  }

  setLocalState(patch: Partial<PeerState>) {
    const keys = (Object.keys(patch) as (keyof PeerState)[]).filter(
      (k) => this.localState[k] !== patch[k],
    )
    if (keys.length === 0) return
    this.localState = { ...this.localState, ...patch }
    const diff: Partial<PeerState> = {}
    for (const k of keys) diff[k] = this.localState[k]
    this.broadcast({ k: 'state', s: diff })
    this.emit()
  }

  // ---- messaging -------------------------------------------------------------

  send(message: RealtimeMessage, to?: string[]) {
    const wire: Wire = { k: 'app', m: encode(message) }
    if (to) {
      for (const id of to) this.sendTo(id, wire)
    } else {
      this.broadcast(wire)
    }
  }

  private broadcast(wire: Wire) {
    const raw = JSON.stringify(wire)
    for (const link of this.links.values()) {
      if (link.dc.readyState === 'open') {
        try {
          link.dc.send(raw)
        } catch {
          // Peer is going away; presence will clean up.
        }
      }
    }
  }

  private sendTo(id: string, wire: Wire) {
    const link = this.links.get(id)
    if (!link || link.dc.readyState !== 'open') return
    try {
      link.dc.send(JSON.stringify(wire))
    } catch {
      // ignore
    }
  }

  get connectingNames() {
    return Array.from(this.peers.values())
      .filter((p) => p.link !== 'connected')
      .map((p) => p.name)
  }

  // ---- sync loop -------------------------------------------------------------

  private emitSignal(signal: OutgoingSignal) {
    if (this.opts.sendSignal) {
      void this.opts.sendSignal(this.sessionId, signal).catch(() => {
        this.outbox.push(signal)
        this.requestSync()
      })
      return
    }
    this.outbox.push(signal)
    this.requestSync()
  }

  /** Runs a sync as soon as possible (used right after queueing a signal). */
  private requestSync() {
    this.scheduleNext()
  }

  private scheduleNext() {
    if (!this.running) return
    window.clearTimeout(this.timer)
    const hasPush = Boolean(
      this.opts.subscribeSignals && this.opts.subscribeParticipants,
    )
    const busy = Array.from(this.peers.values()).some(
      (p) => p.link === 'connecting',
    )
    const delay =
      this.outbox.length > 0
        ? IMMEDIATE_MS
        : busy && !hasPush
          ? FAST_POLL_MS
          : SLOW_POLL_MS
    this.timer = window.setTimeout(() => void this.sync(), delay)
  }

  private async sync() {
    if (!this.running || this.syncing) return
    this.syncing = true
    const outbox = this.outbox
    this.outbox = []
    let result: SyncResult
    try {
      result = await this.opts.sync({ sessionId: this.sessionId, outbox })
    } catch {
      // Network hiccup: keep the signals for the next attempt.
      this.outbox = outbox.concat(this.outbox)
      this.syncing = false
      this.syncFailures += 1
      if (this.syncFailures === 1) this.firstFailureAt = Date.now()
      if (
        this.syncFailures >= SYNC_FAILS_BEFORE_RECONNECTING &&
        this.status === 'connected'
      ) {
        this.status = 'reconnecting'
        this.emit()
      }
      if (Date.now() - this.firstFailureAt > SYNC_GIVE_UP_MS) {
        void this.stop('lost')
        return
      }
      this.scheduleNext()
      return
    }
    this.syncing = false
    if (!this.running) return
    this.syncFailures = 0

    if (result.status !== 'ok') {
      // Ignore transient initial not-found while Firestore write propagates.
      if (
        result.status === 'not-found' &&
        !this.hasSyncedOnce &&
        this.initialMisses < 3
      ) {
        this.initialMisses += 1
        this.scheduleNext()
        return
      }
      const cause: MeshDisconnectCause =
        result.status === 'removed' || result.status === 'rejected'
          ? 'removed'
          : result.status === 'ended'
            ? 'ended'
            : 'lost'
      void this.stop(cause)
      return
    }

    this.hasSyncedOnce = true
    this.initialMisses = 0
    if (this.status !== 'connected') this.status = 'connected'
    this.role = result.role
    if (JSON.stringify(result.settings) !== JSON.stringify(this.settings)) {
      this.settings = result.settings
    }
    if (JSON.stringify(result.waiting) !== JSON.stringify(this.waiting)) {
      this.waiting = result.waiting
    }
    if (result.spotlightId !== undefined) {
      this.spotlightId = result.spotlightId
    }
    if (result.breakout !== undefined) {
      this.breakout = result.breakout
    }
    this.reconcilePeers(result.peers)
    for (const signal of result.inbox) await this.handleSignal(signal)
    this.emit()
    this.scheduleNext()
  }

  // ---- peers -----------------------------------------------------------------

  private reconcilePeers(online: PeerInfo[]) {
    const now = Date.now()
    const seen = new Set<string>()
    for (const info of online) {
      if (this.gone.get(info.identity) === info.session) continue
      this.gone.delete(info.identity)
      seen.add(info.identity)
      this.lastSeen.set(info.identity, now)
      const existing = this.peers.get(info.identity)
      if (existing && existing.session !== info.session) {
        // They reloaded: drop the stale connection and start over immediately.
        this.dropLink(info.identity)
        this.earlyIceByPeer.delete(info.identity)
        this.failedAt.delete(info.identity)
        existing.session = info.session
        existing.link = 'connecting'
      }
      const peer = existing ?? this.addPeer(info)
      peer.name = info.name
      peer.role = info.role
      peer.session = info.session
      if (peer.link !== 'connected') {
        if (info.micOn !== undefined) peer.state.micOn = info.micOn
        if (info.camOn !== undefined) peer.state.camOn = info.camOn
        if (info.handRaised !== undefined)
          peer.state.handRaised = info.handRaised
      }

      // Replay any offer that arrived via push signaling before participant discovery.
      const deferredOffer = this.pendingOffersByPeer.get(info.identity)
      if (deferredOffer) {
        this.pendingOffersByPeer.delete(info.identity)
        if (deferredOffer.fromSession === info.session) {
          void this.handleSignal(deferredOffer)
          continue
        }
      }

      const link = this.links.get(info.identity)
      if (!link) {
        const failed = this.failedAt.get(info.identity) ?? 0
        if (now - failed < RETRY_AFTER_FAIL_MS) continue
        if (this.isInitiator(info.identity)) {
          void this.openLink(peer, true)
        }
        // Otherwise wait for their offer.
      } else if (
        link.pc.connectionState !== 'connected' &&
        now - link.createdAt > CONNECT_TIMEOUT_MS
      ) {
        this.markFailed(info.identity)
      }
    }
    for (const [id, peer] of this.peers) {
      if (seen.has(id)) continue
      const last = this.lastSeen.get(id) ?? 0
      // Keep a connected peer briefly: their sync may be lagging while the
      // direct link is fine. Drop anyone else immediately.
      if (peer.link === 'connected' && now - last < PRESENCE_GRACE_MS) continue
      this.removePeer(id)
    }
  }

  private isInitiator(peerId: string) {
    return this.opts.identity < peerId
  }

  private addPeer(info: PeerInfo): MeshPeer {
    const peer: MeshPeer = {
      identity: info.identity,
      session: info.session,
      name: info.name,
      role: info.role,
      link: 'connecting',
      quality: 'good',
      state: {
        micOn: Boolean(info.micOn),
        camOn: Boolean(info.camOn),
        sharing: false,
        handRaised: Boolean(info.handRaised),
        speaking: false,
      },
      lastSpokeAt: 0,
      camStream: new MediaStream(),
      micStream: new MediaStream(),
      screenStream: new MediaStream(),
      hasCamTrack: false,
      hasScreenTrack: false,
    }
    this.peers.set(info.identity, peer)
    return peer
  }

  private removePeer(id: string) {
    this.dropLink(id)
    this.peers.delete(id)
    this.lastSeen.delete(id)
    this.failedAt.delete(id)
    this.earlyIceByPeer.delete(id)
    this.pendingOffersByPeer.delete(id)
    this.emit()
  }

  private markFailed(id: string) {
    this.dropLink(id)
    this.failedAt.set(id, Date.now())
    const peer = this.peers.get(id)
    if (peer) {
      peer.link = 'failed'
      peer.quality = 'lost'
    }
    this.emit()
  }

  // ---- connections -----------------------------------------------------------

  private createLink(peer: MeshPeer, initiator: boolean): Link {
    const pc = new RTCPeerConnection({
      iceServers: this.opts.iceServers,
      bundlePolicy: 'max-bundle',
      iceCandidatePoolSize: 4,
    })
    const dc = pc.createDataChannel('lectern', { negotiated: true, id: 0 })
    const link: Link = {
      pc,
      dc,
      initiator,
      session: peer.session,
      makingOffer: false,
      descriptionSent: false,
      pendingIce: [],
      openedAt: 0,
      createdAt: Date.now(),
      statsTimer: 0,
      lastStats: null,
    }
    const id = peer.identity

    dc.onopen = () => {
      if (this.links.get(id) !== link) return
      link.openedAt = Date.now()
      peer.link = 'connected'
      peer.quality = 'good'
      this.failedAt.delete(id)
      // Tell them how we look right now.
      try {
        dc.send(
          JSON.stringify({ k: 'state', s: this.localState } satisfies Wire),
        )
      } catch {
        // ignore
      }
      this.emit()
    }
    dc.onmessage = (ev) => {
      if (this.links.get(id) !== link) return
      this.handleWire(peer, String(ev.data))
    }
    dc.onclose = () => {
      if (this.links.get(id) !== link) return
      // A clean close means they left; presence confirms shortly.
      this.markFailed(id)
    }

    // Trickle ICE: emit every ICE candidate immediately as soon as it is discovered.
    pc.onicecandidate = (ev) => {
      if (this.links.get(id) !== link) return
      if (!ev.candidate) return
      this.emitSignal({
        kind: 'ice',
        to: id,
        toSession: link.session,
        payload: JSON.stringify(ev.candidate.toJSON()),
      })
    }
    pc.onconnectionstatechange = () => {
      if (this.links.get(id) !== link) return
      const s = pc.connectionState
      if (s === 'failed' || s === 'closed') {
        this.markFailed(id)
      } else if (s === 'disconnected') {
        peer.quality = 'lost'
        this.emit()
      } else if (s === 'connected') {
        if (peer.quality === 'lost') peer.quality = 'good'
        this.emit()
      }
    }
    pc.ontrack = (ev) => {
      if (this.links.get(id) !== link) return
      const index = pc.getTransceivers().indexOf(ev.transceiver)
      const slot = SLOTS[index]
      if (!slot) return
      const track = ev.track
      const target =
        slot === 'mic'
          ? peer.micStream
          : slot === 'cam'
            ? peer.camStream
            : peer.screenStream
      for (const old of target.getTracks()) {
        if (old.kind === track.kind) target.removeTrack(old)
      }
      target.addTrack(track)
      if (slot === 'cam') peer.hasCamTrack = true
      if (slot === 'screen') peer.hasScreenTrack = true
      this.emit()
    }

    link.statsTimer = window.setInterval(
      () => void this.sampleStats(peer, link),
      3000,
    )
    return link
  }

  private attachSlot(link: Link, slot: Slot) {
    const transceivers = link.pc.getTransceivers()
    const index = SLOTS.indexOf(slot)
    const t = transceivers[index]
    const track = this.localTracks[slot]
    if (track && track.kind !== SLOT_KIND[slot]) return
    if (t) {
      t.sender.replaceTrack(track ?? null).catch(() => {})
      return
    }
    if (track && typeof link.pc.addTrack === 'function') {
      try {
        link.pc.addTrack(track)
      } catch {
        // ignore if connection is closing
      }
    }
  }

  private closeLink(link: Link) {
    window.clearInterval(link.statsTimer)
    link.dc.onopen = null
    link.dc.onmessage = null
    link.dc.onclose = null
    link.pc.onicecandidate = null
    link.pc.onconnectionstatechange = null
    link.pc.ontrack = null
    try {
      link.dc.close()
    } catch {
      // ignore
    }
    try {
      link.pc.close()
    } catch {
      // ignore
    }
  }

  private dropLink(id: string) {
    const link = this.links.get(id)
    if (!link) return
    this.links.delete(id)
    this.closeLink(link)
    const peer = this.peers.get(id)
    if (peer) {
      for (const s of [peer.camStream, peer.micStream, peer.screenStream]) {
        for (const t of s.getTracks()) s.removeTrack(t)
      }
      peer.hasCamTrack = false
      peer.hasScreenTrack = false
      peer.state = { ...peer.state, speaking: false }
    }
  }

  /** Initiator side: build and send the offer immediately (Trickle ICE). */
  private async openLink(peer: MeshPeer, initiator: boolean) {
    this.dropLink(peer.identity)
    peer.link = 'connecting'
    const link = this.createLink(peer, initiator)
    link.makingOffer = true
    this.links.set(peer.identity, link)
    this.emit()
    try {
      for (const slot of SLOTS) {
        const t = link.pc.addTransceiver(SLOT_KIND[slot], {
          direction: 'sendrecv',
        })
        const track = this.localTracks[slot]
        if (track) t.sender.replaceTrack(track).catch(() => {})
      }
      const offer = await link.pc.createOffer()
      await link.pc.setLocalDescription(offer)
      if (this.links.get(peer.identity) !== link) return
      link.descriptionSent = true
      this.emitSignal({
        kind: 'offer',
        to: peer.identity,
        toSession: peer.session,
        payload: JSON.stringify(link.pc.localDescription),
      })
    } catch {
      if (this.links.get(peer.identity) === link) this.markFailed(peer.identity)
    } finally {
      link.makingOffer = false
    }
  }

  private queueEarlyIce(
    peerId: string,
    session: string,
    candidate: RTCIceCandidateInit,
  ) {
    const existing = this.earlyIceByPeer.get(peerId)
    if (existing && existing.session === session) {
      if (existing.candidates.length < 64) existing.candidates.push(candidate)
    } else {
      this.earlyIceByPeer.set(peerId, { session, candidates: [candidate] })
    }
  }

  private async handleSignal(signal: IncomingSignal) {
    const sigKey = String(signal.id)
    if (this.seenSignalIds.has(sigKey)) return
    this.seenSignalIds.add(sigKey)
    if (this.seenSignalIds.size > 600) {
      const oldest = this.seenSignalIds.values().next().value
      if (oldest !== undefined) this.seenSignalIds.delete(oldest)
    }

    if (signal.kind === 'ice') {
      let candidate: RTCIceCandidateInit
      try {
        candidate = JSON.parse(signal.payload) as RTCIceCandidateInit
      } catch {
        return
      }
      const link = this.links.get(signal.from)
      if (link && link.session === signal.fromSession) {
        if (link.pc.remoteDescription) {
          link.pc.addIceCandidate(candidate).catch(() => {})
        } else {
          link.pendingIce.push(candidate)
        }
      } else {
        // Queue ICE candidates arriving before the offer/link is ready.
        this.queueEarlyIce(signal.from, signal.fromSession, candidate)
      }
      return
    }

    const peer = this.peers.get(signal.from)
    if (!peer) {
      if (signal.kind === 'offer') {
        // Hold offer until participant discovery adds this peer, then replay immediately.
        this.seenSignalIds.delete(sigKey)
        this.pendingOffersByPeer.set(signal.from, signal)
      }
      return
    }

    if (signal.kind === 'offer') {
      // Deterministic offer direction + Polite Peer glare handling:
      // Lexicographically smaller identity is the impolite initiator and leads.
      const polite = !this.isInitiator(signal.from)
      if (!polite) return
      await this.answer(peer, signal)
      return
    }

    const link = this.links.get(signal.from)
    if (!link || link.session !== signal.fromSession) return
    if (signal.kind === 'answer') {
      if (!link.initiator || link.pc.signalingState !== 'have-local-offer')
        return
      try {
        await link.pc.setRemoteDescription(
          JSON.parse(signal.payload) as RTCSessionDescriptionInit,
        )
        await this.flushIce(signal.from, link)
      } catch {
        this.markFailed(signal.from)
      }
    }
  }

  private async flushIce(peerId: string, link: Link) {
    const early = this.earlyIceByPeer.get(peerId)
    let earlyCandidates: RTCIceCandidateInit[] = []
    if (early && early.session === link.session) {
      earlyCandidates = early.candidates
      this.earlyIceByPeer.delete(peerId)
    }
    const pending = [...earlyCandidates, ...link.pendingIce]
    link.pendingIce = []
    for (const c of pending) await link.pc.addIceCandidate(c).catch(() => {})
  }

  /** Answerer side: adopt the offer's transceivers, attach tracks, and send answer immediately (Trickle ICE). */
  private async answer(peer: MeshPeer, signal: IncomingSignal) {
    if (peer.session !== signal.fromSession) {
      peer.session = signal.fromSession
    }
    this.dropLink(peer.identity)
    peer.link = 'connecting'
    const link = this.createLink(peer, false)
    this.links.set(peer.identity, link)
    this.emit()
    try {
      await link.pc.setRemoteDescription(
        JSON.parse(signal.payload) as RTCSessionDescriptionInit,
      )
      await this.flushIce(peer.identity, link)
      const transceivers = link.pc.getTransceivers()
      SLOTS.forEach((slot, i) => {
        const t = transceivers[i]
        if (!t) return
        t.direction = 'sendrecv'
        const track = this.localTracks[slot]
        if (track) t.sender.replaceTrack(track).catch(() => {})
      })
      const desc = await link.pc.createAnswer()
      await link.pc.setLocalDescription(desc)
      if (this.links.get(peer.identity) !== link) return
      link.descriptionSent = true
      this.emitSignal({
        kind: 'answer',
        to: peer.identity,
        toSession: peer.session,
        payload: JSON.stringify(link.pc.localDescription),
      })
      await this.flushIce(peer.identity, link)
    } catch {
      if (this.links.get(peer.identity) === link) this.markFailed(peer.identity)
    }
  }

  // ---- incoming data -----------------------------------------------------------

  private handleWire(peer: MeshPeer, raw: string) {
    let wire: Wire
    try {
      wire = JSON.parse(raw) as Wire
    } catch {
      return
    }
    switch (wire.k) {
      case 'state': {
        const next = { ...peer.state, ...wire.s }
        if (next.speaking && !peer.state.speaking) peer.lastSpokeAt = Date.now()
        peer.state = next
        this.emit()
        return
      }
      case 'app': {
        const message = decode(wire.m)
        if (!message) return
        this.opts.onMessage(
          { id: peer.identity, name: peer.name, role: peer.role },
          message,
        )
        return
      }
      case 'bye':
        this.gone.set(peer.identity, peer.session)
        this.removePeer(peer.identity)
        return
    }
  }

  // ---- quality ------------------------------------------------------------------

  private async sampleStats(peer: MeshPeer, link: Link) {
    if (link.pc.connectionState !== 'connected') return
    try {
      const report = await link.pc.getStats()
      let rtt = 0
      let lost = 0
      let received = 0
      report.forEach((s) => {
        if (
          s.type === 'candidate-pair' &&
          (s as RTCIceCandidatePairStats).state === 'succeeded' &&
          (s as RTCIceCandidatePairStats).nominated
        ) {
          rtt = (s as RTCIceCandidatePairStats).currentRoundTripTime ?? rtt
        }
        if (s.type === 'inbound-rtp') {
          const r = s as RTCInboundRtpStreamStats
          lost += r.packetsLost ?? 0
          received += r.packetsReceived ?? 0
        }
      })
      let loss = 0
      if (link.lastStats) {
        const dl = lost - link.lastStats.lost
        const dr = received - link.lastStats.received
        loss = dr + dl > 0 ? dl / (dr + dl) : 0
      }
      link.lastStats = { lost, received }
      const quality: Connection =
        rtt > 0.45 || loss > 0.1
          ? 'poor'
          : rtt > 0.2 || loss > 0.03
            ? 'fair'
            : 'good'
      if (quality !== peer.quality) {
        peer.quality = quality
        this.emit()
      }
    } catch {
      // Stats are best effort.
    }
  }
}
