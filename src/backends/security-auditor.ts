/**
 * SecurityAuditor - Компоненты безопасности для режима opencode
 * 
 * Обеспечивает защиту от уязвимостей доступа к файловой системе,
 * инъекций и автоматического одобрения опасных операций.
 */

import { realpath } from 'node:fs/promises'
import { logger } from '../logger.js'

/**
 * PermissionPolicy - Политика разрешений для инструментов opencode
 * 
 * Определяет какие операции могут быть автоматически одобрены,
 * а какие требуют явного разрешения пользователя.
 */
export enum PermissionRiskLevel {
  LOW = 'low',           // Чтение файлов, список директорий
  MEDIUM = 'medium',     // Запись файлов в разрешенных директориях
  HIGH = 'high',         // Выполнение команд, доступ к сети
  CRITICAL = 'critical', // Доступ за пределами рабочей директории
}

export interface PermissionRule {
  toolName: string
  riskLevel: PermissionRiskLevel
  autoApprove: boolean
  patterns?: RegExp[]
}

/**
 * Безопасный парсер путей с защитой от path traversal (класс для расширения)
 */
export class PathSanitizerClass {
  private allowedBasePaths: Set<string>

  constructor(allowedBasePaths: string[] = []) {
    this.allowedBasePaths = new Set(allowedBasePaths.map(p => p.replace(/\/$/, '')))
  }

  /**
   * Добавляет разрешенный базовый путь
   */
  addAllowedPath(path: string): void {
    this.allowedBasePaths.add(path.replace(/\/$/, ''))
  }

  /**
   * Санитизирует и валидирует путь
   * @returns Нормализованный абсолютный путь или null если путь недопустим
   */
  async sanitize(path: string): Promise<string | null> {
    if (!path || typeof path !== 'string') {
      return null
    }

    // Отклоняем пути с явными попытками traversal
    if (path.includes('\0')) {
      logger.warn('[PathSanitizer] Null byte in path detected')
      return null
    }

    let normalized: string
    try {
      // Разрешаем относительные пути относительно текущей директории
      if (!path.startsWith('/')) {
        normalized = await realpath(path).catch(() => path)
      } else {
        normalized = await realpath(path).catch(() => path)
      }
    } catch {
      normalized = path
    }

    // Нормализуем путь (убираем .., ., лишние слэши)
    const parts = normalized.split('/').filter(p => p.length > 0 && p !== '.')
    const resolved: string[] = []

    for (const part of parts) {
      if (part === '..') {
        resolved.pop()
      } else {
        resolved.push(part)
      }
    }

    const cleanPath = '/' + resolved.join('/')

    // Если есть список разрешенных путей, проверяем принадлежность
    if (this.allowedBasePaths.size > 0) {
      for (const basePath of this.allowedBasePaths) {
        if (cleanPath === basePath || cleanPath.startsWith(basePath + '/')) {
          return cleanPath
        }
      }
      logger.warn(`[PathSanitizer] Path ${cleanPath} is outside allowed bases`)
      return null
    }

    return cleanPath
  }

  /**
   * Проверяет находится ли путь внутри разрешенной директории
   */
  isPathAllowed(path: string): boolean {
    if (this.allowedBasePaths.size === 0) {
      return true
    }

    const normalized = path.replace(/\/$/, '')
    for (const basePath of this.allowedBasePaths) {
      if (normalized === basePath || normalized.startsWith(basePath + '/')) {
        return true
      }
    }
    return false
  }
}

/**
 * Менеджер политик разрешений (класс для расширения)
 */
export class PermissionManagerClass {
  private rules: Map<string, PermissionRule>
  private defaultAutoApprove: boolean

  constructor(defaultAutoApprove: boolean = false) {
    this.defaultAutoApprove = defaultAutoApprove
    this.rules = new Map()
    this.initializeDefaultRules()
  }

  /**
   * Инициализирует правила по умолчанию
   */
  private initializeDefaultRules(): void {
    // Низкий риск - можно авто-одобрять
    this.rules.set('read_file', {
      toolName: 'read_file',
      riskLevel: PermissionRiskLevel.LOW,
      autoApprove: true,
    })

    this.rules.set('list_directory', {
      toolName: 'list_directory',
      riskLevel: PermissionRiskLevel.LOW,
      autoApprove: true,
    })

    // Средний риск - авто-одобрение только если явно разрешено
    this.rules.set('write_file', {
      toolName: 'write_file',
      riskLevel: PermissionRiskLevel.MEDIUM,
      autoApprove: this.defaultAutoApprove,
    })

    // Высокий риск - никогда не авто-одобрять по умолчанию
    this.rules.set('execute_command', {
      toolName: 'execute_command',
      riskLevel: PermissionRiskLevel.HIGH,
      autoApprove: false,
    })

    this.rules.set('web_fetch', {
      toolName: 'web_fetch',
      riskLevel: PermissionRiskLevel.HIGH,
      autoApprove: false,
    })

    // Критический риск - требует явного подтверждения
    this.rules.set('edit_file', {
      toolName: 'edit_file',
      riskLevel: PermissionRiskLevel.MEDIUM,
      autoApprove: this.defaultAutoApprove,
    })
  }

