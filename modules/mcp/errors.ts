/**
 * Structured tool errors (specs/22 §Non-functional). Mirrors the Harvest MCP's error codes so Claude
 * can act on them: `not_found` (also used for rows the caller may not see — never reveal existence),
 * `forbidden` (the caller's role can't do this at all), `validation_failed` (bad input or a business
 * rule refused it, e.g. a locked entry), `conflict` (lost a race / state changed), `rate_limited`.
 */
export type ToolErrorCode = 'not_found' | 'forbidden' | 'validation_failed' | 'conflict' | 'rate_limited' | 'internal_error'

export class ToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ToolError'
  }
}

export const notFound = (what: string) => new ToolError('not_found', `${what} not found.`)
export const forbidden = (message: string) => new ToolError('forbidden', message)
export const invalid = (message: string, details?: Record<string, unknown>) => new ToolError('validation_failed', message, details)

export function toolErrorBody(e: ToolError): { error: { code: ToolErrorCode; message: string; details?: Record<string, unknown> } } {
  return { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } }
}
