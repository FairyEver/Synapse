import type {
  StateSyncKeyResources,
  StateSyncMutationOp,
  StateSyncRole,
} from '@synapse/shared/state-sync-contracts'
import { requestJson } from '@/lib/api-client'

const base = '/api/console/state-sync'

export type StateSyncSpaceSummary = {
  id: string
  name: string
  description: string
  defaultDocTtlSeconds: number | null
  maxDocs: number
  docCount: number
  onlineCount: number
  tokenCount: number
  createdAt: string
  updatedAt: string
}

export type StateSyncTokenItem = {
  id: string
  spaceId: string
  name: string
  role: StateSyncRole
  prefix: string
  lastUsedAt: string | null
  createdAt: string
}

export type StateSyncDocSummary = {
  spaceId: string
  docId: string
  rev: number
  onlineCount: number
  ttlSeconds: number | null
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

export type StateSyncDocCreateResult = {
  spaceId: string
  docId: string
  rev: number
  expiresAt: string | null
  wsPath: string
}

export type StateSyncDocMutateResult = {
  rev: number
  changed: boolean
  expiresAt: string | null
}

export type StateSyncSdkManifestFile = {
  url: string
  latestUrl: string
  integrity?: string
  bytes?: number
}

export type StateSyncSdkManifestEntry = {
  name: string
  title: string
  manifestUrl: string
  latest: string
  major: string
  globalName: string
  docsUrl: string
  nodeDownloadCommand?: string
  files: {
    browserGlobal: StateSyncSdkManifestFile
    esm: StateSyncSdkManifestFile
    cjs: StateSyncSdkManifestFile
    types: StateSyncSdkManifestFile
  }
  versions: string[]
}

export type RootSdkManifest = {
  schemaVersion: number
  sdks?: {
    'state-sync'?: StateSyncSdkManifestEntry
  }
}

export function buildStateSyncWsUrl(spaceId: string, docId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/api/open/v1/state-sync/spaces/${encodeURIComponent(spaceId)}/docs/${encodeURIComponent(docId)}/ws`
}

export function formatTtlSeconds(seconds: number | null): string {
  if (seconds === null) return '永不过期'
  if (seconds % 86400 === 0) return `${seconds / 86400} 天`
  if (seconds >= 86400) {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    return hours > 0 ? `${days} 天 ${hours} 小时` : `${days} 天`
  }
  if (seconds % 3600 === 0) return `${seconds / 3600} 小时`
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`
  }
  if (seconds % 60 === 0) return `${seconds / 60} 分钟`
  return `${seconds} 秒`
}

export function formatExpiryCountdown(expiresAt: string | null, nowMs = Date.now()): string {
  if (!expiresAt) return '永不过期'
  const targetMs = Date.parse(expiresAt)
  if (Number.isNaN(targetMs)) return '-'
  const remainingSec = Math.floor((targetMs - nowMs) / 1000)
  if (remainingSec <= 0) return '已过期'
  const days = Math.floor(remainingSec / 86400)
  const hours = Math.floor((remainingSec % 86400) / 3600)
  const minutes = Math.floor((remainingSec % 3600) / 60)
  const seconds = remainingSec % 60
  if (days > 0) return `${days} 天 ${hours} 小时后过期`
  if (hours > 0) return `${hours} 小时 ${minutes} 分后过期`
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒后过期`
  return `${seconds} 秒后过期`
}

export const stateSyncApi = {
  listSpaces: (signal?: AbortSignal) =>
    requestJson<{ data: StateSyncSpaceSummary[] }>(`${base}/spaces`, { signal }),
  getSpace: (spaceId: string, signal?: AbortSignal) =>
    requestJson<StateSyncSpaceSummary>(`${base}/spaces/${encodeURIComponent(spaceId)}`, { signal }),
  createSpace: (body: {
    name: string
    description: string
    defaultDocTtlSeconds?: number | null
    maxDocs?: number
  }) =>
    requestJson<StateSyncSpaceSummary>(`${base}/spaces`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateSpace: (
    spaceId: string,
    body: {
      name?: string
      description?: string
      defaultDocTtlSeconds?: number | null
      maxDocs?: number
    },
  ) =>
    requestJson<StateSyncSpaceSummary>(`${base}/spaces/${encodeURIComponent(spaceId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteSpace: (spaceId: string) =>
    requestJson<{ deleted: true }>(`${base}/spaces/${encodeURIComponent(spaceId)}`, {
      method: 'DELETE',
    }),
  listTokens: (spaceId: string, signal?: AbortSignal) =>
    requestJson<{ data: StateSyncTokenItem[] }>(`${base}/spaces/${encodeURIComponent(spaceId)}/tokens`, { signal }),
  createToken: (spaceId: string, body: { name: string; role: StateSyncRole }) =>
    requestJson<{ token: StateSyncTokenItem; secret: string }>(
      `${base}/spaces/${encodeURIComponent(spaceId)}/tokens`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),
  revokeToken: (spaceId: string, tokenId: string) =>
    requestJson<{ revoked: true }>(
      `${base}/spaces/${encodeURIComponent(spaceId)}/tokens/${encodeURIComponent(tokenId)}`,
      { method: 'DELETE' },
    ),
  listDocs: (spaceId: string, options: { limit?: number; cursor?: string } = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (options.limit !== undefined) params.set('limit', String(options.limit))
    if (options.cursor) params.set('cursor', options.cursor)
    const suffix = params.toString() ? `?${params.toString()}` : ''
    return requestJson<{ data: StateSyncDocSummary[]; nextCursor: string | null }>(
      `${base}/spaces/${encodeURIComponent(spaceId)}/docs${suffix}`,
      { signal },
    )
  },
  createDoc: (
    spaceId: string,
    body: { docId?: string; initialData?: Record<string, unknown>; ttlSeconds?: number | null },
  ) =>
    requestJson<StateSyncDocCreateResult>(`${base}/spaces/${encodeURIComponent(spaceId)}/docs`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  mutateDoc: (
    spaceId: string,
    docId: string,
    body: { op: StateSyncMutationOp; path: string; value?: unknown; expectedRev?: number },
  ) =>
    requestJson<StateSyncDocMutateResult>(
      `${base}/spaces/${encodeURIComponent(spaceId)}/docs/${encodeURIComponent(docId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      },
    ),
  deleteDoc: (spaceId: string, docId: string) =>
    requestJson<{ deleted: true }>(
      `${base}/spaces/${encodeURIComponent(spaceId)}/docs/${encodeURIComponent(docId)}`,
      { method: 'DELETE' },
    ),
  issueDebugTicket: (spaceId: string, docId: string) =>
    requestJson<{ ticket: string; expiresAt: string }>(
      `${base}/spaces/${encodeURIComponent(spaceId)}/docs/${encodeURIComponent(docId)}/debug-ticket`,
      { method: 'POST' },
    ),
  updateKeyResources: (apiKeyId: string, stateSyncResources: StateSyncKeyResources) =>
    requestJson(`/api/console/api-keys/${encodeURIComponent(apiKeyId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ stateSyncResources }),
    }),
  getSdkManifest: async (signal?: AbortSignal): Promise<RootSdkManifest | null> => {
    try {
      const response = await fetch('/sdk/manifest.json', { signal, cache: 'no-store' })
      if (!response.ok) return null
      return (await response.json()) as RootSdkManifest
    } catch {
      return null
    }
  },
}
