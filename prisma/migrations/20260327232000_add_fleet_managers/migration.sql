-- `fleet_managers` may already exist from `20260312180537_add_firebase_auth` (older shape with `company_id`).
-- Do not DROP it: preserve rows. Add the junction table and reshape the existing table.

-- CreateTable
CREATE TABLE IF NOT EXISTS "fleet_manager_company_assignments" (
    "id" SERIAL NOT NULL,
    "fleet_manager_id" INTEGER NOT NULL,
    "company_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_manager_company_assignments_pkey" PRIMARY KEY ("id")
);

-- Backfill assignments from legacy `company_id`, then drop that column (if present).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'fleet_managers'
      AND c.column_name = 'company_id'
  ) THEN
    INSERT INTO "fleet_manager_company_assignments" ("fleet_manager_id", "company_id", "role", "is_active", "joined_at")
    SELECT fm."id", fm."company_id", 'viewer', true, CURRENT_TIMESTAMP
    FROM "fleet_managers" fm
    WHERE fm."company_id" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "fleet_manager_company_assignments" a
        WHERE a."fleet_manager_id" = fm."id" AND a."company_id" = fm."company_id"
      );

    ALTER TABLE "fleet_managers" DROP CONSTRAINT IF EXISTS "fleet_managers_company_id_fkey";
    ALTER TABLE "fleet_managers" DROP COLUMN IF EXISTS "company_id";
  END IF;
END $$;

-- Legacy `fleet_managers.email` was NOT NULL; current model allows null.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'fleet_managers'
      AND c.column_name = 'email'
      AND c.is_nullable = 'NO'
  ) THEN
    ALTER TABLE "fleet_managers" ALTER COLUMN "email" DROP NOT NULL;
  END IF;
END $$;

-- CreateIndex (idempotent for replays / shadow DB)
CREATE UNIQUE INDEX IF NOT EXISTS "fleet_managers_firebase_uid_key" ON "fleet_managers"("firebase_uid");
CREATE INDEX IF NOT EXISTS "fleet_managers_firebase_uid_idx" ON "fleet_managers"("firebase_uid");

CREATE UNIQUE INDEX IF NOT EXISTS "fleet_manager_company_assignments_fleet_manager_id_company_id_key" ON "fleet_manager_company_assignments"("fleet_manager_id", "company_id");
CREATE INDEX IF NOT EXISTS "fleet_manager_company_assignments_fleet_manager_id_idx" ON "fleet_manager_company_assignments"("fleet_manager_id");
CREATE INDEX IF NOT EXISTS "fleet_manager_company_assignments_company_id_idx" ON "fleet_manager_company_assignments"("company_id");

-- AddForeignKey (only if missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fleet_manager_company_assignments_fleet_manager_id_fkey'
  ) THEN
    ALTER TABLE "fleet_manager_company_assignments" ADD CONSTRAINT "fleet_manager_company_assignments_fleet_manager_id_fkey" FOREIGN KEY ("fleet_manager_id") REFERENCES "fleet_managers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fleet_manager_company_assignments_company_id_fkey'
  ) THEN
    ALTER TABLE "fleet_manager_company_assignments" ADD CONSTRAINT "fleet_manager_company_assignments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
