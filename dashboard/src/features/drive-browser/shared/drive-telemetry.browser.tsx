import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { driveApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { DriveTelemetryBoundary } from './drive-telemetry-boundary'
import { trackedDriveApi } from './drive-telemetry-api'
import {
  flushDriveTelemetry,
  resetDriveTelemetryForTests,
  trackDriveEvent,
} from './drive-telemetry'

const sendClientTelemetryBatch = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({ sendClientTelemetryBatch }))

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  vi.useFakeTimers()
  sendClientTelemetryBatch.mockResolvedValue(undefined)
  resetDriveTelemetryForTests()
  useAuthStore.getState().auth.reset()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  host?.remove()
  root = null
  host = null
  resetDriveTelemetryForTests()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('Drive Web telemetry', () => {
  it('sends only the fixed Drive dimensions without a client-supplied user id', async () => {
    trackDriveEvent({
      eventKey: 'web.drive.item.open',
      component: 'drive-web',
      action: 'click',
    })
    flushDriveTelemetry()
    await settlePromises()

    expect(sendClientTelemetryBatch).toHaveBeenCalledTimes(1)
    const body = sendClientTelemetryBatch.mock.calls[0]?.[0] as { events: Array<Record<string, unknown>> }
    expect(body.events).toHaveLength(1)
    expect(body.events[0]).toMatchObject({
      eventKey: 'web.drive.item.open',
      component: 'drive-web',
      action: 'click',
      moduleId: 'drive',
      windowType: 'web-drive',
      platform: 'web',
    })
    expect(body.events[0]).not.toHaveProperty('userId')
    expect(body.events[0]).not.toHaveProperty('metadata')
  })

  it('isolates delivery failures without recursive sends', async () => {
    sendClientTelemetryBatch.mockRejectedValueOnce(new Error('offline'))

    expect(() => {
      trackDriveEvent({
        eventKey: 'web.drive.refresh',
        component: 'drive-web',
        action: 'click',
      })
      flushDriveTelemetry()
    }).not.toThrow()
    await settlePromises()

    expect(sendClientTelemetryBatch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(14_999)
    expect(sendClientTelemetryBatch).toHaveBeenCalledTimes(1)
  })

  it('does not downgrade an event to anonymous after the Web identity changes', async () => {
    useAuthStore.getState().auth.setUser({ email: 'user@example.com', handle: 'user', sessionId: 'session-1' })
    trackDriveEvent({
      eventKey: 'web.drive.item.open',
      component: 'drive-web',
      action: 'click',
    })
    useAuthStore.getState().auth.reset()

    flushDriveTelemetry()
    await settlePromises()

    expect(sendClientTelemetryBatch).not.toHaveBeenCalled()
  })

  it('falls back to in-memory identifiers when browser storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })

    expect(() => trackDriveEvent({
      eventKey: 'web.drive.item.open',
      component: 'drive-web',
      action: 'click',
    })).not.toThrow()
    flushDriveTelemetry()
    await settlePromises()

    const body = sendClientTelemetryBatch.mock.calls[0]?.[0] as { events: Array<Record<string, unknown>> }
    expect(body.events[0]?.clientInstanceId).toEqual(expect.any(String))
    expect(body.events[0]?.sessionId).toEqual(expect.any(String))
  })

  it('samples high-frequency events and keeps the final event', async () => {
    for (let index = 0; index < 5; index += 1) {
      trackDriveEvent({
        eventKey: 'web.drive.ui.scroll',
        component: 'drive-web',
        action: 'scroll',
      })
    }

    await vi.advanceTimersByTimeAsync(1_000)
    flushDriveTelemetry()
    await settlePromises()

    const body = sendClientTelemetryBatch.mock.calls[0]?.[0] as { events: unknown[] }
    expect(body.events).toHaveLength(1)
  })

  it('records Drive operations with outcomes and duration without changing their result', async () => {
    const usage = { usedBytes: '1', quotaBytes: '10' } as never
    vi.spyOn(driveApi, 'getUsage').mockResolvedValue(usage)

    await expect(trackedDriveApi.getUsage()).resolves.toBe(usage)
    flushDriveTelemetry()
    await settlePromises()

    const body = sendClientTelemetryBatch.mock.calls[0]?.[0] as { events: Array<Record<string, unknown>> }
    expect(body.events[0]).toMatchObject({
      eventKey: 'web.drive.operation.items.get-usage',
      category: 'operation',
      action: 'complete',
      outcome: 'success',
    })
    expect(body.events[0]?.durationMs).toEqual(expect.any(Number))
  })

  it('records a failed Drive operation and preserves the original rejection', async () => {
    const failure = new Error('usage unavailable')
    vi.spyOn(driveApi, 'getUsage').mockRejectedValue(failure)

    await expect(trackedDriveApi.getUsage()).rejects.toBe(failure)
    flushDriveTelemetry()
    await settlePromises()

    const body = sendClientTelemetryBatch.mock.calls[0]?.[0] as { events: Array<Record<string, unknown>> }
    expect(body.events[0]).toMatchObject({
      eventKey: 'web.drive.operation.items.get-usage',
      outcome: 'failure',
    })
  })

  it('keeps the business callback running when telemetry delivery fails', async () => {
    sendClientTelemetryBatch.mockRejectedValueOnce(new Error('ipc unavailable'))
    const callback = vi.fn()
    render(
      <DriveTelemetryBoundary scope='console'>
        <button data-drive-telemetry-event='web.drive.folder-create.open' onClick={callback}>新建</button>
      </DriveTelemetryBoundary>,
    )

    const button = host?.querySelector('button')
    expect(button).not.toBeNull()
    act(() => button?.click())
    flushDriveTelemetry()
    await settlePromises()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(sendClientTelemetryBatch).toHaveBeenCalledTimes(1)
  })

  it('isolates Beacon failures, preserves the event, and executes the business callback once', async () => {
    const sendBeacon = vi.fn(() => {
      throw new Error('beacon unavailable')
    })
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: sendBeacon })
    const callback = vi.fn()
    render(
      <DriveTelemetryBoundary scope='console'>
        <button data-drive-telemetry-event='web.drive.file-upload.choose' onClick={callback}>上传</button>
      </DriveTelemetryBoundary>,
    )

    const button = host?.querySelector('button')
    act(() => button?.click())
    expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(sendBeacon).toHaveBeenCalledTimes(1)

    flushDriveTelemetry()
    await settlePromises()
    expect(sendClientTelemetryBatch).toHaveBeenCalledTimes(1)
  })

  it('captures Drive dialog and menu interactions rendered through portals', async () => {
    render(<DriveTelemetryBoundary scope='console'><div /></DriveTelemetryBoundary>)
    const portal = document.createElement('div')
    portal.dataset.driveTelemetryScope = 'portal'
    const button = document.createElement('button')
    button.dataset.driveTelemetryEvent = 'web.drive.share.create'
    portal.append(button)
    document.body.append(portal)

    try {
      act(() => button.click())
      flushDriveTelemetry()
      await settlePromises()

      const body = sendClientTelemetryBatch.mock.calls[0]?.[0] as { events: Array<Record<string, unknown>> }
      expect(body.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ eventKey: 'web.drive.share.create', action: 'click' }),
      ]))
    } finally {
      portal.remove()
    }
  })
})

function render(element: React.ReactNode) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(element))
}

async function settlePromises() {
  await Promise.resolve()
  await Promise.resolve()
}
