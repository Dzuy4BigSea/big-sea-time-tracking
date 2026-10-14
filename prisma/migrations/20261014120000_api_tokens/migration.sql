-- Personal access tokens for the API / MCP server (specs/22). Additive and idempotent: a new table
-- only, no change to existing data. Safe to re-run (IF NOT EXISTS / guarded constraints).

-- CreateTable
CREATE TABLE IF NOT EXISTS "ApiToken" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ApiToken_accountId_idx" ON "ApiToken"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ApiToken_userId_idx" ON "ApiToken"("userId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
