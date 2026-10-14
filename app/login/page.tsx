import LoginForm from './LoginForm'
import { isGoogleConfigured, loginErrorMessage } from '@/modules/shared/googleSignIn'
import { safeCallbackPath } from '@/modules/shared/safeRedirect'

// Server wrapper: reads the env at request time and passes only a boolean to the client (never the
// OAuth client id/secret), plus the friendly text for any ?error= Auth.js sent back.
export const dynamic = 'force-dynamic'

export default function LoginPage({ searchParams }: { searchParams: { error?: string | string[]; callbackUrl?: string | string[] } }) {
  const code = Array.isArray(searchParams.error) ? searchParams.error[0] : searchParams.error
  const googleEnabled = isGoogleConfigured({
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
  })
  // Where to land after signing in (e.g. back to /oauth/authorize for a claude.ai connector).
  // Same-origin paths only — anything else falls back to "/" (no open redirect).
  const callbackUrl = safeCallbackPath(Array.isArray(searchParams.callbackUrl) ? undefined : searchParams.callbackUrl)
  return <LoginForm googleEnabled={googleEnabled} initialError={loginErrorMessage(code)} callbackUrl={callbackUrl} />
}
