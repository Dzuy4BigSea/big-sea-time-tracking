-- AlterTable
ALTER TABLE "MigrationSnapshot" DROP COLUMN "data",
ADD COLUMN     "meta" JSONB,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'full',
ALTER COLUMN "status" SET DEFAULT 'running';

-- CreateTable
CREATE TABLE "MigrationSnapshotPart" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "chunk" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationSnapshotPart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MigrationSnapshotPart_snapshotId_idx" ON "MigrationSnapshotPart"("snapshotId");

-- CreateIndex
CREATE INDEX "MigrationSnapshotPart_accountId_idx" ON "MigrationSnapshotPart"("accountId");

-- AddForeignKey
ALTER TABLE "MigrationSnapshotPart" ADD CONSTRAINT "MigrationSnapshotPart_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MigrationSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

