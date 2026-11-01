// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountSummary } from './app-shell'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('AccountSummary', () => {
  it('uses the nickname and renders the profile image', () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root?.render(
        <AccountSummary
          mode='user'
          user={{
            email: 'liyang@example.com',
            handle: 'liyang',
            nickname: '李杨',
            avatarUrl: '/api/avatars/system/avatar-1',
            sessionId: 'session-1',
          }}
        />,
      )
    })

    expect(host.textContent).toContain('李杨')
    expect(host.querySelector('.font-semibold')?.textContent).toBe('李杨')
    expect(host.textContent).toContain('liyang@example.com')
  })

  it('keeps the admin shell free of user identity data', () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root?.render(
        <AccountSummary
          mode='admin'
          user={{
            email: 'liyang@example.com',
            handle: 'liyang',
            nickname: '李杨',
            avatarUrl: '/api/avatars/system/avatar-1',
            sessionId: 'session-1',
          }}
        />,
      )
    })

    expect(host.textContent).toContain('平台管理员')
    expect(host.querySelector('img')).toBeNull()
  })
})
