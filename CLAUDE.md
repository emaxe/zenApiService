# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zen API Service — OpenAI-совместимый HTTP-прокси для моделей OpenCode (opencode.ai). Принимает запросы в формате OpenAI API, проксирует их на `https://opencode.ai/zen/v1/`, возвращает ответы клиентам. Поддерживает обычный и SSE-streaming режимы.

## Commands

```bash
npm run dev          # запуск с hot-reload (tsx watch)
npm start            # запуск без watch
npx tsx src/index.ts --port 8080 --model minimax-m2.5-free  # CLI-аргументы переопределяют .env
```

Тестов нет. Линтера нет. TypeScript проверяется через `npx tsc --noEmit`.

## Architecture

Чистый Node.js HTTP-сервер без фреймворков. Все зависимости — только `dotenv` (runtime) и `tsx`/`typescript` (dev).

**Поток запроса:** `index.ts` → `server.ts` (роутинг + CORS + auth) → `routes/*.ts` (обработчики) → `proxy.ts` (fetch к upstream)

- `config.ts` — загрузка конфига с приоритетом CLI > env > defaults. Обязательные env: `OPENCODE_API_KEY`, `LOCAL_API_KEY`
- `server.ts` — создание `http.createServer`, маршрутизация по URL/method, авторизация через Bearer-токен (`LOCAL_API_KEY`)
- `auth.ts` — проверка `Authorization: Bearer <token>`
- `proxy.ts` — универсальная обёртка над `fetch()` для проксирования к upstream API
- `helpers.ts` — `parseBody` (чтение и парсинг JSON из IncomingMessage), `sendJson`, `sendError` (OpenAI-формат ошибок)
- `logger.ts` — простой логгер с уровнями info/error/warn/debug (debug включается через `DEBUG=true`)
- `routes/models.ts` — `GET /v1/models` — проксирует список моделей
- `routes/chatCompletions.ts` — `POST /v1/chat/completions` — проксирует completions, обрабатывает streaming через ReadableStream

**Upstream:** `https://opencode.ai/zen/v1/`

## Key Conventions

- ESM-модули (`"type": "module"` в package.json), импорты с расширением `.js`
- Ошибки возвращаются в формате OpenAI: `{ error: { message, type, param, code } }`
- Конфигурация через `.env` + CLI-аргументы (node:util `parseArgs`)
- CORS разрешён для всех origins
