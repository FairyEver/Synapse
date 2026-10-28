// @vitest-environment jsdom
import { StrictMode, act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDriveBrowsingHistoryVisit } from './use-drive-browsing-history-visit'

const calls = vi.hoisted(() => ({ record: vi.fn(), track: vi.fn() }))
vi.mock('./shared/drive-telemetry-api', () => ({ trackedDriveBrowserApi: { recordShareVisit: calls.record } }))
vi.mock('./shared/drive-telemetry', () => ({ trackDriveEvent: calls.track }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers() })

type Input = Parameters<typeof useDriveBrowsingHistoryVisit>[0]
function View({ input }: { input: Input }) { useDriveBrowsingHistoryVisit(input); return null }
function render(input: Input, strict = false) {
  if (!host) host = document.createElement('div')
  if (!root) { document.body.append(host); root = createRoot(host) }
  act(() => root!.render(strict ? createElement(StrictMode, null, createElement(View, { input })) : createElement(View, { input })))
}

describe('browser share visits', () => {
  it('does not record failed, locked or owner views; records only after a share is ready', async () => {
    calls.record.mockResolvedValue({ ok: true })
    render({ context: 'owner', ready: true })
    render({ context: 'share', shareId: 'shr_a', ready: false })
    expect(calls.record).not.toHaveBeenCalled()
    render({ context: 'share', shareId: 'shr_a', ready: true })
    expect(calls.record).toHaveBeenCalledTimes(1)
    expect(calls.record.mock.calls[0]?.slice(0, 2)).toEqual(['shr_a', undefined])
    expect(calls.record.mock.calls[0]?.[2]).toMatchObject({ visitId: expect.stringMatching(/^[a-f0-9-]{36}$/u) })
  })

  it('keeps the same event across strict effects and metadata refreshes', async () => {
    calls.record.mockResolvedValue({ ok: true })
    render({ context: 'share', shareId: 'shr_a', itemId: 'one', ready: true, navigationKey: 1 }, true)
    const firstId = calls.record.mock.calls[0]?.[2].visitId
    expect(firstId).toBeTruthy()
    expect(calls.record.mock.calls.every(call => call[2].visitId === firstId)).toBe(true)
    const count = calls.record.mock.calls.length
    render({ context: 'share', shareId: 'shr_a', itemId: 'one', ready: true, navigationKey: 1 }, true)
    expect(calls.record).toHaveBeenCalledTimes(count)
  })

  it('creates independent events when returning to the same link or opening it again', () => {
    calls.record.mockResolvedValue({ ok: true })
    render({ context: 'share', shareId: 'shr_a', ready: true, navigationKey: 1 })
    render({ context: 'share', shareId: 'shr_b', ready: true, navigationKey: 2 })
    render({ context: 'share', shareId: 'shr_a', ready: true, navigationKey: 1 })
    render({ context: 'share', shareId: 'shr_a', ready: true, navigationKey: 3 })
    expect(new Set(calls.record.mock.calls.map(call => call[2].visitId)).size).toBe(4)
  })

  it('handles a recording failure separately from document reading without logging content', async () => {
    calls.record.mockRejectedValue(new Error('sensitive share details'))
    render({ context: 'share', shareId: 'shr_private', ready: true })
    await act(async () => { await Promise.resolve() })
    expect(calls.track).toHaveBeenCalledWith(expect.objectContaining({ category: 'error', outcome: 'failure' }))
    expect(JSON.stringify(calls.track.mock.calls)).not.toMatch(/shr_private|sensitive/u)
  })

  it('retries a failed report with the same event identity and stops after navigation', async () => {
    vi.useFakeTimers()
    calls.record.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true })
    render({ context: 'share', shareId: 'shr_a', ready: true })
    await act(async () => { await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(1_000); await Promise.resolve() })
    expect(calls.record).toHaveBeenCalledTimes(2)
    expect(calls.record.mock.calls[0]?.[2]).toEqual(calls.record.mock.calls[1]?.[2])
    calls.record.mockRejectedValueOnce(new Error('offline'))
    render({ context: 'share', shareId: 'shr_b', ready: true })
    await act(async () => { await Promise.resolve() })
    render({ context: 'owner', ready: true })
    await act(async () => { vi.advanceTimersByTime(1_000); await Promise.resolve() })
    expect(calls.record).toHaveBeenCalledTimes(3)
  })

  it('does not treat an embedded share frame as a top-level browsing visit', () => {
    vi.spyOn(window, 'self', 'get').mockReturnValue({} as Window & typeof globalThis)
    render({ context: 'share', shareId: 'shr_a', ready: true })
    expect(calls.record).not.toHaveBeenCalled()
  })

  it('records each persisted page restoration separately without counting ordinary pageshow', async () => {
    calls.record.mockResolvedValue({ ok: true })
    render({ context: 'share', shareId: 'shr_a', ready: true, navigationKey: 1 })
    await act(async () => { await Promise.resolve() })
    act(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })))
    expect(calls.record).toHaveBeenCalledTimes(1)
    await act(async () => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); await Promise.resolve() })
    await act(async () => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); await Promise.resolve() })
    expect(new Set(calls.record.mock.calls.map(call => call[2].visitId)).size).toBe(3)
  })
})
