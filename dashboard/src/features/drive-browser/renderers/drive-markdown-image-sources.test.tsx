// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DriveBrowserEditDto,
  DriveDocumentImageImportResult,
  DriveDocumentImageSource,
  DriveDocumentImageSourcesDto,
} from '@synapse/shared'
import { driveBrowserApi } from '@/lib/api'
import {
  useDriveMarkdownImageSources,
  type DriveMarkdownImageSourceContext,
} from './drive-markdown-image-sources'
import type { DriveRendererEditContext } from './drive-renderer-shell'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  document.body.innerHTML = ''
  root = null
  host = null
  vi.restoreAllMocks()
})

describe('useDriveMarkdownImageSources', () => {
  it('does not report image import failure after a successful import when preview reload fails', async () => {
    const reload = vi.fn(() => Promise.reject('reload failed'))
    vi.spyOn(driveBrowserApi, 'scanOwnerImageSources').mockResolvedValue(imageSources({
      canImport: true,
      sources: [
        imageSource({
          src: 'https://example.test/external.png',
          canImport: true,
          kind: 'external',
        }),
      ],
    }))
    vi.spyOn(driveBrowserApi, 'importOwnerImageSources').mockResolvedValue(imageImportResult())

    renderImageSources({ reload })

    await click(buttonWithText('图片来源'))
    await click(buttonWithText('转存全部'))
    await flushPromises()

    expect(reload).toHaveBeenCalled()
    expect(document.body.textContent).toContain('图片转存已完成，预览刷新失败，请手动刷新。')
    expect(document.body.textContent).not.toContain('图片转存失败。')
  })

  it('hides image sources for read-only share markdown', () => {
    const scanShareImageSources = vi.spyOn(driveBrowserApi, 'scanShareImageSources').mockResolvedValue(imageSources())

    renderImageSources({
      reload: vi.fn(),
      context: { context: 'share', shareId: 'share-1', itemId: 'item-1' },
      edit: editable({ canEdit: false, currentVersionId: null, reason: 'permission_denied' }),
    })

    expect(document.body.textContent).not.toContain('图片来源')
    expect(scanShareImageSources).not.toHaveBeenCalled()
  })
})

function renderImageSources({
  reload,
  context,
  edit,
}: {
  readonly reload: DriveRendererEditContext['reload']
  readonly context?: DriveMarkdownImageSourceContext
  readonly edit?: DriveBrowserEditDto | null
}) {
  act(() => {
    root?.render(<ImageSourcesHarness reload={reload} context={context} edit={edit} />)
  })
}

function ImageSourcesHarness({
  reload,
  context,
  edit,
}: {
  readonly reload: DriveRendererEditContext['reload']
  readonly context?: DriveMarkdownImageSourceContext
  readonly edit?: DriveBrowserEditDto | null
}) {
  const { toolbarItem, panel } = useDriveMarkdownImageSources({
    context: context ?? { context: 'owner', itemId: 'item-1' },
    edit: edit === undefined ? editable() : edit,
    editContext: {
      reload,
      reloading: false,
      saveText: vi.fn(),
      savingText: false,
    },
  })

  return (
    <>
      {toolbarItem?.kind === 'button' ? (
        <button type='button' disabled={toolbarItem.disabled} onClick={toolbarItem.onClick}>
          {toolbarItem.label}
        </button>
      ) : null}
      {panel}
    </>
  )
}

function editable(overrides: Partial<DriveBrowserEditDto> = {}): DriveBrowserEditDto {
  return {
    canEdit: true,
    editorKind: 'text',
    currentVersionId: 'version-1',
    maxInlineEditBytes: '1024',
    reason: null,
    ...overrides,
  }
}

function imageSources(overrides: Partial<DriveDocumentImageSourcesDto> = {}): DriveDocumentImageSourcesDto {
  const sources = overrides.sources ?? []
  return {
    itemId: 'item-1',
    versionId: 'version-1',
    canImport: false,
    sources,
    summary: {
      total: sources.length,
      ownerAsset: sources.filter((source) => source.kind === 'owner_asset').length,
      collaboratorAsset: sources.filter((source) => source.kind === 'collaborator_asset').length,
      external: sources.filter((source) => source.kind === 'external').length,
      invalid: sources.filter((source) => source.kind === 'invalid').length,
      unsupported: sources.filter((source) => source.kind === 'unsupported').length,
      importable: sources.filter((source) => source.canImport).length,
    },
    ...overrides,
  }
}

function imageSource(overrides: Partial<DriveDocumentImageSource> = {}): DriveDocumentImageSource {
  return {
    id: 'source-1',
    imageKey: 'source-1',
    src: 'https://example.test/image.png',
    kind: 'external',
    occurrenceCount: 1,
    canImport: true,
    status: 'ready',
    ...overrides,
  }
}

function imageImportResult(overrides: Partial<DriveDocumentImageImportResult> = {}): DriveDocumentImageImportResult {
  const result: DriveDocumentImageImportResult = {
    itemId: 'item-1',
    versionId: 'version-2',
    imported: [{
      previousSrc: 'https://example.test/external.png',
      nextSrc: 'https://synapse.test/files/asset',
      assetId: 'asset-1',
      size: '10',
    }],
    failed: [],
    summary: {
      importedCount: 1,
      failedCount: 0,
      replacedOccurrenceCount: 1,
    },
  }
  return {
    ...result,
    ...overrides,
    summary: {
      ...result.summary,
      ...overrides.summary,
    },
  }
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
  })
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve()
  })
}

function buttonWithText(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.trim() === text)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button ${text}`)
  return button
}
