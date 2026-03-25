import { createServer as createHttpServer } from 'node:http'
import type { Config } from './config.js'
import { checkAuth } from './auth.js'
import { sendError } from './helpers.js'
import { logger } from './logger.js'
import { handleModels } from './routes/models.js'
import { handleChatCompletions } from './routes/chatCompletions.js'

export function createServer(config: Config) {
  return createHttpServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    // OPTIONS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // Auth check
    if (!checkAuth(req, config.localApiKey)) {
      sendError(res, 401, 'Unauthorized', 'unauthorized')
      return
    }

    const url = req.url ?? '/'
    const method = req.method ?? 'GET'

    try {
      if (method === 'GET' && url === '/v1/models') {
        await handleModels(req, res, config)
      } else if (method === 'POST' && url === '/v1/chat/completions') {
        await handleChatCompletions(req, res, config)
      } else {
        sendError(res, 404, 'Not found', 'not_found')
      }
    } catch (err) {
      logger.error('Unhandled error:', err)
      if (!res.headersSent) {
        sendError(res, 500, 'Internal server error', 'internal_error')
      }
    }
  })
}
