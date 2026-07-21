// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpdateHandoffPage } from './page'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('UpdateHandoffPage', () => {
  it('loads without requesting a credential or exposing dashboard and download paths', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)

    renderPage()

    expect(document.querySelector('h1')?.textContent).toBe('更新 Synapse')
    expect(document.body.textContent).toContain('更新将关闭并重新启动 Synapse，请先结束正在进行的任务。')
    expect(buttonWithText('打开 Synapse 并更新').disabled).toBe(false)
    expect(document.body.textContent).toContain('设置 → 关于 Synapse')
    expect(document.querySelector('a[href*="download"]')).toBeNull()
    expect(document.querySelector('a[href^="synapse:"]')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('requests once while pending, opens the returned deep link, and offers a fresh attempt', async () => {
    const response = deferred<Response>()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(response.promise)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          deepLink: 'synapse://update?token=newer-token',
          expiresAt: '2026-07-21T12:01:00.000Z',
        }),
      } as Response)
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)

    renderPage()
    const updateButton = buttonWithText('打开 Synapse 并更新')

    act(() => {
      updateButton.click()
      updateButton.click()
    })

    expect(buttonWithText('正在申请更新凭证').disabled).toBe(true)
    expect(buttonWithText('正在申请更新凭证').getAttribute('aria-busy')).toBe('true')
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(fetchSpy).toHaveBeenCalledWith('/api/desktop/update-intent', expect.objectContaining({
      credentials: 'include',
      method: 'POST',
    }))

    await act(async () => {
      response.resolve({
        ok: true,
        json: async () => ({
          deepLink: 'synapse://update?token=fresh-token',
          expiresAt: '2026-07-21T12:00:00.000Z',
        }),
      } as Response)
      await response.promise
    })

    expect(openSpy).toHaveBeenCalledOnce()
    expect(openSpy).toHaveBeenCalledWith('synapse://update?token=fresh-token', '_self')
    expect(buttonWithText('再次打开 Synapse').disabled).toBe(false)

    await act(async () => {
      buttonWithText('再次打开 Synapse').click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(openSpy).toHaveBeenLastCalledWith('synapse://update?token=newer-token', '_self')
  })

  it('shows a necessary error and retries with a newly issued deep link', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          deepLink: 'synapse://update?token=retry-token',
          expiresAt: '2026-07-21T12:00:00.000Z',
        }),
      } as Response)
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)

    renderPage()
    await act(async () => {
      buttonWithText('打开 Synapse 并更新').click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('暂时无法打开 Synapse，请重试。')
    expect(document.body.textContent).toContain('设置 → 关于 Synapse')
    expect(buttonWithText('重试').disabled).toBe(false)
    expect(openSpy).not.toHaveBeenCalled()

    await act(async () => {
      buttonWithText('重试').click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(openSpy).toHaveBeenCalledWith('synapse://update?token=retry-token', '_self')
    expect(buttonWithText('再次打开 Synapse').disabled).toBe(false)
  })
})

function renderPage() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)

  act(() => {
    root?.render(<UpdateHandoffPage />)
  })
}

function buttonWithText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button'))
    .find((item) => item.textContent?.includes(text))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} button not found`)
  return button
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
