import { handlers } from '@/auth'

// Node runtime — the Credentials authorize uses Prisma.
export const runtime = 'nodejs'
export const { GET, POST } = handlers
