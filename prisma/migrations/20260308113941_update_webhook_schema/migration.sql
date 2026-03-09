/*
  Warnings:

  - You are about to drop the column `company_id` on the `motive_webhooks` table. All the data in the column will be lost.
  - You are about to drop the column `webhook_type` on the `motive_webhooks` table. All the data in the column will be lost.
  - Added the required column `action` to the `motive_webhooks` table without a default value. This is not possible if the table is not empty.
  - Added the required column `trigger` to the `motive_webhooks` table without a default value. This is not possible if the table is not empty.
  - Made the column `motive_driver_id` on table `motive_webhooks` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "motive_webhooks_company_id_received_at_idx";

-- DropIndex
DROP INDEX "motive_webhooks_motive_driver_id_idx";

-- AlterTable
ALTER TABLE "motive_webhooks" DROP COLUMN "company_id",
DROP COLUMN "webhook_type",
ADD COLUMN     "action" TEXT NOT NULL,
ADD COLUMN     "driver_company_id" INTEGER,
ADD COLUMN     "driver_role" TEXT,
ADD COLUMN     "first_name" TEXT,
ADD COLUMN     "last_name" TEXT,
ADD COLUMN     "our_driver_id" INTEGER,
ADD COLUMN     "trigger" TEXT NOT NULL,
ADD COLUMN     "username" TEXT,
ALTER COLUMN "motive_driver_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "motive_webhooks_motive_driver_id_received_at_idx" ON "motive_webhooks"("motive_driver_id", "received_at");

-- CreateIndex
CREATE INDEX "motive_webhooks_our_driver_id_idx" ON "motive_webhooks"("our_driver_id");

-- CreateIndex
CREATE INDEX "motive_webhooks_driver_company_id_idx" ON "motive_webhooks"("driver_company_id");
