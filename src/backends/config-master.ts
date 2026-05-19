/**
 * ConfigMaster - Конфигурируемость и наблюдаемость
 * 
 * Предоставляет настраиваемые параметры, улучшенное кэширование,
 * защиту от DoS и безопасное логирование.
 */

import { logger } from '../logger.js'

/**
 * Настраиваемые параметры для режима opencode
 */
export interface OpencodeConfig {
  // Таймауты
  eventTimeoutMs: number
  streamKeepaliveMs: number
  idleTimeoutMs: number
  
  // Кэширование
  providerCacheTtlMs: number
  
  // Лимиты
  maxConcurrentSessions: number
  maxSessionLifetimeMs: number
  
  // Безопасность
  strictPermissionMode: boolean
  allowedDirectories: string[]
  
  // Повторные попытки
  maxRetries: number
  retryBaseDelayMs: number
  
  // Наблюдаемость
  enableDebugLogging: boolean
  maskSessionIdsInLogs: boolean
}

/**
 * Значения по умолчанию
 */
export const DEFAULT_OPENDODE_CONFIG: OpencodeConfig = {
  eventTimeoutMs: 120_000,
  streamKeepaliveMs: 15_000,
  idleTimeoutMs: 30_000,
  providerCacheTtlMs: 30_000,
  maxConcurrentSessions: 10,
  maxSessionLifetimeMs: 300_000, // 5 минут
  strictPermissionMode: false,
  allowedDirectories: [],
  maxRetries: 3,
  retryBaseDelayMs: 1000,
  enableDebugLogging: process.env.DEBUG?.includes('opencode') ?? false,
  maskSessionIdsInLogs: true,
}

/**
 * Менеджер конфигурации с поддержкой переменных окружения
 */
export class ConfigManager {
  private config: OpencodeConfig

  constructor(overrides?: Partial<OpencodeConfig>) {
    this.config = { ...DEFAULT_OPENDODE_CONFIG, ...overrides }
    this.loadFromEnv()
  }

  private loadFromEnv(): void {
    // Таймауты
    if (process.env.OPENCODE_EVENT_TIMEOUT_MS) {
      this.config.eventTimeoutMs = parseInt(process.env.OPENCODE_EVENT_TIMEOUT_MS, 10) || DEFAULT_OPENDODE_CONFIG.eventTimeoutMs
    }
    if (process.env.OPENCODE_STREAM_KEEPALIVE_MS) {
      this.config.streamKeepaliveMs = parseInt(process.env.OPENCODE_STREAM_KEEPALIVE_MS, 10) || DEFAULT_OPENDODE_CONFIG.streamKeepaliveMs
    }
    if (process.env.OPENCODE_IDLE_TIMEOUT_MS) {
      this.config.idleTimeoutMs = parseInt(process.env.OPENCODE_IDLE_TIMEOUT_MS, 10) || DEFAULT_OPENDODE_CONFIG.idleTimeoutMs
    }

    // Кэширование
    if (process.env.OPENCODE_PROVIDER_CACHE_TTL_MS) {
      this.config.providerCacheTtlMs = parseInt(process.env.OPENCODE_PROVIDER_CACHE_TTL_MS, 10) || DEFAULT_OPENDODE_CONFIG.providerCacheTtlMs
    }

    // Лимиты
    if (process.env.OPENCODE_MAX_CONCURRENT_SESSIONS) {
      this.config.maxConcurrentSessions = parseInt(process.env.OPENCODE_MAX_CONCURRENT_SESSIONS, 10) || DEFAULT_OPENDODE_CONFIG.maxConcurrentSessions
    }
    if (process.env.OPENCODE_MAX_SESSION_LIFETIME_MS) {
      this.config.maxSessionLifetimeMs = parseInt(process.env.OPENCODE_MAX_SESSION_LIFETIME_MS, 10) || DEFAULT_OPENDODE_CONFIG.maxSessionLifetimeMs
    }

    // Безопасность
    if (process.env.OPENCODE_STRICT_PERMISSION_MODE) {
      this.config.strictPermissionMode = process.env.OPENCODE_STRICT_PERMISSION_MODE.toLowerCase() === 'true'
    }
    if (process.env.OPENCODE_ALLOWED_DIRECTORIES) {
      this.config.allowedDirectories = process.env.OPENCODE_ALLOWED_DIRECTORIES.split(',').map(d => d.trim()).filter(d => d.length > 0)
    }

    // Повторные попытки
    if (process.env.OPENCODE_MAX_RETRIES) {
      this.config.maxRetries = parseInt(process.env.OPENCODE_MAX_RETRIES, 10) || DEFAULT_OPENDODE_CONFIG.maxRetries
    }
    if (process.env.OPENCODE_RETRY_BASE_DELAY_MS) {
      this.config.retryBaseDelayMs = parseInt(process.env.OPENCODE_RETRY_BASE_DELAY_MS, 10) || DEFAULT_OPENDODE_CONFIG.retryBaseDelayMs
    }

    // Наблюдаемость
    if (process.env.OPENCODE_DEBUG_LOGGING) {
      this.config.enableDebugLogging = process.env.OPENCODE_DEBUG_LOGGING.toLowerCase() === 'true'
    }
    if (process.env.OPENCODE_MASK_SESSION_IDS) {
      this.config.maskSessionIdsInLogs = process.env.OPENCODE_MASK_SESSION_IDS.toLowerCase() === 'true'
    }
  }

