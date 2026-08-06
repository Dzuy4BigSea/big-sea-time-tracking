-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'harvest';

-- CreateTable
CREATE TABLE "MigrationSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'harvest',
    "status" TEXT NOT NULL DEFAULT 'complete',
    "entityCounts" JSONB,
    "data" JSONB NOT NULL,
    "errorMessage" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MigrationSnapshot_accountId_idx" ON "MigrationSnapshot"("accountId");

-- AddForeignKey
ALTER TABLE "MigrationSnapshot" ADD CONSTRAINT "MigrationSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

