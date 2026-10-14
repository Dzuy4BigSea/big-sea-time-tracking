-- AlterTable (specs/27 AC-REC-102): the day of month a recurring schedule was set up on, so a
-- 31st-of-the-month template issues on the last day of short months and goes back to the 31st.
-- Nullable: existing profiles keep advancing from their stored next issue date until edited.
-- IF NOT EXISTS so `prisma migrate deploy` still succeeds if this line was already run by hand.
ALTER TABLE "RecurringInvoiceProfile" ADD COLUMN IF NOT EXISTS "anchorDay" INTEGER;
