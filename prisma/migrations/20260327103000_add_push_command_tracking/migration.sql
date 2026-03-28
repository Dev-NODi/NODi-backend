-- AlterTable
ALTER TABLE "driving_sessions"
ADD COLUMN "requested_blocking_state" BOOLEAN,
ADD COLUMN "applied_blocking_state" BOOLEAN,
ADD COLUMN "last_command_id" TEXT,
ADD COLUMN "last_ack_at" TIMESTAMP(3),
ADD COLUMN "last_ack_reason" TEXT;

-- CreateTable
CREATE TABLE "push_commands" (
    "id" BIGSERIAL NOT NULL,
    "command_id" TEXT NOT NULL,
    "driver_id" INTEGER NOT NULL,
    "session_id" INTEGER,
    "requested_action" TEXT NOT NULL,
    "should_block" BOOLEAN NOT NULL,
    "duty_status" TEXT,
    "source" TEXT NOT NULL DEFAULT 'webhook',
    "push_sent" BOOLEAN NOT NULL DEFAULT false,
    "sse_sent" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMP(3),
    "ack_applied" BOOLEAN,
    "ack_source" TEXT,
    "ack_timestamp" TIMESTAMP(3),
    "ack_reason" TEXT,
    "ack_device_id" TEXT,
    "raw_ack" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_commands_command_id_key" ON "push_commands"("command_id");
CREATE INDEX "push_commands_driver_id_created_at_idx" ON "push_commands"("driver_id", "created_at");
CREATE INDEX "push_commands_session_id_idx" ON "push_commands"("session_id");
CREATE INDEX "push_commands_ack_applied_idx" ON "push_commands"("ack_applied");

-- AddForeignKey
ALTER TABLE "push_commands" ADD CONSTRAINT "push_commands_driver_id_fkey"
FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "push_commands" ADD CONSTRAINT "push_commands_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "driving_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
