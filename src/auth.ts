import type { IncomingMessage } from 'node:http'

export function checkAuth(req: IncomingMessage, localApiKey: string): boolean {
  const authHeader = req.headers['authorization']
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false
  }
  const token = authHeader.slice(7) // "Bearer ".length === 7
  return token === localApiKey
}
