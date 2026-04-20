/*
  Warnings:

  - A unique constraint covering the columns `[firebase_uid]` on the table `drivers` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "firebase_uid" TEXT;

-- CreateTable
CREATE TABLE "fleet_managers" (
    "id" SERIAL NOT NULL,
    "firebase_uid" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "company_id" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleet_managers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" SERIAL NOT NULL,
    "firebase_uid" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fleet_managers_firebase_uid_key" ON "fleet_managers"("firebase_uid");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_managers_email_key" ON "fleet_managers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admins_firebase_uid_key" ON "admins"("firebase_uid");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_firebase_uid_key" ON "drivers"("firebase_uid");

-- AddForeignKey
ALTER TABLE "fleet_managers" ADD CONSTRAINT "fleet_managers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
