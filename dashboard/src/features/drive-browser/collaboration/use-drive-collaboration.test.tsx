// @vitest-environment jsdom

import { StrictMode, act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDriveCollaboration } from './use-drive-collaboration'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount()
    })
  }
  host?.remove()
  root = null
  host = null
  vi.unstubAllGlobals()
})

describe('useDriveCollaboration', () => {
  it('creates a fresh live session after the StrictMode effect probe', async () => {
    const sockets: FakeWebSocket[] = []
    vi.stubGlobal('WebSocket', class extends FakeWebSocket {
      constructor(url: string | URL) {
        super(url)
        sockets.push(this)
      }
    })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    function Harness() {
      useDriveCollaboration({
        itemId: 'item-1',
        context: { kind: 'owner', itemId: 'item-1' },
        capability: {
          enabled: true,
          canRead: true,
          canWrite: true,
          epoch: 'epoch-1',
          checkpointVersionId: 'version-1',
          websocketPath: '/api/drive/collaboration',
          reason: null,
        },
      })
      return null
    }

    await act(async () => {
      root?.render(createElement(StrictMode, null, createElement(Harness)))
    })

    expect(sockets.length).toBeGreaterThan(0)
    expect(sockets.slice(0, -1).every((socket) => socket.closed)).toBe(true)
    expect(sockets.at(-1)?.closed).toBe(false)
  })
})

class FakeWebSocket {
  static readonly OPEN = 1

  readonly url: string
  closed = false
  readyState = 0
  binaryType: BinaryType = 'blob'

  constructor(url: string | URL) {
    this.url = String(url)
  }

  addEventListener(): void {}

  send(): void {}

  close(): void {
    this.closed = true
    this.readyState = 3
  }
}
