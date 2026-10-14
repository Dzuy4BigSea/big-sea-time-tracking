/**
 * Discovery documents for the MCP Authorization spec (specs/22 §OAuth):
 *   - Protected Resource Metadata (RFC 9728) at /.well-known/oauth-protected-resource[/api/mcp]
 *   - Authorization Server Metadata (RFC 8414) at /.well-known/oauth-authorization-server
 *   - the WWW-Authenticate challenge /api/mcp sends with a 401.
 * Track2 is both the resource server and the authorization server, so the issuer is the app origin.
 * `appUrl` is always the configured origin (lib/appUrl.ts), never a request header.
 */

export const MCP_PATH = '/api/mcp'
export const AUTHORIZE_PATH = '/oauth/authorize'
export const TOKEN_PATH = '/api/oauth/token'
export const REGISTER_PATH = '/api/oauth/register'
export const REVOKE_PATH = '/api/oauth/revoke'
export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource'

export const TOKEN_ENDPOINT_AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'] as const
export type TokenEndpointAuthMethod = (typeof TOKEN_ENDPOINT_AUTH_METHODS)[number]

/** The canonical resource identifier (RFC 8707) of the MCP server. */
export function mcpResource(appUrl: string): string {
  return `${appUrl}${MCP_PATH}`
}

/**
 * The canonical resource for a client-supplied `resource` parameter, or null when it names something
 * else. Absent → the MCP server (older clients don't send it). A trailing slash is tolerated.
 */
export function normalizeResource(raw: string | null | undefined, appUrl: string): string | null {
  const canonical = mcpResource(appUrl)
  if (raw === undefined || raw === null || raw === '') return canonical
  const trimmed = raw.endsWith('/') ? raw.slice(0, -1) : raw
  return trimmed === canonical ? canonical : null
}

export function protectedResourceMetadata(appUrl: string) {
  return {
    resource: mcpResource(appUrl),
    authorization_servers: [appUrl],
    bearer_methods_supported: ['header'],
    resource_name: 'Track2',
    resource_documentation: `${appUrl}/settings/tokens`,
  }
}

export function authorizationServerMetadata(appUrl: string) {
  return {
    issuer: appUrl,
    authorization_endpoint: `${appUrl}${AUTHORIZE_PATH}`,
    token_endpoint: `${appUrl}${TOKEN_PATH}`,
    registration_endpoint: `${appUrl}${REGISTER_PATH}`,
    revocation_endpoint: `${appUrl}${REVOKE_PATH}`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: [...TOKEN_ENDPOINT_AUTH_METHODS],
    revocation_endpoint_auth_methods_supported: [...TOKEN_ENDPOINT_AUTH_METHODS],
    service_documentation: `${appUrl}/settings/tokens`,
  }
}

/**
 * The 401 challenge for /api/mcp (MCP auth spec + RFC 9728 §5.1). ASCII only: header values are
 * ByteStrings. `error="invalid_token"` only when a token was actually presented (RFC 6750 §3.1).
 */
export function wwwAuthenticate(appUrl: string, opts: { tokenPresented?: boolean } = {}): string {
  const parts = [`Bearer realm="Track2"`, `resource_metadata="${appUrl}${PROTECTED_RESOURCE_METADATA_PATH}"`]
  if (opts.tokenPresented) {
    parts.push('error="invalid_token"', 'error_description="The access token is missing, invalid, expired or revoked"')
  }
  return parts.join(', ')
}

/** CORS for the public OAuth/discovery endpoints: any origin, never credentials (no cookies used). */
export function corsHeaders(methods: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': `${methods}, OPTIONS`,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id',
    'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
    'Access-Control-Max-Age': '86400',
  }
}
