#!/bin/bash
# Примеры curl запросов к Zen API Service
#
# Перед запуском убедись что сервер запущен:
#   npx tsx src/index.ts
#
# Переменные (замени на свои значения):

BASE_URL="http://localhost:3000"
API_KEY="my-secret-key"

# ─────────────────────────────────────────
# АВТОРИЗАЦИЯ
# ─────────────────────────────────────────

# Без ключа → 401
echo "=== Без авторизации ==="
curl -s "$BASE_URL/v1/models" | jq .

# Неверный ключ → 401
echo "=== Неверный ключ ==="
curl -s "$BASE_URL/v1/models" \
  -H "Authorization: Bearer wrong-key" | jq .

# ─────────────────────────────────────────
# МОДЕЛИ
# ─────────────────────────────────────────

# Список всех доступных моделей
echo "=== Список моделей ==="
curl -s "$BASE_URL/v1/models" \
  -H "Authorization: Bearer $API_KEY" | jq .

# Только ID моделей
echo "=== Только ID ==="
curl -s "$BASE_URL/v1/models" \
  -H "Authorization: Bearer $API_KEY" | jq '.data[].id'

# ─────────────────────────────────────────
# CHAT COMPLETIONS — ОБЫЧНЫЙ РЕЖИМ
# ─────────────────────────────────────────

# Простой запрос с big-pickle
echo "=== Chat: big-pickle ==="
curl -s "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "big-pickle",
    "messages": [
      { "role": "user", "content": "Привет! Напиши одно предложение о себе." }
    ]
  }' | jq .

# Запрос с minimax
echo "=== Chat: minimax-m2.5-free ==="
curl -s "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "minimax-m2.5-free",
    "messages": [
      { "role": "user", "content": "2 + 2 = ?" }
    ]
  }' | jq .

# Запрос с gpt-5-nano
echo "=== Chat: gpt-5-nano ==="
curl -s "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5-nano",
    "messages": [
      { "role": "user", "content": "Скажи привет на трёх языках." }
    ]
  }' | jq .

# Без указания модели — используется DEFAULT_MODEL
echo "=== Chat: без модели (дефолт) ==="
curl -s "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "user", "content": "Ping" }
    ]
  }' | jq .

# Запрещённая модель → 400
echo "=== Chat: запрещённая модель ==="
curl -s "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [
      { "role": "user", "content": "test" }
    ]
  }' | jq .

# Мультиходовой диалог
echo "=== Chat: диалог ==="
curl -s "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "big-pickle",
    "messages": [
      { "role": "system", "content": "Ты помощник, который отвечает кратко." },
      { "role": "user", "content": "Как тебя зовут?" },
      { "role": "assistant", "content": "Я языковая модель." },
      { "role": "user", "content": "Сколько тебе лет?" }
    ]
  }' | jq .

# Только текст ответа
echo "=== Chat: только текст ==="
curl -s "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "big-pickle",
    "messages": [
      { "role": "user", "content": "Скажи: привет" }
    ]
  }' | jq -r '.choices[0].message.content'

# ─────────────────────────────────────────
# CHAT COMPLETIONS — STREAMING (SSE)
# ─────────────────────────────────────────

# Streaming ответ (сырые SSE чанки)
echo "=== Streaming: сырые чанки ==="
curl -s "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "big-pickle",
    "messages": [
      { "role": "user", "content": "Напиши короткое стихотворение." }
    ],
    "stream": true
  }'

echo ""

# Streaming — вывод только текста (jq парсит каждый чанк)
echo "=== Streaming: только текст ==="
curl -s "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "big-pickle",
    "messages": [
      { "role": "user", "content": "Считай от 1 до 5." }
    ],
    "stream": true
  }' | grep '^data: ' | grep -v '\[DONE\]' \
    | sed 's/^data: //' \
    | jq -r '.choices[0].delta.content // empty'

echo ""
