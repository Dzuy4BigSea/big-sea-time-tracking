/**
 * Client-safe parts of the Google Drive export (no node:crypto), shared by the menu, the result banner
 * and the server code in ./googleDrive.ts.
 */

/** Query params the app adds after a Drive action (stripped from returnTo so banners don't stack). */
export const DRIVE_RESULT_PARAMS = ['driveFile', 'driveError', 'drive'] as const

export function isDriveFileId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(id)
}

/** The Sheet's URL, built from a validated id (never from a URL passed in the query string). */
export function sheetUrl(fileId: string): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(fileId)}/edit`
}

export type DriveErrorCode =
  | 'auth'
  | 'forbidden'
  | 'too_large'
  | 'rate_limited'
  | 'server'
  | 'network'
  | 'denied'
  | 'state'
  | 'account_mismatch'
  | 'scope'
  | 'no_refresh_token'
  | 'not_configured'
  | 'export_too_large'
  | 'export_forbidden'
  | 'export_not_found'
  | 'token'
  | 'unknown'

export function driveErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null
  switch (code as DriveErrorCode) {
    case 'denied':
      return 'Google Drive access wasn’t granted, so nothing was exported.'
    case 'state':
      return 'That Google Drive connection link expired or didn’t match this session. Please try the export again.'
    case 'account_mismatch':
      return 'Connect the Google account that matches your Track2 email to export to Google Drive.'
    case 'scope':
      return 'Track2 needs permission to create files in your Google Drive. Please try again and allow it.'
    case 'no_refresh_token':
    case 'token':
    case 'auth':
      return 'Track2 couldn’t get access to your Google Drive. Please try the export again.'
    case 'not_configured':
      return 'Google Drive export isn’t set up for this site.'
    case 'export_too_large':
    case 'too_large':
      return 'This report is too large for a Google Sheet. Narrow the timeframe or filters, or export CSV instead.'
    case 'export_forbidden':
      return 'You don’t have permission to export this report.'
    case 'export_not_found':
      return 'That report couldn’t be found.'
    case 'forbidden':
      return 'Google Drive refused the upload (the Drive API may be off, or your Drive is full). Try again later or export CSV.'
    case 'rate_limited':
      return 'Google Drive is busy right now. Please try again in a minute.'
    case 'network':
    case 'server':
    default:
      return 'Google Drive didn’t respond as expected. Please try again, or export CSV instead.'
  }
}
