import { createServer as createHttpServer } from 'node:http'
import type { Config } from './config.js'
import type { Backend } from './backend.js'
import { checkAuth } from './auth.js'
import { sendError } from './helpers.js'
import { logger } from './logger.js'

export function createServer(config: Config, backend: Backend) {
  return createHttpServer(async (req, res) => {
    const url = req.url ?? '/'
    const method = req.method ?? 'GET'
    const startTime = Date.now()

    logger.debug(`→ ${method} ${url}`)

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    // OPTIONS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      logger.debug(`← 204 OPTIONS (${Date.now() - startTime}ms)`)
      return
    }

    // Auth check
    if (!checkAuth(req, config.localApiKey)) {
      sendError(res, 401, 'Unauthorized', 'unauthorized')
      logger.debug(`← 401 Unauthorized (${Date.now() - startTime}ms)`)
      return
    }

    try {
      if (method === 'GET' && url === '/v1/models') {
        await backend.handleModels(req, res, config)
      } else if (method === 'POST' && url === '/v1/chat/completions') {
        await backend.handleChatCompletions(req, res, config)
      } else {
        sendError(res, 404, 'Not found', 'not_found')
      }
    } catch (err) {
      logger.error('Unhandled error:', err)
      if (!res.headersSent) {
        sendError(res, 500, 'Internal server error', 'internal_error')
      }
    }

    logger.debug(`← ${res.statusCode} ${method} ${url} (${Date.now() - startTime}ms)`)
  })
}
