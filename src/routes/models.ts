import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Config } from '../config.js'
import { proxyRequest } from '../proxy.js'
import { sendJson, sendError } from '../helpers.js'
import { logger } from '../logger.js'

export async function handleModels(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config
): Promise<void> {
  try {
    const upstreamUrl = 'https://opencode.ai/zen/v1/models'
    logger.debug(`[api] → GET ${upstreamUrl}`)

    const response = await proxyRequest(
      upstreamUrl,
      config.openCodeApiKey,
      { method: 'GET' }
    )

    logger.debug(`[api] ← ${response.status} ${response.statusText}`)

    if (!response.ok) {
      sendError(res, 502, 'Upstream unavailable', 'upstream_error')
      return
    }

    const data = await response.json() as { data?: Array<{ id: string }> }

    const allModels = data.data ?? []
    logger.debug(`[api] Models: ${allModels.length} models returned`)
    sendJson(res, 200, { object: 'list', data: allModels })
  } catch (err) {
    logger.debug(`[api] Models error: ${err}`)
    sendError(res, 502, 'Upstream unavailable', 'upstream_error')
  }
}
