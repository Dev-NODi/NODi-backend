-- Fleet profile: company label + emergency dispatch for dashboard / NODi driver lock UI
ALTER TABLE "fleet_managers" ADD COLUMN IF NOT EXISTS "company_name" TEXT;
ALTER TABLE "fleet_managers" ADD COLUMN IF NOT EXISTS "contact_number" TEXT;