  get<K extends keyof OpencodeConfig>(key: K): OpencodeConfig[K] {
    return this.config[key]
  }

  getAll(): OpencodeConfig {
    return { ...this.config }
  }

  update(overrides: Partial<OpencodeConfig>): void {
    this.config = { ...this.config, ...overrides }
    logger.info('[ConfigManager] Configuration updated')
  }
}

/**
 * Умный кэш с механизмом инвалидации
 */
export class SmartCache<T> {
  private cache: Map<string, { value: T; expiresAt: number; createdAt: number }>
  private readonly defaultTtlMs: number
  private readonly maxSize: number

  constructor(options?: { defaultTtlMs?: number; maxSize?: number }) {
    this.cache = new Map()
    this.defaultTtlMs = options?.defaultTtlMs ?? 30_000
    this.maxSize = options?.maxSize ?? 100
  }

  get(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) {
      return null
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }

    return entry.value
  }

  set(key: string, value: T, ttlMs?: number): void {
    // Очищаем старые записи если достигнут лимит
    if (this.cache.size >= this.maxSize) {
      this.evictOldest()
    }

    const now = Date.now()
    this.cache.set(key, {
      value,
      expiresAt: now + (ttlMs ?? this.defaultTtlMs),
      createdAt: now,
    })
  }

  invalidate(key: string): void {
    this.cache.delete(key)
  }

  invalidateAll(): void {
    this.cache.clear()
  }

  /**
   * Принудительная инвалидация по условию
   */
  invalidateWhere(predicate: (key: string, value: T) => boolean): void {
    for (const [key, entry] of this.cache.entries()) {
      if (predicate(key, entry.value)) {
        this.cache.delete(key)
      }
    }
  }

  private evictOldest(): void {
    let oldestKey: string | null = null
    let oldestTime = Infinity

    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
    }
  }

  /**
   * Получает или вычисляет значение с кэшированием
   */
  async getOrCompute(
    key: string,
    computeFn: () => Promise<T>,
    ttlMs?: number,
  ): Promise<T> {
    const cached = this.get(key)
    if (cached !== null) {
      return cached
    }

    const value = await computeFn()
    this.set(key, value, ttlMs)
    return value
  }

  size(): number {
    return this.cache.size
  }
}

/**
 * RateLimiter - Ограничитель частоты запросов для защиты от DoS
 */
export class RateLimiter {
  private readonly maxRequests: number
  private readonly windowMs: number
  private requests: Map<string, number[]>

  constructor(options?: { maxRequests?: number; windowMs?: number }) {
    this.maxRequests = options?.maxRequests ?? 100
    this.windowMs = options?.windowMs ?? 60_000 // 1 минута
    this.requests = new Map()
  }

  /**
   * Проверяет можно ли выполнить запрос
   * @returns true если запрос разрешен, false если превышен лимит
   */
  allowRequest(clientId: string): boolean {
    const now = Date.now()
    const windowStart = now - this.windowMs

    let timestamps = this.requests.get(clientId) ?? []
    
    // Удаляем устаревшие записи
    timestamps = timestamps.filter(ts => ts > windowStart)

    if (timestamps.length >= this.maxRequests) {
      this.requests.set(clientId, timestamps)
      return false
    }

    timestamps.push(now)
    this.requests.set(clientId, timestamps)
    return true
  }

  /**
   * Сбрасывает лимиты для клиента
   */
  reset(clientId: string): void {
    this.requests.delete(clientId)
  }

  /**
   * Очищает все лимиты
   */
  resetAll(): void {
    this.requests.clear()
  }

  /**
   * Периодическая очистка устаревших записей
   */
  cleanup(): void {
    const now = Date.now()
    const windowStart = now - this.windowMs

    for (const [clientId, timestamps] of this.requests.entries()) {
      const filtered = timestamps.filter(ts => ts > windowStart)
      if (filtered.length === 0) {
        this.requests.delete(clientId)
      } else {
        this.requests.set(clientId, filtered)
      }
    }
  }
}

/**
 * SessionRegistry - Реестр активных сессий с мониторингом
 */
export class SessionRegistry {
  private sessions: Map<string, { createdAt: number; lastActivityAt: number; requestId: string }>
  private readonly maxLifetimeMs: number
  private readonly maxConcurrent: number

