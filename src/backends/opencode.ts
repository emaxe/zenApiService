import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  createOpencodeClient,
  createOpencodeServer,
  type Event,
  type OpencodeClient,
  type Provider,
} from '@opencode-ai/sdk'
import type { Backend } from '../backend.js'
import type { Config } from '../config.js'
import { parseBody, sendError, sendJson } from '../helpers.js'
import { logger } from '../logger.js'
import {
  buildChatResponse,
  buildSSEChunk,
  buildSSERoleChunk,
  buildSSEStopChunk,
  extractContentText,
  extractTextDelta,
  generateCompletionId,
  messagesToParts,
  parseModelString,
  providersToModels,
  type ContentBlock,
  type OpenAIMessage,
} from './opencode-mapper.js'
// Новые импорты для устранения выявленных проблем
import { Mutex, SessionLockManager, SafeStreamWrapper, ResponseWriter } from './concurrency-guardian.js'
import { PathSanitizer, PermissionManager, InputValidator } from './security-auditor.js'
import { EchoDetector, SessionTracker, RetryHandler, SnapshotSync } from './protocol-stabilizer.js'
import { ConfigManager, SmartCache, RateLimiter, SessionRegistry, SafeLogger } from './config-master.js'

interface ChatRequest {
  model?: string
  stream?: boolean
  opencode_directory?: string
  messages: OpenAIMessage[]
  [key: string]: unknown
}

interface ResolvedModel {
  providerID: string
  modelID: string
  responseModel: string
}

interface AssistantSnapshot {
  content: string
  finishReason: 'stop' | 'length' | 'content_filter' | 'tool_calls'
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

interface PromptState {
  model: ResolvedModel
  completionId: string
  /** Text to strip if echoed back by the model. Empty string = no stripping. */
  echoText: string
  sessionId: string
  directory?: string
}

class ClientInputError extends Error {}

const DEFAULT_EVENT_TIMEOUT_MS = 120_000
const DEFAULT_PROVIDER_CACHE_TTL_MS = 30_000
const DEFAULT_STREAM_KEEPALIVE_MS = 15_000

export class OpencodeBackend implements Backend {
  private config: Config
  private client: OpencodeClient | null = null
  private serverClose: (() => void) | null = null
  
  // Новые компоненты для устранения проблем
  private configManager: ConfigManager
  private sessionLockManager: SessionLockManager
  private pathSanitizer: typeof PathSanitizer
  private permissionManager: typeof PermissionManager
  private inputValidator: InputValidator
  private echoDetector: EchoDetector
  private retryHandler: RetryHandler
  private snapshotSync: SnapshotSync
  private providerCache: SmartCache<Provider[]>
  private rateLimiter: RateLimiter
  private sessionRegistry: SessionRegistry
  private safeLogger: SafeLogger

  constructor(config: Config) {
    this.config = config
    this.defaultDirectory = process.env.OPENCODE_DIRECTORY?.trim() || undefined
    
    // Инициализация новых компонентов
    this.configManager = new ConfigManager()
    this.sessionLockManager = new SessionLockManager()
    this.pathSanitizer = PathSanitizer
    this.permissionManager = PermissionManager
    this.inputValidator = new InputValidator()
    this.echoDetector = new EchoDetector()
    this.retryHandler = new RetryHandler({
      maxRetries: this.configManager.get('maxRetries'),
      baseDelayMs: this.configManager.get('retryBaseDelayMs'),
    })
    this.snapshotSync = new SnapshotSync()
    this.providerCache = new SmartCache<Provider[]>({ 
      defaultTtlMs: this.configManager.get('providerCacheTtlMs') 
    })
    this.rateLimiter = new RateLimiter({ maxRequests: 100, windowMs: 60_000 })
    this.sessionRegistry = new SessionRegistry({
      maxLifetimeMs: this.configManager.get('maxSessionLifetimeMs'),
      maxConcurrent: this.configManager.get('maxConcurrentSessions'),
    })
    this.safeLogger = new SafeLogger({
      maskSessionIds: this.configManager.get('maskSessionIdsInLogs'),
      enableDebug: this.configManager.get('enableDebugLogging'),
    })
  }

