-- Expense indexes for the week-paged Expenses list and Reports → Expenses (specs/26). Indexes only;
-- IF NOT EXISTS so this is safe to run by hand in the Supabase SQL editor before `prisma migrate deploy`.
-- On a busy table prefer the CONCURRENTLY form by hand, then let `migrate deploy` record this migration:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "Expense_accountId_userId_spentDate_idx" ON "Expense"("accountId", "userId", "spentDate");
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "Expense_accountId_spentDate_idx" ON "Expense"("accountId", "spentDate");

-- Expenses page: one person's expenses, newest first, paged on whole weeks.
CREATE INDEX IF NOT EXISTS "Expense_accountId_userId_spentDate_idx" ON "Expense"("accountId", "userId", "spentDate");

-- Reports → Expenses: an account's expenses in a timeframe, grouped in SQL.
CREATE INDEX IF NOT EXISTS "Expense_accountId_spentDate_idx" ON "Expense"("accountId", "spentDate");