  constructor(options?: { maxLifetimeMs?: number; maxConcurrent?: number }) {
    this.sessions = new Map()
    this.maxLifetimeMs = options?.maxLifetimeMs ?? 300_000
    this.maxConcurrent = options?.maxConcurrent ?? 10
  }

  /**
   * Регистрирует новую сессию
   * @returns true если сессия создана, false если превышен лимит
   */
  register(sessionId: string, requestId: string): boolean {
    if (this.sessions.size >= this.maxConcurrent) {
      this.cleanup()
      if (this.sessions.size >= this.maxConcurrent) {
        return false
      }
    }

    const now = Date.now()
    this.sessions.set(sessionId, {
      createdAt: now,
      lastActivityAt: now,
      requestId,
    })
    return true
  }

  /**
   * Обновляет время последней активности
   */
  touch(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.lastActivityAt = Date.now()
      this.sessions.set(sessionId, session)
    }
  }

  /**
   * Удаляет сессию из реестра
   */
  unregister(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  /**
   * Проверяет существует ли сессия
   */
  exists(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /**
   * Получает информацию о сессии
   */
  getSession(sessionId: string): { createdAt: number; lastActivityAt: number; requestId: string } | null {
    return this.sessions.get(sessionId) ?? null
  }

  /**
   * Очищает просроченные сессии
   */
  cleanup(): void {
    const now = Date.now()
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.createdAt > this.maxLifetimeMs) {
        this.sessions.delete(sessionId)
        logger.warn(`[SessionRegistry] Session ${sessionId} exceeded max lifetime, removed`)
      }
    }
  }

  /**
   * Получает количество активных сессий
   */
  count(): number {
    return this.sessions.size
  }

  /**
   * Получает идентификаторы всех активных сессий
   */
  listSessionIds(): string[] {
    return Array.from(this.sessions.keys())
  }
}

/**
 * SafeLogger - Безопасный логгер с маскированием чувствительных данных
 */
export class SafeLogger {
  private readonly maskSessionIds: boolean
  private readonly enableDebug: boolean

  constructor(options?: { maskSessionIds?: boolean; enableDebug?: boolean }) {
    this.maskSessionIds = options?.maskSessionIds ?? true
    this.enableDebug = options?.enableDebug ?? false
  }

  /**
   * Маскирует идентификатор сессии (статический метод для совместимости)
   */
  static mask(sessionId: string): string {
    if (!sessionId || sessionId.length <= 8) {
      return '***'
    }
    return sessionId.slice(0, 4) + '...' + sessionId.slice(-4)
  }

  /**
   * Маскирует идентификатор сессии
   */
  maskSessionId(sessionId: string): string {
    if (!this.maskSessionIds || !sessionId) {
      return sessionId
    }

    if (sessionId.length <= 8) {
      return '***'
    }

    return sessionId.slice(0, 4) + '...' + sessionId.slice(-4)
  }

  /**
   * Логирует сообщение с маскированием
   */
  debug(message: string, context?: Record<string, unknown>): void {
    if (!this.enableDebug) {
      return
    }

    const maskedMessage = this.maskSensitiveData(message)
    const maskedContext = context ? this.maskContext(context) : undefined

    logger.debug(maskedMessage, maskedContext)
  }

  info(message: string, context?: Record<string, unknown>): void {
    const maskedMessage = this.maskSensitiveData(message)
    const maskedContext = context ? this.maskContext(context) : undefined

    logger.info(maskedMessage, maskedContext)
  }

  warn(message: string, context?: Record<string, unknown>): void {
    const maskedMessage = this.maskSensitiveData(message)
    const maskedContext = context ? this.maskContext(context) : undefined

    logger.warn(maskedMessage, maskedContext)
  }

  error(message: string, context?: Record<string, unknown>): void {
    const maskedMessage = this.maskSensitiveData(message)
    const maskedContext = context ? this.maskContext(context) : undefined

    logger.error(maskedMessage, maskedContext)
  }

  private maskSensitiveData(text: string): string {
    if (!this.maskSessionIds) {
      return text
    }

    // Маскируем session ID в формате UUID или коротком формате
    return text.replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, '<SESSION_ID>')
      .replace(/\bsess_[a-zA-Z0-9]{8,}\b/gi, '<SESSION_ID>')
  }

  private maskContext(context: Record<string, unknown>): Record<string, unknown> {
    if (!this.maskSessionIds) {
      return context
    }

    const masked: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(context)) {
      if (key.toLowerCase().includes('session') || key.toLowerCase().includes('token') || key.toLowerCase().includes('secret')) {
        masked[key] = '<REDACTED>'
      } else if (typeof value === 'string') {
        masked[key] = this.maskSensitiveData(value)
      } else {
        masked[key] = value
      }
    }
    return masked
  }
}

// Экспортируем RiskLevel из security-auditor для совместимости
export { PermissionRiskLevel as RiskLevel } from './security-auditor.js'
