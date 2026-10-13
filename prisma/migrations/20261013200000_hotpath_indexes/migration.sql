-- Hot-path indexes (specs/21-performance-scaling.md). Indexes only; IF NOT EXISTS so this is safe to run
-- by hand in the Supabase SQL editor before `prisma migrate deploy` records it.
--
-- On a busy production table prefer the CONCURRENTLY form by hand (it cannot run inside the transaction
-- `migrate deploy` uses), then let `migrate deploy` mark this migration applied (the IF NOT EXISTS
-- statements become no-ops):
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProjectUserAssignment_userId_isActive_idx" ON "ProjectUserAssignment"("userId", "isActive");
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "TimeEntry_uninvoiced_billable_idx" ON "TimeEntry"("accountId", "projectId") INCLUDE ("minutes", "billableRateCents", "isRunning", "lockState") WHERE "isBillable" AND "invoiceLineItemId" IS NULL;

-- loggableProjectsFor (timesheet + the top bar on every page), managedProjectIdsFor, mayActFor:
-- "this user's active assignments". Previously a sequential scan of every assignment.
CREATE INDEX IF NOT EXISTS "ProjectUserAssignment_userId_isActive_idx" ON "ProjectUserAssignment"("userId", "isActive");

-- The uninvoiced billable pool: dashboard "uninvoiced" tile, /retainers, invoice creation from tracked
-- time, uninvoiced report. Partial, so it only holds the (small) not-yet-invoiced slice of the ~388k
-- entries; INCLUDE makes the pool sums index-only scans (no heap reads). Prisma 5 can't declare partial indexes,
-- so this one lives only here (see the note at the top of schema.prisma).
CREATE INDEX IF NOT EXISTS "TimeEntry_uninvoiced_billable_idx" ON "TimeEntry"("accountId", "projectId")
  INCLUDE ("minutes", "billableRateCents", "isRunning", "lockState")
  WHERE "isBillable" AND "invoiceLineItemId" IS NULL;
