# 19 — Migration follow-ups (revisit)

Parked items from the Harvest → Track2 migration (completed 2026-08-07). None block go-live; each
is a fidelity/accuracy improvement to decide on before or shortly after cutover. See the
`migration-progress` memory for the full run log.

## 1. Project-manager flag looks over-broad
Phase 4 imported `is_project_manager` faithfully, but **28,417 of 31,646** user-assignments (~90%)
came back as PM. That may mean Harvest's flag doesn't distinguish "manages the project" the way we
assume (could be closer to "can see/administer"). **Action:** confirm what Big Sea intends the PM
flag to drive (permissions? reporting? nothing?), and if it should be sparser, derive a stricter rule
(e.g. only the account/exec managers, or only people with the manager permission profile) instead of
trusting the raw Harvest flag.

## 2. Reconcile the 7 partially-paid invoices vs Xero
Fully-paid/unpaid invoices imported exactly; the 7 with a *partial* balance got a single
reconstructed payment (right total + balance + date, but not the individual payment lines). Xero is
the system of record for payment detail. **Action:** eyeball these against Xero and hand-adjust if
any matter: **#2072, #2645, #387523, #387747, #389700, #911, #996**. (If exact multi-payment history
is ever needed, do a targeted pull of Harvest `/invoices/{id}/payments` for just these.)

## 3. Estimates = 0 (Harvest endpoint 403'd)
The backup's estimates list returned 403, so **no estimates** were captured or migrated (snapshot is
`partial` for this reason). **Action:** decide whether historical estimates matter; if so, re-auth /
re-pull just the estimates resource, then run the importer's estimate stage (already built).

## 4. Cost rates + most billable rates not in the flat export
Harvest's flat export doesn't carry per-person **cost rates**, and only ~47k of 388k time entries
carry a stored **billable rate** (Harvest resolves the rest at report time). Consequences today: the
project **Costs** column is hidden (would be all $0), and historical billable $ on time reports
understates. Invoice revenue is unaffected (captured at the invoice level). **Action:** if internal
profitability on historical time matters, capture person cost/billable rate tables from Harvest
(per-user rate endpoints) and backfill; otherwise accept going-forward rate resolution via Track2's
rate rules.
