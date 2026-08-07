'use client'

import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { updateEntityBrandingAction, type EntityState } from '@/app/settings/entities/actions'

export interface EntityBranding {
  id: string
  name: string
  code: string
  isDefault: boolean
  senderName: string | null
  senderEmail: string | null
  replyToEmail: string | null
  brandColor: string | null
  accentColor: string | null
  logoFileUrl: string | null
  documentTitle: string | null
  emailBrandColor: string | null
  emailAccentColor: string | null
}

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'
const ACCOUNT_BRAND = '#004348'
const ACCOUNT_ACCENT = '#047a44'

function Save() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
      {pending ? 'Saving…' : 'Save company branding'}
    </button>
  )
}

function ColorField({ name, label, value, onChange, placeholder }: { name: string; label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-gray-400">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-gray-300 bg-white p-0.5"
          aria-label={`${label} swatch`}
        />
        <input name={name} value={value} onChange={(e) => onChange(e.target.value)} placeholder={`${placeholder} (default)`} className={`${input} w-32 font-mono`} />
      </span>
    </label>
  )
}

export function BrandConsoleForm({ entity }: { entity: EntityBranding }) {
  const [state, action] = useFormState(updateEntityBrandingAction, {} as EntityState)
  const [name, setName] = useState(entity.name)
  const [brand, setBrand] = useState(entity.brandColor ?? '')
  const [accent, setAccent] = useState(entity.accentColor ?? '')
  const [logo, setLogo] = useState(entity.logoFileUrl ?? '')
  const [title, setTitle] = useState(entity.documentTitle ?? '')
  const [emailBrand, setEmailBrand] = useState(entity.emailBrandColor ?? '')
  const [emailAccent, setEmailAccent] = useState(entity.emailAccentColor ?? '')

  const brandC = brand || ACCOUNT_BRAND
  const accentC = accent || ACCOUNT_ACCENT
  const emailBrandC = emailBrand || brand || '#0d2022'
  const emailAccentC = emailAccent || accent || '#bbfd50'

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <form action={action} className="space-y-5">
        <input type="hidden" name="id" value={entity.id} />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-gray-400">Company name</span>
            <input name="name" value={name} onChange={(e) => setName(e.target.value)} className={input} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-gray-400">Document title</span>
            <input name="documentTitle" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="INVOICE (default)" className={input} />
          </label>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Invoice branding</div>
          <div className="flex flex-wrap gap-4">
            <ColorField name="brandColor" label="Brand color" value={brand} onChange={setBrand} placeholder={ACCOUNT_BRAND} />
            <ColorField name="accentColor" label="Accent color" value={accent} onChange={setAccent} placeholder={ACCOUNT_ACCENT} />
          </div>
          <label className="mt-3 flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-gray-400">Logo URL</span>
            <input name="logoFileUrl" value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="/brand/logotype-white.svg or https://…" className={`${input} max-w-md`} />
          </label>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Email theme</div>
          <div className="flex flex-wrap gap-4">
            <ColorField name="emailBrandColor" label="Header color" value={emailBrand} onChange={setEmailBrand} placeholder="#0d2022" />
            <ColorField name="emailAccentColor" label="Accent" value={emailAccent} onChange={setEmailAccent} placeholder="#bbfd50" />
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Sender identity</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-400">From name</span>
              <input name="senderName" defaultValue={entity.senderName ?? ''} placeholder={name} className={input} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-400">From email</span>
              <input name="senderEmail" type="email" defaultValue={entity.senderEmail ?? ''} placeholder="billing@…" className={input} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-400">Reply-to</span>
              <input name="replyToEmail" type="email" defaultValue={entity.replyToEmail ?? ''} placeholder="optional" className={input} />
            </label>
          </div>
          <p className="mt-1 text-xs text-gray-400">Blank fields fall back to the account default. Sending requires a from-email (yours or the account&apos;s).</p>
        </div>

        <div className="flex items-center gap-3">
          <Save />
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          {state.ok && <span className="text-sm text-brand-green">Saved ✓</span>}
        </div>
      </form>

      {/* Live preview */}
      <div className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Preview</div>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 text-white" style={{ background: brandC }}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt={name} className="h-5 w-auto" />
            ) : (
              <span className="text-sm font-semibold">{name}</span>
            )}
            <span className="text-xs font-bold uppercase tracking-widest">{title || 'INVOICE'}</span>
          </div>
          <div className="space-y-2 p-4 text-xs">
            <div className="flex justify-between"><span className="text-gray-400">Amount due</span><span className="font-serif text-base font-semibold" style={{ color: brandC }}>$2,400.00</span></div>
            <div className="h-px bg-gray-100" />
            <button className="w-full rounded py-1.5 text-center text-xs font-semibold text-white" style={{ background: accentC }} type="button" disabled>Pay invoice</button>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex">
            <div className="w-1.5" style={{ background: emailAccentC }} />
            <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest" style={{ background: emailBrandC, color: emailAccentC }}>Invoice</div>
          </div>
          <div className="p-4 text-xs text-gray-600">
            <div className="mb-2 font-semibold text-gray-800">Email header preview</div>
            <button className="rounded px-3 py-1.5 text-xs font-semibold text-white" style={{ background: emailBrandC }} type="button" disabled>View invoice</button>
          </div>
        </div>
        <p className="text-xs text-gray-400">Colors left blank inherit the account brand.</p>
      </div>
    </div>
  )
}
