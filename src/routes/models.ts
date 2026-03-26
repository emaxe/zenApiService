import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Config } from '../config.js'
import { proxyRequest } from '../proxy.js'
import { sendJson, sendError } from '../helpers.js'

export async function handleModels(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config
): Promise<void> {
  try {
    const response = await proxyRequest(
      'https://opencode.ai/zen/v1/models',
      config.openCodeApiKey,
      { method: 'GET' }
    )

    if (!response.ok) {
      sendError(res, 502, 'Upstream unavailable', 'upstream_error')
      return
    }

    const data = await response.json() as { data?: Array<{ id: string }> }

    const allModels = data.data ?? []
    sendJson(res, 200, { object: 'list', data: allModels })
  } catch (err) {
    sendError(res, 502, 'Upstream unavailable', 'upstream_error')
  }
}
