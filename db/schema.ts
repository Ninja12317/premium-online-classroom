import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

/**
 * A class meeting. `hostKeyHash` is the SHA-256 of a secret handed to the
 * teacher when the meeting is created; it proves host authority without
 * requiring an account (accounts are optional and add scheduling/history).
 */
export const meetings = pgTable('meetings', {
  id: serial().primaryKey(),
  meetingId: text('meeting_id').notNull().unique(),
  title: text().notNull(),
  hostName: text('host_name').notNull(),
  hostUserId: text('host_user_id'),
  hostKeyHash: text('host_key_hash').notNull(),
  passcode: text(),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  durationMin: integer('duration_min').notNull().default(60),
  waitingRoom: boolean('waiting_room').notNull().default(true),
  locked: boolean().notNull().default(false),
  allowStudentScreenShare: boolean('allow_student_screen_share')
    .notNull()
    .default(false),
  allowStudentDraw: boolean('allow_student_draw').notNull().default(false),
  allowChat: boolean('allow_chat').notNull().default(true),
  allowPrivateChat: boolean('allow_private_chat').notNull().default(true),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/**
 * One row per person who asked to join a meeting. `status` drives the waiting
 * room; `keyHash` is the SHA-256 of a per-participant secret so that co-host
 * actions can be authorised server-side. `sessionId` and `lastSeenAt` are the
 * presence heartbeat for the peer-to-peer room: a participant is "online"
 * while they keep syncing.
 */
export const participants = pgTable('participants', {
  id: serial().primaryKey(),
  meetingId: text('meeting_id').notNull(),
  identity: text().notNull().unique(),
  name: text().notNull(),
  role: text().notNull().default('student'),
  status: text().notNull().default('waiting'),
  keyHash: text('key_hash').notNull(),
  sessionId: text('session_id'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/**
 * WebRTC signalling mailbox. Peers exchange session descriptions and ICE
 * candidates through here while they establish a direct connection; after
 * that everything travels peer-to-peer. Rows are short-lived and swept on
 * every sync.
 */
export const signals = pgTable(
  'signals',
  {
    id: serial().primaryKey(),
    meetingId: text('meeting_id').notNull(),
    fromIdentity: text('from_identity').notNull(),
    fromSession: text('from_session').notNull(),
    toIdentity: text('to_identity').notNull(),
    toSession: text('to_session').notNull(),
    kind: text().notNull(),
    payload: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('signals_inbox_idx').on(t.toIdentity, t.toSession, t.id)],
)
