# Track2 — Design System & Re-skin Guide

A hand-off reference for reproducing the Track2 UI at the same fidelity while swapping in your brand colors. Everything here reflects what's actually in the app (Tailwind CSS + a few CSS variables). **To re-brand, you change ~3 hex values (see §1.1) — nothing else structural needs to move.**

Stack: **Tailwind CSS** (utility classes), tokens centralized in [`tailwind.config.ts`](tailwind.config.ts) and [`app/globals.css`](app/globals.css). System UI font stack (no custom webfont yet).

---

## 1. Color tokens

### 1.1 Brand colors — **change these to re-skin** (`tailwind.config.ts` → `theme.extend.colors.brand`)

| Token | Current hex | Role in the UI | Swap to |
|---|---|---|---|
| `brand.orange` | `#fb5c31` | **Primary accent** — active nav item, Timer button, "PM" tags, active tabs/pills, hover accents, the `orange-50` highlight backgrounds | **your primary brand color** |
| `brand.green` | `#3aa76d` | **Primary action / success** — Save/Create/primary buttons, positive figures, "connected/ok" states | your success or secondary brand color (can stay green) |
| `brand.teal` | `#004348` | **Document brand** — invoice header + "amount due" (this is Big Sea's teal already; also overridable per-account in Settings → Invoice appearance) | your document/brand color |

Because these are Tailwind theme tokens, changing the three hex values re-skins every `brand-*` utility (`bg-brand-orange`, `text-brand-green`, etc.) across the whole app at once. The invoice document color is *also* editable at runtime per account (Settings → Invoice appearance), so client-facing invoices can carry a brand color without a code change.

> Quickest path for a designer/Claude: edit `tailwind.config.ts`, replace the three hexes, rebuild. Optionally add a `50` tint of your primary to replace the `orange-50` active-state backgrounds for a perfect match.

### 1.2 Neutrals & status (Tailwind defaults, used as-is)

- **Neutrals:** `gray-50` (row hover / subtle fills), `gray-100` (borders/dividers, muted badges), `gray-200` (card & table borders), `gray-400` (labels, meta), `gray-500/600/700` (secondary text), `gray-900` (primary text). Page background `gray-50`; surfaces `white`.
- **Status palette** (badges & accents): `blue` = open / Time-&-Materials; `green` = paid / billable / success; `red` = overdue / declined / destructive; `purple` = fixed-fee; `amber` = warnings (e.g. missing config); `orange` (brand) = active/PM.
- **CSS variables** ([`app/globals.css`](app/globals.css)): `--bg: #ffffff`, `--fg: #1a1a1a` (body base). Pages are theme-light today.

---

## 2. Typography, spacing, shape

- **Font:** system sans stack (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, …`). Swap by setting `fontFamily.sans` in the config + loading a webfont if desired.
- **Type scale (Tailwind):** page title `text-2xl font-semibold`; section heading `text-sm font-semibold text-gray-700`; table/label caps `text-xs uppercase tracking-wide text-gray-400`; body `text-sm`; numbers use `tabular-nums`.
- **Spacing:** 4px base (Tailwind scale). Cards `p-4`/`p-5`; table cells `px-4 py-3`; page content wrapped `mx-auto max-w-6xl px-8 py-6`.
- **Radius:** `rounded` (inputs/buttons), `rounded-lg` (cards/tables/modals), `rounded-full` (badges/pills/avatars).
- **Elevation:** flat by default (1px `gray-200` borders); modals use `shadow-xl`, popovers `shadow-lg`, sticky top bar `bg-white/90 backdrop-blur`.

---

## 3. Component patterns (copy-paste class recipes)

**Buttons**
- Primary action: `rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50`
- Brand/timer: `rounded-full bg-brand-orange px-3 py-1.5 text-sm font-medium text-white hover:opacity-90`
- Secondary: `rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50`
- Destructive (ghost): `text-gray-400 hover:bg-red-50 hover:text-red-600`
- Link: `text-blue-600 hover:underline` (or `text-gray-500 hover:text-brand-orange` for in-context nav)

**Card:** `rounded-lg border border-gray-200 bg-white p-5`

**Table:** wrapper `overflow-hidden rounded-lg border border-gray-200 bg-white`; head row `border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400`; body row `border-b border-gray-100 last:border-0 hover:bg-gray-50`; numeric cells `text-right tabular-nums`.

**Badge / status pill:** `rounded-full px-2 py-0.5 text-xs font-medium` + a status color pair (e.g. paid `bg-green-100 text-green-700`, open `bg-blue-100 text-blue-700`, draft `bg-gray-100 text-gray-600`, overdue `text-red-600`).

**Form field:** input `rounded border border-gray-300 px-2 py-1.5 text-sm`; label `text-xs uppercase tracking-wide text-gray-400` (or `text-sm font-medium text-gray-700` in dialogs). Inline validation `text-sm text-red-600`; success `text-sm text-brand-green`.

**Modal:** overlay `fixed inset-0 z-40 flex items-start justify-center bg-black/30 p-4 pt-24`; panel `w-full max-w-md rounded-lg bg-white p-5 shadow-xl`. (See the "New time entry" dialog for the canonical example.)

**Sidebar:** `flex w-56 shrink-0 flex-col border-r border-gray-200 bg-white px-3 py-4`; section heading `text-[11px] font-medium uppercase tracking-wide text-gray-400`; nav item active `bg-orange-50 font-medium text-brand-orange`, idle `text-gray-700 hover:bg-gray-50`.

**Top bar:** `sticky top-0 z-20 flex items-center justify-between border-b border-gray-200 bg-white/90 px-8 py-3 backdrop-blur`; round icon buttons `flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50`.

**Progress bar** (budgets): track `h-1.5 w-24 overflow-hidden rounded-full bg-gray-100`; fill `bg-blue-500` (or `bg-red-500` when over).

---

## 4. Key screens to reference (for fidelity)

`components/Sidebar.tsx`, `components/TopBar.tsx`, `components/TimeEntryModal.tsx`, `app/page.tsx` (dashboard), `app/invoices/[id]/page.tsx` + `app/i/[token]/page.tsx` (invoice document), `app/reports/page.tsx`, `app/settings/**`. These show the buttons/cards/tables/badges/modal patterns in situ.

---

## 5. Re-skin checklist (for the designer / Claude)

1. Set the three `brand.*` hexes in `tailwind.config.ts` to your palette (primary → `brand.orange`, action → `brand.green`, document → `brand.teal`).
2. If your primary isn't orange, replace the `orange-50` active-state fills (sidebar/tabs/PM tags) with a `50`-tint of your primary — add it as `brand.tint` in the config and swap `orange-50` → `brand-tint`.
3. (Optional) Set `fontFamily.sans` + load your webfont for brand typography.
4. Set the account's **Invoice appearance** (Settings) to your logo + brand color for client-facing invoices.
5. Rebuild (`npm run build`) and spot-check: active nav, Timer button, primary buttons, status badges, invoice header.

Nothing else in the layout, spacing, or component structure needs to change to keep the current fidelity — only the color tokens (and optionally the font).
