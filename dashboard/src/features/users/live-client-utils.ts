import type { LiveClientChangedEvent, LiveClientRow } from '@/lib/api'

export type LiveClientSummary = {
  label: string
  onlineCount: number
  totalCount: number
  hasStale: boolean
}

export const liveClientStatusLabels: Record<LiveClientRow['status'], string> = {
  online: '在线',
  stale: '不稳定',
  offline: '离线',
}

export const liveClientStatusVariants: Record<
  LiveClientRow['status'],
  'default' | 'secondary' | 'outline'
> = {
  online: 'default',
  stale: 'secondary',
  offline: 'outline',
}

export function getLiveClientSummary(
  userId: string,
  clients: readonly LiveClientRow[]
): LiveClientSummary {
  const matchingClients = clients.filter((client) => client.userId === userId)
  const onlineCount = matchingClients.filter(
    (client) => client.status === 'online'
  ).length

  return {
    label: onlineCount === 0 ? '离线' : `${onlineCount} 台在线`,
    onlineCount,
    totalCount: matchingClients.length,
    hasStale: matchingClients.some((client) => client.status === 'stale'),
  }
}

export function upsertLiveClient(
  clients: readonly LiveClientRow[],
  event: LiveClientChangedEvent
): LiveClientRow[] {
  const nextClient = event.client
  if (!nextClient.userId) {
    return clients as LiveClientRow[]
  }

  const index = clients.findIndex(
    (client) =>
      client.userId === nextClient.userId &&
      client.clientInstanceId === nextClient.clientInstanceId
  )

  if (index === -1) {
    return [...clients, nextClient]
  }

  return clients.map((client, clientIndex) =>
    clientIndex === index ? nextClient : client
  )
}

export function upsertOwnLiveClient(
  clients: readonly LiveClientRow[],
  event: LiveClientChangedEvent
): LiveClientRow[] {
  const nextClient = event.client
  const index = clients.findIndex(
    (client) => client.clientInstanceId === nextClient.clientInstanceId
  )

  if (index === -1) {
    return [...clients, nextClient]
  }

  return clients.map((client, clientIndex) =>
    clientIndex === index ? nextClient : client
  )
}

export function mergeLiveClientSnapshot(
  clients: readonly LiveClientRow[],
  snapshot: readonly LiveClientRow[]
): LiveClientRow[] {
  const byClient = new Map<string, LiveClientRow>()

  for (const client of clients) {
    const key = getAdminLiveClientKey(client)
    if (key) {
      byClient.set(key, client)
    }
  }

  for (const client of snapshot) {
    const key = getAdminLiveClientKey(client)
    if (!key) continue

    const existing = byClient.get(key)
    if (
      !existing ||
      getLiveClientObservedAt(client) > getLiveClientObservedAt(existing)
    ) {
      byClient.set(key, client)
    }
  }

  return Array.from(byClient.values())
}

export function mergeOwnLiveClientSnapshot(
  clients: readonly LiveClientRow[],
  snapshot: readonly LiveClientRow[]
): LiveClientRow[] {
  const byClientInstance = new Map<string, LiveClientRow>()

  for (const client of clients) {
    byClientInstance.set(client.clientInstanceId, client)
  }

  for (const client of snapshot) {
    const existing = byClientInstance.get(client.clientInstanceId)
    if (!existing || getLiveClientObservedAt(client) > getLiveClientObservedAt(existing)) {
      byClientInstance.set(client.clientInstanceId, client)
    }
  }

  return Array.from(byClientInstance.values())
}

function getAdminLiveClientKey(client: LiveClientRow) {
  if (!client.userId) return null
  return `${client.userId}:${client.clientInstanceId}`
}

function getLiveClientObservedAt(client: LiveClientRow) {
  return Math.max(
    parseLiveClientTime(client.connectedAt),
    parseLiveClientTime(client.lastSeenAt),
    parseLiveClientTime(client.disconnectedAt)
  )
}

function parseLiveClientTime(value: string | null | undefined) {
  if (!value) return 0
  const time = Date.parse(value)
  return Number.isNaN(time) ? 0 : time
}
