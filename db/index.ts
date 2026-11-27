import type { meetings, participants, signals } from './schema.js'

export type MeetingRow = typeof meetings.$inferSelect
export type ParticipantRow = typeof participants.$inferSelect
export type SignalRow = typeof signals.$inferSelect

interface MemoryStore {
  nextMeetingId: number
  nextParticipantId: number
  nextSignalId: number
  meetings: MeetingRow[]
  participants: ParticipantRow[]
  signals: SignalRow[]
}

const globalForStore = globalThis as typeof globalThis & {
  __lecternMemoryStore?: MemoryStore
}

/**
 * In-memory data store replacing Netlify Database for local / AI Studio
 * runtime. Stored on `globalThis` so active rooms survive Vite SSR reloads.
 * Data resets when the container restarts.
 */
export const memoryStore: MemoryStore =
  globalForStore.__lecternMemoryStore ??
  (globalForStore.__lecternMemoryStore = {
    nextMeetingId: 1,
    nextParticipantId: 1,
    nextSignalId: 1,
    meetings: [],
    participants: [],
    signals: [],
  })
