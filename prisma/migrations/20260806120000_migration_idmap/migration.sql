-- CreateTable
CREATE TABLE "MigrationIdMap" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "harvestId" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationIdMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MigrationIdMap_accountId_idx" ON "MigrationIdMap"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationIdMap_accountId_entity_harvestId_key" ON "MigrationIdMap"("accountId", "entity", "harvestId");

-- AddForeignKey
ALTER TABLE "MigrationIdMap" ADD CONSTRAINT "MigrationIdMap_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

