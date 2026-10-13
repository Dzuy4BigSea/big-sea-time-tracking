-- Google Drive export grants (OPS.md §8). Additive only: one new table, no change to existing data.
-- Idempotent (IF NOT EXISTS / guarded FK) so it is safe to run by hand in the Supabase SQL editor
-- before `prisma migrate deploy` records it.

-- CreateTable
CREATE TABLE IF NOT EXISTS "GoogleDriveGrant" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "googleEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleDriveGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GoogleDriveGrant_userId_key" ON "GoogleDriveGrant"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GoogleDriveGrant_accountId_idx" ON "GoogleDriveGrant"("accountId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoogleDriveGrant_userId_fkey') THEN
    ALTER TABLE "GoogleDriveGrant" ADD CONSTRAINT "GoogleDriveGrant_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
