-- Constraints Prisma cannot express declaratively.
-- Apply these in a migration AFTER `prisma migrate` creates the tables
-- (e.g. paste into the generated migration.sql, or run once by hand).

-- INV: at most one running timer per user (specs/04, AC-TIME-014).
CREATE UNIQUE INDEX IF NOT EXISTS one_running_timer_per_user
  ON "TimeEntry" ("userId")
  WHERE "isRunning";

-- Effective-dated rates must not overlap per user (specs/03).
-- Requires the btree_gist extension for the range exclusion constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "PersonBillableRate"
  ADD CONSTRAINT person_billable_rate_no_overlap
  EXCLUDE USING gist (
    "userId" WITH =,
    daterange(COALESCE("startDate", '-infinity'), COALESCE("endDate", 'infinity'), '[]') WITH &&
  );

ALTER TABLE "PersonCostRate"
  ADD CONSTRAINT person_cost_rate_no_overlap
  EXCLUDE USING gist (
    "userId" WITH =,
    daterange(COALESCE("startDate", '-infinity'), COALESCE("endDate", 'infinity'), '[]') WITH &&
  );
