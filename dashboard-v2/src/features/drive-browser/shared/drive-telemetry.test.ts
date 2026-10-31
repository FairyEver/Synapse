/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  flushDriveTelemetry,
  resetDriveTelemetryForTests,
  trackDriveEvent,
} from './drive-telemetry'

const sendClientTelemetryBatch = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({ sendClientTelemetryBatch }))
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({ auth: { user: null } }),
  },
}))

describe('Drive telemetry failure isolation', () => {
  beforeEach(() => {
    sendClientTelemetryBatch.mockResolvedValue(undefined)
    resetDriveTelemetryForTests()
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  afterEach(() => {
    resetDriveTelemetryForTests()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('keeps the business callback single-shot and retries after Beacon throws', async () => {
    const sendBeacon = vi.fn(() => {
      throw new Error('beacon unavailable')
    })
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: sendBeacon })
    const businessCallback = vi.fn(() => {
      trackDriveEvent({
        eventKey: 'web.drive.editor.save',
        component: 'drive-editor',
        action: 'submit',
      })
      return 'saved'
    })

    expect(businessCallback()).toBe('saved')
    expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow()
    expect(businessCallback).toHaveBeenCalledTimes(1)
    expect(sendBeacon).toHaveBeenCalledTimes(1)

    flushDriveTelemetry()
    await Promise.resolve()
    await Promise.resolve()
    expect(sendClientTelemetryBatch).toHaveBeenCalledTimes(1)
  })
})
