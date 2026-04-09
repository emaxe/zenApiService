# Zen API Service

OpenAI-совместимый прокси для моделей [OpenCode](https://opencode.ai) Zen.

## Быстрый старт

### 1. Установка зависимостей

```bash
npm install
```

### 2. Настройка конфигурации

Скопируй `.env.example` в `.env` и заполни ключи:

```bash
cp .env.example .env
```

```env
OPENCODE_API_KEY=sk-...       # ключ от opencode.ai (обязательно только в MODE=api)
LOCAL_API_KEY=my-secret-key   # любой секретный ключ для клиентов (обязательно)
PORT=3000                     # порт сервера (по умолчанию 3000)
DEFAULT_MODEL=big-pickle      # модель по умолчанию
MODE=api                      # api | opencode
OPENCODE_PORT=54321           # порт локального opencode serve (для MODE=opencode)
OPENCODE_DIRECTORY=/path/to/project # рабочая директория opencode по умолчанию (необязательно)
DEBUG=false                   # включить debug-логи
```

Получить `OPENCODE_API_KEY` можно на [opencode.ai](https://opencode.ai).

### 3. Запуск

`MODE=api` (по умолчанию):

```bash
npx tsx src/index.ts --mode api
```

`MODE=opencode` (локальный `opencode serve` через SDK):

```bash
npx tsx src/index.ts --mode opencode --opencode-port 54321
```

Сервер запустится на `http://localhost:3000`. CLI аргументы переопределяют `.env`:

```bash
npx tsx src/index.ts --port 8080 --model opencode/big-pickle --mode opencode
```

### Работа с файлами в `MODE=opencode`

Если агент должен читать файлы другого проекта, передай рабочую директорию в запросе:

- через header: `x-opencode-directory: /absolute/path/to/project`
- или через body: `"opencode_directory": "/absolute/path/to/project"`

Пример:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer my-secret-key" \
  -H "Content-Type: application/json" \
  -H "x-opencode-directory: /Users/maksimklisin/Desktop/_JS/career-ops" \
  -d '{
    "model": "opencode/big-pickle",
    "stream": true,
    "messages": [
      { "role": "user", "content": "О чем файл data/pipeline.md?" }
    ]
  }'
```

---

## Доступные модели

Актуальный список моделей доступен через эндпоинт `GET /v1/models` (см. ниже).

---

## API

Все запросы требуют заголовок авторизации:

```
Authorization: Bearer <LOCAL_API_KEY>
```

### GET /v1/models

Список доступных моделей.

```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer my-secret-key"
```

<details>
<summary>Пример ответа</summary>

```json
{
  "object": "list",
  "data": [
    { "id": "big-pickle", "object": "model", "owned_by": "opencode" },
    { "id": "minimax-m2.5-free", "object": "model", "owned_by": "opencode" },
    ...
  ]
}
```
</details>

---

### POST /v1/chat/completions

Генерация текста. Поддерживает обычный и потоковый режимы.

**Обычный режим:**

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer my-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "big-pickle",
    "messages": [
      { "role": "user", "content": "Привет! Кто ты?" }
    ]
  }'
```

**Потоковый режим (SSE):**

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer my-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "big-pickle",
    "messages": [
      { "role": "user", "content": "Напиши короткое стихотворение" }
    ],
    "stream": true
  }'
```

Больше примеров curl-запросов (streaming, system prompt, мультиходовой диалог, обработка ошибок) — в [CURL_EXAMPLES.md](CURL_EXAMPLES.md).

---

## Использование с OpenAI SDK

Сервис совместим с официальным OpenAI SDK — достаточно поменять `base_url` и `api_key`.

**Python:**

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="my-secret-key"
)

response = client.chat.completions.create(
    model="big-pickle",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

**Потоковый режим (Python):**

```python
stream = client.chat.completions.create(
    model="big-pickle",
    messages=[{"role": "user", "content": "Расскажи анекдот"}],
    stream=True
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

**JavaScript/TypeScript:**

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:3000/v1",
  apiKey: "my-secret-key",
});

const response = await client.chat.completions.create({
  model: "big-pickle",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(response.choices[0].message.content);
```

---

## Коды ошибок

| HTTP | code | Причина |
|------|------|---------|
| 401 | `unauthorized` | Неверный или отсутствующий API ключ |
| 400 | `invalid_json` | Тело запроса не является валидным JSON |
| 400 | `invalid_request_error` | Невалидные поля в запросе (например, `messages`) |
| 404 | `not_found` | Эндпоинт не существует |
| 502 | `upstream_error` / `opencode_error` | Ошибка upstream/opencode |
| 504 | `timeout` | Таймаут запроса в режиме `opencode` |

Все ошибки возвращаются в формате OpenAI:

```json
{
  "error": {
    "message": "`messages` must be a non-empty array",
    "type": "invalid_request_error",
    "code": "invalid_request_error"
  }
}
```

---

## Переменные окружения

| Переменная | Обязательно | По умолчанию | Описание |
|------------|-------------|--------------|----------|
| `OPENCODE_API_KEY` | только `MODE=api` | — | Ключ для upstream opencode.ai |
| `LOCAL_API_KEY` | ✅ | — | Ключ для авторизации клиентов |
| `PORT` | — | `3000` | Порт сервера |
| `MODE` | — | `api` | Режим работы: `api` или `opencode` |
| `DEFAULT_MODEL` | — | `big-pickle` | Модель если не указана в запросе |
| `OPENCODE_PORT` | — | `54321` | Порт локального `opencode serve` |
| `OPENCODE_DIRECTORY` | — | cwd сервиса | Рабочая директория opencode по умолчанию |
| `DEBUG` | — | `false` | Включить debug-логи (`DEBUG=true`) |
