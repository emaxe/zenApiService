import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Config } from '../config.js'
import type { Backend } from '../backend.js'
import { handleModels } from '../routes/models.js'
import { handleChatCompletions } from '../routes/chatCompletions.js'

/**
 * API backend — delegates to existing route handlers (fetch proxy to upstream).
 * This is the default mode (MODE=api).
 */
export class ApiBackend implements Backend {
  async start(): Promise<void> {
    // noop — no initialization needed for HTTP proxy mode
  }

  async stop(): Promise<void> {
    // noop — no cleanup needed
  }

  async handleChatCompletions(
    req: IncomingMessage,
    res: ServerResponse,
    config: Config,
  ): Promise<void> {
    return handleChatCompletions(req, res, config)
  }

  async handleModels(
    req: IncomingMessage,
    res: ServerResponse,
    config: Config,
  ): Promise<void> {
    return handleModels(req, res, config)
  }
}
