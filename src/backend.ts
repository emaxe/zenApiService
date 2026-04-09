import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Config } from './config.js'

export interface Backend {
  /** Initialize backend (e.g. spawn child process). Called before server.listen() */
  start(): Promise<void>

  /** Cleanup resources (e.g. kill child process). Called on shutdown */
  stop(): Promise<void>

  /** Handle POST /v1/chat/completions */
  handleChatCompletions(req: IncomingMessage, res: ServerResponse, config: Config): Promise<void>

  /** Handle GET /v1/models */
  handleModels(req: IncomingMessage, res: ServerResponse, config: Config): Promise<void>
}
