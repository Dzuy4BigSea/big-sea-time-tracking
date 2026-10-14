/**
 * A small in-memory Xero (Accounting API + identity token endpoint + Connections) for unit tests.
 * Response bodies follow Xero's documented shapes; faults (timeouts, 429, 5xx) are injected per call.
 */
import { XERO_API, XERO_CONNECTIONS_URL, XERO_TOKEN_URL } from '@/modules/integrations/xeroClient'

export interface FakeReq {
  method: string
  url: string
  path: string
  headers: Record<string, string>
  body: any
}

export type Fault =
  | { kind: 'timeout'; applyFirst?: boolean } // hang until aborted; applyFirst = Xero processed it anyway
  | { kind: '429'; retryAfter: string; problem?: string }
  | { kind: '500' }
  | { kind: '503' }

let seq = 0
const uuid = (p: string) => `${p}-${String(++seq).padStart(4, '0')}-0000-0000-000000000000`

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

const validation = (messages: string[], element: Record<string, unknown> = {}) =>
  json(400, {
    ErrorNumber: 10,
    Type: 'ValidationException',
    Message: 'A validation exception occurred',
    Elements: [{ ...element, ValidationErrors: messages.map((Message) => ({ Message })) }],
  })

const round2 = (n: number) => Math.round(n * 100) / 100

export class FakeXero {
  tenantId = 'tenant-bigsea'
  accessToken = 'at-0'
  refreshToken = 'rt-0'
  tokenCalls = 0
  connectionsCalls = 0
  /** Extra amount (major units) Xero adds to every created invoice — simulates a mapping bug. */
  totalSkew = 0
  /** Tenants the token can reach (Connections API). */
  connectedTenants: string[] = [this.tenantId]
  accountCodes = new Set(['400', '400.2', '820'])
  bankAccounts = new Set(['Stripe', '090'])
  contacts: any[] = []
  invoices: any[] = []
  calls: FakeReq[] = []
  private idem = new Map<string, { status: number; body: unknown }>()
  private faults: Array<{ match: (r: FakeReq) => boolean; fault: Fault }> = []

  /** Inject a one-shot fault for the next request matching `method` + path prefix. */
  failNext(method: string, pathPrefix: string, fault: Fault) {
    this.faults.push({ match: (r) => r.method === method && r.path.startsWith(pathPrefix), fault })
  }

