import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { UpdateHandoffPage } from './page'

describe('UpdateHandoffPage in Chromium', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('stays idle until keyboard confirmation, then exposes the attempted-open state', async () => {
    const response = deferred<Response>()
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(response.promise)
    const openMock = vi.spyOn(window, 'open').mockReturnValue(null)
    vi.stubGlobal('fetch', fetchMock)

    const screen = await render(<UpdateHandoffPage />)
    const updateButton = screen.getByRole('button', { name: '打开 Synapse 并更新' })

    await expect.element(screen.getByRole('heading', { name: '更新 Synapse' })).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(openMock).not.toHaveBeenCalled()
    expect(document.querySelector('a[href*="download"]')).toBeNull()
    expect(document.querySelector('a[href^="synapse:"]')).toBeNull()

    await userEvent.tab()
    await expect.element(updateButton).toHaveFocus()
    await userEvent.keyboard('{Enter}')

    const pendingButton = screen.getByRole('button', { name: '正在申请更新凭证' })
    await expect.element(pendingButton).toBeDisabled()
    await expect.element(pendingButton).toHaveAttribute('aria-busy', 'true')
    expect(fetchMock).toHaveBeenCalledOnce()

    response.resolve(jsonResponse({
      deepLink: 'synapse://update?token=browser-token',
      expiresAt: '2026-07-21T12:00:00.000Z',
    }))

    await expect.element(screen.getByRole('button', { name: '再次打开 Synapse' })).toHaveFocus()
    expect(openMock).toHaveBeenCalledWith('synapse://update?token=browser-token', '_self')
    expect(fetchMock.mock.calls.every(([input]) => !String(input).includes('/session'))).toBe(true)
    expect(window.location.href).not.toContain('browser-token')
    expect(window.localStorage.getItem('token')).toBeNull()
    expect(window.sessionStorage.getItem('token')).toBeNull()
    expect(document.body.textContent).not.toContain('browser-token')
  })

  it('keeps the manual path visible after failure and retries with a fresh credential', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(jsonResponse({
        deepLink: 'synapse://update?token=retry-browser-token',
        expiresAt: '2026-07-21T12:01:00.000Z',
      }))
    const openMock = vi.spyOn(window, 'open').mockReturnValue(null)
    vi.stubGlobal('fetch', fetchMock)

    const screen = await render(<UpdateHandoffPage />)
    await userEvent.click(screen.getByRole('button', { name: '打开 Synapse 并更新' }))

    await expect.element(screen.getByRole('alert')).toHaveTextContent('暂时无法打开 Synapse，请重试。')
    await expect.element(screen.getByText(/设置 → 关于 Synapse/)).toBeVisible()
    const retryButton = screen.getByRole('button', { name: '重试' })
    await expect.element(retryButton).toHaveFocus()

    await userEvent.click(retryButton)

    await expect.element(screen.getByRole('button', { name: '再次打开 Synapse' })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(openMock).toHaveBeenCalledWith('synapse://update?token=retry-browser-token', '_self')
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })
}
