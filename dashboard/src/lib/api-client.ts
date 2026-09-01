export class ApiError extends Error {
  readonly code?: string
  readonly status: number

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function readErrorDetails(response: Response): Promise<{ readonly code?: string; readonly message: string }> {
  const fallback = response.statusText || '请求失败'

  try {
    const payload = (await response.json()) as { code?: unknown; message?: unknown }
    const code = typeof payload.code === 'string' ? payload.code : undefined

    if (typeof payload.message === 'string') {
      return { code, message: payload.message }
    }

    if (Array.isArray(payload.message)) {
      return {
        code,
        message: payload.message.filter((item) => typeof item === 'string').join('，') || fallback,
      }
    }
  } catch {
    return { message: fallback }
  }

  return { message: fallback }
}

export async function readErrorMessage(response: Response) {
  return (await readErrorDetails(response)).message
}

export async function requestJson<T>(path: string, options: RequestInit = {}) {
  const headers =
    options.body === undefined
      ? options.headers
      : {
          'Content-Type': 'application/json',
          ...options.headers,
        }

  const response = await fetch(path, {
    ...options,
    credentials: options.credentials ?? 'include',
    headers,
  })

  if (!response.ok) {
    const error = await readErrorDetails(response)
    throw new ApiError(error.message, response.status, error.code)
  }

  return (await response.json()) as T
}

export async function sendClientTelemetryBatch(body: unknown): Promise<void> {
  const response = await fetch('/api/client-telemetry/events', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  })

  if (!response.ok) {
    throw new ApiError('埋点发送失败。', response.status)
  }
}
