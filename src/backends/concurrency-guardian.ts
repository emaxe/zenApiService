/**
 * ConcurrencyGuardian - Управление конкурентностью и блокировками
 * 
 * Обеспечивает потокобезопасность при работе с сессиями opencode,
 * предотвращая race conditions при одновременных запросах.
 */

export class Mutex {
  private locked = false
  private queue: Array<{ resolve: () => void; promise: Promise<void> }> = []

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true
      return
    }

    let resolveFunc: () => void
    const promise = new Promise<void>(resolve => {
      resolveFunc = resolve
    })
    this.queue.push({ resolve: resolveFunc!, promise })
    await promise
  }

  release(): void {
    const next = this.queue.shift()
    if (next) {
      next.resolve()
    } else {
      this.locked = false
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }
}

/**
 * SessionLockManager - Менеджер блокировок на уровне сессий
 * 
 * Позволяет синхронизировать доступ к конкретным сессиям,
 * предотвращая конкурентные операции над одной сессией.
 */
export class SessionLockManager {
  private locks = new Map<string, Mutex>()
  private globalLock = new Mutex()

  async acquireSessionLock(sessionId: string): Promise<Mutex> {
    return this.globalLock.run(async () => {
      let mutex = this.locks.get(sessionId)
      if (!mutex) {
        mutex = new Mutex()
        this.locks.set(sessionId, mutex)
      }
      await mutex.acquire()
      return mutex
    })
  }

  releaseSessionLock(sessionId: string): void {
    const mutex = this.locks.get(sessionId)
    if (mutex) {
      mutex.release()
      // Очищаем замок если очередь пуста
      if (this.locks.get(sessionId) === mutex && !mutex['locked'] && mutex['queue'].length === 0) {
        this.locks.delete(sessionId)
      }
    }
  }

  async runWithSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const mutex = await this.acquireSessionLock(sessionId)
    try {
      return await fn()
    } finally {
      this.releaseSessionLock(sessionId)
    }
  }

  cleanup(): void {
    this.locks.clear()
  }
}

/**
 * SafeStreamWrapper - Безопасная обертка для асинхронных итераторов
 * 
 * Гарантирует корректное освобождение ресурсов даже при ошибках.
 */
export class SafeStreamWrapper<T> {
  private iterator: AsyncIterator<T>
  private closed = false
  private closePromise: Promise<void> | null = null

  constructor(iterator: AsyncIterator<T>) {
    this.iterator = iterator
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.closed) {
      return { done: true, value: undefined }
    }
    return this.iterator.next()
  }

  async return(): Promise<void> {
    if (this.closed || this.closePromise) {
      return this.closePromise ?? Promise.resolve()
    }

    this.closePromise = (async () => {
      this.closed = true
      try {
        await this.iterator.return?.(undefined)
      } catch (error) {
        // Логируем ошибку закрытия, но не пробрасываем
        console.warn('[SafeStreamWrapper] Error during iterator return:', error)
      }
    })()

    return this.closePromise
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    try {
      while (!this.closed) {
        const result = await this.next()
        if (result.done) break
        yield result.value!
      }
    } finally {
      await this.return()
    }
  }
}

/**
 * ResponseWriter - Безопасная запись в HTTP-ответ
 * 
 * Предотвращает запись после завершения ответа.
 */
export class ResponseWriter {
  private writable: boolean
  private ended = false

  constructor(private res: { writableEnded: boolean; write: (data: string) => boolean; end: () => void }) {
    this.writable = !res.writableEnded
  }

  canWrite(): boolean {
    return this.writable && !this.ended && !this.res.writableEnded
  }

  write(data: string): boolean {
    if (!this.canWrite()) {
      return false
    }
    return this.res.write(data)
  }

  end(): void {
    if (!this.ended && !this.res.writableEnded) {
      this.ended = true
      this.res.end()
    }
  }
}
