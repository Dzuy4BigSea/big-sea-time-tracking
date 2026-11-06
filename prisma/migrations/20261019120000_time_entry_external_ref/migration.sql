-- TimeEntry → external work item (Asana task) link (specs/29). Idempotent; adding nullable columns
-- is metadata-only in Postgres, so this is instant on the 388k-row table.
ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "externalService" TEXT;
ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "externalGroupId" TEXT;
ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "externalPermalink" TEXT;
CREATE INDEX IF NOT EXISTS "TimeEntry_accountId_externalService_externalId_idx" ON "TimeEntry"("accountId", "externalService", "externalId");
CREATE INDEX IF NOT EXISTS "TimeEntry_accountId_externalService_externalGroupId_idx" ON "TimeEntry"("accountId", "externalService", "externalGroupId");
