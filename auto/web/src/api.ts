import type { UiConfig, SchedulerSnapshot, OutputLine } from './types'

const BASE = ''

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
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

export function fetchWorkerOutput(): Promise<{ workers: Record<number, OutputLine[]> }> {
  return json<{ workers: Record<number, OutputLine[]> }>('/api/workers/output')
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
