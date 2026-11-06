CREATE TABLE "meetings" (
	"id" serial PRIMARY KEY,
	"meeting_id" text NOT NULL UNIQUE,
	"title" text NOT NULL,
	"host_name" text NOT NULL,
	"host_user_id" text,
	"host_key_hash" text NOT NULL,
	"passcode" text,
	"scheduled_at" timestamp with time zone,
	"duration_min" integer DEFAULT 60 NOT NULL,
	"waiting_room" boolean DEFAULT true NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"allow_student_screen_share" boolean DEFAULT false NOT NULL,
	"allow_student_draw" boolean DEFAULT false NOT NULL,
	"allow_chat" boolean DEFAULT true NOT NULL,
	"allow_private_chat" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" serial PRIMARY KEY,
	"meeting_id" text NOT NULL,
	"identity" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"role" text DEFAULT 'student' NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
