// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { DriveRendererContent } from './drive-renderer-shell'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./milkdown-renderer', () => {
  throw new Error('Milkdown chunk failed')
})

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('DriveRendererContent Milkdown loading', () => {
  it('shows an explicit error state when the Milkdown module fails to load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    try {
      act(() => {
        root?.render(
          <DriveRendererContent
            snapshot={markdownSnapshot()}
            selected={{ id: 'milkdown', label: 'Milkdown', container: 'full' }}
          />
        )
      })
      await waitForSelector('[role="alert"]')

      expect(document.querySelector('[role="alert"]')?.textContent).toContain('无法加载编辑器')
      expect(document.querySelector('[data-drive-milkdown-renderer="true"]')).toBeNull()
    } finally {
      consoleError.mockRestore()
    }
  })
})

function markdownSnapshot(): DriveBrowserSnapshotDto {
  return {
    context: 'owner',
    surface: 'standalone',
    current: {
      id: 'file',
      name: 'file.md',
      type: 'file',
      size: '7',
      mimeType: 'text/markdown',
      updatedAt: '2026-09-09T00:00:00.000Z',
      previewKind: 'markdown',
      browserUrl: '/drive/items/file',
      downloadUrl: '/drive/items/file/download',
    },
    breadcrumbs: [],
    children: [],
    preview: {
      kind: 'markdown',
      text: '# Notes',
      html: '<h1>Notes</h1>',
      outline: [],
      truncated: false,
      imageUrl: null,
      visitUrl: null,
      relativeImages: [],
    },
    edit: null,
    annotation: null,
    canDownload: true,
    canZip: false,
  }
}

async function waitForSelector(selector: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
    if (document.querySelector(selector)) return
  }
  throw new Error(`element not found: ${selector}`)
}
