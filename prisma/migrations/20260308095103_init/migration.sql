-- CreateTable
CREATE TABLE "companies" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "motive_company_id" INTEGER,
    "motive_oauth_token" TEXT,
    "motive_oauth_refresh_token" TEXT,
    "motive_token_expires_at" TIMESTAMP(3),
    "webhook_secret" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" SERIAL NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "motive_driver_id" INTEGER,
    "device_id" TEXT,
    "device_platform" TEXT,
    "fcm_token" TEXT,
    "fcm_token_updated_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_company_assignments" (
    "id" SERIAL NOT NULL,
    "driver_id" INTEGER NOT NULL,
    "company_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "motive_driver_id_in_company" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_company_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driving_sessions" (
    "id" SERIAL NOT NULL,
    "session_id" TEXT NOT NULL,
    "driver_id" INTEGER NOT NULL,
    "company_id" INTEGER NOT NULL,
    "motive_driver_id" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "duty_status" TEXT NOT NULL,
    "blocking_active" BOOLEAN NOT NULL DEFAULT false,
    "blocked_apps" JSONB,
    "total_block_attempts" INTEGER NOT NULL DEFAULT 0,
    "is_tampered" BOOLEAN DEFAULT false,
    "tampered_at" TIMESTAMP(3),
    "tampered_reason" TEXT,
    "vehicle_id" INTEGER,
    "device_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driving_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_motive_company_id_key" ON "companies"("motive_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_phone_key" ON "drivers"("phone");

-- CreateIndex
CREATE INDEX "drivers_phone_idx" ON "drivers"("phone");

-- CreateIndex
CREATE INDEX "drivers_motive_driver_id_idx" ON "drivers"("motive_driver_id");

-- CreateIndex
CREATE INDEX "driver_company_assignments_driver_id_idx" ON "driver_company_assignments"("driver_id");

-- CreateIndex
CREATE INDEX "driver_company_assignments_company_id_idx" ON "driver_company_assignments"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "driver_company_assignments_driver_id_company_id_key" ON "driver_company_assignments"("driver_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "driving_sessions_session_id_key" ON "driving_sessions"("session_id");

-- CreateIndex
CREATE INDEX "driving_sessions_driver_id_company_id_idx" ON "driving_sessions"("driver_id", "company_id");

-- CreateIndex
CREATE INDEX "driving_sessions_company_id_ended_at_idx" ON "driving_sessions"("company_id", "ended_at");

-- CreateIndex
CREATE INDEX "driving_sessions_session_id_idx" ON "driving_sessions"("session_id");

-- AddForeignKey
ALTER TABLE "driver_company_assignments" ADD CONSTRAINT "driver_company_assignments_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_company_assignments" ADD CONSTRAINT "driver_company_assignments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driving_sessions" ADD CONSTRAINT "driving_sessions_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driving_sessions" ADD CONSTRAINT "driving_sessions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
