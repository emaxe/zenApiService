import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Config } from '../config.js'
import { parseBody, sendJson, sendError } from '../helpers.js'
import { proxyRequest } from '../proxy.js'
import { logger } from '../logger.js'

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

  logger.debug(`[api] Chat request: model=${model}, stream=${isStream}, messages=${body.messages.length}`)
  if (body.messages.length > 0) {
    const last = body.messages[body.messages.length - 1]
    logger.debug(`[api] Last message: role=${last.role}, content="${last.content.slice(0, 100)}${last.content.length > 100 ? '...' : ''}"`)
  }

  try {
    const upstreamUrl = 'https://opencode.ai/zen/v1/chat/completions'
    logger.debug(`[api] → POST ${upstreamUrl}`)

    const response = await proxyRequest(
      upstreamUrl,
      config.openCodeApiKey,
      { method: 'POST', body: requestBody }
    )

    logger.debug(`[api] ← ${response.status} ${response.statusText}`)

    if (!response.ok) {
      const errorText = await response.text()
      logger.debug(`[api] Upstream error body: ${errorText.slice(0, 500)}`)
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
      let chunkCount = 0

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          chunkCount++
          res.write(chunk)
        }
      } finally {
        reader.releaseLock()
        logger.debug(`[api] Stream finished, ${chunkCount} chunks sent`)
        res.end()
      }
    } else {
      // Regular mode
      const data = await response.json()
      logger.debug(`[api] Response: ${JSON.stringify(data).slice(0, 300)}`)
      sendJson(res, 200, data)
    }
  } catch (err) {
    logger.debug(`[api] Upstream error: ${err}`)
    if (!res.headersSent) {
      sendError(res, 502, 'Upstream unavailable', 'upstream_error')
    }
  }
}
