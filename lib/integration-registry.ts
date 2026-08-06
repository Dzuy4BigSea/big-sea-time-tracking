/**
 * Integration provider registry (specs/14) — pure data, safe to import in both client and
 * server components. Describes, per provider, the credential fields an admin enters and the
 * non-secret config. The setup UI and the save action are both driven by this.
 */

export type ProviderKey = 'stripe' | 'xero' | 'asana'
export type FieldKind = 'secret' | 'text' | 'toggle'

export interface ProviderField {
  key: string
  label: string
  kind: FieldKind
  placeholder?: string
  help?: string
  required?: boolean
}

export interface ProviderDef {
  key: ProviderKey
  name: string
  category: string
  description: string
  docsUrl: string
  /** Credential fields — stored encrypted in secretsEnc. */
  secrets: ProviderField[]
  /** Non-secret configuration — stored in config JSON. */
  config: ProviderField[]
  /** Which config field (if any) labels the connection, shown as "Connected to …". */
  orgNameField?: string
}

export const PROVIDERS: ProviderDef[] = [
  {
    key: 'stripe',
    name: 'Stripe',
    category: 'Finance and payments',
    description: 'Receive invoice payments online by credit card or ACH. Recorded payments sync back automatically.',
    docsUrl: 'https://dashboard.stripe.com/apikeys',
    secrets: [
      { key: 'secretKey', label: 'Secret key', kind: 'secret', placeholder: 'sk_live_…', required: true, help: 'Stripe → Developers → API keys.' },
      { key: 'webhookSecret', label: 'Webhook signing secret', kind: 'secret', placeholder: 'whsec_…', required: true, help: 'From the webhook endpoint you create for /api/integrations/stripe/webhook.' },
    ],
    config: [
      { key: 'publishableKey', label: 'Publishable key', kind: 'text', placeholder: 'pk_live_…' },
      { key: 'accountLabel', label: 'Account label', kind: 'text', placeholder: 'Big Sea' },
      { key: 'creditCardEnabled', label: 'Enable credit card payments', kind: 'toggle' },
      { key: 'achEnabled', label: 'Enable ACH direct debit (USD)', kind: 'toggle' },
    ],
    orgNameField: 'accountLabel',
  },
  {
    key: 'xero',
    name: 'Xero',
    category: 'Finance and payments',
    description: 'Copy invoices and payments to Xero on send, eliminating double entry.',
    docsUrl: 'https://developer.xero.com/app/manage',
    secrets: [
      { key: 'accessToken', label: 'Access token', kind: 'secret', placeholder: 'Xero OAuth2 access token', required: true, help: 'A valid Xero access token (or the token from your OAuth app).' },
      { key: 'refreshToken', label: 'Refresh token', kind: 'secret', placeholder: 'optional', help: 'Used to refresh the access token when it expires.' },
    ],
    config: [
      { key: 'tenantId', label: 'Xero tenant ID', kind: 'text', placeholder: 'xero-tenant-uuid', required: true },
      { key: 'orgName', label: 'Organisation name', kind: 'text', placeholder: 'Big Sea' },
      { key: 'defaultRevenueAccountCode', label: 'Default revenue account code', kind: 'text', placeholder: '400.2' },
      { key: 'paymentAccountCode', label: 'Payment account code (blank = don’t copy payments)', kind: 'text', placeholder: 'Stripe' },
      { key: 'populateTrackingByClient', label: 'Populate tracking categories by client', kind: 'toggle' },
    ],
    orgNameField: 'orgName',
  },
  {
    key: 'asana',
    name: 'Asana',
    category: 'Project management',
    description: 'Import projects and people from an Asana workspace to seed your projects and team.',
    docsUrl: 'https://app.asana.com/0/my-apps',
    secrets: [
      { key: 'accessToken', label: 'Personal access token', kind: 'secret', placeholder: 'Asana PAT', required: true, help: 'Asana → My Settings → Apps → Personal access tokens.' },
    ],
    config: [
      { key: 'workspaceGid', label: 'Workspace GID', kind: 'text', placeholder: 'asana workspace gid', required: true },
      { key: 'workspaceName', label: 'Workspace name', kind: 'text', placeholder: 'Big Sea' },
      { key: 'autoImportNewProjects', label: 'Auto-import new projects', kind: 'toggle' },
    ],
    orgNameField: 'workspaceName',
  },
]

export function providerDef(key: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.key === key)
}
