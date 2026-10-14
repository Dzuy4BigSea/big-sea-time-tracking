-- AlterTable (specs/05 §Editing an invoice): Harvest's per-invoice "Accept online payments for this
-- invoice" toggle with Credit Card / ACH. Defaults keep every existing invoice payable exactly as
-- before (the Stripe connection's methods still apply on top).
-- IF NOT EXISTS so `prisma migrate deploy` still succeeds if these lines were already run by hand.
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "acceptOnlinePayments" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "allowCardPayments" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "allowAchPayments" BOOLEAN NOT NULL DEFAULT true;