  callsTo(method: string, pathPrefix: string): FakeReq[] {
    return this.calls.filter((c) => c.method === method && c.path.startsWith(pathPrefix))
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    const headers = Object.fromEntries(Object.entries((init.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
    const rawBody = typeof init.body === 'string' ? init.body : undefined
    let body: any = undefined
    if (rawBody) {
      try {
        body = JSON.parse(rawBody)
      } catch {
        body = Object.fromEntries(new URLSearchParams(rawBody))
      }
    }
    const path = url.startsWith(XERO_API) ? url.slice(XERO_API.length) : url
    const req: FakeReq = { method, url, path, headers, body }
    this.calls.push(req)

    const fi = this.faults.findIndex((f) => f.match(req))
    if (fi >= 0) {
      const { fault } = this.faults.splice(fi, 1)[0]
      if (fault.kind === '429') return json(429, { Title: 'Too Many Requests' }, { 'retry-after': fault.retryAfter, 'x-rate-limit-problem': fault.problem ?? 'minute' })
      if (fault.kind === '500') return json(500, { Title: 'An error occurred', Status: 500, Detail: 'Internal Server Error' })
      if (fault.kind === '503') return new Response('Service Unavailable', { status: 503 })
      if (fault.kind === 'timeout') {
        if (fault.applyFirst) await this.handle(req) // Xero did it; the response is lost
        return new Promise<Response>((_, reject) => {
          const signal = init.signal
          if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
        })
      }
    }
    return this.handle(req)
  }

  private async handle(req: FakeReq): Promise<Response> {
    if (req.url === XERO_TOKEN_URL) return this.token(req)
    if (req.url === XERO_CONNECTIONS_URL) {
      this.connectionsCalls++
      if (req.headers.authorization !== `Bearer ${this.accessToken}`) return json(401, { Title: 'Unauthorized', Status: 401, Detail: 'TokenExpired' })
      return json(
        200,
        this.connectedTenants.map((t, i) => ({ id: `conn-${i}`, authEventId: 'auth-1', tenantId: t, tenantType: 'ORGANISATION', tenantName: i ? 'Cordelia Labs' : 'Big Sea', createdDateUtc: '2026-10-01T00:00:00.0000000', updatedDateUtc: '2026-10-01T00:00:00.0000000' })),
      )
    }
    if (req.headers.authorization !== `Bearer ${this.accessToken}`) {
      return json(401, { Type: null, Title: 'Unauthorized', Status: 401, Detail: 'TokenExpired: token expired at 10/14/2026 09:00:00', Instance: 'f1d2', Extensions: {} }, { 'www-authenticate': 'Bearer error="invalid_token"' })
    }
    if (req.headers['xero-tenant-id'] !== this.tenantId) {
      return json(403, { Type: null, Title: 'Forbidden', Status: 403, Detail: 'AuthenticationUnsuccessful', Instance: 'f1d3', Extensions: {} })
    }
    const key = req.headers['idempotency-key']
    if (key && req.method !== 'GET' && this.idem.has(key)) {
      const c = this.idem.get(key)!
      return json(c.status, c.body)
    }
    const res = this.api(req)
    if (key && req.method !== 'GET') this.idem.set(key, { status: res.status, body: res.body })
    return json(res.status, res.body)
  }

  private token(req: FakeReq): Response {
    this.tokenCalls++
    if (req.body?.grant_type === 'client_credentials') {
      // Custom Connection: no refresh token in the response
      this.accessToken = `at-cc-${this.tokenCalls}`
      return json(200, { access_token: this.accessToken, expires_in: 1800, token_type: 'Bearer', scope: 'accounting.transactions accounting.contacts' })
    }
    if (req.body?.grant_type !== 'refresh_token' || req.body?.refresh_token !== this.refreshToken) return json(400, { error: 'invalid_grant' })
    this.accessToken = `at-${this.tokenCalls}`
    this.refreshToken = `rt-${this.tokenCalls}`
    return json(200, {
      id_token: 'eyJ.id.token',
      access_token: this.accessToken,
      expires_in: 1800,
      token_type: 'Bearer',
      refresh_token: this.refreshToken,
      scope: 'openid profile email accounting.transactions accounting.contacts offline_access',
    })
  }

  private envelope(extra: Record<string, unknown>) {
    return { Id: uuid('resp'), Status: 'OK', ProviderName: 'Track2', DateTimeUTC: '/Date(1760400000000)/', ...extra }
  }

  private view(inv: any) {
    return { ...inv, Payments: inv.Payments.map((p: any) => ({ ...p })) }
  }

  private api(req: FakeReq): { status: number; body: unknown } {
    const [pathname, qs] = req.path.split('?')
    const q = new URLSearchParams(qs ?? '')
    if (req.method === 'GET' && pathname === '/Contacts') {
      const term = (q.get('searchTerm') ?? '').toLowerCase()
      const hits = this.contacts.filter((c) => String(c.Name).toLowerCase().includes(term) || String(c.EmailAddress ?? '').toLowerCase().includes(term))
      return { status: 200, body: this.envelope({ Contacts: hits }) }
    }
    if (req.method === 'PUT' && pathname === '/Contacts') {
      const c = req.body.Contacts[0]
      if (this.contacts.some((x) => x.Name.toLowerCase() === String(c.Name).toLowerCase())) {
        return { status: 400, body: JSON.parse(validationBody([`The contact name ${c.Name} is already assigned to another contact. The contact name must be unique across all active contacts.`])) }
      }
      const contact = { ContactID: uuid('contact'), Name: c.Name, EmailAddress: c.EmailAddress ?? '', ContactStatus: 'ACTIVE' }
      this.contacts.push(contact)
      return { status: 200, body: this.envelope({ Contacts: [contact] }) }
    }
    if (req.method === 'GET' && pathname === '/Invoices') {
      const nums = (q.get('InvoiceNumbers') ?? '').split(',').filter(Boolean)
      return { status: 200, body: this.envelope({ Invoices: this.invoices.filter((i) => nums.includes(i.InvoiceNumber)).map((i) => this.view(i)) }) }
    }
    const byId = pathname.match(/^\/Invoices\/([^/]+)$/)
    if (req.method === 'GET' && byId) {
      const inv = this.invoices.find((i) => i.InvoiceID === decodeURIComponent(byId[1]))
      if (!inv) return { status: 404, body: { Title: 'Not Found', Status: 404 } }
      return { status: 200, body: this.envelope({ Invoices: [this.view(inv)] }) }
    }
    if ((req.method === 'PUT' && pathname === '/Invoices') || (req.method === 'POST' && byId)) {
      const p = req.body.Invoices[0]
      const errors: string[] = []
      if (!this.contacts.some((c) => c.ContactID === p.Contact?.ContactID)) errors.push('The Contact must contain at least 1 of the following elements to identify the contact: Name, ContactID, ContactNumber')
      for (const li of p.LineItems) if (!this.accountCodes.has(li.AccountCode)) errors.push(`Account code '${li.AccountCode}' is not a valid code for this document.`)
      if (p.Status === 'AUTHORISED' && !p.DueDate) errors.push('Due Date is mandatory for approved documents.')
      const existing = byId ? this.invoices.find((i) => i.InvoiceID === decodeURIComponent(byId[1])) : null
      if (!existing && this.invoices.some((i) => i.InvoiceNumber === p.InvoiceNumber && i.Type === 'ACCREC' && i.Status !== 'VOIDED')) errors.push('Invoice # must be unique.')
      if (errors.length) return { status: 400, body: JSON.parse(validationBody(errors, { Type: 'ACCREC', InvoiceNumber: p.InvoiceNumber })) }
      const sub = round2(p.LineItems.reduce((s: number, li: any) => s + round2(li.Quantity * li.UnitAmount), 0))
      const total = round2(sub + this.totalSkew)
      const inv = existing ?? { InvoiceID: uuid('inv'), Payments: [], AmountPaid: 0, AmountCredited: 0 }
      Object.assign(inv, {
        Type: 'ACCREC',
        InvoiceNumber: p.InvoiceNumber,
        Reference: p.Reference ?? '',
        Contact: { ContactID: p.Contact.ContactID, Name: this.contacts.find((c) => c.ContactID === p.Contact.ContactID)?.Name },
        DateString: `${p.Date}T00:00:00`,
        Date: p.Date,
        DueDate: p.DueDate,
        Status: p.Status,
        LineAmountTypes: p.LineAmountTypes,
        LineItems: p.LineItems,
        SubTotal: sub,
        TotalTax: 0,
        Total: total,
        AmountDue: round2(total - inv.AmountPaid),
        CurrencyCode: p.CurrencyCode,
        CurrencyRate: 1,
        HasErrors: false,
      })
      if (!existing) this.invoices.push(inv)
      return { status: 200, body: this.envelope({ Invoices: [this.view(inv)] }) }
    }
    if (req.method === 'PUT' && pathname === '/Payments') {
      const p = req.body.Payments[0]
      const inv = this.invoices.find((i) => i.InvoiceID === p.Invoice?.InvoiceID)
      if (!inv) return { status: 400, body: JSON.parse(validationBody(['Invoice could not be found'])) }
      if (!this.bankAccounts.has(p.Account?.Code)) return { status: 400, body: JSON.parse(validationBody(['Account code must be specified and be a valid bank account or one with payments enabled.'])) }
      if (inv.Status !== 'AUTHORISED') return { status: 400, body: JSON.parse(validationBody(['Payment can only be made against Authorised documents'])) }
      if (round2(p.Amount) > inv.AmountDue) return { status: 400, body: JSON.parse(validationBody(['Payment amount exceeds the amount outstanding on this document'])) }
      const pay = { PaymentID: uuid('pay'), Date: p.Date, Amount: p.Amount, Reference: p.Reference ?? '', Status: 'AUTHORISED', PaymentType: 'ACCRECPAYMENT', HasAccount: true, HasValidationErrors: false }
      inv.Payments.push(pay)
      inv.AmountPaid = round2(inv.AmountPaid + p.Amount)
      inv.AmountDue = round2(inv.Total - inv.AmountPaid)
      if (inv.AmountDue === 0) inv.Status = 'PAID'
      return { status: 200, body: this.envelope({ Payments: [{ ...pay, Invoice: { InvoiceID: inv.InvoiceID, InvoiceNumber: inv.InvoiceNumber } }] }) }
    }
    return { status: 404, body: { Title: 'Not Found', Status: 404 } }
  }
}

function validationBody(messages: string[], element: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ErrorNumber: 10,
    Type: 'ValidationException',
    Message: 'A validation exception occurred',
    Elements: [{ ...element, ValidationErrors: messages.map((Message) => ({ Message })) }],
  })
}

export { validation as validationResponse }
