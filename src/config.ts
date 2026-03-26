import { parseArgs } from 'node:util';
import 'dotenv/config';

export interface Config {
  port: number;
  openCodeApiKey: string;
  localApiKey: string;
  defaultModel: string;
}

const DEFAULT_PORT = 3000;
const DEFAULT_MODEL = 'big-pickle';

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
    },
    strict: false,
  });

  // Извлекаем значения из environment
  const envPort = process.env.PORT;
  const envDefaultModel = process.env.DEFAULT_MODEL;
  const openCodeApiKey = process.env.OPENCODE_API_KEY;
  const localApiKey = process.env.LOCAL_API_KEY;

  // Проверяем обязательные переменные
  if (!openCodeApiKey) {
    console.error('Error: OPENCODE_API_KEY environment variable is not set');
    process.exit(1);
  }

  if (!localApiKey) {
    console.error('Error: LOCAL_API_KEY environment variable is not set');
    process.exit(1);
  }

  // Приоритет: CLI > env > defaults
  let port = DEFAULT_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed)) port = parsed;
  }
  if (values.port && typeof values.port === 'string') {
    const parsed = parseInt(values.port, 10);
    if (!isNaN(parsed)) port = parsed;
  }

  let defaultModel = DEFAULT_MODEL;
  if (envDefaultModel) {
    defaultModel = envDefaultModel;
  }
  if (values.model && typeof values.model === 'string') {
    defaultModel = values.model;
  }

  return {
    port,
    openCodeApiKey,
    localApiKey,
    defaultModel,
  };
}
