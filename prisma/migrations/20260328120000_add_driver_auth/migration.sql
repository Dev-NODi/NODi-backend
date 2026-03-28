ALTER TABLE "drivers"
ALTER COLUMN "phone" DROP NOT NULL;

ALTER TABLE "drivers"
ADD COLUMN "password_hash" TEXT;

CREATE UNIQUE INDEX "drivers_email_key" ON "drivers"("email");

CREATE INDEX "drivers_email_idx" ON "drivers"("email");
