import { afterEach, describe, expect, it, vi } from 'vitest'
import { desktopUpdateApi } from './desktop-update-api'

describe('desktopUpdateApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requests a fresh update intent through the public endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        deepLink: 'synapse://update?token=fresh-token',
        expiresAt: '2026-07-21T12:00:00.000Z',
      }), { status: 200 })
    )

    await expect(desktopUpdateApi.issueIntent()).resolves.toEqual({
      deepLink: 'synapse://update?token=fresh-token',
      expiresAt: '2026-07-21T12:00:00.000Z',
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/desktop/update-intent', {
      credentials: 'omit',
      method: 'POST',
      headers: undefined,
    })
  })
})
