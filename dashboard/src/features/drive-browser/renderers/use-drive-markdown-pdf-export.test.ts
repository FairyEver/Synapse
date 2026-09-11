// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { ApiError } from '@/lib/api'
import type { DriveAnnotationContext } from '../use-drive-annotations'
import { pdfFilename, useDriveMarkdownPdfExport } from './use-drive-markdown-pdf-export'

const mocks = vi.hoisted(() => ({
  exportOwnerPdf: vi.fn(),
  exportSharePdf: vi.fn(),
  finish: vi.fn(),
  loading: vi.fn(() => 'toast-id'),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../shared/drive-telemetry-api', () => ({
  trackedDriveBrowserApi: {
    exportOwnerPdf: mocks.exportOwnerPdf,
    exportSharePdf: mocks.exportSharePdf,
  },
}))

vi.mock('../shared/drive-telemetry', () => ({
  startDriveOperation: vi.fn(() => mocks.finish),
}))

vi.mock('sonner', () => ({
  toast: {
    loading: mocks.loading,
    success: mocks.success,
    warning: mocks.warning,
    error: mocks.error,
  },
}))

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  vi.clearAllMocks()
})

describe('useDriveMarkdownPdfExport', () => {
  it.each([
    ['文档.md', '文档.pdf'],
    ['report.bin', 'report.pdf'],
    ['.notes', '.notes.pdf'],
  ])('converts %s to %s', (name, expected) => {
    expect(pdfFilename(name)).toBe(expected)
  })

  it('disables export while local edits are unsaved', () => {
    const hook = renderExportHook({ hasUnsavedChanges: true })

    expect(hook().available).toBe(true)
    expect(hook().disabledReason).toBe('请先保存再导出')
    void hook().exportPdf()
    expect(mocks.exportOwnerPdf).not.toHaveBeenCalled()
  })

  it('prevents duplicate owner exports and reports image and diagram warnings', async () => {
    const pending = deferred({ imageWarnings: 2, diagramWarnings: 1 })
    mocks.exportOwnerPdf.mockReturnValueOnce(pending.promise)
    const hook = renderExportHook()

    const first = hook().exportPdf()
    const duplicate = hook().exportPdf()
    expect(mocks.exportOwnerPdf).toHaveBeenCalledOnce()
    expect(mocks.exportOwnerPdf).toHaveBeenCalledWith('file-1', '说明.pdf')
    pending.resolve()
    await act(async () => Promise.all([first, duplicate]))

    expect(mocks.finish).toHaveBeenCalledWith('success')
    expect(mocks.warning).toHaveBeenCalledWith('PDF 已导出，2 张图片未加载，1 个图表未渲染', { id: 'toast-id' })
  })

  it('routes a shared child export and presents an actionable service error', async () => {
    mocks.exportSharePdf.mockRejectedValueOnce(new ApiError('unavailable', 502))
    const hook = renderExportHook({
      snapshot: markdownSnapshot({ context: 'share' }),
      context: { context: 'share', shareId: 'share-1', itemId: 'file-1' },
    })

    await act(async () => hook().exportPdf())

    expect(mocks.exportSharePdf).toHaveBeenCalledWith('share-1', 'file-1', '说明.pdf')
    expect(mocks.finish).toHaveBeenCalledWith('failure')
    expect(mocks.error).toHaveBeenCalledWith('PDF 导出服务暂不可用，请稍后重试。', { id: 'toast-id' })
  })
})

function renderExportHook(input: {
  snapshot?: DriveBrowserSnapshotDto
  context?: DriveAnnotationContext
  hasUnsavedChanges?: boolean
} = {}) {
  let current: ReturnType<typeof useDriveMarkdownPdfExport> | undefined
  function Harness() {
    current = useDriveMarkdownPdfExport({
      snapshot: input.snapshot ?? markdownSnapshot(),
      context: input.context,
      hasUnsavedChanges: input.hasUnsavedChanges ?? false,
    })
    return null
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(createElement(Harness)))
  return () => {
    if (!current) throw new Error('PDF export hook did not render')
    return current
  }
}

function markdownSnapshot(input: Partial<DriveBrowserSnapshotDto> = {}): DriveBrowserSnapshotDto {
  return {
    context: 'owner',
    surface: 'standalone',
    current: {
      id: 'file-1',
      name: '说明.md',
      type: 'file',
      size: '18',
      mimeType: 'text/markdown',
      updatedAt: '2026-09-11T00:00:00.000Z',
      previewKind: 'markdown',
      browserUrl: '/drive/items/file-1',
      downloadUrl: '/drive/items/file-1/download',
    },
    breadcrumbs: [],
    children: [],
    preview: {
      kind: 'markdown',
      text: '# 说明',
      html: '<h1>说明</h1>',
      outline: [],
      truncated: false,
      imageUrl: null,
      visitUrl: null,
      relativeImages: [],
    },
    edit: { canEdit: true, editorKind: 'text', currentVersionId: 'version-1', reason: null },
    annotation: null,
    canDownload: true,
    canZip: false,
    ...input,
  }
}

function deferred<T>(value: T) {
  let resolve!: () => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = () => resolvePromise(value)
  })
  return { promise, resolve }
}
