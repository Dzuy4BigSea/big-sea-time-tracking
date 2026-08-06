-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('asana', 'stripe', 'xero');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('connected', 'disconnected', 'error');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "xeroContactId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "stripePaymentIntentId" TEXT,
ADD COLUMN     "xeroInvoiceId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "stripeChargeId" TEXT,
ADD COLUMN     "xeroPaymentId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "asanaProjectGid" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "asanaUserGid" TEXT;

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'disconnected',
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "secretsEnc" JSONB,
    "expiresAt" TIMESTAMP(3),
    "externalOrgId" TEXT,
    "externalOrgName" TEXT,
    "connectedByUserId" TEXT,
    "config" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSyncLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "direction" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "externalId" TEXT,
    "ok" BOOLEAN NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationConnection_accountId_idx" ON "IntegrationConnection"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_accountId_provider_key" ON "IntegrationConnection"("accountId", "provider");

-- CreateIndex
CREATE INDEX "IntegrationSyncLog_accountId_provider_idx" ON "IntegrationSyncLog"("accountId", "provider");

-- CreateIndex
CREATE INDEX "IntegrationSyncLog_entityType_entityId_idx" ON "IntegrationSyncLog"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_xeroInvoiceId_key" ON "Invoice"("xeroInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_stripePaymentIntentId_key" ON "Invoice"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripeChargeId_key" ON "Payment"("stripeChargeId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_xeroPaymentId_key" ON "Payment"("xeroPaymentId");

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationSyncLog" ADD CONSTRAINT "IntegrationSyncLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