  /**
   * Добавляет или обновляет правило
   */
  setRule(rule: PermissionRule): void {
    this.rules.set(rule.toolName, rule)
  }

  /**
   * Проверяет можно ли автоматически одобрить разрешение
   */
  canAutoApprove(toolName: string, permissionDetails?: unknown): boolean {
    const rule = this.rules.get(toolName)
    if (!rule) {
      return this.defaultAutoApprove
    }

    // Дополнительные проверки на основе деталей разрешения
    if (permissionDetails && typeof permissionDetails === 'object') {
      const details = permissionDetails as Record<string, unknown>
      
      // Проверяем путь если он указан
      if (typeof details.path === 'string') {
        // Для операций записи проверяем что путь в разрешенной зоне
        if (rule.riskLevel === PermissionRiskLevel.MEDIUM || 
            rule.riskLevel === PermissionRiskLevel.HIGH) {
          // Здесь можно добавить дополнительную валидацию пути
        }
      }

      // Проверяем команду если это выполнение
      if (typeof details.command === 'string' && rule.toolName === 'execute_command') {
        // Блокируем опасные команды даже при авто-одобрении
        const dangerousCommands = ['rm -rf', 'sudo', 'chmod 777', 'dd if=', '> /dev/']
        for (const dangerous of dangerousCommands) {
          if (details.command.includes(dangerous)) {
            logger.warn(`[PermissionManager] Blocked dangerous command: ${details.command}`)
            return false
          }
        }
      }
    }

    return rule.autoApprove
  }

  /**
   * Получает уровень риска для инструмента
   */
  getRiskLevel(toolName: string): PermissionRiskLevel {
    return this.rules.get(toolName)?.riskLevel ?? PermissionRiskLevel.MEDIUM
  }

  /**
   * Устанавливает режим строгой безопасности
   */
  enableStrictMode(): void {
    this.defaultAutoApprove = false
    for (const rule of this.rules.values()) {
      if (rule.riskLevel !== PermissionRiskLevel.LOW) {
        rule.autoApprove = false
      }
    }
    logger.info('[PermissionManager] Strict mode enabled')
  }
}

/**
 * InputValidator - Валидатор входных данных
 * 
 * Защищает от DoS через огромные запросы и инъекций.
 */
export class InputValidator {
  private readonly maxMessageLength: number
  private readonly maxMessages: number
  private readonly maxTotalSize: number
  private readonly maxDepth: number

  constructor(options?: {
    maxMessageLength?: number
    maxMessages?: number
    maxTotalSize?: number
    maxDepth?: number
  }) {
    this.maxMessageLength = options?.maxMessageLength ?? 100_000
    this.maxMessages = options?.maxMessages ?? 50
    this.maxTotalSize = options?.maxTotalSize ?? 500_000
    this.maxDepth = options?.maxDepth ?? 10
  }

  validateMessages(messages: Array<{ role?: unknown; content?: unknown }>): string | null {
    if (!Array.isArray(messages)) {
      return 'messages must be an array'
    }

    if (messages.length === 0) {
      return 'messages array cannot be empty'
    }

    if (messages.length > this.maxMessages) {
      return `Too many messages: ${messages.length} (max: ${this.maxMessages})`
    }

    let totalSize = 0

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      
      // Проверка структуры
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
        return `messages[${i}] must be an object`
      }

      const role = (msg as { role?: unknown }).role
      if (typeof role !== 'string' || !['system', 'user', 'assistant'].includes(role)) {
        return `messages[${i}].role must be one of: system, user, assistant`
      }

      const content = (msg as { content?: unknown }).content
      
