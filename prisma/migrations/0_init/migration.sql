-- CreateEnum
CREATE TYPE "WeekStart" AS ENUM ('sunday', 'monday');

-- CreateEnum
CREATE TYPE "DeadlineDay" AS ENUM ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun');

-- CreateEnum
CREATE TYPE "TimeRounding" AS ENUM ('none', 'nearest_1', 'nearest_5', 'nearest_6', 'nearest_10', 'nearest_15');

-- CreateEnum
CREATE TYPE "TimeEntryNotesPolicy" AS ENUM ('optional', 'required');

-- CreateEnum
CREATE TYPE "TimeFormatClock" AS ENUM ('h12', 'h24');

-- CreateEnum
CREATE TYPE "TimeDisplay" AS ENUM ('hh_mm', 'decimal');

-- CreateEnum
CREATE TYPE "TimerMode" AS ENUM ('duration', 'start_stop');

-- CreateEnum
CREATE TYPE "ExpenseReimbursement" AS ENUM ('disabled', 'allowed');

-- CreateEnum
CREATE TYPE "PermissionProfile" AS ENUM ('member', 'project_manager', 'people_admin', 'accounting', 'executive_manager', 'administrator');

-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('employee', 'contractor');

-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('time_and_materials', 'fixed_fee', 'non_billable');

-- CreateEnum
CREATE TYPE "BillableRateMethod" AS ENUM ('none', 'project', 'person', 'task');

-- CreateEnum
CREATE TYPE "BudgetMethod" AS ENUM ('none', 'hours_total', 'hours_per_task', 'hours_per_person', 'fee_total', 'cost_total');

-- CreateEnum
CREATE TYPE "LockState" AS ENUM ('open', 'approved', 'invoiced');

-- CreateEnum
CREATE TYPE "TimesheetStatus" AS ENUM ('unsubmitted', 'submitted', 'approved', 'reopened');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'open', 'paid', 'written_off', 'closed');

-- CreateEnum
CREATE TYPE "PaymentTerm" AS ENUM ('due_on_receipt', 'net_15', 'net_30', 'net_45', 'net_60', 'custom');

-- CreateEnum
CREATE TYPE "LineItemKind" AS ENUM ('time', 'expense', 'free_form', 'flat');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'check', 'bank_transfer', 'card', 'other');

-- CreateEnum
CREATE TYPE "EstimateStatus" AS ENUM ('draft', 'sent', 'accepted', 'declined');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('invoice', 'reminder', 'thank_you');

-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('weekly', 'monthly', 'quarterly', 'yearly', 'custom');

-- CreateEnum
CREATE TYPE "RecurringStatus" AS ENUM ('active', 'paused');

-- CreateEnum
CREATE TYPE "RetainerStatus" AS ENUM ('ongoing', 'archived');

