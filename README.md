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
OPENCODE_API_KEY=sk-...       # ключ от opencode.ai (обязательно)
LOCAL_API_KEY=my-secret-key   # любой секретный ключ для клиентов (обязательно)
PORT=3000                     # порт сервера (по умолчанию 3000)
DEFAULT_MODEL=big-pickle      # модель по умолчанию
ALLOWED_MODELS=big-pickle,minimax-m2.5-free  # ограничить список моделей (необязательно)
```

Получить `OPENCODE_API_KEY` можно на [opencode.ai](https://opencode.ai).

### 3. Запуск

```bash
npx tsx src/index.ts
```

Сервер запустится на `http://localhost:3000`. CLI аргументы переопределяют `.env`:

```bash
npx tsx src/index.ts --port 8080 --model minimax-m2.5-free
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
| 400 | `model_not_allowed` | Модель не входит в список разрешённых |
| 404 | `not_found` | Эндпоинт не существует |
| 502 | `upstream_error` | Ошибка соединения с opencode.ai |

Все ошибки возвращаются в формате OpenAI:

```json
{
  "error": {
    "message": "Model 'gpt-4' is not allowed.",
    "type": "invalid_request_error",
    "code": "model_not_allowed"
  }
}
```

---

## Переменные окружения

| Переменная | Обязательно | По умолчанию | Описание |
|------------|-------------|--------------|----------|
| `OPENCODE_API_KEY` | ✅ | — | Ключ для upstream opencode.ai |
| `LOCAL_API_KEY` | ✅ | — | Ключ для авторизации клиентов |
| `PORT` | — | `3000` | Порт сервера |
| `DEFAULT_MODEL` | — | `big-pickle` | Модель если не указана в запросе |
| `ALLOWED_MODELS` | — | все | Список разрешённых моделей через запятую |
| `DEBUG` | — | `false` | Включить debug-логи (`DEBUG=true`) |
