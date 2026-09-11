import '@/styles/index.css'
import '@mdxeditor/editor/style.css'
import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type {
  DriveAnnotationThreadDto,
  DriveBrowserEditDto,
  DriveBrowserItemDto,
  DriveBrowserPreviewDto,
} from '@synapse/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { driveAnnotationApi } from '@/lib/api'
import { DriveMDXeditorRenderer } from './mdxeditor-renderer'
import { DriveRendererToolbarProvider } from './drive-renderer-toolbar-context'

afterEach(() => {
  vi.restoreAllMocks()
})

const editorCases = [
  {
    name: 'MDXEditor',
    contentSelector: '.drive-mdxeditor-content',
    overlaySelector: '[data-drive-mdxeditor-comment-thread-id="thread-target"]',
    scrollSelector: '[data-drive-mdxeditor-scroll="true"]',
    render: (props: EditorProps) => <DriveMDXeditorRenderer {...props} />,
  },
] as const

describe.each(editorCases)('$name comment geometry in Chromium', (editorCase) => {
  it('uses native Range geometry and scrolls a distant comment anchor into view', async () => {
    const fixture = commentDocument()
    vi.spyOn(driveAnnotationApi, 'listOwner').mockResolvedValue([
      commentThread(fixture.targetRange),
    ])
    const screen = await render(
      <div className='h-96 min-h-0 overflow-hidden'>
        <QueryClientProvider client={new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })}>
          <DriveRendererToolbarProvider>
            {editorCase.render({
              current: current(),
              preview: preview(fixture.markdown),
              edit: editable(),
              editContext: editContext(),
              annotationContext: { context: 'owner', itemId: 'file' },
            })}
          </DriveRendererToolbarProvider>
        </QueryClientProvider>
      </div>,
    )

    try {
      const content = await waitForElement(editorCase.contentSelector)
      const scroller = await waitForElement(editorCase.scrollSelector)
      const overlay = await waitForElement(editorCase.overlaySelector)
      const targetRange = rangeForText(content, 'Target')
      await expectElementAlignedToRange(overlay, targetRange)
      const initialTargetRect = firstVisibleRect(targetRange)
      const initialScrollerRect = scroller.getBoundingClientRect()

      expect(initialTargetRect.width).toBeGreaterThan(0)
      expect(initialTargetRect.height).toBeGreaterThan(0)
      expect(initialTargetRect.top).toBeGreaterThan(initialScrollerRect.bottom)

      const commentButton = await waitForElement('button[aria-label="查看评论：Target"]')
      await userEvent.click(commentButton)
      await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0)
      await nextAnimationFrame()
      await expectElementAlignedToRange(overlay, targetRange)

      const scrolledTargetRect = firstVisibleRect(targetRange)
      const scrolledScrollerRect = scroller.getBoundingClientRect()
      expect(scrolledTargetRect.top).toBeGreaterThanOrEqual(scrolledScrollerRect.top)
      expect(scrolledTargetRect.bottom).toBeLessThanOrEqual(scrolledScrollerRect.bottom)
      expect(commentButton.getAttribute('aria-current')).toBe('true')
    } finally {
      await screen.unmount()
    }
  })
})

type EditorProps = {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
  readonly edit: DriveBrowserEditDto
  readonly editContext: NonNullable<ComponentProps<typeof DriveMDXeditorRenderer>['editContext']>
  readonly annotationContext: NonNullable<ComponentProps<typeof DriveMDXeditorRenderer>['annotationContext']>
}

function commentDocument(): {
  readonly markdown: string
  readonly targetRange: { readonly start: number; readonly end: number }
} {
  const blocks = [
    'Heading',
    ...Array.from({ length: 40 }, (_, index) => `Filler paragraph ${index + 1}.`),
    'Target anchor paragraph.',
  ]
  const markdown = [`# ${blocks[0]}`, ...blocks.slice(1)].join('\n\n')
  const start = Array.from(blocks.slice(0, -1).join('')).length
  return { markdown, targetRange: { start, end: start + Array.from('Target').length } }
}

