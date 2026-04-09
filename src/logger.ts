const timestamp = () => new Date().toISOString()

let _debugEnabled = process.env.DEBUG === 'true'

export function setDebug(enabled: boolean) {
  _debugEnabled = enabled
}

export const logger = {
  info: (message: string, ...args: unknown[]) => {
    console.log(`[${timestamp()}] [INFO] ${message}`, ...args)
  },
  error: (message: string, ...args: unknown[]) => {
    console.error(`[${timestamp()}] [ERROR] ${message}`, ...args)
  },
  warn: (message: string, ...args: unknown[]) => {
    console.warn(`[${timestamp()}] [WARN] ${message}`, ...args)
  },
  debug: (message: string, ...args: unknown[]) => {
    if (_debugEnabled) {
      console.log(`\x1b[36m[${timestamp()}] [DEBUG] ${message}\x1b[0m`, ...args)
    }
  },
}
