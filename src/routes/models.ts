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
      // Upstream вернул ошибку — вернём свой список из allowedModels
      const models = config.allowedModels.map(id => ({
        id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'opencode',
      }))
      sendJson(res, 200, { object: 'list', data: models })
      return
    }

    const data = await response.json() as { data?: Array<{ id: string }> }

    // Фильтруем только разрешённые модели
    const allModels = data.data ?? []
    const filtered = allModels.filter(m => config.allowedModels.includes(m.id))

    // Если upstream не вернул нужные модели, строим список вручную
    const resultModels = config.allowedModels.map(id => {
      const found = filtered.find(m => m.id === id)
      return found ?? {
        id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'opencode',
      }
    })

    sendJson(res, 200, { object: 'list', data: resultModels })
  } catch (err) {
    sendError(res, 502, 'Upstream unavailable', 'upstream_error')
  }
}
