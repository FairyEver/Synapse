import { afterEach, describe, expect, it, vi } from 'vitest'
import { trackedDriveBrowserApi } from './drive-telemetry-api'

const mocks = vi.hoisted(() => ({ load: vi.fn(), finish: vi.fn(), start: vi.fn() }))

vi.mock('@/lib/api', () => ({
  driveApi: {},
  driveAnnotationApi: {},
  driveMessageApi: {},
  driveFileVersionsApi: {},
  driveBrowserApi: { getConsoleRoot: mocks.load },
}))
vi.mock('./drive-telemetry', () => ({ startDriveOperation: mocks.start }))

describe('Drive browser request telemetry', () => {
  afterEach(() => vi.resetAllMocks())

  it('records successful requests', async () => {
    mocks.start.mockReturnValue(mocks.finish)
    mocks.load.mockResolvedValue({ itemId: 'item-1' })

    await expect(trackedDriveBrowserApi.getConsoleRoot()).resolves.toEqual({ itemId: 'item-1' })

    expect(mocks.finish).toHaveBeenCalledExactlyOnceWith('success')
  })

  it('records cancelled requests without treating navigation as failure', async () => {
    mocks.start.mockReturnValue(mocks.finish)
    const error = new DOMException('Aborted', 'AbortError')
    mocks.load.mockRejectedValue(error)

    await expect(trackedDriveBrowserApi.getConsoleRoot()).rejects.toBe(error)

    expect(mocks.finish).toHaveBeenCalledExactlyOnceWith('cancelled')
  })

  it('keeps reporting other request errors as failures', async () => {
    mocks.start.mockReturnValue(mocks.finish)
    const error = new Error('Request failed')
    mocks.load.mockRejectedValue(error)

    await expect(trackedDriveBrowserApi.getConsoleRoot()).rejects.toBe(error)

    expect(mocks.finish).toHaveBeenCalledExactlyOnceWith('failure')
  })
})
