/**
 * Server-action access policy: the declared guard for every exported `'use server'` action.
 *
 * This is the single list of "what each function requires". `actionPolicy.test.ts` keeps it honest:
 * it fails when an action is added without an entry here, when an entry goes stale, and when an
 * action's source no longer references the capability its entry declares. A new feature therefore
 * can't ship without someone deciding which capability guards it.
 *
 * Keys are `<file under app/>#<exported function>`.
 */
import type { Capability } from './permissions'

export type ActionGuard =
  /** Requires `cap` (and every `also`) via can(). `scope` notes extra resource checks for some profiles. */
  | { cap: Capability; also?: Capability[]; scope?: 'managed_projects'; feature: string }
  /** The actor's own time/expenses (track_own_time), or someone else's via view_edit_others_time. */
  | { self: true; feature: string }
  /** Only touches rows the signed-in user owns (or, for saved reports, an account admin). */
  | { owner: true; feature: string }
  /** No sign-in: public invoice links, or a pure redirect to a page that gates itself. */
  | { public: true; feature: string }

export const ACTION_POLICY: Record<string, ActionGuard> = {
  // ── Clients ──
  'clients/actions.ts#createClientAction': { cap: 'manage_clients', feature: 'Create a client' },
  'clients/actions.ts#updateClientAction': { cap: 'manage_clients', feature: 'Edit a client' },
  'clients/actions.ts#saveContactAction': { cap: 'manage_clients', feature: 'Add/edit a client contact' },
  'clients/actions.ts#deleteContactAction': { cap: 'manage_clients', feature: 'Delete a client contact' },
  'clients/actions.ts#toggleInvoiceRecipientAction': { cap: 'manage_clients', feature: 'Toggle invoice recipient' },
  'clients/actions.ts#setClientArchivedAction': { cap: 'manage_clients', feature: 'Archive/restore a client' },

  // ── Projects (Project Managers: only projects they manage) ──
  'projects/actions.ts#createProjectAction': { cap: 'manage_projects', feature: 'Create a project' },
  'projects/actions.ts#updateProjectAction': { cap: 'manage_projects', scope: 'managed_projects', feature: 'Edit a project' },
  'projects/actions.ts#assignUserToProjectAction': { cap: 'manage_projects', scope: 'managed_projects', feature: 'Add a person to a project' },
  'projects/actions.ts#toggleProjectManagerAction': { cap: 'manage_projects', scope: 'managed_projects', feature: 'Make someone a project manager' },
  'projects/actions.ts#unassignUserFromProjectAction': { cap: 'manage_projects', scope: 'managed_projects', feature: 'Remove a person from a project' },
  'projects/actions.ts#setProjectArchivedAction': { cap: 'manage_projects', scope: 'managed_projects', feature: 'Archive/restore a project' },
  'projects/actions.ts#setProjectUserRateAction': { cap: 'manage_projects', also: ['set_rates'], scope: 'managed_projects', feature: 'Set a person’s project rate' },
  'projects/actions.ts#addTaskToProjectAction': { cap: 'manage_projects', scope: 'managed_projects', feature: 'Add a task to a project' },
  'projects/actions.ts#removeTaskFromProjectAction': { cap: 'manage_projects', scope: 'managed_projects', feature: 'Remove a task from a project' },
  'projects/actions.ts#toggleProjectTaskBillableAction': { cap: 'manage_projects', scope: 'managed_projects', feature: 'Toggle a project task billable' },
  'projects/actions.ts#setProjectTaskRateAction': { cap: 'manage_projects', also: ['set_rates'], scope: 'managed_projects', feature: 'Set a project task rate' },

  // ── Tasks ──
  'tasks/actions.ts#createTaskAction': { cap: 'manage_tasks', feature: 'Create a task' },
  'tasks/actions.ts#updateTaskAction': { cap: 'manage_tasks', feature: 'Edit a task' },
  'tasks/actions.ts#setTaskArchivedAction': { cap: 'manage_tasks', feature: 'Archive/restore a task' },

  // ── Time & expenses ──
  'timesheet/actions.ts#logTimeAction': { self: true, feature: 'Log time' },
  'timesheet/actions.ts#startTimerAction': { self: true, feature: 'Start a timer' },
  'timesheet/actions.ts#stopTimerAction': { self: true, feature: 'Stop a timer' },
  'timesheet/actions.ts#updateTimeEntryAction': { self: true, feature: 'Edit a time entry' },
  'timesheet/actions.ts#deleteTimeEntryAction': { self: true, feature: 'Delete a time entry' },
  'expenses/actions.ts#createExpenseAction': { self: true, feature: 'Record an expense' },
  'expenses/actions.ts#updateExpenseAction': { self: true, feature: 'Edit an expense' },
  'expenses/actions.ts#deleteExpenseAction': { self: true, feature: 'Delete an expense' },
  'expenses/actions.ts#createCategoryAction': { cap: 'edit_account_settings', feature: 'Create an expense category' },

  // ── Team ──
  'team/actions.ts#createPersonAction': { cap: 'manage_people', feature: 'Add a person' },
  'team/actions.ts#updatePersonBasicAction': { cap: 'manage_people', feature: 'Edit a person’s basic info' },
  'team/actions.ts#updatePersonPermissionsAction': { cap: 'manage_people', feature: 'Change a person’s permissions' },
  'team/actions.ts#updatePersonSecurityAction': { cap: 'manage_people', feature: 'Change a person’s sign-in details' },
  'team/actions.ts#updatePersonAction': { cap: 'manage_people', feature: 'Edit a person' },
  'team/actions.ts#setPersonArchivedAction': { cap: 'manage_people', feature: 'Archive/restore a person' },
  'team/actions.ts#setAssignedToAllAction': { cap: 'manage_people', feature: 'Assign a person to all projects' },
  'team/actions.ts#assignProjectToPersonAction': { cap: 'manage_people', feature: 'Assign projects to a person' },
  'team/actions.ts#unassignProjectFromPersonAction': { cap: 'manage_people', feature: 'Remove a person from a project' },
  'team/actions.ts#toggleManagesProjectAction': { cap: 'manage_people', feature: 'Make a person manage a project' },
  'team/actions.ts#addPersonRateAction': { cap: 'set_rates', feature: 'Add a person’s billable/cost rate' },
  'team/actions.ts#assignPeopleToManagerAction': { cap: 'edit_account_settings', feature: 'Assign people to a manager' },
  'team/actions.ts#removeAssignedPersonAction': { cap: 'edit_account_settings', feature: 'Remove a manager’s assigned person' },
  'team/actions.ts#togglePinAction': { owner: true, feature: 'Pin a teammate on my Team view' },

  // ── Invoices, payments, estimates, retainers, recurring ──
  'invoices/actions.ts#openGeneratePickerAction': { public: true, feature: 'Open the generate-invoice picker (redirect only)' },
  'invoices/actions.ts#recordPaymentAction': { cap: 'manage_invoices', feature: 'Record a payment' },
  'invoices/actions.ts#deletePaymentAction': { cap: 'manage_invoices', feature: 'Delete a payment' },
  'invoices/actions.ts#generateInvoiceAction': { cap: 'manage_invoices', feature: 'Generate an invoice from time' },
  'invoices/actions.ts#sendInvoiceAction': { cap: 'manage_invoices', feature: 'Send an invoice' },
  'invoices/actions.ts#markDraftAction': { cap: 'manage_invoices', feature: 'Return an invoice to draft' },
  'invoices/actions.ts#writeOffInvoiceAction': { cap: 'manage_invoices', feature: 'Write off an invoice' },
  'invoices/actions.ts#reopenInvoiceAction': { cap: 'manage_invoices', feature: 'Reopen an invoice' },
  'invoices/actions.ts#copyToXeroAction': { cap: 'manage_invoices', feature: 'Copy an invoice to Xero' },
  'invoices/actions.ts#resendInvoiceAction': { cap: 'manage_invoices', feature: 'Resend an invoice' },
  'invoices/actions.ts#sendReminderAction': { cap: 'manage_invoices', feature: 'Send a payment reminder' },
  'invoices/actions.ts#duplicateInvoiceAction': { cap: 'manage_invoices', feature: 'Duplicate an invoice' },
  'invoices/actions.ts#deleteInvoiceAction': { cap: 'manage_invoices', feature: 'Delete an invoice' },
  'invoices/[id]/edit/actions.ts#saveInvoiceAction': { cap: 'manage_invoices', feature: 'Edit an invoice' },
  'invoices/[id]/edit/actions.ts#createBlankInvoiceAction': { cap: 'manage_invoices', feature: 'Create a blank invoice' },
  'estimates/actions.ts#createEstimateAction': { cap: 'manage_invoices', feature: 'Create an estimate' },
  'estimates/actions.ts#sendEstimateAction': { cap: 'manage_invoices', feature: 'Send an estimate' },
  'estimates/actions.ts#setEstimateStatusAction': { cap: 'manage_invoices', feature: 'Accept/decline an estimate' },
  'estimates/actions.ts#convertEstimateAction': { cap: 'manage_invoices', feature: 'Convert an estimate to an invoice' },
  'estimates/actions.ts#deleteEstimateAction': { cap: 'manage_invoices', feature: 'Delete an estimate' },
  'retainers/actions.ts#createRetainerAction': { cap: 'manage_invoices', feature: 'Create a retainer' },
  'retainers/actions.ts#addDepositAction': { cap: 'manage_invoices', feature: 'Add a retainer deposit' },
  'retainers/actions.ts#applyDrawdownAction': { cap: 'manage_invoices', feature: 'Draw down a retainer' },
  'retainers/actions.ts#archiveRetainerAction': { cap: 'manage_invoices', feature: 'Archive a retainer' },
  'recurring/actions.ts#createRecurringAction': { cap: 'manage_invoices', feature: 'Create a recurring invoice' },
  'recurring/actions.ts#updateRecurringAction': { cap: 'manage_invoices', feature: 'Edit a recurring invoice' },
  'recurring/actions.ts#createRecurringFromInvoiceAction': { cap: 'manage_invoices', feature: 'Make an invoice recurring' },
  'recurring/actions.ts#generateDueAction': { cap: 'manage_invoices', feature: 'Generate due recurring invoices' },
  'recurring/actions.ts#toggleRecurringStatusAction': { cap: 'manage_invoices', feature: 'Pause/resume a recurring invoice' },
  'recurring/actions.ts#updateRecurringLimitAction': { cap: 'manage_invoices', feature: 'Change a recurring invoice limit' },
  'recurring/actions.ts#deleteRecurringAction': { cap: 'manage_invoices', feature: 'Delete a recurring invoice' },
  'i/[token]/actions.ts#startStripeCheckoutAction': { public: true, feature: 'Client pays an invoice online (public link)' },

  // ── Invoice configuration (an account setting) ──
  'invoices/configure/actions.ts#saveLabelsAction': { cap: 'edit_account_settings', feature: 'Edit invoice field labels' },
  'invoices/configure/actions.ts#resetLabelsAction': { cap: 'edit_account_settings', feature: 'Reset invoice field labels' },
  'invoices/configure/actions.ts#saveMessageAction': { cap: 'edit_account_settings', feature: 'Edit invoice email messages' },
  'invoices/configure/actions.ts#addItemTypeAction': { cap: 'edit_account_settings', feature: 'Add an invoice item type' },
  'invoices/configure/actions.ts#deleteItemTypeAction': { cap: 'edit_account_settings', feature: 'Delete an invoice item type' },
  'invoices/configure/actions.ts#addSenderAction': { cap: 'edit_account_settings', feature: 'Add an invoice sender' },
  'invoices/configure/actions.ts#setDefaultSenderAction': { cap: 'edit_account_settings', feature: 'Set the default invoice sender' },
  'invoices/configure/actions.ts#deleteSenderAction': { cap: 'edit_account_settings', feature: 'Delete an invoice sender' },

  // ── Reports ──
  'reports/saved/actions.ts#createSavedReport': { owner: true, feature: 'Save a report' },
  'reports/saved/actions.ts#editSavedReport': { owner: true, feature: 'Rename/share a saved report' },
  'reports/saved/actions.ts#updateSavedReportParams': { owner: true, feature: 'Update a saved report' },
  'reports/saved/actions.ts#duplicateSavedReport': { owner: true, feature: 'Duplicate a saved report' },
  'reports/saved/actions.ts#setSavedReportArchived': { owner: true, feature: 'Archive a saved report' },
  'reports/saved/actions.ts#deleteSavedReport': { owner: true, feature: 'Delete a saved report' },

  // ── Settings ──
  'settings/actions.ts#updatePreferencesAction': { cap: 'edit_account_settings', feature: 'Edit account preferences' },
  'settings/actions.ts#updateModulesAction': { cap: 'edit_account_settings', feature: 'Turn modules on/off' },
  'settings/actions.ts#createCategoryAction': { cap: 'edit_account_settings', feature: 'Create an expense category' },
  'settings/actions.ts#updateAppearanceAction': { cap: 'edit_account_settings', feature: 'Edit appearance' },
  'settings/actions.ts#toggleCategoryAction': { cap: 'edit_account_settings', feature: 'Archive an expense category' },
  'settings/activity-log/actions.ts#runChecksNowAction': { cap: 'edit_account_settings', feature: 'Run integration health checks' },
  'settings/entities/actions.ts#updateEntityBrandingAction': { cap: 'edit_account_settings', feature: 'Edit a company’s branding' },
  'settings/entities/actions.ts#addEntityAction': { cap: 'edit_account_settings', feature: 'Add a company' },
  'settings/entities/actions.ts#setDefaultEntityAction': { cap: 'edit_account_settings', feature: 'Set the default company' },
  'settings/entities/actions.ts#setEntityActiveAction': { cap: 'edit_account_settings', feature: 'Archive a company' },
  'settings/integrations/actions.ts#saveIntegrationAction': { cap: 'edit_account_settings', feature: 'Connect an integration' },
  'settings/integrations/actions.ts#importAsanaAction': { cap: 'edit_account_settings', feature: 'Import from Asana' },
  'settings/integrations/actions.ts#disconnectIntegrationAction': { cap: 'edit_account_settings', feature: 'Disconnect an integration' },
  'settings/migrate/actions.ts#saveHarvestCredsAction': { cap: 'edit_account_settings', feature: 'Save Harvest credentials' },
  'settings/migrate/actions.ts#createBackupSnapshotAction': { cap: 'edit_account_settings', feature: 'Start a Harvest backup' },
  'settings/migrate/actions.ts#backupBatchAction': { cap: 'edit_account_settings', feature: 'Run a Harvest backup batch' },
  'settings/migrate/actions.ts#discardBackupAction': { cap: 'edit_account_settings', feature: 'Discard a Harvest backup' },
  'settings/migrate/actions.ts#importBatchAction': { cap: 'edit_account_settings', feature: 'Import a Harvest batch' },
  'settings/tokens/actions.ts#createApiTokenAction': { owner: true, feature: 'Create my API token' },
  'settings/tokens/actions.ts#revokeApiTokenAction': { owner: true, feature: 'Revoke my API token' },
  'settings/tokens/actions.ts#revokeOAuthGrantAction': { owner: true, feature: 'Revoke an app I authorized' },
}
