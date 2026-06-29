// @vitest-environment jsdom

import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { driveApi } from '@/lib/api'
import { DriveShareSettingsDialog, DriveSharesDialog } from './drive-share-dialogs'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  driveApi: {
    listShares: vi.fn(),
    disableShare: vi.fn(),
  },
}))

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('DriveShareSettingsDialog', () => {
  it('submits desktop-compatible share settings', async () => {
    const onConfirm = vi.fn(async () => undefined)
    render(<DriveShareSettingsDialog open itemName='notes.md' submitting={false} onOpenChange={() => undefined} onConfirm={onConfirm} />)

    await click(textButton('确定'))

    expect(onConfirm).toHaveBeenCalledWith({
      passwordEnabled: true,
      expiresIn: '3d',
      accessMode: 'link_read',
      editorEmails: [],
    })
  })
})

describe('DriveSharesDialog', () => {
  it('lists shares and cancels a share', async () => {
    vi.mocked(driveApi.listShares).mockResolvedValue({
      items: [{
        id: 'share-db-id',
        shareId: 'shr_1',
        itemId: 'item-1',
        itemName: 'notes.md',
        itemType: 'file',
        sourceDeleted: false,
        url: 'https://example.com/share/shr_1',
        urlWithPassword: 'https://example.com/share/shr_1?p=abc',
        passwordEnabled: true,
        password: 'abc',
        expiresAt: null,
        accessMode: 'link_read',
        editorEmails: [],
        createdAt: '2026-06-29T00:00:00.000Z',
      }],
      page: { offset: 0, limit: 20, hasMore: false, nextOffset: null },
    })
    vi.mocked(driveApi.disableShare).mockResolvedValue({ ok: true })
    render(<DriveSharesDialog open onOpenChange={() => undefined} onChanged={async () => undefined} />)
    await flush()

    expect(document.body.textContent).toContain('notes.md')
    await click(textButton('取消分享'))
    expect(driveApi.disableShare).toHaveBeenCalledWith('share-db-id')
  })
})

function render(element: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(element))
}

async function flush() {
  await act(async () => undefined)
}

function textButton(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes(text))
  if (!button) throw new Error(`missing button ${text}`)
  return button
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}
