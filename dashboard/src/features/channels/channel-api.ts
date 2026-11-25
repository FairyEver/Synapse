import type {
  ChannelKeyResources,
  ChannelPresenceMember,
  ChannelRetainedItem,
  ChannelRole,
} from '@synapse/shared/channel-contracts'
import { requestJson } from '@/lib/api-client'

const base = '/api/console/channels'

export type ChannelSummary = {
  id: string
  name: string
  description: string
  onlineCount: number
  tokenCount: number
  createdAt: string
  updatedAt: string
}

export type ChannelTokenItem = {
  id: string
  channelId: string
  name: string
  role: ChannelRole
  prefix: string
  lastUsedAt: string | null
  createdAt: string
}

export type ChannelConsoleState = {
  channelId: string
  latestSeq: number
  presence: ChannelPresenceMember[]
  retained: ChannelRetainedItem[]
}

export function buildChannelWsUrl(channelId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/api/open/v1/channels/${encodeURIComponent(channelId)}/ws`
}

export const channelApi = {
  list: (signal?: AbortSignal) =>
    requestJson<{ data: ChannelSummary[] }>(base, { signal }),
  get: (id: string, signal?: AbortSignal) =>
    requestJson<ChannelSummary>(`${base}/${encodeURIComponent(id)}`, { signal }),
  create: (body: { name: string; description: string }) =>
    requestJson<ChannelSummary>(base, { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: { name?: string; description?: string }) =>
    requestJson<ChannelSummary>(`${base}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string) =>
    requestJson<{ deleted: true }>(`${base}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listTokens: (id: string, signal?: AbortSignal) =>
    requestJson<{ data: ChannelTokenItem[] }>(`${base}/${encodeURIComponent(id)}/tokens`, { signal }),
  createToken: (id: string, body: { name: string; role: ChannelRole }) =>
    requestJson<{ token: ChannelTokenItem; secret: string }>(`${base}/${encodeURIComponent(id)}/tokens`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  revokeToken: (id: string, tokenId: string) =>
    requestJson<{ revoked: true }>(`${base}/${encodeURIComponent(id)}/tokens/${encodeURIComponent(tokenId)}`, {
      method: 'DELETE',
    }),
  issueDebugTicket: (id: string) =>
    requestJson<{ ticket: string; expiresAt: string }>(`${base}/${encodeURIComponent(id)}/debug-ticket`, {
      method: 'POST',
    }),
  getState: (id: string, signal?: AbortSignal) =>
    requestJson<ChannelConsoleState>(`${base}/${encodeURIComponent(id)}/state`, { signal }),
  clearRetained: (id: string, event: string) =>
    requestJson<{ deleted: boolean }>(`${base}/${encodeURIComponent(id)}/retained/${encodeURIComponent(event)}`, {
      method: 'DELETE',
    }),
  updateKeyResources: (apiKeyId: string, channelResources: ChannelKeyResources) =>
    requestJson(`/api/console/api-keys/${encodeURIComponent(apiKeyId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ channelResources }),
    }),
}
