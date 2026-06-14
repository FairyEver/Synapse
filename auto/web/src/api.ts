import type { UiConfig, SchedulerSnapshot, OutputLine } from './types'

const BASE = ''
const CSRF_HEADER = 'x-auto-csrf-token'

let csrfTokenPromise: Promise<string> | null = null

function requestMethod(init?: RequestInit): string {
  return (init?.method ?? 'GET').toUpperCase()
}

function needsCsrfToken(init?: RequestInit): boolean {
  const method = requestMethod(init)
  return method !== 'GET' && method !== 'HEAD'
}

async function csrfToken(): Promise<string> {
  csrfTokenPromise ??= fetch(`${BASE}/api/csrf-token`)
    .then(async (res) => {
      if (!res.ok) throw new Error(res.statusText)
      const body = await res.json() as { token?: unknown }
      if (typeof body.token !== 'string' || body.token.length === 0) {
        throw new Error('CSRF token missing')
      }
      return body.token
    })
  return csrfTokenPromise
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (needsCsrfToken(init)) {
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }
    headers.set(CSRF_HEADER, await csrfToken())
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as Record<string, string>).error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export function fetchConfig(): Promise<UiConfig> {
  return json<UiConfig>('/api/config')
}

export function saveConfig(config: UiConfig): Promise<UiConfig> {
  return json<UiConfig>('/api/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  })
}

export function startScheduler(config: UiConfig): Promise<SchedulerSnapshot> {
  return json<SchedulerSnapshot>('/api/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  })
}

export function stopAfterCurrent(): Promise<SchedulerSnapshot> {
  return json<SchedulerSnapshot>('/api/stop-after-current', { method: 'POST' })
}

export function fetchGuide(): Promise<{ content: string }> {
  return json<{ content: string }>('/api/guide')
}

export function fetchWorkerOutput(): Promise<{ workers: Record<string, OutputLine[]> }> {
  return json<{ workers: Record<string, OutputLine[]> }>('/api/workers/output')
}

export function createPrompt(name: string): Promise<UiConfig> {
  return json<UiConfig>('/api/prompts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export function fetchPrompt(name: string): Promise<{ name: string; prompt: string }> {
  return json<{ name: string; prompt: string }>(`/api/prompts/${encodeURIComponent(name)}`)
}

export function renamePrompt(name: string, newName: string): Promise<UiConfig> {
  return json<UiConfig>(`/api/prompts/${encodeURIComponent(name)}/rename`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  })
}

export function deletePrompt(name: string): Promise<UiConfig> {
  return json<UiConfig>(`/api/prompts/${encodeURIComponent(name)}`, { method: 'DELETE' })
}