  private defaultDirectory: string | undefined

  async start(): Promise<void> {
    const port = this.config.opencodePort
    logger.info(`[opencode] Starting opencode serve on port ${port}...`)

    try {
      const server = await createOpencodeServer({
        port,
        hostname: '127.0.0.1',
        config: {
          permission: {
            external_directory: 'allow',
          },
        },
      })

      this.serverClose = server.close
      logger.info(`[opencode] Server started at ${server.url}`)

      this.client = createOpencodeClient({
        baseUrl: server.url,
      })

      logger.info(`[opencode] Backend ready (SDK connected to ${server.url})`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`[opencode] Failed to start: ${message}`)
      if (message.includes('ENOENT')) {
        logger.error('[opencode] "opencode" command not found. Make sure opencode CLI is installed and in PATH.')
      }
      throw err
    }
  }

  async stop(): Promise<void> {
    if (this.serverClose) {
      logger.info('[opencode] Stopping opencode serve...')
      this.serverClose()
      this.serverClose = null
      logger.info('[opencode] Server stopped')
    }
  }

  async handleChatCompletions(
    req: IncomingMessage,
    res: ServerResponse,
    config: Config,
  ): Promise<void> {
    if (!this.client) {
      sendError(res, 503, 'OpenCode backend is not ready', 'service_unavailable')
      return
    }

    const requestId = randomUUID().slice(0, 8)
    const requestStartTime = Date.now()

    // Проверка rate limiting
    const clientId = req.socket.remoteAddress ?? 'unknown'
    if (!this.rateLimiter.allowRequest(clientId)) {
      sendError(res, 429, 'Too many requests', 'rate_limit_exceeded')
      return
    }

    let parsed: unknown
    try {
      parsed = await parseBody(req)
    } catch {
      sendError(res, 400, 'Invalid JSON body', 'invalid_json')
      return
    }

    // Валидация входных данных с лимитами
    const validationResult = this.inputValidator.validateMessages((parsed as { messages?: unknown }).messages as Array<{ role?: unknown; content?: unknown }> ?? [])
    if (validationResult) {
      sendError(res, 400, validationResult, 'invalid_request_error')
      return
    }

    const bodyError = this.validateChatRequest(parsed)
    if (bodyError) {
      sendError(res, 400, bodyError, 'invalid_request_error')
      return
    }
    const body = parsed as ChatRequest

    const requestedModel = body.model ?? config.defaultModel
    const isStream = body.stream === true
    const completionId = generateCompletionId()
    const directory = await this.resolveRequestDirectory(req, body)

    if (body.messages.length > 0) {
      const last = body.messages[body.messages.length - 1]
      const lastContentPreview = extractContentText(last.content).slice(0, 80)
      this.safeLogger.debug(
        `[opencode][${requestId}] Chat request: model=${requestedModel}, stream=${isStream}, messages=${body.messages.length}, directory=${directory ?? '(default)'}, last=${last.role}:${lastContentPreview}`,
      )
    }

    let state: PromptState | null = null
    let sessionTracker: SessionTracker | null = null

    try {
      const model = await this.retryHandler.executeWithRetry(
        () => this.resolveModel(requestedModel),
        'resolveModel',
      )

      const { data: session, error: sessionError } = await this.client.session.create({
        ...(directory ? { query: { directory } } : {}),
      })
      if (sessionError || !session) {
        const message = this.extractSdkErrorMessage(sessionError) ?? 'Failed to create opencode session'
        sendError(res, 502, message, 'opencode_error')
        return
      }

      const sessionId = session.id
      
      // Регистрируем сессию в реестре
      if (!this.sessionRegistry.register(sessionId, requestId)) {
        await this.client.session.delete({
          path: { id: sessionId },
          ...(directory ? { query: { directory } } : {}),
        })
        sendError(res, 503, 'Too many concurrent sessions', 'service_unavailable')
        return
      }

      // Создаем трекер состояния сессии
      sessionTracker = new SessionTracker(
        sessionId,
        this.configManager.get('idleTimeoutMs'),
        5000,
        6,
      )

      this.safeLogger.debug(`[opencode][${requestId}] Created session ${this.safeLogger.maskSessionId(sessionId)}`)

      // Используем улучшенный детектор эха
      const echoText = this.echoDetector.detectEchoText(body.messages)
      const { parts, system } = messagesToParts(body.messages, echoText)

      const { stream: eventStream } = await this.client.event.subscribe({
        ...(directory ? { query: { directory } } : {}),
      })

      // Оборачиваем итератор для безопасного управления ресурсами
      const safeStream = new SafeStreamWrapper(eventStream)

      const promptResult = await this.client.session.promptAsync({
        body: {
          parts,
          model: { providerID: model.providerID, modelID: model.modelID },
          ...(system ? { system } : {}),
        },
        path: { id: sessionId },
        ...(directory ? { query: { directory } } : {}),
      })

      if (promptResult.error) {
        const status = promptResult.response.status
        const message = this.extractSdkErrorMessage(promptResult.error) ?? 'OpenCode prompt failed'
        sessionTracker.markError(message)
        sendError(res, status >= 500 ? 502 : status, message, 'opencode_error')
        return
      }

      state = {
        model,
        completionId,
        echoText,
        sessionId,
        directory,
      }

      if (isStream) {
        await this.handleStreaming(res, safeStream, state, requestId)
      } else {
        await this.handleNonStreaming(res, safeStream, state, requestId)
      }

      this.safeLogger.debug(`[opencode][${requestId}] Request completed in ${Date.now() - requestStartTime}ms`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      this.safeLogger.error(`[opencode][${requestId}] Chat error: ${message}`)
      if (!res.headersSent) {
        if (err instanceof ClientInputError) {
          sendError(res, 400, message, 'invalid_request_error')
        } else {
          sendError(res, 502, `OpenCode error: ${message}`, 'opencode_error')
        }
      }
    } finally {
      if (state?.sessionId) {
        this.sessionRegistry.unregister(state.sessionId)
        try {
          await this.client.session.delete({
            path: { id: state.sessionId },
            ...(state.directory ? { query: { directory: state.directory } } : {}),
          })
          this.safeLogger.debug(`[opencode][${requestId}] Deleted session ${this.safeLogger.maskSessionId(state.sessionId)}`)
        } catch {
        }
      }
    }
  }

  async handleModels(
    _req: IncomingMessage,
    res: ServerResponse,
    _config: Config,
  ): Promise<void> {
    if (!this.client) {
      sendError(res, 503, 'OpenCode backend is not ready', 'service_unavailable')
      return
    }

    try {
      const providers = await this.getProviders(true)
      const models = providersToModels(providers)
      sendJson(res, 200, { object: 'list', data: models })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`[opencode] Models error: ${message}`)
      sendError(res, 502, `OpenCode error: ${message}`, 'opencode_error')
    }
  }

