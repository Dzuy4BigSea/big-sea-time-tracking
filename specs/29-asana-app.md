# 29 — Track time from Asana tasks (Asana app)

Big Sea's work is planned in Asana, and today people track time against Asana tasks through Harvest's
Asana integration (a browser extension that puts a Harvest clock on each task). Harvest stores that link
on each time entry as `external_reference`. Track2 replaces it with an **official Asana app** built on
Asana's App Components platform, so it works in Asana on the web, in the desktop app and on mobile, and
nobody installs a browser extension. This completes the "in-context time tracking" part of
[specs/14 §1](14-integrations.md) (AC-ASANA-003), which was deferred.

Asana platform facts here come from developers.asana.com (building-app-components, app-components-on-tasks,
modal-forms, widgets, approval checklist, share-your-app) and Asana's app-components example app,
read 2026-10-19.

## 1. What people see

1. On any task in a project that has the Track2 app added, a **Track time** button (Asana renders it from
   the app's "Modal form action text").
2. It opens a form Asana draws from Track2's JSON:
   - **What** (radio): *Start a timer* (default) · *Log hours* · *Stop my timer* (only when the person
     has a running timer; the default when that timer is on this Asana task).
   - **Project** (typeahead over the person's active assigned projects).
   - **Task** (dropdown of that project's active tasks, the person's recently used first).
   - **Notes** (prefilled with the Asana task name, as Harvest did).
   - **Hours** (only for *Log hours*; `1.5` or `1:30`) and **Date** (defaults to today in the account timezone).
3. Submitting creates the time entry or starts/stops the timer in Track2 and attaches a **Track2** card
   (widget) to the Asana task. The card shows the hours logged on that task, whether a timer is running,
   and when time was last tracked. "Open in Track2" goes to `/asana/t/<task gid>`: every Track2 entry on
   that Asana task the viewer may see.

Asana widgets have no buttons, so stopping a timer is done from the same **Track time** form (or from
Track2 itself). The card is fetched when the task is opened, so a running timer's hours are as of then.

## 2. Data model

`TimeEntry` gains the same link Harvest keeps (`externalService`, `externalId`, `externalGroupId`,
`externalPermalink`; index `(accountId, externalService, externalId)`). For Asana: service `asana`,
id = task gid, group = Asana project gid, permalink = the task URL. A link is metadata: it never changes
hours, rates or lock state, and editing it does not touch an invoiced or approved entry's money (INV-3).

People are matched by `User.asanaUserGid` (set by the Asana people import, by the email fallback below,
or by the person's own sign-in).

## 3. Contract with Asana

| Endpoint (under `/api/integrations/asana/app`) | Asana calls it | Answers |
|---|---|---|
| `GET form` | when Track time is clicked | form metadata (`form_metadata_v0`) |
| `GET projects` | typeahead on Project | `{ items: [{ title, subtitle, value }] }` |
| `POST change` | a watched field changed | the whole form again |
| `POST submit` | form submitted | `{ resource_name, resource_url }`; 400 + the form with field errors |
| `GET widget` | a task with a Track2 attachment is opened | widget metadata (`summary_with_details_v0`) |
| `GET auth`, `GET auth/callback` | the Authentication URL popup | Asana OAuth → link → `postMessage("success")` |

- Every request from Asana is signed: `x-asana-request-signature` = hex HMAC-SHA256 with the app's client
  secret over the raw query string (GET) or the `data` string of the JSON body (POST). Bad or missing
  signature → 400. `expires_at` in the past → 400. Responses carry CORS for `https://app.asana.com`.
- `workspace` → the Track2 account whose Asana connection has that `workspaceGid` (INV-5). None → 404.
- `user` gid → the active Track2 user with that `asanaUserGid` in the account. When none, Track2 looks the
  Asana user up with the account's Asana token and matches an active user by email, saving the gid.
  Still none → the form shows "Link your Track2 account" and submit is refused.
- Env (Vercel, Production): `ASANA_APP_CLIENT_ID`, `ASANA_APP_CLIENT_SECRET`. Without them every endpoint
  answers 503.

## 4. Backfill of Harvest links

`scripts/backfill-external-refs.mjs` reads the stored Harvest snapshots and writes each entry's
`external_reference` onto the Track2 entry with the same `harvestId`. The Harvest importer and
`rebuild-timesheets.mjs` carry the link from now on.

## Acceptance criteria

- **AC-ASANAAPP-001**: *Given* a request whose signature doesn't match the client secret (or is missing,
  or `expires_at` has passed), *when* any app endpoint is called, *then* it answers 400 and changes nothing.
- **AC-ASANAAPP-002**: *Given* an Asana workspace gid that no Track2 account is connected to, *when* the
  form or widget is requested, *then* it answers 404.
- **AC-ASANAAPP-003**: *Given* an Asana user with no Track2 user by gid but an active Track2 user with the
  same email, *when* they open the form, *then* they're matched and the gid is saved; *given* no match,
  *then* the form explains how to link and submit is refused.
- **AC-ASANAAPP-004**: *Given* a person opens Track time on an Asana task, *when* the form loads, *then*
  Project/Task default to the last Track2 project/task used on that Asana task by them, else on that
  Asana project by anyone, else the Track2 project imported from that Asana project; Notes default to
  the Asana task name; Date defaults to the account's today.
- **AC-ASANAAPP-005**: *Given* *Start a timer* with a project and task the person is assigned to, *when*
  submitted, *then* a running timer is created for them linked to the Asana task (service `asana`, task
  gid, project gid, permalink), any other running timer is stopped first (spec 04), and the response
  attaches `/asana/t/<task gid>`.
- **AC-ASANAAPP-006**: *Given* *Log hours* with `1:30`, *when* submitted, *then* a 90-minute entry is
  created on the chosen date with the same link; hours that don't parse or are ≤ 0 return 400 with the
  error on the Hours field.
- **AC-ASANAAPP-007**: *Given* *Stop my timer*, *when* submitted, *then* the person's running timer stops
  (spec 04 rounding/caps apply); *given* nothing is running, *then* 400 "No timer is running".
- **AC-ASANAAPP-008**: *Given* a project/task the person isn't assigned to (or archived), *when* submitted,
  *then* 400 with `checkLoggable`'s message and nothing is written.
- **AC-ASANAAPP-009**: *Given* a task with linked entries, *when* the widget loads, *then* it shows the
  total hours the viewer may see (their own for Members, all for people who can see others' time), the
  viewer's own hours, a "Running" pill when a visible timer is running on that task, and the last date.
- **AC-ASANAAPP-010**: *Given* Harvest snapshot rows with an Asana `external_reference`, *when* the
  backfill runs with `--apply`, *then* the matching Track2 entries get the link, entries that already have
  a link are not overwritten, `updatedAt` doesn't change, and a second run writes nothing.
- **AC-ASANAAPP-011**: *Given* the Authentication URL is opened by a signed-in Track2 user, *when* they
  approve Asana's OAuth screen, *then* their `asanaUserGid` is set (and cleared from any other user in the
  account), and the popup posts `success` to `https://app.asana.com`.