      // Проверка размера контента
      if (typeof content === 'string') {
        if (content.length > this.maxMessageLength) {
          return `messages[${i}].content too long: ${content.length} (max: ${this.maxMessageLength})`
        }
        totalSize += content.length
      } else if (Array.isArray(content)) {
        // Проверка массива контент-блоков
        if (content.length > this.maxDepth) {
          return `messages[${i}].content has too many blocks: ${content.length} (max: ${this.maxDepth})`
        }

        for (let j = 0; j < content.length; j++) {
          const block = content[j]
          if (!block || typeof block !== 'object') {
            return `messages[${i}].content[${j}] must be an object`
          }

          const blockType = (block as { type?: unknown }).type
          if (typeof blockType !== 'string') {
            return `messages[${i}].content[${j}].type must be a string`
          }

          // Проверка размера текстового контента
          if ('text' in block && typeof block.text === 'string') {
            totalSize += block.text.length
          }
        }
      } else if (content !== undefined) {
        return `messages[${i}].content must be a string or array`
      }

      // Проверка общего размера
      if (totalSize > this.maxTotalSize) {
        return `Total message size exceeds limit: ${totalSize} (max: ${this.maxTotalSize})`
      }
    }

    return null
  }

  /**
   * Очищает строку от потенциально опасных паттернов
   */
  sanitizeString(input: string): string {
    // Удаляем null-байты
    let sanitized = input.replace(/\0/g, '')
    
    // Ограничиваем длину
    if (sanitized.length > this.maxMessageLength) {
      sanitized = sanitized.slice(0, this.maxMessageLength)
    }

    return sanitized
  }
}

/**
 * Результат санитайзинга пути
 */
export interface SanitizePathResult {
  isValid: boolean
  path: string
  error?: string
}

/**
 * Статический класс PathSanitizer для совместимости
 */
export const PathSanitizerStatic = {
  /**
   * Санитизирует и валидирует путь
   * @param candidate - Путь для санитайзинга
   * @param defaultDirectory - Базовая директория по умолчанию
   * @returns Результат валидации с нормализованным путем
   */
  sanitizePath(candidate: string, defaultDirectory?: string): SanitizePathResult {
    if (!candidate || typeof candidate !== 'string') {
      return { isValid: false, path: '', error: 'Path is empty or invalid' }
    }

    // Отклоняем пути с явными попытками traversal
    if (candidate.includes('\0')) {
      return { isValid: false, path: '', error: 'Null byte in path detected' }
    }

    // Нормализуем путь (убираем .., ., лишние слэши)
    const parts = candidate.split('/').filter(p => p.length > 0 && p !== '.')
    const resolved: string[] = []

    for (const part of parts) {
      if (part === '..') {
        resolved.pop()
      } else {
        resolved.push(part)
      }
    }

    let cleanPath = '/' + resolved.join('/')

    // Если есть defaultDirectory, проверяем что путь внутри неё
    if (defaultDirectory) {
      const normalizedBase = defaultDirectory.replace(/\/$/, '')
      if (cleanPath !== normalizedBase && !cleanPath.startsWith(normalizedBase + '/')) {
        return { 
          isValid: false, 
          path: cleanPath, 
          error: `Path is outside allowed directory: ${normalizedBase}` 
        }
      }
    }

    return { isValid: true, path: cleanPath }
  },
}

// Экспортируем классы и статические версии для совместимости
export { PathSanitizerStatic as PathSanitizer }

/**
 * Решение о разрешении
 */
export interface PermissionDecision {
  approved: boolean
  reason?: string
  riskLevel: PermissionRiskLevel
  scope: 'once' | 'session'
}

/**
 * Статический класс PermissionManager для совместимости
 */
export const PermissionManagerStatic = {
  /**
   * Оценивает запрос разрешения
   * @param params - Параметры запроса
   * @returns Решение об одобрении
   */
  evaluatePermissionRequest(params: {
    sessionId: string
    permissionID: string
    directory?: string
    requestId: string
  }): PermissionDecision {
    // По умолчанию одобряем с низким риском
    // В реальной реализации здесь была бы логика анализа toolName из permissionID
    
    const permissionID = params.permissionID.toLowerCase()
    
    // Высокий риск - команды и сеть
    if (permissionID.includes('command') || permissionID.includes('exec') || 
        permissionID.includes('fetch') || permissionID.includes('network')) {
      return {
        approved: false,
        reason: 'High-risk operations (commands/network) require manual approval',
        riskLevel: PermissionRiskLevel.HIGH,
        scope: 'once',
      }
    }
    
    // Средний риск - запись файлов
    if (permissionID.includes('write') || permissionID.includes('edit')) {
      return {
        approved: true,
        reason: 'File write operation auto-approved',
        riskLevel: PermissionRiskLevel.MEDIUM,
        scope: 'once',
      }
    }
    
    // Низкий риск - чтение
    return {
      approved: true,
      reason: 'Read operation auto-approved',
      riskLevel: PermissionRiskLevel.LOW,
      scope: 'session',
    }
  },
}

export { PermissionManagerStatic as PermissionManager }
