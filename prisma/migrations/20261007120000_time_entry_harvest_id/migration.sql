-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN "harvestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_accountId_harvestId_key" ON "TimeEntry"("accountId", "harvestId");
