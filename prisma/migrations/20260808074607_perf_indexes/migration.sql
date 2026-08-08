-- CreateIndex
CREATE INDEX "Invoice_accountId_issueDate_idx" ON "Invoice"("accountId", "issueDate");

-- CreateIndex
CREATE INDEX "Invoice_accountId_status_idx" ON "Invoice"("accountId", "status");

-- CreateIndex
CREATE INDEX "TimeEntry_accountId_spentDate_idx" ON "TimeEntry"("accountId", "spentDate");

-- CreateIndex
CREATE INDEX "TimeEntry_projectId_spentDate_idx" ON "TimeEntry"("projectId", "spentDate");

