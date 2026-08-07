-- DropIndex
DROP INDEX "IntegrationConnection_accountId_provider_key";

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "entityId" TEXT;

-- AlterTable
ALTER TABLE "IntegrationConnection" ADD COLUMN     "entityId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "entityId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "entityId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "homeEntityId" TEXT;

-- CreateTable
CREATE TABLE "BusinessEntity" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "senderName" TEXT,
    "senderEmail" TEXT,
    "replyToEmail" TEXT,
    "brandColor" TEXT,
    "logoFileUrl" TEXT,
    "documentTitle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessEntity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessEntity_accountId_idx" ON "BusinessEntity"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessEntity_accountId_code_key" ON "BusinessEntity"("accountId", "code");

-- CreateIndex
CREATE INDEX "IntegrationConnection_entityId_idx" ON "IntegrationConnection"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_accountId_provider_entityId_key" ON "IntegrationConnection"("accountId", "provider", "entityId");

-- AddForeignKey
ALTER TABLE "BusinessEntity" ADD CONSTRAINT "BusinessEntity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_homeEntityId_fkey" FOREIGN KEY ("homeEntityId") REFERENCES "BusinessEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "BusinessEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "BusinessEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "BusinessEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "BusinessEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One shared (account-wide) connection per provider (Asana). Entity-specific rows (Stripe/Xero) are
-- guarded by the compound unique above; this partial index covers the NULL-entity shared row.
CREATE UNIQUE INDEX "IntegrationConnection_accountId_provider_shared_key"
  ON "IntegrationConnection"("accountId", "provider") WHERE "entityId" IS NULL;
