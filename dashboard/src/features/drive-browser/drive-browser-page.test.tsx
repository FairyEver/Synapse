// @vitest-environment jsdom

import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DriveBrowserPage } from './drive-browser-page'
import { useDriveBrowser, type DriveBrowserState } from './use-drive-browser'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./use-drive-browser', () => ({
  useDriveBrowser: vi.fn(),
}))

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
  vi.clearAllMocks()
})

describe('DriveBrowserPage', () => {
  it('clears consumed initial share passwords when unlock falls back to the password form', () => {
    const onInitialPasswordConsumed = vi.fn()
    mockDriveBrowserState({
      status: 'passwordRequired',
      message: '请输入密码。',
      unlock: vi.fn(),
      unlocking: false,
      unlockError: null,
    })

    renderPage(
      <DriveBrowserPage
        context='share'
        shareId='share-1'
        initialPassword='old-password'
        onInitialPasswordConsumed={onInitialPasswordConsumed}
      />
    )

    expect(onInitialPasswordConsumed).toHaveBeenCalledTimes(1)
  })
})

function mockDriveBrowserState(state: DriveBrowserState) {
  vi.mocked(useDriveBrowser).mockReturnValue(state)
}

function renderPage(element: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root?.render(element)
  })
}
