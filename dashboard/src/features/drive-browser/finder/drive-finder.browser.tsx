import '@/styles/globals.css'
import '../reader.css'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { DriveFinder } from './drive-finder'

describe('independent shared folder browsing', () => {
  it('opens folders and files through the supplied share URLs and retains directory download', async () => {
    const onNavigate = vi.fn()
    const onLoadMoreChildren = vi.fn()
    const snapshot = sharedFolder()
    const screen = await render(
      <div className='h-96'>
        <DriveFinder
          snapshot={snapshot}
          mode='share'
          onNavigate={onNavigate}
          onLoadMoreChildren={onLoadMoreChildren}
        />
      </div>
    )
    try {
      const folderRow = document.querySelector<HTMLElement>(
        'tr[data-key="child-folder"]'
      )!
      await userEvent.click(folderRow)
      expect(onNavigate).toHaveBeenLastCalledWith(
        '/share/shared-folder/items/child-folder'
      )
      const fileRow = document.querySelector<HTMLElement>(
        'tr[data-key="child-file"]'
      )!
      fileRow.focus()
      await userEvent.keyboard('{Enter}')
      expect(onNavigate).toHaveBeenLastCalledWith(
        '/share/shared-folder/items/child-file'
      )
      const directoryDownload = [...document.querySelectorAll('a')].find(
        (link) => link.textContent?.includes('下载整个目录')
      )
      expect(directoryDownload?.getAttribute('href')).toBe(
        '/share/shared-folder/download'
      )
      expect(
        [...document.querySelectorAll('a')].some((link) =>
          link.href.includes('/console/drive')
        )
      ).toBe(false)
      const loadMore = [...document.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === '加载更多'
      )!
      await userEvent.click(loadMore)
      expect(onLoadMoreChildren).toHaveBeenCalledOnce()
    } finally {
      await screen.unmount()
    }
  })
})

function sharedFolder(): DriveBrowserSnapshotDto {
  const common = {
    size: '1024',
    mimeType: null,
    updatedAt: '2026-10-31T00:00:00Z',
    previewKind: 'download' as const,
    downloadUrl: null,
  }
  return {
    context: 'share',
    surface: 'standalone',
    current: {
      ...common,
      id: 'root',
      type: 'folder',
      name: 'Shared documents',
      browserUrl: '/share/shared-folder',
      downloadUrl: '/share/shared-folder/download',
    },
    breadcrumbs: [
      {
        id: 'root',
        name: 'Shared documents',
        browserUrl: '/share/shared-folder',
      },
    ],
    children: [
      {
        ...common,
        id: 'child-folder',
        type: 'folder',
        name: 'Documents',
        browserUrl: '/share/shared-folder/items/child-folder',
      },
      {
        ...common,
        id: 'child-file',
        type: 'file',
        name: 'Notes.md',
        previewKind: 'markdown',
        mimeType: 'text/markdown',
        browserUrl: '/share/shared-folder/items/child-file',
      },
    ],
    childrenPage: { offset: 0, limit: 2, nextOffset: 2, hasMore: true },
    preview: null,
    edit: null,
    annotation: null,
    canDownload: true,
    canZip: true,
  }
}
