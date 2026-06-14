import { describe, expect, it } from 'vitest'
import type { DashboardDeviceRow, LiveClientChangedEvent } from './api'
import {
  mergeDeviceSnapshot,
  sortDevicesByTableSorting,
  upsertDeviceLiveEvent,
} from './device-utils'

function device(
  userId: string | undefined,
  clientInstanceId: string,
  overrides: Partial<DashboardDeviceRow> = {}
): DashboardDeviceRow {
  return {
    userId,
    clientInstanceId,
    displayName: '工作电脑',
    deviceName: 'MacBook',
    platform: 'darwin-arm64',
    appVersion: '0.2.253',
    status: 'offline',
    connectedAt: null,
    firstSeenAt: '2026-06-06T09:00:00.000Z',
    lastSeenAt: '2026-06-06T10:00:00.000Z',
    ...overrides,
  }
}

function event(
  clientInstanceId: string,
  overrides: Partial<LiveClientChangedEvent['client']> = {}
): LiveClientChangedEvent {
  return {
    type: 'live.client.changed',
    occurredAt: '2026-06-06T10:05:00.000Z',
    client: {
      userId: 'user-1',
      clientInstanceId,
      status: 'online',
      appVersion: '0.2.254',
      platform: 'darwin-arm64',
      deviceName: 'MacBook Pro',
      connectedAt: '2026-06-06T10:05:00.000Z',
      lastSeenAt: '2026-06-06T10:05:00.000Z',
      ...overrides,
    },
  }
}

describe('device utilities', () => {
  it('updates a user device from live events while preserving display metadata', () => {
    const updated = upsertDeviceLiveEvent(
      [device(undefined, 'client-a')],
      event('client-a', { userId: undefined }),
      { scope: 'user' }
    )

    expect(updated).toEqual([
      expect.objectContaining({
        clientInstanceId: 'client-a',
        displayName: '工作电脑',
        deviceName: 'MacBook Pro',
        firstSeenAt: '2026-06-06T09:00:00.000Z',
        status: 'online',
        lastSeenAt: '2026-06-06T10:05:00.000Z',
      }),
    ])
  })

  it('ignores admin live events without user id', () => {
    const current = [device('user-1', 'client-a')]

    expect(upsertDeviceLiveEvent(
      current,
      event('client-b', { userId: undefined }),
      { scope: 'admin' }
    )).toBe(current)
  })

  it('keeps newer admin device state when an older snapshot arrives', () => {
    const updated = mergeDeviceSnapshot(
      [
        device('user-1', 'client-a', {
          status: 'online',
          lastSeenAt: '2026-06-06T10:05:00.000Z',
        }),
      ],
      [
        device('user-1', 'client-a', {
          status: 'offline',
          lastSeenAt: '2026-06-06T10:00:00.000Z',
        }),
        device('user-2', 'client-a'),
      ],
      { scope: 'admin' }
    )

    expect(updated).toHaveLength(2)
    expect(
      updated.find((item) => item.userId === 'user-1')
    ).toMatchObject({ status: 'online' })
    expect(
      updated.find((item) => item.userId === 'user-2')
    ).toMatchObject({ clientInstanceId: 'client-a' })
  })

  it('adds new user devices from live events', () => {
    const updated = upsertDeviceLiveEvent(
      [],
      event('client-a', { userId: undefined }),
      { scope: 'user' }
    )

    expect(updated).toEqual([
      expect.objectContaining({
        clientInstanceId: 'client-a',
        displayName: null,
        firstSeenAt: '2026-06-06T10:05:00.000Z',
        status: 'online',
      }),
    ])
  })

  it('adds new admin devices from live events', () => {
    const updated = upsertDeviceLiveEvent(
      [],
      event('client-a', { userId: 'user-1' }),
      { scope: 'admin' }
    )

    expect(updated).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        clientInstanceId: 'client-a',
        displayName: null,
        firstSeenAt: '2026-06-06T10:05:00.000Z',
        status: 'online',
      }),
    ])
  })

  it('keeps live-updated admin rows aligned with the active table sorting', () => {
    const current = [
      device('user-1', 'client-a', {
        deviceName: 'Alpha',
        platform: 'darwin-arm64',
        lastSeenAt: '2026-06-06T10:00:00.000Z',
      }),
      device('user-1', 'client-b', {
        deviceName: 'Beta',
        platform: 'win32-x64',
        lastSeenAt: '2026-06-06T09:00:00.000Z',
      }),
    ]

    const liveUpdated = upsertDeviceLiveEvent(
      current,
      event('client-b', {
        userId: 'user-1',
        platform: 'win32-x64',
        lastSeenAt: '2026-06-06T11:00:00.000Z',
      }),
      { scope: 'admin' }
    )
    const sorted = sortDevicesByTableSorting(liveUpdated, [{ id: 'platform', desc: false }])

    expect(liveUpdated.map((item) => item.clientInstanceId)).toEqual(['client-b', 'client-a'])
    expect(sorted.map((item) => item.clientInstanceId)).toEqual(['client-a', 'client-b'])
  })
})
