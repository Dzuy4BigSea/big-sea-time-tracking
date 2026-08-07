/**
 * Business-entity resolution (specs/16) — pure, DB-free logic.
 *
 * An invoice's effective entity, and the sender identity / branding / integration routing that flow
 * from it, are decided here so the rules are unit-testable without a database. The DB wiring lives in
 * lib/entities.ts.
 */

export type EntityRef = string | null | undefined

/**
 * Pick the effective entity id for an invoice: the invoice's own stamp wins, then the client's
 * designation, then the account's default entity. Returns null only if there is no default at all.
 */
export function pickEntityId(invoiceEntityId: EntityRef, clientEntityId: EntityRef, defaultEntityId: EntityRef): string | null {
  return invoiceEntityId ?? clientEntityId ?? defaultEntityId ?? null
}

export interface SenderIdentity {
  senderName: string | null
  senderEmail: string | null
  replyToEmail: string | null
}

/**
 * Merge an entity's sender identity over the account default. An entity field only overrides when it
 * is actually set (non-empty); blank entity fields fall through to the account default.
 */
export function resolveSender(
  entity: Partial<SenderIdentity> | null | undefined,
  accountDefault: Partial<SenderIdentity>,
): SenderIdentity {
  const pick = (a: string | null | undefined, b: string | null | undefined) => {
    const v = (a ?? '').trim() || (b ?? '').trim()
    return v || null
  }
  return {
    senderName: pick(entity?.senderName, accountDefault.senderName),
    senderEmail: pick(entity?.senderEmail, accountDefault.senderEmail),
    replyToEmail: pick(entity?.replyToEmail, accountDefault.replyToEmail),
  }
}

export interface Branding {
  brandColor: string
  accentColor: string
  logoFileUrl: string | null
  documentTitle: string
}

/** Merge an entity's branding over the account appearance; blank entity fields fall through. */
export function resolveBranding(
  entity:
    | { brandColor?: string | null; accentColor?: string | null; logoFileUrl?: string | null; documentTitle?: string | null }
    | null
    | undefined,
  accountAppearance: Branding,
): Branding {
  const str = (a: string | null | undefined, b: string) => ((a ?? '').trim() || b)
  return {
    brandColor: str(entity?.brandColor, accountAppearance.brandColor),
    accentColor: str(entity?.accentColor, accountAppearance.accentColor),
    // logo: entity logo wins if set, else account logo (which may itself be null)
    logoFileUrl: (entity?.logoFileUrl ?? '').trim() || accountAppearance.logoFileUrl,
    documentTitle: str(entity?.documentTitle, accountAppearance.documentTitle),
  }
}

export interface EmailTheme {
  brandColor: string
  accentColor: string
}

/**
 * Resolve email header/accent colors for an entity (spec 18). Email colors fall back to the entity's
 * invoice brand/accent, then to the provided account defaults — so a company themes its emails for
 * free once it sets its invoice brand, and can still override email colors specifically.
 */
export function resolveEmailTheme(
  entity:
    | { emailBrandColor?: string | null; emailAccentColor?: string | null; brandColor?: string | null; accentColor?: string | null }
    | null
    | undefined,
  accountDefault: EmailTheme,
): EmailTheme {
  const pick = (...vals: (string | null | undefined)[]) => vals.map((v) => (v ?? '').trim()).find(Boolean)
  return {
    brandColor: pick(entity?.emailBrandColor, entity?.brandColor, accountDefault.brandColor) || accountDefault.brandColor,
    accentColor: pick(entity?.emailAccentColor, entity?.accentColor, accountDefault.accentColor) || accountDefault.accentColor,
  }
}

/** Whether an invoice can actually be sent for this entity (needs a from-address). */
export function canSendAs(identity: SenderIdentity): boolean {
  return !!identity.senderEmail
}
