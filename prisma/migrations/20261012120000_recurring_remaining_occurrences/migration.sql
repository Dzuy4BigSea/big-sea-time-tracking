-- AlterTable
-- IF NOT EXISTS so `prisma migrate deploy` still succeeds if this line was already run by hand
-- (e.g. in the Supabase SQL editor to unblock a deploy).
ALTER TABLE "RecurringInvoiceProfile" ADD COLUMN IF NOT EXISTS "remainingOccurrences" INTEGER;
