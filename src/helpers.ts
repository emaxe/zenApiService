import type { IncomingMessage, ServerResponse } from 'node:http'

export async function parseBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []

  for await (const chunk of req) {
    chunks.push(chunk)
  }

  const body = Buffer.concat(chunks).toString('utf-8')

  if (!body) {
    throw new Error('Request body is empty')
  }

  try {
    return JSON.parse(body)
  } catch {
    throw new Error('Invalid JSON in request body')
  }
}

export function sendJson(
  res: ServerResponse,
  statusCode: number,
  data: unknown
): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

export function sendError(
  res: ServerResponse,
  statusCode: number,
  message: string,
  code?: string
): void {
  sendJson(res, statusCode, {
    error: {
      message,
      type: 'invalid_request_error',
      param: null,
      code: code ?? null,
    },
  })
}
