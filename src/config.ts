import { parseArgs } from 'node:util';
import 'dotenv/config';
import { setDebug } from './logger.js';

export type Mode = 'api' | 'opencode';

export interface Config {
  port: number;
  mode: Mode;
  debug: boolean;
  openCodeApiKey: string;
  localApiKey: string;
  defaultModel: string;
  opencodePort: number;
}

const DEFAULT_PORT = 3000;
const DEFAULT_MODEL = 'big-pickle';
const DEFAULT_OPENCODE_PORT = 54321;

export function loadConfig(): Config {
  // Парсим CLI аргументы
  const { values } = parseArgs({
    options: {
      port: {
        type: 'string',
      },
      model: {
        type: 'string',
      },
      mode: {
        type: 'string',
      },
      debug: {
        type: 'boolean',
      },
      'opencode-port': {
        type: 'string',
      },
    },
    strict: false,
  });

  // Извлекаем значения из environment
  const envPort = process.env.PORT;
  const envDefaultModel = process.env.DEFAULT_MODEL;
  const envMode = process.env.MODE;
  const envOpencodePort = process.env.OPENCODE_PORT;
  const openCodeApiKey = process.env.OPENCODE_API_KEY;
  const localApiKey = process.env.LOCAL_API_KEY;
  const envDebug = process.env.DEBUG;

  // Debug: CLI > env > false
  const debug = values.debug === true || envDebug === 'true';
  setDebug(debug);

  // Приоритет: CLI > env > defaults для mode
  let mode: Mode = 'api';
  if (envMode === 'api' || envMode === 'opencode') {
    mode = envMode;
  }
  if (values.mode === 'api' || values.mode === 'opencode') {
    mode = values.mode;
  }

  // В режиме api требуем OPENCODE_API_KEY
  if (mode === 'api' && !openCodeApiKey) {
    console.error('Error: OPENCODE_API_KEY environment variable is not set');
    process.exit(1);
  }

  if (!localApiKey) {
    console.error('Error: LOCAL_API_KEY environment variable is not set');
    process.exit(1);
  }

  // Приоритет: CLI > env > defaults для port
  let port = DEFAULT_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed)) port = parsed;
  }
  if (values.port && typeof values.port === 'string') {
    const parsed = parseInt(values.port, 10);
    if (!isNaN(parsed)) port = parsed;
  }

  // model
  let defaultModel = DEFAULT_MODEL;
  if (envDefaultModel) {
    defaultModel = envDefaultModel;
  }
  if (values.model && typeof values.model === 'string') {
    defaultModel = values.model;
  }

  // opencode port
  let opencodePort = DEFAULT_OPENCODE_PORT;
  if (envOpencodePort) {
    const parsed = parseInt(envOpencodePort, 10);
    if (!isNaN(parsed)) opencodePort = parsed;
  }
  const cliOpencodePort = values['opencode-port'];
  if (cliOpencodePort && typeof cliOpencodePort === 'string') {
    const parsed = parseInt(cliOpencodePort, 10);
    if (!isNaN(parsed)) opencodePort = parsed;
  }

  return {
    port,
    mode,
    debug,
    openCodeApiKey: openCodeApiKey ?? '',
    localApiKey,
    defaultModel,
    opencodePort,
  };
}
