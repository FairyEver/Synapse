import { describe, expect, it } from 'vitest'
import type { LiveClientChangedEvent, LiveClientRow } from '@/lib/api'
import {
  getLiveClientSummary,
  mergeLiveClientSnapshot,
  mergeOwnLiveClientSnapshot,
  upsertLiveClient,
  upsertOwnLiveClient,
} from './live-client-utils'

function client(
  userId: string | undefined,
  clientInstanceId: string,
  status: LiveClientRow['status']
): LiveClientRow {
  return {
    userId,
    clientInstanceId,
    status,
    appVersion: '0.2.253',
    platform: 'darwin-arm64',
    deviceName: 'MacBook',
    connectedAt: '2026-06-06T10:00:00.000Z',
    lastSeenAt: '2026-06-06T10:00:01.000Z',
  }
}

function event(clientRow: LiveClientRow): LiveClientChangedEvent {
  return {
    type: 'live.client.changed',
    client: clientRow,
    occurredAt: '2026-06-06T10:00:02.000Z',
  }
}

describe('live client utilities', () => {
  it('summarizes online clients for a user', () => {
    const summary = getLiveClientSummary('user-1', [
      client('user-1', 'client-a', 'online'),
      client('user-1', 'client-b', 'offline'),
      client('user-2', 'client-c', 'online'),
    ])

    expect(summary).toEqual({
      label: '1 台在线',
      onlineCount: 1,
      totalCount: 2,
      hasStale: false,
      isUnknown: false,
    })
  })

  it('uses offline label when no matching client is online', () => {
    const summary = getLiveClientSummary('user-1', [
      client('user-1', 'client-a', 'offline'),
    ])

    expect(summary.label).toBe('离线')
    expect(summary.onlineCount).toBe(0)
    expect(summary.totalCount).toBe(1)
  })

  it('uses unknown label when the live client snapshot is unavailable', () => {
    const summary = getLiveClientSummary('user-1', [], {
      isSnapshotUnavailable: true,
    })

    expect(summary.label).toBe('状态未知')
    expect(summary.onlineCount).toBe(0)
    expect(summary.totalCount).toBe(0)
    expect(summary.isUnknown).toBe(true)
  })

  it('marks stale clients in the summary', () => {
    const summary = getLiveClientSummary('user-1', [
      client('user-1', 'client-a', 'stale'),
    ])

    expect(summary.hasStale).toBe(true)
  })

  it('replaces existing clients by user and client instance', () => {
    const updated = upsertLiveClient(
      [
        client('user-1', 'client-a', 'online'),
        client('user-1', 'client-b', 'online'),
      ],
      event({
        ...client('user-1', 'client-a', 'offline'),
        disconnectedAt: '2026-06-06T10:02:00.000Z',
      })
    )

    expect(updated).toHaveLength(2)
    expect(updated.find((item) => item.clientInstanceId === 'client-a')).toMatchObject({
      status: 'offline',
      disconnectedAt: '2026-06-06T10:02:00.000Z',
    })
  })

  it('adds new clients with a user id', () => {
    const updated = upsertLiveClient(
      [client('user-1', 'client-a', 'online')],
      event(client('user-2', 'client-b', 'online'))
    )

    expect(updated.map((item) => item.clientInstanceId).sort()).toEqual([
      'client-a',
      'client-b',
    ])
  })

  it('ignores admin events without a user id', () => {
    const clients = [client('user-1', 'client-a', 'online')]

    expect(upsertLiveClient(clients, event(client(undefined, 'client-b', 'online')))).toBe(clients)
  })

  it('keeps newer admin client events when an older snapshot arrives', () => {
    const updated = mergeLiveClientSnapshot(
      [
        {
          ...client('user-1', 'client-a', 'online'),
          lastSeenAt: '2026-06-06T10:03:00.000Z',
        },
        {
          ...client('user-2', 'client-a', 'online'),
          lastSeenAt: '2026-06-06T10:04:00.000Z',
        },
      ],
      [
        {
          ...client('user-1', 'client-a', 'stale'),
          lastSeenAt: '2026-06-06T10:01:00.000Z',
        },
        client('user-3', 'client-c', 'online'),
      ]
    )

    expect(updated).toHaveLength(3)
    expect(
      updated.find(
        (item) =>
          item.userId === 'user-1' && item.clientInstanceId === 'client-a'
      )
    ).toMatchObject({
      status: 'online',
      lastSeenAt: '2026-06-06T10:03:00.000Z',
    })
    expect(
      updated.find(
        (item) =>
          item.userId === 'user-2' && item.clientInstanceId === 'client-a'
      )
    ).toMatchObject({
      status: 'online',
      lastSeenAt: '2026-06-06T10:04:00.000Z',
    })
    expect(
      updated.find(
        (item) =>
          item.userId === 'user-3' && item.clientInstanceId === 'client-c'
      )
    ).toMatchObject({ status: 'online' })
  })

  it('replaces own clients without requiring a user id', () => {
    const updated = upsertOwnLiveClient(
      [client(undefined, 'client-a', 'online')],
      event({
        ...client(undefined, 'client-a', 'stale'),
        lastSeenAt: '2026-06-06T10:03:00.000Z',
      })
    )

    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({
      clientInstanceId: 'client-a',
      status: 'stale',
      lastSeenAt: '2026-06-06T10:03:00.000Z',
    })
  })

  it('keeps newer own client events when an older snapshot arrives', () => {
    const updated = mergeOwnLiveClientSnapshot(
      [
        {
          ...client(undefined, 'client-a', 'online'),
          lastSeenAt: '2026-06-06T10:03:00.000Z',
        },
      ],
      [
        {
          ...client(undefined, 'client-a', 'stale'),
          lastSeenAt: '2026-06-06T10:01:00.000Z',
        },
      ]
    )

    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({
      clientInstanceId: 'client-a',
      status: 'online',
      lastSeenAt: '2026-06-06T10:03:00.000Z',
    })
  })

  it('uses newer own client snapshots', () => {
    const updated = mergeOwnLiveClientSnapshot(
      [
        {
          ...client(undefined, 'client-a', 'stale'),
          lastSeenAt: '2026-06-06T10:01:00.000Z',
        },
      ],
      [
        {
          ...client(undefined, 'client-a', 'online'),
          lastSeenAt: '2026-06-06T10:03:00.000Z',
        },
      ]
    )

    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({
      clientInstanceId: 'client-a',
      status: 'online',
      lastSeenAt: '2026-06-06T10:03:00.000Z',
    })
  })

  it('keeps current own client state when snapshot time ties', () => {
    const updated = mergeOwnLiveClientSnapshot(
      [
        {
          ...client(undefined, 'client-a', 'stale'),
          lastSeenAt: '2026-06-06T10:03:00.000Z',
        },
      ],
      [
        {
          ...client(undefined, 'client-a', 'online'),
          lastSeenAt: '2026-06-06T10:03:00.000Z',
        },
      ]
    )

    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({
      clientInstanceId: 'client-a',
      status: 'stale',
      lastSeenAt: '2026-06-06T10:03:00.000Z',
    })
  })
})
