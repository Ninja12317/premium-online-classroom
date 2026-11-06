CREATE TABLE "signals" (
	"id" serial PRIMARY KEY,
	"meeting_id" text NOT NULL,
	"from_identity" text NOT NULL,
	"from_session" text NOT NULL,
	"to_identity" text NOT NULL,
	"to_session" text NOT NULL,
	"kind" text NOT NULL,
	"payload" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "signals_inbox_idx" ON "signals" ("to_identity","to_session","id");