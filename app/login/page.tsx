import LoginForm from './LoginForm'
import { isGoogleConfigured, loginErrorMessage } from '@/modules/shared/googleSignIn'

// Server wrapper: reads the env at request time and passes only a boolean to the client (never the
// OAuth client id/secret), plus the friendly text for any ?error= Auth.js sent back.
export const dynamic = 'force-dynamic'

export default function LoginPage({ searchParams }: { searchParams: { error?: string | string[] } }) {
  const code = Array.isArray(searchParams.error) ? searchParams.error[0] : searchParams.error
  const googleEnabled = isGoogleConfigured({
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
  })
  return <LoginForm googleEnabled={googleEnabled} initialError={loginErrorMessage(code)} />
}
