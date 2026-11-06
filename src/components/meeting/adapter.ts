import type { ReactNode } from 'react'
import type { DeviceSelection } from '@/components/device-settings'
import type {
  Connection,
  MeetingSettings,
  Role,
  WaitingParticipant,
} from '@/lib/meeting-types'
import type { RealtimeMessage } from '@/lib/realtime'
import type { DeviceLists, MediaErrorKind } from '@/lib/use-local-media'
import type { TileModel } from './types'

export interface RemoteSender {
  id: string
  name: string
  role: Role
}

export interface ScreenShare {
  ownerId: string
  ownerName: string
  node: ReactNode
}

export type RoomState =
  'connecting' | 'connected' | 'reconnecting' | 'disconnected'
export type DisconnectCause = 'removed' | 'ended' | 'duplicate' | 'lost' | null

/**
 * Everything the meeting screen needs from a media/room backend. Implemented
 * by the peer-to-peer mesh adapter (`use-mesh-adapter.tsx`).
 */
export interface RoomAdapter {
  realtime: boolean
  state: RoomState
  disconnectCause: DisconnectCause
  localId: string
  tiles: TileModel[]
  activeSpeakerId: string | null
  renderVideo: (tile: TileModel) => ReactNode | null
  screenShare: ScreenShare | null
  audioNode: ReactNode
  micOn: boolean
  camOn: boolean
  setMicOn: (on: boolean) => Promise<void>
  setCamOn: (on: boolean) => Promise<void>
  sharing: boolean
  shareSupported: boolean
  startShare: () => Promise<boolean>
  stopShare: () => Promise<void>
  devices: DeviceLists
  selection: DeviceSelection
  setDevices: (next: DeviceSelection) => Promise<void>
  micTrack: MediaStreamTrack | null
  mediaError: MediaErrorKind | null
  quality: Connection
  /** Live settings from the room, or null when the backend has none. */
  roomSettings: MeetingSettings | null
  /** Waiting-room queue when the backend provides it (moderators only). */
  waiting?: WaitingParticipant[] | null
  /** People who are in the room but not yet connected to us. */
  connectingNames?: string[]
  send: (message: RealtimeMessage, to?: string[]) => void
  subscribe: (
    cb: (from: RemoteSender, message: RealtimeMessage) => void,
  ) => () => void
  handRaised: boolean
  setHand: (raised: boolean) => void
  leave: () => Promise<void>
}
