/** Types shared by Firestore services, WebRTC mesh, and the meeting UI. */

export type Role = 'host' | 'cohost' | 'student'
export type ParticipantStatus =
  | 'waiting'
  | 'admitted'
  | 'rejected'
  | 'removed'
  | 'left'
export type Connection = 'good' | 'fair' | 'poor' | 'lost'

/** Live meeting settings. Returned on every room sync so peers converge. */
export interface MeetingSettings {
  locked: boolean
  waitingRoom: boolean
  allowStudentScreenShare: boolean
  allowStudentDraw: boolean
  allowChat: boolean
  allowPrivateChat: boolean
}

export interface BreakoutRoom {
  id: string
  name: string
  assignedIds: string[]
}

export interface BreakoutState {
  open: boolean
  rooms: BreakoutRoom[]
  broadcastMessage?: string | null
  broadcastAt?: number | null
}

export interface ScreenAnnStroke {
  id: string
  tool: 'pen' | 'highlighter' | 'arrow' | 'rect'
  color: string
  width: number
  points: number[] // normalized [0..1]
  authorId?: string
}

export interface MeetingReactionEvent {
  id: string
  emoji: string
  name: string
  by: string
  at: number
}

export interface PresenterCameraState {
  cx: number
  cy: number
  zoom: number
  by: string
  at: number
  force?: boolean
}

export interface PresenterViewportState {
  panX: number
  panY: number
  zoom: number
  cx?: number
  cy?: number
  by?: string
  at?: number
  force?: boolean
}

export interface BoardLaserState {
  id: string
  name: string
  x: number
  y: number
  at: number
}

export interface WhiteboardPresenceDoc {
  uid: string
  name: string
  laserX: number | null
  laserY: number | null
  active: boolean
  at: number
}

export interface MeetingSummary extends MeetingSettings {
  meetingId: string
  title: string
  hostName: string
  hostId?: string | null
  memberIds?: string[]
  hasPasscode: boolean
  passcode?: string | null
  scheduledAt: string | null
  durationMin: number
  startedAt: string | null
  endedAt: string | null
  status?: 'scheduled' | 'live' | 'ended'
  spotlightId?: string | null
  breakout?: BreakoutState | null
  notes?: string
  whiteboardOpen?: boolean
  activeWhiteboardId?: string | null
  activeWhiteboardTitle?: string | null
  allowParticipantAnnotate?: boolean
  muteAllAt?: number | null
  lastReaction?: MeetingReactionEvent | null
  screenAnnotations?: ScreenAnnStroke[]
  presenterCamera?: PresenterCameraState | null
  presenterViewport?: PresenterViewportState | null
}

export interface PollOption {
  id: string
  text: string
}

export interface MeetingPoll {
  id: string
  question: string
  options: PollOption[]
  votes: Record<string, string>
  anonymous: boolean
  status: 'open' | 'closed'
  createdBy: string
  createdByName: string
  createdAt: number
}

export interface StandaloneBoardMeta {
  id: string
  title: string
  ownerId: string
  memberIds?: string[]
  createdBy?: string
  createdByName?: string
  backgroundType?: 'dots' | 'grid' | 'lined' | 'blank'
  boardTheme?: 'light' | 'dark'
  createdAt: number
  updatedAt: number
  elementCount?: number
  presenterCamera?: PresenterCameraState | null
  laser?: BoardLaserState | null
}

/** An ICE server entry as accepted by RTCPeerConnection. */
export interface IceServer {
  urls: string[]
  username?: string
  credential?: string
}

/** Who is online in a room right now, from presence heartbeat / Firestore. */
export interface PeerInfo {
  identity: string
  session: string
  name: string
  role: Role
  micOn?: boolean
  camOn?: boolean
  handRaised?: boolean
  breakoutRoomId?: string | null
}

/** One signalling message: an SDP description or an ICE candidate. */
export interface OutgoingSignal {
  kind: 'offer' | 'answer' | 'ice'
  to: string
  toSession: string
  payload: string
}

export interface IncomingSignal {
  id: number | string
  kind: 'offer' | 'answer' | 'ice'
  from: string
  fromSession: string
  payload: string
}

export type SyncResult =
  | { status: 'not-found' | 'ended' | 'removed' | 'rejected' | 'waiting' }
  | {
      status: 'ok'
      role: Role
      settings: MeetingSettings
      peers: PeerInfo[]
      inbox: IncomingSignal[]
      /** Waiting-room queue; only sent to moderators. */
      waiting: WaitingParticipant[] | null
      spotlightId?: string | null
      breakout?: BreakoutState | null
    }

export interface WaitingParticipant {
  identity: string
  name: string
  requestedAt: string
}

export const defaultSettings: MeetingSettings = {
  locked: false,
  waitingRoom: true,
  allowStudentScreenShare: false,
  allowStudentDraw: false,
  allowChat: true,
  allowPrivateChat: true,
}

export function isModerator(role: Role) {
  return role === 'host' || role === 'cohost'
}
