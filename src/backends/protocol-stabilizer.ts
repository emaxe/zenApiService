/**
 * ProtocolStabilizer - Компоненты для стабильности протокола
 * 
 * Обеспечивает устойчивое взаимодействие с opencode,
 * умную обработку эхо-ответов и надежное определение завершения сессии.
 */

import { logger } from '../logger.js'

/**
 * Умный детектор эха с поддержкой различных сценариев
 */
export class EchoDetector {
  private readonly maxEchoLength: number
  private readonly minMatchRatio: number

  constructor(options?: { maxEchoLength?: number; minMatchRatio?: number }) {
    this.maxEchoLength = options?.maxEchoLength ?? 2000
    this.minMatchRatio = options?.minMatchRatio ?? 0.9
  }

  /**
   * Определяет текст эха из сообщений пользователя
   * Более надежная версия чем простое взятие последнего сообщения
   */
  detectEchoText(messages: Array<{ role?: string; content?: unknown }>): string {
    // Ищем последнее сообщение пользователя
    let lastUserMessage = ''
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const content = messages[i].content
        if (typeof content === 'string') {
          lastUserMessage = content
        } else if (Array.isArray(content)) {
          lastUserMessage = content
            .filter(block => block && typeof block === 'object' && 'text' in block)
            .map(block => (block as { text: string }).text)
            .join('')
        }
        break
      }
    }

    if (!lastUserMessage || lastUserMessage.length > this.maxEchoLength) {
      return ''
    }

    // Очищаем сообщение от лишних пробелов и нормализуем
    const normalized = lastUserMessage.trim().replace(/\s+/g, ' ')
    
    // Не используем эхо если сообщение слишком короткое или выглядит как команда
    if (normalized.length < 10) {
      return ''
    }

    // Проверяем не является ли это системной инструкцией
    const lowerNormalized = normalized.toLowerCase()
    if (lowerNormalized.startsWith('system:') || 
        lowerNormalized.startsWith('instruction:') ||
        lowerNormalized.includes('you are')) {
      return ''
    }

    return normalized
  }

  /**
   * Проверяет начинается ли ответ с эха
   * Возвращает длину совпавшей части
   */
  findEchoOverlap(response: string, echoText: string): number {
    if (!echoText || !response) {
      return 0
    }

    // Нормализуем оба текста
    const normalizedResponse = response.replace(/\s+/g, ' ').trim()
    const normalizedEcho = echoText.replace(/\s+/g, ' ').trim()

    // Проверяем точное совпадение в начале
    if (normalizedResponse.startsWith(normalizedEcho)) {
      return normalizedEcho.length
    }

    // Проверяем частичное совпадение с допустимым порогом
    const checkLength = Math.min(normalizedEcho.length, normalizedResponse.length)
    if (checkLength < 10) {
      return 0
    }

    const responsePrefix = normalizedResponse.slice(0, checkLength)
    const echoPrefix = normalizedEcho.slice(0, checkLength)

    // Считаем процент совпадения
    let matches = 0
    for (let i = 0; i < checkLength; i++) {
      if (responsePrefix[i] === echoPrefix[i]) {
        matches++
      }
    }

    const ratio = matches / checkLength
    if (ratio >= this.minMatchRatio) {
      return checkLength
    }

    return 0
  }

  /**
   * Удаляет эхо из ответа если оно обнаружено
   */
  stripEcho(response: string, echoText: string): string {
    if (!echoText) {
      return response
    }

    const overlap = this.findEchoOverlap(response, echoText)
    if (overlap === 0) {
      return response
    }

    // Удаляем эхо и последующие переводы строк
    return response.slice(overlap).replace(/^[\s\n]+/, '')
  }
}

/**
 * Менеджер состояния сессии с альтернативными способами определения завершения
 */
export class SessionStateManager {
  private readonly idleTimeoutMs: number
  private readonly activityCheckIntervalMs: number
  private readonly maxIdleChecks: number

  constructor(options?: {
    idleTimeoutMs?: number
    activityCheckIntervalMs?: number
    maxIdleChecks?: number
  }) {
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 30_000
    this.activityCheckIntervalMs = options?.activityCheckIntervalMs ?? 5_000
    this.maxIdleChecks = options?.maxIdleChecks ?? 6
  }

  /**
   * Создает новый трекер состояния сессии
   */
  createTracker(sessionId: string): SessionTracker {
    return new SessionTracker(
      sessionId,
      this.idleTimeoutMs,
      this.activityCheckIntervalMs,
      this.maxIdleChecks,
    )
  }
}

export class SessionTracker {
  private sessionId: string
  private lastActivityAt: number
  private idleCheckCount: number
  private isIdle: boolean
  private hasError: boolean
  private errorMessage: string | null
  private readonly idleTimeoutMs: number
  private readonly activityCheckIntervalMs: number
  private readonly maxIdleChecks: number

  constructor(
    sessionId: string,
    idleTimeoutMs: number,
    activityCheckIntervalMs: number,
    maxIdleChecks: number,
  ) {
    this.sessionId = sessionId
    this.lastActivityAt = Date.now()
    this.idleCheckCount = 0
    this.isIdle = false
    this.hasError = false
    this.errorMessage = null
    this.idleTimeoutMs = idleTimeoutMs
    this.activityCheckIntervalMs = activityCheckIntervalMs
    this.maxIdleChecks = maxIdleChecks
  }

  markActivity(): void {
    this.lastActivityAt = Date.now()
    this.idleCheckCount = 0
  }

  markError(message: string): void {
    this.hasError = true
    this.errorMessage = message
    this.markActivity()
  }

