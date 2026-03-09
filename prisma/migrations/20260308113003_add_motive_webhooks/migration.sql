-- CreateTable
CREATE TABLE "motive_webhooks" (
    "id" BIGSERIAL NOT NULL,
    "webhook_type" TEXT NOT NULL,
    "company_id" INTEGER,
    "payload" JSONB NOT NULL,
    "motive_driver_id" INTEGER,
    "duty_status" TEXT,
    "previous_duty_status" TEXT,
    "processing_status" TEXT NOT NULL DEFAULT 'pending',
    "processed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "session_id" INTEGER,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "motive_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "motive_webhooks_company_id_received_at_idx" ON "motive_webhooks"("company_id", "received_at");

-- CreateIndex
CREATE INDEX "motive_webhooks_processing_status_idx" ON "motive_webhooks"("processing_status");

-- CreateIndex
CREATE INDEX "motive_webhooks_motive_driver_id_idx" ON "motive_webhooks"("motive_driver_id");
