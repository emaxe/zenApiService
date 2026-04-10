import { randomUUID } from 'node:crypto'
import type {
  Part,
  TextPartInput,
  Provider,
} from '@opencode-ai/sdk'

/**
 * OpenAI content block (used in multi-part messages)
 */
export interface ContentBlock {
  type: string
  text?: string
  [key: string]: unknown
}

/**
 * OpenAI message format (incoming request).
 * `content` may be a plain string or an array of content blocks
 * (as sent by agents using the OpenAI vision / multi-part format).
 */
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentBlock[]
}

/**
 * Normalise a message's content to a plain string.
 * Array content blocks are concatenated by their `text` fields.
 */
export function extractContentText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content
  return content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('')
}

/**
 * Parse OpenAI messages[] into opencode SDK format.
 *
 * Since we use per-request sessions (no persistent context in opencode),
 * we need to include the FULL conversation history in the prompt.
 *
 * - system messages → concatenated into `system` parameter
 * - user + assistant messages → formatted as conversation history in a single TextPartInput
 */
export function messagesToParts(messages: OpenAIMessage[]): {
  parts: TextPartInput[]
  system: string | undefined
  /**
   * Text to strip from the beginning of the response if the model echoes it back.
   * Empty string means no echo-stripping (used for multi-turn conversations
   * where the full history prompt is never echoed).
   */
  echoText: string
} {
  const systemParts: string[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(extractContentText(msg.content))
    }
  }

  const hasHistory = messages.some(m => m.role === 'assistant')
  const lastUser = messages.filter(m => m.role === 'user').pop()
  const lastUserText = lastUser ? extractContentText(lastUser.content) : ''

  let promptText: string

  if (hasHistory) {
    // Build a conversation-style prompt so opencode understands the context.
    // echoText = '' because the model will never echo this long formatted wrapper.
    const formattedParts: string[] = []
    for (const msg of messages) {
      if (msg.role === 'system') continue
      const text = extractContentText(msg.content)
      if (msg.role === 'user') {
        formattedParts.push(`[User]: ${text}`)
      } else if (msg.role === 'assistant') {
        formattedParts.push(`[Assistant]: ${text}`)
      }
    }
    promptText = `Here is our conversation so far:\n\n${formattedParts.join('\n\n')}\n\nPlease continue the conversation by responding to the latest [User] message.`
  } else {
    // Single user message — send as-is
    promptText = lastUserText
  }

  return {
    parts: [{ type: 'text' as const, text: promptText }],
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    // For multi-turn, never strip echo (the history wrapper is never echoed back).
    // For single-turn, strip only if the model echoes the user message verbatim.
    echoText: hasHistory ? '' : lastUserText,
  }
}

/**
 * Parse model string in format "providerID/modelID" into separate parts.
 * Falls back to the raw string as modelID with empty providerID if no slash present.
 */
export function parseModelString(model: string): { providerID: string; modelID: string } {
  const slashIndex = model.indexOf('/')
  if (slashIndex === -1) {
    return { providerID: '', modelID: model }
  }
  return {
    providerID: model.slice(0, slashIndex),
    modelID: model.slice(slashIndex + 1),
  }
}

/**
 * Build an OpenAI-compatible SSE chunk from a text delta.
 */
export function buildSSEChunk(
  contentDelta: string,
  model: string,
  completionId: string,
  index: number = 0,
): string {
  const chunk = {
    id: completionId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index,
        delta: { content: contentDelta },
        finish_reason: null,
      },
    ],
  }
  return `data: ${JSON.stringify(chunk)}\n\n`
}

/**
 * Build the initial SSE chunk with assistant role.
 */
export function buildSSERoleChunk(
  model: string,
  completionId: string,
  index: number = 0,
): string {
  const chunk = {
    id: completionId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index,
        delta: { role: 'assistant' },
        finish_reason: null,
      },
    ],
  }
  return `data: ${JSON.stringify(chunk)}\n\n`
}

/**
 * Build the final SSE chunk with finish_reason = 'stop'.
 */
export function buildSSEStopChunk(
  model: string,
  completionId: string,
  finishReason: 'stop' | 'length' | 'content_filter' | 'tool_calls' = 'stop',
): string {
  const chunk = {
    id: completionId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: finishReason,
      },
    ],
  }
  return `data: ${JSON.stringify(chunk)}\n\n`
}

/**
 * Build a non-streaming OpenAI-compatible response.
 */
export function buildChatResponse(
  content: string,
  model: string,
  completionId: string,
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
  finishReason: 'stop' | 'length' | 'content_filter' | 'tool_calls' = 'stop',
): object {
  return {
    id: completionId,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: finishReason,
      },
    ],
    usage: usage ?? {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  }
}

/**
 * Build an OpenAI-compatible models list from opencode providers.
 */
export function providersToModels(
  providers: Provider[],
): Array<{ id: string; object: string; created: number; owned_by: string }> {
  const models: Array<{ id: string; object: string; created: number; owned_by: string }> = []

  for (const provider of providers) {
    for (const [modelId, _model] of Object.entries(provider.models)) {
      models.push({
        id: `${provider.id}/${modelId}`,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: provider.name || provider.id,
      })
    }
  }

  return models
}

/**
 * Extract text delta from a Part update (for streaming).
 * Returns the delta string if it's a text part, otherwise null.
 */
export function extractTextDelta(
  part: Part,
  delta: string | undefined,
  partTextMap: Map<string, string>,
): string | null {
  if (part.type !== 'text') return null

  // Prefer explicit delta if provided
  if (delta) {
    const prevText = partTextMap.get(part.id) ?? ''
    partTextMap.set(part.id, prevText + delta)
    return delta
  }

  // Fall back to computing delta from full text
  const prevText = partTextMap.get(part.id) ?? ''
  const newText = part.text
  if (newText.length > prevText.length) {
    partTextMap.set(part.id, newText)
    return newText.slice(prevText.length)
  }
  return null
}

/**
 * Generate a unique completion ID in OpenAI format.
 */
export function generateCompletionId(): string {
  return `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 24)}`
}
