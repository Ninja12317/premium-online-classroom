import type { ReactNode } from 'react'
import type { Connection, Role } from '@/lib/meeting-types'

/** Everything a tile needs to render, independent of where the media comes from. */
export interface TileModel {
  id: string
  name: string
  role: Role
  isLocal: boolean
  micOn: boolean
  camOn: boolean
  speaking: boolean
  handRaised: boolean
  quality: Connection
  sharing: boolean
  breakoutRoomId?: string | null
}

export interface ChatMessage {
  id: string
  authorId: string
  authorName: string
  text: string
  at: number
  kind: 'message' | 'announcement' | 'private' | 'system'
  toId?: string
  toName?: string
}

export type ViewMode = 'gallery' | 'speaker' | 'side-by-side'
export type PanelTab = 'chat' | 'people' | 'polls' | 'notes' | 'info'

export interface Presentation {
  kind: 'screen' | 'whiteboard'
  label: string
  node: ReactNode
}

export interface FloatingReaction {
  id: string
  emoji: string
  name: string
  x: number
}
