-- AlterTable
ALTER TABLE "drivers"
ADD COLUMN "fleet_manager_phone" TEXT;

-- AlterTable
ALTER TABLE "driving_sessions"
ADD COLUMN "blocked_attempt_ack_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "blocked_attempt_per_app" JSONB,
ADD COLUMN "blocked_attempt_synced_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "driver_allowlist_selections" (
    "id" SERIAL NOT NULL,
    "driver_id" INTEGER NOT NULL,
    "device_id" TEXT NOT NULL,
    "selected_apps" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_allowlist_selections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "driver_allowlist_selections_driver_id_device_id_key" ON "driver_allowlist_selections"("driver_id", "device_id");
CREATE INDEX "driver_allowlist_selections_driver_id_idx" ON "driver_allowlist_selections"("driver_id");

-- AddForeignKey
ALTER TABLE "driver_allowlist_selections" ADD CONSTRAINT "driver_allowlist_selections_driver_id_fkey"
FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
