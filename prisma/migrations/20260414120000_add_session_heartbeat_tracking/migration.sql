-- AlterTable
ALTER TABLE "driving_sessions"
ADD COLUMN "last_heartbeat_sent_at" TIMESTAMP(3),
ADD COLUMN "last_heartbeat_ack_at" TIMESTAMP(3),
ADD COLUMN "missed_heartbeat_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "heartbeat_command_id" TEXT;
