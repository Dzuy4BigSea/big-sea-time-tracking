-- Harvest "Assigned people" + Team overview pins (specs/28-team-parity.md). Additive only: two new
-- tables, no change to existing data. Idempotent (IF NOT EXISTS, guarded constraints) so it is safe to
-- run by hand in the Supabase SQL editor before `prisma migrate deploy` records it.

-- CreateTable
CREATE TABLE IF NOT EXISTS "ManagerAssignment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagerAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TeamPin" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pinnedUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamPin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ManagerAssignment_managerId_userId_key" ON "ManagerAssignment"("managerId", "userId");
CREATE INDEX IF NOT EXISTS "ManagerAssignment_accountId_idx" ON "ManagerAssignment"("accountId");
CREATE INDEX IF NOT EXISTS "ManagerAssignment_userId_idx" ON "ManagerAssignment"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "TeamPin_userId_pinnedUserId_key" ON "TeamPin"("userId", "pinnedUserId");
CREATE INDEX IF NOT EXISTS "TeamPin_accountId_idx" ON "TeamPin"("accountId");

-- AddForeignKey (guarded: ADD CONSTRAINT has no IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ManagerAssignment_accountId_fkey') THEN
    ALTER TABLE "ManagerAssignment" ADD CONSTRAINT "ManagerAssignment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ManagerAssignment_managerId_fkey') THEN
    ALTER TABLE "ManagerAssignment" ADD CONSTRAINT "ManagerAssignment_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ManagerAssignment_userId_fkey') THEN
    ALTER TABLE "ManagerAssignment" ADD CONSTRAINT "ManagerAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeamPin_accountId_fkey') THEN
    ALTER TABLE "TeamPin" ADD CONSTRAINT "TeamPin_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeamPin_userId_fkey') THEN
    ALTER TABLE "TeamPin" ADD CONSTRAINT "TeamPin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeamPin_pinnedUserId_fkey') THEN
    ALTER TABLE "TeamPin" ADD CONSTRAINT "TeamPin_pinnedUserId_fkey" FOREIGN KEY ("pinnedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
