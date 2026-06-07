import type { DashboardDeviceRow, LiveClientChangedEvent } from './api'

export const deviceStatusLabels: Record<DashboardDeviceRow['status'], string> = {
  online: '在线',
  stale: '不稳定',
  offline: '离线',
}

export const deviceStatusVariants: Record<
  DashboardDeviceRow['status'],
  'default' | 'secondary' | 'outline'
> = {
  online: 'default',
  stale: 'secondary',
  offline: 'outline',
}

type DeviceScope = {
  scope: 'admin' | 'user'
}

export function upsertDeviceLiveEvent(
  devices: readonly DashboardDeviceRow[],
  event: LiveClientChangedEvent,
  options: DeviceScope
): DashboardDeviceRow[] {
  const eventKey = getLiveEventKey(event, options)
  if (!eventKey) return devices as DashboardDeviceRow[]

  const index = devices.findIndex((device) => getDeviceKey(device, options) === eventKey)
  if (index === -1) {
    return sortDevicesByObservedAt([
      ...devices,
      deviceFromLiveEvent(event, options),
    ])
  }

  return sortDevicesByObservedAt(
    devices.map((device, deviceIndex) =>
      deviceIndex === index ? mergeDeviceWithLiveEvent(device, event) : device
    )
  )
}

export function mergeDeviceSnapshot(
  devices: readonly DashboardDeviceRow[],
  snapshot: readonly DashboardDeviceRow[],
  options: DeviceScope
): DashboardDeviceRow[] {
  const byDevice = new Map<string, DashboardDeviceRow>()

  for (const device of devices) {
    const key = getDeviceKey(device, options)
    if (key) byDevice.set(key, device)
  }

  for (const device of snapshot) {
    const key = getDeviceKey(device, options)
    if (!key) continue

    const existing = byDevice.get(key)
    if (!existing || getDeviceObservedAt(device) > getDeviceObservedAt(existing)) {
      byDevice.set(key, device)
    }
  }

  return sortDevicesByObservedAt(Array.from(byDevice.values()))
}

export function getDeviceObservedAt(device: DashboardDeviceRow) {
  return Math.max(
    parseDeviceTime(device.connectedAt),
    parseDeviceTime(device.lastSeenAt),
    parseDeviceTime(device.disconnectedAt),
    parseDeviceTime(device.firstSeenAt)
  )
}

function mergeDeviceWithLiveEvent(
  device: DashboardDeviceRow,
  event: LiveClientChangedEvent
): DashboardDeviceRow {
  const client = event.client
  return {
    ...device,
    deviceName: client.deviceName,
    platform: client.platform,
    appVersion: client.appVersion,
    status: client.status,
    connectedAt: client.connectedAt,
    lastSeenAt: client.lastSeenAt,
    disconnectedAt: client.disconnectedAt,
    disconnectReason: client.disconnectReason,
  }
}

function deviceFromLiveEvent(
  event: LiveClientChangedEvent,
  options: DeviceScope
): DashboardDeviceRow {
  const client = event.client
  const firstSeenAt =
    client.connectedAt ?? client.lastSeenAt ?? event.occurredAt
  return {
    ...(options.scope === 'admin' ? { userId: client.userId } : undefined),
    clientInstanceId: client.clientInstanceId,
    displayName: null,
    deviceName: client.deviceName,
    platform: client.platform,
    appVersion: client.appVersion,
    status: client.status,
    connectedAt: client.connectedAt,
    firstSeenAt,
    lastSeenAt: client.lastSeenAt,
    disconnectedAt: client.disconnectedAt,
    disconnectReason: client.disconnectReason,
  }
}

function sortDevicesByObservedAt(devices: DashboardDeviceRow[]) {
  return devices.toSorted((left, right) => getDeviceObservedAt(right) - getDeviceObservedAt(left))
}

function getLiveEventKey(event: LiveClientChangedEvent, options: DeviceScope) {
  const client = event.client
  if (options.scope === 'admin') {
    if (!client.userId) return null
    return `${client.userId}:${client.clientInstanceId}`
  }
  return client.clientInstanceId
}

function getDeviceKey(device: DashboardDeviceRow, options: DeviceScope) {
  if (options.scope === 'admin') {
    if (!device.userId) return null
    return `${device.userId}:${device.clientInstanceId}`
  }
  return device.clientInstanceId
}

function parseDeviceTime(value: string | null | undefined) {
  if (!value) return 0
  const time = Date.parse(value)
  return Number.isNaN(time) ? 0 : time
}
