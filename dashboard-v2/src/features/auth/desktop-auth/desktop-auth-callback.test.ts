import { describe, expect, it } from 'vitest'

import { buildInvalidDesktopAuthCallbackUrl } from './index'

describe('buildInvalidDesktopAuthCallbackUrl', () => {
  it('returns a controlled error callback when state can identify the desktop attempt', () => {
    expect(
      buildInvalidDesktopAuthCallbackUrl({
        client_id: 'bad-client',
        redirect_uri: 'synapse://auth/desktop/callback',
        response_type: 'code',
        state: 'state-1234567890',
      })
    ).toBe(
      'synapse://auth/desktop/callback?error=invalid_request&state=state-1234567890'
    )
  })

  it('does not build a callback without a usable state', () => {
    expect(buildInvalidDesktopAuthCallbackUrl({ state: 'short' })).toBeNull()
    expect(buildInvalidDesktopAuthCallbackUrl({})).toBeNull()
  })
})
