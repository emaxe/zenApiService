export interface ProxyOptions {
  method: string
  body?: unknown
  headers?: Record<string, string>
}

export async function proxyRequest(
  upstreamUrl: string,
  upstreamApiKey: string,
  options: ProxyOptions
): Promise<Response> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${upstreamApiKey}`,
    'Content-Type': 'application/json',
    ...options.headers,
  }

  const fetchOptions: RequestInit = {
    method: options.method,
    headers,
  }

  if (options.body !== undefined) {
    fetchOptions.body = JSON.stringify(options.body)
  }

  return fetch(upstreamUrl, fetchOptions)
}