function current(): DriveBrowserItemDto {
  return {
    id: 'file',
    name: 'notes.md',
    type: 'file',
    size: '1024',
    mimeType: 'text/markdown',
    updatedAt: '2026-09-08T00:00:00.000Z',
    previewKind: 'markdown',
    browserUrl: '/console/drive/items/file',
    downloadUrl: '/api/drive/items/file/content',
  }
}

function preview(text: string): DriveBrowserPreviewDto {
  return {
    kind: 'markdown',
    text,
    html: '<h1>Heading</h1>',
    outline: [],
    truncated: false,
    imageUrl: null,
    visitUrl: null,
    relativeImages: [],
  }
}

function editable(): DriveBrowserEditDto {
  return { canEdit: true, editorKind: 'text', currentVersionId: 'version-1', reason: null }
}

function editContext(): NonNullable<ComponentProps<typeof DriveMDXeditorRenderer>['editContext']> {
  return {
    reload: vi.fn(async () => ({} as never)),
    reloading: false,
    saveText: vi.fn(async () => ({} as never)),
    savingText: false,
  }
}

function commentThread(range: { readonly start: number; readonly end: number }): DriveAnnotationThreadDto {
  return {
    id: 'thread-target',
    itemId: 'file',
    baseVersionId: 'version-1',
    targetKind: 'textRange',
    target: {
      schemaVersion: 1,
      kind: 'textRange',
      surface: 'markdownRenderedText',
      range,
      quote: { exact: 'Target', prefix: '', suffix: '' },
    },
    anchorStatus: 'attached',
    anchor: {
      schemaVersion: 2,
      baseVersionId: 'version-1',
      selectors: {
        schemaVersion: 2,
        kind: 'textRange',
        position: range,
        quote: { exact: 'Target', prefix: '', suffix: '' },
        semantic: { blockId: 'target-block', start: 0, end: 6, headingPath: [] },
      },
      positionStatus: 'attached',
      quoteStatus: 'exact',
      resolvedSourceRange: range,
      resolvedRenderedRange: range,
      confidence: 1,
      lastResolvedVersionId: 'version-1',
    },
    author: { id: 'user-1', email: null, handle: 'author' },
    comments: [{
      id: 'comment-target',
      threadId: 'thread-target',
      parentCommentId: null,
      body: 'Target comment',
      author: { id: 'user-1', email: null, handle: 'author' },
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      editedAt: null,
      deletedAt: null,
      deleted: false,
      permissions: { canEdit: true, canDelete: true },
    }],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    permissions: { canDelete: true },
  }
}

async function waitForElement(selector: string): Promise<HTMLElement> {
  await expect.poll(() => document.querySelector<HTMLElement>(selector)).not.toBeNull()
  return document.querySelector<HTMLElement>(selector)!
}

function rangeForText(root: HTMLElement, value: string): Range {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const start = node.data.indexOf(value)
    if (start < 0) continue
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, start + value.length)
    return range
  }
  throw new Error(`Missing text: ${value}`)
}

function firstVisibleRect(range: Range): DOMRect {
  const rect = Array.from(range.getClientRects()).find((candidate) => candidate.width > 0 && candidate.height > 0)
  if (!rect) throw new Error('The browser did not produce a visible Range rectangle')
  return rect
}

async function expectElementAlignedToRange(element: HTMLElement, range: Range): Promise<void> {
  await expect.poll(() => {
    const actual = element.getBoundingClientRect()
    const expected = firstVisibleRect(range)
    return Math.max(
      Math.abs(actual.top - expected.top),
      Math.abs(actual.left - expected.left),
      Math.abs(actual.width - expected.width),
      Math.abs(actual.height - expected.height),
    )
  }).toBeLessThan(1.5)
}

async function nextAnimationFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}
