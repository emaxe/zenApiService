import { loadConfig } from './config.js'
import { createServer } from './server.js'
import { logger } from './logger.js'
import { ApiBackend } from './backends/api.js'
import { OpencodeBackend } from './backends/opencode.js'
import type { Backend } from './backend.js'

const config = loadConfig()

// Create backend based on mode
const backend: Backend = config.mode === 'opencode'
  ? new OpencodeBackend(config)
  : new ApiBackend()

// Start backend (e.g. spawn opencode serve)
await backend.start()

const server = createServer(config, backend)

server.listen(config.port, () => {
  const modeLabel = config.mode === 'opencode' ? 'opencode' : 'api (proxy)'
  console.log(`\n╔${'═'.repeat(42)}╗`)
  console.log(`║      Zen API Service${' '.repeat(20)}║`)
  console.log(`╠${'═'.repeat(42)}╣`)
  console.log(`║  URL: http://localhost:${config.port}/v1${' '.repeat(Math.max(0, 14 - String(config.port).length))}║`)
  console.log(`║  Mode: ${modeLabel}${' '.repeat(Math.max(0, 33 - modeLabel.length))}║`)
  if (config.debug) {
    console.log(`║  Debug: \x1b[36mON\x1b[0m${' '.repeat(30)}║`)
  }
  console.log(`╚${'═'.repeat(42)}╝\n`)
  logger.info(`Server listening on port ${config.port} (mode: ${config.mode}, debug: ${config.debug})`)
})

async function shutdown() {
  logger.info('Server shutting down...')
  await backend.stop()
  server.close(() => {
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