  markIdle(): void {
    this.isIdle = true
    this.markActivity()
  }

  shouldConsiderIdle(): boolean {
    // Если уже получили явное событие idle
    if (this.isIdle) {
      return true
    }

    // Если есть ошибка - считаем сессию завершенной
    if (this.hasError) {
      return true
    }

    // Проверяем таймаут без активности
    const elapsed = Date.now() - this.lastActivityAt
    if (elapsed >= this.idleTimeoutMs) {
      this.idleCheckCount++
      // Ждем несколько проверок подряд чтобы избежать ложных срабатываний
      return this.idleCheckCount >= this.maxIdleChecks
    }

    return false
  }

  isFinished(): boolean {
    return this.isIdle || this.hasError || this.shouldConsiderIdle()
  }

  getFinishReason(): 'stop' | 'length' | 'error' {
    if (this.hasError) {
      return 'error'
    }
    if (this.isIdle) {
      return 'stop'
    }
    if (this.shouldConsiderIdle()) {
      return 'length' // Завершено по таймауту
    }
    return 'stop'
  }

  getErrorMessage(): string | null {
    return this.errorMessage
  }

  getTimeSinceLastActivity(): number {
    return Date.now() - this.lastActivityAt
  }

  reset(): void {
    this.lastActivityAt = Date.now()
    this.idleCheckCount = 0
    this.isIdle = false
    this.hasError = false
    this.errorMessage = null
  }
}

/**
 * RetryHandler - Обработчик повторных попыток для transient ошибок
 */
export class RetryHandler {
  private readonly maxRetries: number
  private readonly baseDelayMs: number
  private readonly maxDelayMs: number
  private readonly retryableStatusCodes: Set<number>

  constructor(options?: {
    maxRetries?: number
    baseDelayMs?: number
    maxDelayMs?: number
    retryableStatusCodes?: number[]
  }) {
    this.maxRetries = options?.maxRetries ?? 3
    this.baseDelayMs = options?.baseDelayMs ?? 1000
    this.maxDelayMs = options?.maxDelayMs ?? 30_000
    this.retryableStatusCodes = new Set(options?.retryableStatusCodes ?? [408, 429, 500, 502, 503, 504])
  }

  /**
   * Проверяет можно ли повторить запрос
   */
  isRetryable(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false
    }

    const err = error as Record<string, unknown>
    
    // Проверяем статус код
    const status = err['status'] ?? err['statusCode'] ?? err['httpStatus']
    if (typeof status === 'number' && this.retryableStatusCodes.has(status)) {
      return true
    }

    // Проверяем тип ошибки
    const message = String(err['message'] ?? '')
    const retryableMessages = [
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'timeout',
      'network error',
      'service unavailable',
      'too many requests',
    ]

    const lowerMessage = message.toLowerCase()
    return retryableMessages.some(msg => lowerMessage.includes(msg))
  }

  /**
   * Вычисляет задержку перед следующей попыткой (exponential backoff with jitter)
   */
  calculateDelay(attempt: number): number {
    const exponentialDelay = this.baseDelayMs * Math.pow(2, attempt)
    const jitter = Math.random() * 0.3 * exponentialDelay
    return Math.min(exponentialDelay + jitter, this.maxDelayMs)
  }

  /**
   * Выполняет операцию с повторными попытками
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: string = 'operation',
  ): Promise<T> {
    let lastError: unknown
    let attempt = 0

    while (attempt <= this.maxRetries) {
      try {
        return await operation()
      } catch (error) {
        lastError = error
        attempt++

        if (attempt > this.maxRetries || !this.isRetryable(error)) {
          break
        }

        const delay = this.calculateDelay(attempt - 1)
        logger.warn(
          `[RetryHandler] ${context} failed (attempt ${attempt}/${this.maxRetries + 1}), retrying in ${Math.round(delay)}ms`,
        )
        await this.sleep(delay)
      }
    }

    throw lastError
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

/**
 * SnapshotSync - Синхронизатор для получения снапшотов сессии
 * 
 * Предотвращает гонки при получении финального состояния сессии.
 */
export class SnapshotSync {
  private readonly maxAttempts: number
  private readonly retryDelayMs: number

  constructor(options?: { maxAttempts?: number; retryDelayMs?: number }) {
    this.maxAttempts = options?.maxAttempts ?? 3
    this.retryDelayMs = options?.retryDelayMs ?? 500
  }

  /**
   * Получает снапшот сессии с повторными попытками
   */
  async getSnapshot<T>(
    fetchFn: () => Promise<T | null>,
    validator?: (snapshot: T) => boolean,
  ): Promise<T | null> {
    let lastResult: T | null = null

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        const result = await fetchFn()
        
        if (result === null) {
          // Данные еще не готовы, ждем и пробуем снова
          if (attempt < this.maxAttempts - 1) {
            await this.sleep(this.retryDelayMs * (attempt + 1))
            continue
          }
          return null
        }

        // Проверяем валидность результата
        if (validator && !validator(result)) {
          if (attempt < this.maxAttempts - 1) {
            await this.sleep(this.retryDelayMs * (attempt + 1))
            continue
          }
          return null
        }

        return result
      } catch (error) {
        lastResult = null
        logger.warn(`[SnapshotSync] Attempt ${attempt + 1} failed:`, error)
        
        if (attempt < this.maxAttempts - 1) {
          await this.sleep(this.retryDelayMs * (attempt + 1))
        }
      }
    }

    return lastResult
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// Добавляем статический метод для совместимости
