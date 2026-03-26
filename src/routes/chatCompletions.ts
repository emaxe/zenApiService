import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Config } from '../config.js'
import { parseBody, sendJson, sendError } from '../helpers.js'
import { proxyRequest } from '../proxy.js'

interface ChatRequest {
  model?: string
  stream?: boolean
  messages: Array<{ role: string; content: string }>
  [key: string]: unknown
}

export async function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config
): Promise<void> {
  // Парсим тело запроса
  let body: ChatRequest
  try {
    body = await parseBody(req) as ChatRequest
  } catch {
    sendError(res, 400, 'Invalid JSON body', 'invalid_json')
    return
  }

  // Подставляем дефолтную модель если не указана
  const model = body.model ?? config.defaultModel

  const requestBody: ChatRequest = { ...body, model }
  const isStream = requestBody.stream === true

  try {
    const response = await proxyRequest(
      'https://opencode.ai/zen/v1/chat/completions',
      config.openCodeApiKey,
      { method: 'POST', body: requestBody }
    )

    if (!response.ok) {
      const errorText = await response.text()
      sendError(res, response.status >= 500 ? 502 : response.status, 'Upstream error: ' + errorText, 'upstream_error')
      return
    }

    if (isStream) {
      // SSE streaming mode
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Transfer-Encoding': 'chunked',
      })

      const responseBody = response.body
      if (!responseBody) {
        res.end('data: [DONE]\n\n')
        return
      }

      const reader = responseBody.getReader()
      const decoder = new TextDecoder()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          res.write(chunk)
        }
      } finally {
        reader.releaseLock()
        // Ensure [DONE] is sent if not already in stream
        res.end()
      }
    } else {
      // Regular mode
      const data = await response.json()
      sendJson(res, 200, data)
    }
  } catch (err) {
    if (!res.headersSent) {
      sendError(res, 502, 'Upstream unavailable', 'upstream_error')
    }
  }
}
