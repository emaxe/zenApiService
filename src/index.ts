import { loadConfig } from './config.js'
import { createServer } from './server.js'
import { logger } from './logger.js'

const config = loadConfig()
const server = createServer(config)

server.listen(config.port, () => {
  console.log(`\n╔${'═'.repeat(42)}╗`)
  console.log(`║      Zen API Service${' '.repeat(20)}║`)
  console.log(`╠${'═'.repeat(42)}╣`)
  console.log(`║  URL: http://localhost:${config.port}/v1${' '.repeat(Math.max(0, 14 - String(config.port).length))}║`)
  console.log(`╚${'═'.repeat(42)}╝\n`)
  logger.info(`Server listening on port ${config.port}`)
})

function shutdown() {
  logger.info('Server shutting down...')
  server.close(() => {
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
