-- DropIndex
DROP INDEX "InvoiceLabels_accountId_key";

-- DropIndex
DROP INDEX "InvoiceMessageTemplate_accountId_kind_key";

-- AlterTable
ALTER TABLE "BusinessEntity" ADD COLUMN     "accentColor" TEXT,
ADD COLUMN     "emailAccentColor" TEXT,
ADD COLUMN     "emailBrandColor" TEXT;

-- AlterTable
ALTER TABLE "InvoiceLabels" ADD COLUMN     "entityId" TEXT;

-- AlterTable
ALTER TABLE "InvoiceMessageTemplate" ADD COLUMN     "entityId" TEXT;

-- CreateIndex
CREATE INDEX "InvoiceLabels_accountId_idx" ON "InvoiceLabels"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLabels_accountId_entityId_key" ON "InvoiceLabels"("accountId", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceMessageTemplate_accountId_entityId_kind_key" ON "InvoiceMessageTemplate"("accountId", "entityId", "kind");

-- AddForeignKey
ALTER TABLE "InvoiceMessageTemplate" ADD CONSTRAINT "InvoiceMessageTemplate_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "BusinessEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLabels" ADD CONSTRAINT "InvoiceLabels_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "BusinessEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

