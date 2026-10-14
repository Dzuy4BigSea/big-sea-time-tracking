-- InvoiceEvent: end-to-end invoice trace (send → email → open → payment → Xero). Idempotent.
CREATE TABLE IF NOT EXISTS "InvoiceEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "paymentId" TEXT,
    "stage" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "externalId" TEXT,
    "externalEventId" TEXT,
    "httpStatus" INTEGER,
    "durationMs" INTEGER,
    "detail" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceEvent_source_externalEventId_key" ON "InvoiceEvent"("source", "externalEventId");
CREATE INDEX IF NOT EXISTS "InvoiceEvent_accountId_invoiceId_occurredAt_idx" ON "InvoiceEvent"("accountId", "invoiceId", "occurredAt");
CREATE INDEX IF NOT EXISTS "InvoiceEvent_accountId_occurredAt_idx" ON "InvoiceEvent"("accountId", "occurredAt");
CREATE INDEX IF NOT EXISTS "InvoiceEvent_accountId_level_occurredAt_idx" ON "InvoiceEvent"("accountId", "level", "occurredAt");
DO $$ BEGIN
  ALTER TABLE "InvoiceEvent" ADD CONSTRAINT "InvoiceEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Supabase's public API must not read this table (Track2 connects as the owner, which bypasses RLS).
ALTER TABLE "InvoiceEvent" ENABLE ROW LEVEL SECURITY;
