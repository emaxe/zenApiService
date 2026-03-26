# Примеры curl запросов

Перед запуском убедись что сервер работает:

```bash
npx tsx src/index.ts
```

Во всех примерах используются:
- `BASE_URL=http://localhost:3000`
- `API_KEY=my-secret-key` — значение `LOCAL_API_KEY` из твоего `.env`

---

## Авторизация

**Без ключа → 401:**
```bash
curl http://localhost:3000/v1/models
```

**Неверный ключ → 401:**
```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer wrong-key"
```

---

## GET /v1/models

**Список моделей:**
```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer my-secret-key"
```

```json
{
  "object": "list",
  "data": [
    { "id": "big-pickle", "object": "model", "owned_by": "opencode" },
    { "id": "minimax-m2.5-free", "object": "model", "owned_by": "opencode" },
    { "id": "gpt-5-nano", "object": "model", "owned_by": "opencode" }
  ]
}
```

**Только ID моделей (с jq):**
```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer my-secret-key" \
  | jq '.data[].id'
```

---

## POST /v1/chat/completions

### Простой запрос

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer my-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "big-pickle",
    "messages": [
      { "role": "user", "content": "Привет!" }
    ]
  }'
```

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Привет! Чем могу помочь?" },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 10, "completion_tokens": 8, "total_tokens": 18 }
}
```

**Вывести только текст ответа:**
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer my-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "big-pickle",
    "messages": [{ "role": "user", "content": "Привет!" }]
  }' \
  | jq -r '.choices[0].message.content'
```

---

### Выбор модели

**minimax-m2.5-free:**
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer my-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "minimax-m2.5-free",
    "messages": [{ "role": "user", "content": "2 + 2 = ?" }]
  }'
```

**gpt-5-nano:**
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer my-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5-nano",
    "messages": [{ "role": "user", "content": "Скажи привет" }]
  }'
```

**Без модели — используется `DEFAULT_MODEL`:**
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer my-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{ "role": "user", "content": "Ping" }]
  }'
```

---

### System prompt

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer my-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "big-pickle",
    "messages": [
      { "role": "system", "content": "Ты помощник, который отвечает только на русском языке и очень кратко." },
      { "role": "user", "content": "What is the capital of France?" }
    ]
  }'
```

---

### Мультиходовой диалог

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer my-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "big-pickle",
    "messages": [
      { "role": "user", "content": "Меня зовут Алексей." },
      { "role": "assistant", "content": "Приятно познакомиться, Алексей!" },
      { "role": "user", "content": "Как меня зовут?" }
    ]
  }'
```

---

### Streaming (SSE)

**Получить поток чанков:**
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer my-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "big-pickle",
    "messages": [{ "role": "user", "content": "Напиши короткое стихотворение." }],
    "stream": true
  }'
```

Ответ приходит в формате Server-Sent Events:
```
data: {"id":"chatcmpl-...","choices":[{"delta":{"content":"Среди"},"index":0}]}

data: {"id":"chatcmpl-...","choices":[{"delta":{"content":" листьев"},"index":0}]}

data: [DONE]
```

**Вывести только текст из потока (с jq):**
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer my-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "big-pickle",
    "messages": [{ "role": "user", "content": "Считай от 1 до 5." }],
    "stream": true
  }' \
  | grep '^data: ' \
  | grep -v '\[DONE\]' \
  | sed 's/^data: //' \
  | jq -r '.choices[0].delta.content // empty'
```

---

## Ошибки

**Запрещённая модель → 400:**
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer my-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{ "role": "user", "content": "test" }]
  }'
```

```json
{
  "error": {
    "message": "Model 'gpt-4' is not allowed. Allowed models: big-pickle, minimax-m2.5-free, gpt-5-nano",
    "type": "invalid_request_error",
    "code": "model_not_allowed"
  }
}
```

**Невалидный JSON → 400:**
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer my-secret-key" \
  -H "Content-Type: application/json" \
  -d 'not-a-json'
```

**Несуществующий эндпоинт → 404:**
```bash
curl http://localhost:3000/v1/unknown \
  -H "Authorization: Bearer my-secret-key"
```