  private async handleStreaming(
    res: ServerResponse,
    eventStream: AsyncGenerator<Event>,
    state: PromptState,
    requestId: string,
  ): Promise<void> {
    const { sessionId, model, completionId, echoText, directory } = state

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Transfer-Encoding': 'chunked',
    })

    const iterator = eventStream[Symbol.asyncIterator]()
    const partTextMap = new Map<string, string>()
    let emittedContent = ''
    let chunkCount = 0
    let timedOut = false
    let errored = false
    let finishedReason: 'stop' | 'length' | 'content_filter' | 'tool_calls' = 'stop'
    let echoStripped = false
    let sessionLastActivityAt = Date.now()
    let keepaliveTimer: ReturnType<typeof setInterval> | null = null

    res.write(buildSSERoleChunk(model.responseModel, completionId))
    keepaliveTimer = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': keep-alive\n\n')
      }
    }, STREAM_KEEPALIVE_MS)

    try {
      while (true) {
        const remainingMs = EVENT_TIMEOUT_MS - (Date.now() - sessionLastActivityAt)
        if (remainingMs <= 0) {
          timedOut = true
          finishedReason = 'length'
          logger.warn(`[opencode][${requestId}] Stream timed out after ${EVENT_TIMEOUT_MS / 1000}s`) 
          break
        }

        const next = await this.nextWithTimeout(iterator.next(), remainingMs)
        if (next.timedOut) {
          timedOut = true
          finishedReason = 'length'
          logger.warn(`[opencode][${requestId}] Stream timed out after ${EVENT_TIMEOUT_MS / 1000}s`)
          break
        }

        if (!next.result || next.result.done) {
          break
        }

        const event = next.result.value
        if (event.type === 'message.part.updated') {
          const { part, delta } = event.properties
          if (part.type !== 'text' || part.sessionID !== sessionId) {
            continue
          }

          sessionLastActivityAt = Date.now()

          const textDelta = extractTextDelta(part, delta, partTextMap)
          if (!textDelta) {
            continue
          }

          let cleanDelta = textDelta
          if (!echoStripped && echoText) {
            const accumulated = partTextMap.get(part.id) ?? ''
            if (accumulated.length <= echoText.length) {
              continue
            }
            if (accumulated.length - textDelta.length < echoText.length) {
              const overlapLen = echoText.length - (accumulated.length - textDelta.length)
              cleanDelta = textDelta.slice(overlapLen).replace(/^\n*/, '')
              echoStripped = true
              if (!cleanDelta) {
                continue
              }
            } else {
              echoStripped = true
            }
          }

          chunkCount++
          emittedContent += cleanDelta
          res.write(buildSSEChunk(cleanDelta, model.responseModel, completionId))
          continue
        }

        if (event.type === 'session.error' && event.properties.sessionID === sessionId) {
          sessionLastActivityAt = Date.now()
          errored = true
          const errMsg = event.properties.error
            ? JSON.stringify(event.properties.error)
            : 'Unknown error'
          logger.error(`[opencode][${requestId}] Session error: ${errMsg}`)
          res.write(`data: ${JSON.stringify({ error: { message: errMsg } })}\n\n`)
          break
        }

        if (event.type === 'permission.updated' && event.properties.sessionID === sessionId) {
          sessionLastActivityAt = Date.now()
          await this.respondToPermissionRequest(sessionId, event.properties.id, requestId, directory)
          continue
        }

        if (event.type === 'session.idle' && event.properties.sessionID === sessionId) {
          sessionLastActivityAt = Date.now()
          const snapshot = await this.getAssistantSnapshot(sessionId, echoText, requestId, directory)
          if (snapshot) {
            finishedReason = snapshot.finishReason
            if (snapshot.content.startsWith(emittedContent)) {
              const tail = snapshot.content.slice(emittedContent.length)
              if (tail) {
                res.write(buildSSEChunk(tail, model.responseModel, completionId))
                emittedContent += tail
                chunkCount++
              }
            }
          }
          break
        }

        if (event.type === 'session.status' && event.properties.sessionID === sessionId) {
          sessionLastActivityAt = Date.now()
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`[opencode][${requestId}] Event stream error: ${message}`)
      errored = true
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: { message } })}\n\n`)
      }
    } finally {
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer)
      }
      try {
        void iterator.return?.(undefined)
      } catch {
      }

      if (!res.writableEnded) {
        if (!errored) {
          res.write(buildSSEStopChunk(model.responseModel, completionId, timedOut ? 'length' : finishedReason))
        }
        res.write('data: [DONE]\n\n')
        res.end()
      }
      logger.debug(`[opencode][${requestId}] Stream finished, chunks=${chunkCount}, emitted=${emittedContent.length}`)
    }
  }

  private async handleNonStreaming(
    res: ServerResponse,
    eventStream: AsyncGenerator<Event>,
    state: PromptState,
    requestId: string,
  ): Promise<void> {
    const { sessionId, model, completionId, echoText, directory } = state

    const iterator = eventStream[Symbol.asyncIterator]()
    const partTextMap = new Map<string, string>()
    let timedOut = false
    let sessionErrored: string | null = null
    let sessionLastActivityAt = Date.now()

    try {
      while (true) {
        const remainingMs = EVENT_TIMEOUT_MS - (Date.now() - sessionLastActivityAt)
        if (remainingMs <= 0) {
          timedOut = true
          break
        }

        const next = await this.nextWithTimeout(iterator.next(), remainingMs)
        if (next.timedOut) {
          timedOut = true
          break
        }

        if (!next.result || next.result.done) {
          break
        }

        const event = next.result.value
        if (event.type === 'message.part.updated') {
          const { part } = event.properties
          if (part.type === 'text' && part.sessionID === sessionId) {
            sessionLastActivityAt = Date.now()
            partTextMap.set(part.id, part.text)
          }
          continue
        }

        if (event.type === 'session.error' && event.properties.sessionID === sessionId) {
          sessionLastActivityAt = Date.now()
          sessionErrored = event.properties.error
            ? JSON.stringify(event.properties.error)
            : 'Unknown error'
          break
        }

        if (event.type === 'permission.updated' && event.properties.sessionID === sessionId) {
          sessionLastActivityAt = Date.now()
          await this.respondToPermissionRequest(sessionId, event.properties.id, requestId, directory)
          continue
        }

        if (event.type === 'session.idle' && event.properties.sessionID === sessionId) {
          sessionLastActivityAt = Date.now()
          break
        }

        if (event.type === 'session.status' && event.properties.sessionID === sessionId) {
          sessionLastActivityAt = Date.now()
          continue
        }
      }
    } finally {
      try {
        void iterator.return?.(undefined)
      } catch {
      }
    }

    if (timedOut) {
      logger.warn(`[opencode][${requestId}] Non-stream request timed out after ${EVENT_TIMEOUT_MS / 1000}s`)
      sendError(res, 504, 'OpenCode request timed out', 'timeout')
      return
    }

    if (sessionErrored) {
      sendError(res, 502, `OpenCode error: ${sessionErrored}`, 'opencode_error')
      return
    }

    const snapshot = await this.getAssistantSnapshot(sessionId, echoText, requestId, directory)
    if (snapshot) {
      sendJson(
        res,
        200,
        buildChatResponse(
          snapshot.content,
          model.responseModel,
          completionId,
          snapshot.usage,
          snapshot.finishReason,
        ),
      )
      return
    }

    let fallbackContent = Array.from(partTextMap.values()).join('')
    fallbackContent = this.stripEchoText(fallbackContent, echoText)
    sendJson(res, 200, buildChatResponse(fallbackContent, model.responseModel, completionId))
  }

  private validateChatRequest(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return 'Request body must be a JSON object'
    }

    const body = payload as { model?: unknown; messages?: unknown }
    if (body.model !== undefined && (typeof body.model !== 'string' || body.model.trim() === '')) {
      return '`model` must be a non-empty string'
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return '`messages` must be a non-empty array'
    }

    for (const [idx, message] of body.messages.entries()) {
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        return `messages[${idx}] must be an object`
      }
      const role = (message as { role?: unknown }).role
      const content = (message as { content?: unknown }).content
      if (role !== 'system' && role !== 'user' && role !== 'assistant') {
        return `messages[${idx}].role must be one of: system, user, assistant`
      }
      // content may be a plain string OR an array of content blocks
      // (agents using the OpenAI multi-part / vision format send arrays)
      if (typeof content === 'string') {
        // valid — nothing to do
      } else if (Array.isArray(content)) {
        // Each element must be an object with at least a `type` field
        for (const [blockIdx, block] of (content as unknown[]).entries()) {
          if (!block || typeof block !== 'object' || Array.isArray(block)) {
            return `messages[${idx}].content[${blockIdx}] must be an object`
          }
          if (typeof (block as ContentBlock).type !== 'string') {
            return `messages[${idx}].content[${blockIdx}].type must be a string`
          }
        }
      } else {
        return `messages[${idx}].content must be a string or array of content blocks`
      }
    }

    return null
  }

  private async resolveModel(requestedModel: string): Promise<ResolvedModel> {
    const modelStr = requestedModel.trim()
    const { providerID, modelID } = parseModelString(modelStr)

    if (providerID && modelID) {
      return { providerID, modelID, responseModel: modelStr }
    }

    if (!modelID) {
      throw new ClientInputError('Invalid model value')
    }

    const providers = await this.getProviders()
    const matches = providers
      .filter(provider => Object.prototype.hasOwnProperty.call(provider.models, modelID))
      .map(provider => provider.id)

    if (matches.length === 0) {
      const knownModels = new Set<string>()
      for (const provider of providers) {
        for (const knownModel of Object.keys(provider.models)) {
          knownModels.add(knownModel)
        }
      }
      const sample = Array.from(knownModels).slice(0, 10)
      throw new ClientInputError(
        `Model \`${modelID}\` is not available. Use provider/model format or one of: ${sample.join(', ')}`,
      )
    }

    if (matches.length > 1) {
      const variants = matches.map(provider => `${provider}/${modelID}`)
      throw new ClientInputError(
        `Model \`${modelID}\` is ambiguous. Use an explicit provider/model: ${variants.join(', ')}`,
      )
    }

    return { providerID: matches[0], modelID, responseModel: modelStr }
  }

  private async getProviders(forceRefresh: boolean = false): Promise<Provider[]> {
    if (!this.client) {
      throw new Error('OpenCode client is not ready')
    }

    const now = Date.now()
    if (!forceRefresh && this.providerCache && this.providerCache.expiresAt > now) {
      return this.providerCache.providers
    }

    const { data, error } = await this.client.config.providers()
    if (error) {
      const message = this.extractSdkErrorMessage(error) ?? 'Failed to load providers'
      throw new Error(message)
    }

    const providers = (data?.providers ?? []) as Provider[]
    this.providerCache = {
      providers,
      expiresAt: now + PROVIDER_CACHE_TTL_MS,
    }
    return providers
  }

  private async getAssistantSnapshot(
    sessionId: string,
    echoText: string,
    requestId: string,
    directory?: string,
  ): Promise<AssistantSnapshot | null> {
    if (!this.client) {
      return null
    }

    const { data, error } = await this.client.session.messages({
      path: { id: sessionId },
      ...(directory ? { query: { directory } } : {}),
    })
    if (error || !data || data.length === 0) {
      if (error) {
        logger.warn(`[opencode][${requestId}] Failed to fetch session messages: ${this.extractSdkErrorMessage(error)}`)
      }
      return null
    }

    for (let i = data.length - 1; i >= 0; i--) {
      const candidate = data[i]
      if (candidate.info.role !== 'assistant') {
        continue
      }

      const text = candidate.parts
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('')

      const content = this.stripEchoText(text, echoText)
      const promptTokens = candidate.info.tokens?.input ?? 0
      const completionTokens = candidate.info.tokens?.output ?? 0
      return {
        content,
        finishReason: this.mapFinishReason(candidate.info.finish),
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      }
    }

    return null
  }

  private stripEchoText(content: string, echoText: string): string {
    if (!echoText) {
      return content
    }
    
    // Используем умный детектор эха вместо простой проверки startsWith
    const echoResult = EchoDetector.detectAndStrip(content, echoText)
    return echoResult.strippedContent
  }

  private mapFinishReason(rawFinish: string | undefined): 'stop' | 'length' | 'content_filter' | 'tool_calls' {
    if (rawFinish === 'length' || rawFinish === 'content_filter' || rawFinish === 'tool_calls') {
      return rawFinish
    }
    if (rawFinish === 'max_tokens' || rawFinish === 'output_length') {
      return 'length'
    }
    return 'stop'
  }

  private extractSdkErrorMessage(error: unknown): string | null {
    if (!error || typeof error !== 'object') {
      return null
    }
    const maybeMessage = (error as { message?: unknown }).message
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage
    }
    return JSON.stringify(error)
  }

  private async nextWithTimeout<T>(
    promise: Promise<IteratorResult<T>>,
    timeoutMs: number,
  ): Promise<{ timedOut: true; result?: undefined } | { timedOut: false; result: IteratorResult<T> }> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const timeoutPromise = new Promise<{ timedOut: true }>(resolve => {
      timeoutId = setTimeout(() => {
        resolve({ timedOut: true })
      }, timeoutMs)
    })

    const resultPromise = promise.then(result => ({ timedOut: false as const, result }))
    const raceResult = await Promise.race([timeoutPromise, resultPromise])

    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    if (raceResult.timedOut) {
      return { timedOut: true }
    }

    return raceResult
  }

  private async respondToPermissionRequest(
    sessionId: string,
    permissionID: string,
    requestId: string,
    directory?: string,
  ): Promise<void> {
    if (!this.client) {
      return
    }

    // Используем PermissionManager для принятия решения об одобрении
    const permissionDecision = PermissionManager.evaluatePermissionRequest({
      sessionId,
      permissionID,
      directory,
      requestId,
    })

    if (!permissionDecision.approved) {
      logger.warn(
        `[opencode][${requestId}] Permission ${permissionID} denied by security policy: ${permissionDecision.reason}`,
      )
      
      // Отправляем отказ вместо одобрения
      const { error } = await this.client.postSessionIdPermissionsPermissionId({
        path: {
          id: sessionId,
          permissionID,
        },
        body: {
          response: 'deny',
          reason: permissionDecision.reason,
        },
        ...(directory ? { query: { directory } } : {}),
      })

      if (error) {
        logger.warn(
          `[opencode][${requestId}] Failed to deny permission ${permissionID}: ${this.extractSdkErrorMessage(error)}`,
        )
      }
      return
    }

    // Одобржаем только безопасные запросы
    const { error } = await this.client.postSessionIdPermissionsPermissionId({
      path: {
        id: sessionId,
        permissionID,
      },
      body: {
        response: permissionDecision.scope === 'session' ? 'always' : 'once',
      },
      ...(directory ? { query: { directory } } : {}),
    })

    if (error) {
      logger.warn(
        `[opencode][${requestId}] Failed to auto-approve permission ${permissionID}: ${this.extractSdkErrorMessage(error)}`,
      )
      return
    }

    const logLevel = permissionDecision.riskLevel === RiskLevel.HIGH ? 'warn' : 'debug'
    logger[logLevel](
      `[opencode][${SafeLogger.mask(sessionId)}] Auto-approved permission ${permissionID} (risk: ${permissionDecision.riskLevel})`,
    )
  }

  private async resolveRequestDirectory(req: IncomingMessage, body: ChatRequest): Promise<string | undefined> {
    const fromBody = typeof body.opencode_directory === 'string' ? body.opencode_directory.trim() : ''
    const fromHeader = this.readHeaderValue(req, 'x-opencode-directory')
      ?? this.readHeaderValue(req, 'x-working-directory')
      ?? this.readHeaderValue(req, 'x-cwd')

    // Игнорируем извлечение директории из сообщений для безопасности
    // Это предотвращает инъекции путей через системные промпты
    const fromMessages = ''

    const raw = fromBody || fromHeader || this.defaultDirectory || fromMessages || ''
    if (!raw) {
      return undefined
    }

    const candidate = this.tryDecodeURIComponent(raw)
    if (!candidate || !candidate.startsWith('/')) {
      throw new ClientInputError('`opencode_directory` must be an absolute path')
    }

    // Используем PathSanitizer для безопасной валидации пути
    const sanitizedPath = PathSanitizer.sanitizePath(candidate, this.defaultDirectory)
    
    if (!sanitizedPath.isValid) {
      throw new ClientInputError(`Invalid directory path: ${sanitizedPath.error}`)
    }

    try {
      await access(sanitizedPath.path)
      return sanitizedPath.path
    } catch {
      throw new ClientInputError(`Directory does not exist or is not accessible: ${sanitizedPath.path}`)
    }
  }

  /**
   * Устаревший метод - больше не используется для безопасности.
   * Извлечение директории из сообщений отключено для предотвращения инъекций.
   * @deprecated Security risk: directory injection via prompts
   */
  private extractDirectoryFromMessages(_messages: OpenAIMessage[]): string {
    return ''
  }

  private readHeaderValue(req: IncomingMessage, name: string): string | undefined {
    const value = req.headers[name]
    if (!value) {
      return undefined
    }
    if (Array.isArray(value)) {
      return value[0]
    }
    return value
  }

  private tryDecodeURIComponent(value: string): string {
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
}
