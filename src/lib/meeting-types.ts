/** Types shared by the server functions and the meeting UI. */

export type Role = 'host' | 'cohost' | 'student'
export type ParticipantStatus = 'waiting' | 'admitted' | 'rejected' | 'removed'
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

export interface MeetingSummary extends MeetingSettings {
  meetingId: string
  title: string
  hostName: string
  hasPasscode: boolean
  scheduledAt: string | null
  durationMin: number
  startedAt: string | null
  endedAt: string | null
}

/** An ICE server entry as accepted by RTCPeerConnection. */
export interface IceServer {
  urls: string[]
  username?: string
  credential?: string
}

/** Who is online in a room right now, from the presence heartbeat. */
export interface PeerInfo {
  identity: string
  session: string
  name: string
  role: Role
}

/** One signalling message: an SDP description or an ICE candidate. */
export interface OutgoingSignal {
  kind: 'offer' | 'answer' | 'ice'
  to: string
  toSession: string
  payload: string
}

export interface IncomingSignal {
  id: number
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