-- CreateEnum
CREATE TYPE "ExpenseLockState" AS ENUM ('open', 'invoiced');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('create', 'update', 'delete', 'state_change');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountOwnerUserId" TEXT,
    "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
    "currencyFormat" TEXT NOT NULL DEFAULT '$0.00',
    "numberFormat" TEXT NOT NULL DEFAULT '1,234.56',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1,
    "weekStartsOn" "WeekStart" NOT NULL DEFAULT 'monday',
    "defaultCapacityHours" DECIMAL(5,2) NOT NULL DEFAULT 40,
    "timesheetDeadlineDay" "DeadlineDay",
    "timesheetDeadlineTime" TEXT,
    "timesheetReminderRule" JSONB,
    "timeEntryNotes" "TimeEntryNotesPolicy" NOT NULL DEFAULT 'optional',
    "timeRounding" "TimeRounding" NOT NULL DEFAULT 'none',
    "dateFormat" TEXT NOT NULL DEFAULT 'MM/DD/YYYY',
    "timeFormatClock" "TimeFormatClock" NOT NULL DEFAULT 'h12',
    "timeDisplay" "TimeDisplay" NOT NULL DEFAULT 'hh_mm',
    "timerMode" "TimerMode" NOT NULL DEFAULT 'duration',
    "expenseReimbursement" "ExpenseReimbursement" NOT NULL DEFAULT 'disabled',
    "invoiceNumberSeq" INTEGER NOT NULL DEFAULT 1000,
    "estimateNumberSeq" INTEGER NOT NULL DEFAULT 1000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "timeTracking" BOOLEAN NOT NULL DEFAULT true,
    "expenseTracking" BOOLEAN NOT NULL DEFAULT true,
    "timesheetApproval" BOOLEAN NOT NULL DEFAULT false,
    "team" BOOLEAN NOT NULL DEFAULT true,
    "invoices" BOOLEAN NOT NULL DEFAULT true,
    "estimates" BOOLEAN NOT NULL DEFAULT false,
    "clientDashboard" BOOLEAN NOT NULL DEFAULT true,
    "activityLog" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "employeeId" TEXT,
    "type" "UserType" NOT NULL DEFAULT 'employee',
    "permissionProfile" "PermissionProfile" NOT NULL DEFAULT 'member',
    "permissionOverrides" JSONB,
    "roleTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "departments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "capacityHoursPerWeek" DECIMAL(5,2),
    "timezone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonBillableRate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hourlyRateCents" INTEGER NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonBillableRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonCostRate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hourlyRateCents" INTEGER NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonCostRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientContact" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phoneOffice" TEXT,
    "phoneMobile" TEXT,
    "isInvoiceRecipient" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultBillable" BOOLEAN NOT NULL DEFAULT true,
    "defaultHourlyRateCents" INTEGER,
    "autoAddToNewProjects" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "projectType" "ProjectType" NOT NULL DEFAULT 'time_and_materials',
    "billableRateMethod" "BillableRateMethod",
    "projectHourlyRateCents" INTEGER,
    "projectFeesCents" INTEGER,
    "billingCurrency" TEXT,
    "budgetMethod" "BudgetMethod" NOT NULL DEFAULT 'none',
    "budgetValue" INTEGER,
    "budgetResetsMonthly" BOOLEAN NOT NULL DEFAULT false,
    "budgetAlertPercent" INTEGER,
    "isBillable" BOOLEAN NOT NULL DEFAULT true,
    "startsOn" DATE,
    "endsOn" DATE,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTaskAssignment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "hourlyRateCents" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProjectTaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectUserAssignment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hourlyRateCents" INTEGER,
    "isProjectManager" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProjectUserAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "spentDate" DATE NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "isBillable" BOOLEAN NOT NULL DEFAULT true,
    "billableRateCents" INTEGER,
    "timerStartedAt" TIMESTAMP(3),
    "isRunning" BOOLEAN NOT NULL DEFAULT false,
    "lockState" "LockState" NOT NULL DEFAULT 'open',
    "invoiceLineItemId" TEXT,
    "approvedTimesheetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timesheet" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'unsubmitted',
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,

    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemType" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSystemDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ItemType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "number" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "issueDate" DATE,
    "dueDate" DATE,
    "paymentTerm" "PaymentTerm" NOT NULL DEFAULT 'net_30',
    "subject" TEXT,
    "poNumber" TEXT,
    "notes" TEXT,
    "terms" TEXT,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(5,2),
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "tax1Name" TEXT,
    "tax1Percent" DECIMAL(6,3),
    "tax2Name" TEXT,
    "tax2Percent" DECIMAL(6,3),
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "publicToken" TEXT,
    "createdFromEstimateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLineItem" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" "LineItemKind" NOT NULL DEFAULT 'free_form',
    "itemTypeId" TEXT,
    "linkedProjectId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidOn" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'other',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Estimate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "number" TEXT,
    "status" "EstimateStatus" NOT NULL DEFAULT 'draft',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subject" TEXT,
    "notes" TEXT,
    "terms" TEXT,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(5,2),
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "tax1Name" TEXT,
    "tax1Percent" DECIMAL(6,3),
    "tax2Name" TEXT,
    "tax2Percent" DECIMAL(6,3),
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "publicToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Estimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateLineItem" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "itemTypeId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EstimateLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitName" TEXT,
    "unitPriceCents" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "spentDate" DATE NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "markupPercent" DECIMAL(5,2),
    "notes" TEXT,
    "isBillable" BOOLEAN NOT NULL DEFAULT true,
    "receiptFileUrl" TEXT,
    "lockState" "ExpenseLockState" NOT NULL DEFAULT 'open',
    "invoiceLineItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringInvoiceProfile" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "frequency" "RecurringFrequency" NOT NULL DEFAULT 'monthly',
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "nextIssueDate" DATE,
    "status" "RecurringStatus" NOT NULL DEFAULT 'active',
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "paymentTerm" "PaymentTerm" NOT NULL DEFAULT 'net_30',
    "notes" TEXT,
    "templateLineItems" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringInvoiceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Retainer" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT,
    "depositCents" INTEGER NOT NULL DEFAULT 0,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "drawnCents" INTEGER NOT NULL DEFAULT 0,
    "status" "RetainerStatus" NOT NULL DEFAULT 'ongoing',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Retainer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceMessageTemplate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "MessageKind" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "InvoiceMessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SenderAddress" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SenderAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceAppearance" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "logoFileUrl" TEXT,
    "bannerFileUrl" TEXT,
    "useCompanyBranding" BOOLEAN NOT NULL DEFAULT true,
    "brandColor" TEXT NOT NULL DEFAULT '#004348',
    "backgroundColor" TEXT NOT NULL DEFAULT '#FFFFFF',
    "showDocumentTitle" BOOLEAN NOT NULL DEFAULT true,
    "documentTitle" TEXT NOT NULL DEFAULT 'INVOICE',
    "snailMailFriendly" BOOLEAN NOT NULL DEFAULT true,
    "showItemTypeCol" BOOLEAN NOT NULL DEFAULT false,
    "showDescriptionCol" BOOLEAN NOT NULL DEFAULT true,
    "showQuantityCol" BOOLEAN NOT NULL DEFAULT false,
    "showUnitPriceCol" BOOLEAN NOT NULL DEFAULT false,
    "showAmountCol" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "InvoiceAppearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLabels" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "labels" JSONB NOT NULL,

    CONSTRAINT "InvoiceLabels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_accountOwnerUserId_key" ON "Account"("accountOwnerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Module_accountId_key" ON "Module"("accountId");

-- CreateIndex
CREATE INDEX "User_accountId_idx" ON "User"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "User_accountId_email_key" ON "User"("accountId", "email");

-- CreateIndex
CREATE INDEX "PersonBillableRate_accountId_idx" ON "PersonBillableRate"("accountId");

-- CreateIndex
CREATE INDEX "PersonBillableRate_userId_idx" ON "PersonBillableRate"("userId");

-- CreateIndex
CREATE INDEX "PersonCostRate_accountId_idx" ON "PersonCostRate"("accountId");

-- CreateIndex
CREATE INDEX "PersonCostRate_userId_idx" ON "PersonCostRate"("userId");

-- CreateIndex
CREATE INDEX "Client_accountId_idx" ON "Client"("accountId");

-- CreateIndex
CREATE INDEX "ClientContact_accountId_idx" ON "ClientContact"("accountId");

-- CreateIndex
CREATE INDEX "ClientContact_clientId_idx" ON "ClientContact"("clientId");

-- CreateIndex
CREATE INDEX "Task_accountId_idx" ON "Task"("accountId");

-- CreateIndex
CREATE INDEX "Project_accountId_idx" ON "Project"("accountId");

-- CreateIndex
CREATE INDEX "Project_clientId_idx" ON "Project"("clientId");

-- CreateIndex
CREATE INDEX "ProjectTaskAssignment_accountId_idx" ON "ProjectTaskAssignment"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTaskAssignment_projectId_taskId_key" ON "ProjectTaskAssignment"("projectId", "taskId");

-- CreateIndex
CREATE INDEX "ProjectUserAssignment_accountId_idx" ON "ProjectUserAssignment"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectUserAssignment_projectId_userId_key" ON "ProjectUserAssignment"("projectId", "userId");

-- CreateIndex
CREATE INDEX "TimeEntry_accountId_idx" ON "TimeEntry"("accountId");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_spentDate_idx" ON "TimeEntry"("userId", "spentDate");

-- CreateIndex
CREATE INDEX "TimeEntry_projectId_idx" ON "TimeEntry"("projectId");

-- CreateIndex
CREATE INDEX "TimeEntry_invoiceLineItemId_idx" ON "TimeEntry"("invoiceLineItemId");

-- CreateIndex
CREATE INDEX "Timesheet_accountId_idx" ON "Timesheet"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Timesheet_userId_periodStart_key" ON "Timesheet"("userId", "periodStart");

-- CreateIndex
CREATE INDEX "ItemType_accountId_idx" ON "ItemType"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_publicToken_key" ON "Invoice"("publicToken");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_createdFromEstimateId_key" ON "Invoice"("createdFromEstimateId");

-- CreateIndex
CREATE INDEX "Invoice_accountId_idx" ON "Invoice"("accountId");

-- CreateIndex
CREATE INDEX "Invoice_clientId_idx" ON "Invoice"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_accountId_number_key" ON "Invoice"("accountId", "number");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_accountId_idx" ON "InvoiceLineItem"("accountId");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_invoiceId_idx" ON "InvoiceLineItem"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_accountId_idx" ON "Payment"("accountId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Estimate_publicToken_key" ON "Estimate"("publicToken");

-- CreateIndex
CREATE INDEX "Estimate_accountId_idx" ON "Estimate"("accountId");

-- CreateIndex
CREATE INDEX "Estimate_clientId_idx" ON "Estimate"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Estimate_accountId_number_key" ON "Estimate"("accountId", "number");

-- CreateIndex
CREATE INDEX "EstimateLineItem_accountId_idx" ON "EstimateLineItem"("accountId");

-- CreateIndex
CREATE INDEX "EstimateLineItem_estimateId_idx" ON "EstimateLineItem"("estimateId");

-- CreateIndex
CREATE INDEX "ExpenseCategory_accountId_idx" ON "ExpenseCategory"("accountId");

-- CreateIndex
CREATE INDEX "Expense_accountId_idx" ON "Expense"("accountId");

-- CreateIndex
CREATE INDEX "Expense_projectId_idx" ON "Expense"("projectId");

-- CreateIndex
CREATE INDEX "Expense_invoiceLineItemId_idx" ON "Expense"("invoiceLineItemId");

-- CreateIndex
CREATE INDEX "RecurringInvoiceProfile_accountId_idx" ON "RecurringInvoiceProfile"("accountId");

-- CreateIndex
CREATE INDEX "RecurringInvoiceProfile_clientId_idx" ON "RecurringInvoiceProfile"("clientId");

-- CreateIndex
CREATE INDEX "Retainer_accountId_idx" ON "Retainer"("accountId");

-- CreateIndex
CREATE INDEX "Retainer_clientId_idx" ON "Retainer"("clientId");

-- CreateIndex
CREATE INDEX "InvoiceMessageTemplate_accountId_idx" ON "InvoiceMessageTemplate"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceMessageTemplate_accountId_kind_key" ON "InvoiceMessageTemplate"("accountId", "kind");

-- CreateIndex
CREATE INDEX "SenderAddress_accountId_idx" ON "SenderAddress"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceAppearance_accountId_key" ON "InvoiceAppearance"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLabels_accountId_key" ON "InvoiceLabels"("accountId");

-- CreateIndex
CREATE INDEX "AuditLog_accountId_idx" ON "AuditLog"("accountId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_accountOwnerUserId_fkey" FOREIGN KEY ("accountOwnerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Module" ADD CONSTRAINT "Module_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonBillableRate" ADD CONSTRAINT "PersonBillableRate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonBillableRate" ADD CONSTRAINT "PersonBillableRate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonCostRate" ADD CONSTRAINT "PersonCostRate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonCostRate" ADD CONSTRAINT "PersonCostRate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskAssignment" ADD CONSTRAINT "ProjectTaskAssignment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskAssignment" ADD CONSTRAINT "ProjectTaskAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskAssignment" ADD CONSTRAINT "ProjectTaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectUserAssignment" ADD CONSTRAINT "ProjectUserAssignment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectUserAssignment" ADD CONSTRAINT "ProjectUserAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectUserAssignment" ADD CONSTRAINT "ProjectUserAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_invoiceLineItemId_fkey" FOREIGN KEY ("invoiceLineItemId") REFERENCES "InvoiceLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_approvedTimesheetId_fkey" FOREIGN KEY ("approvedTimesheetId") REFERENCES "Timesheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemType" ADD CONSTRAINT "ItemType_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdFromEstimateId_fkey" FOREIGN KEY ("createdFromEstimateId") REFERENCES "Estimate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_itemTypeId_fkey" FOREIGN KEY ("itemTypeId") REFERENCES "ItemType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_linkedProjectId_fkey" FOREIGN KEY ("linkedProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateLineItem" ADD CONSTRAINT "EstimateLineItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateLineItem" ADD CONSTRAINT "EstimateLineItem_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateLineItem" ADD CONSTRAINT "EstimateLineItem_itemTypeId_fkey" FOREIGN KEY ("itemTypeId") REFERENCES "ItemType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_invoiceLineItemId_fkey" FOREIGN KEY ("invoiceLineItemId") REFERENCES "InvoiceLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoiceProfile" ADD CONSTRAINT "RecurringInvoiceProfile_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoiceProfile" ADD CONSTRAINT "RecurringInvoiceProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Retainer" ADD CONSTRAINT "Retainer_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Retainer" ADD CONSTRAINT "Retainer_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Retainer" ADD CONSTRAINT "Retainer_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceMessageTemplate" ADD CONSTRAINT "InvoiceMessageTemplate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SenderAddress" ADD CONSTRAINT "SenderAddress_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceAppearance" ADD CONSTRAINT "InvoiceAppearance_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLabels" ADD CONSTRAINT "InvoiceLabels_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---- Raw-SQL constraints (not expressible in Prisma schema) ----
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
