import '../reader.css'
import '@/styles/globals.css'
import '@mdxeditor/editor/style.css'
import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type {
  DriveAnnotationThreadDto,
  DriveBrowserEditDto,
  DriveBrowserItemDto,
  DriveBrowserPreviewDto,
  DriveBrowserSnapshotDto,
} from '@synapse/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { driveAnnotationApi, driveMessageApi } from '@/lib/api'
import { DriveRendererShell } from './drive-renderer-shell'
import { createMarkdownRenderedTextModel } from './markdown-rendered-text'
import { DriveMDXeditorRenderer } from './mdxeditor-renderer'
import { DriveRendererToolbarProvider } from './drive-renderer-toolbar-context'
import { DriveMessagesSection } from '../drive-messages-section'

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

describe.each(editorCases)(
  '$name comment geometry in Chromium',
  (editorCase) => {
    it('uses native Range geometry and scrolls a distant comment anchor into view', async () => {
      const fixture = commentDocument()
      vi.spyOn(driveAnnotationApi, 'listOwner').mockResolvedValue([
        commentThread(fixture.targetRange),
      ])
      const screen = await render(
        <div className='h-96 min-h-0 overflow-hidden'>
          <QueryClientProvider
            client={
              new QueryClient({
                defaultOptions: {
                  queries: { retry: false },
                  mutations: { retry: false },
                },
              })
            }
          >
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
        </div>
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
        expect(initialTargetRect.top).toBeGreaterThan(
          initialScrollerRect.bottom
        )

        const commentButton = await waitForElement(
          'button[aria-label="查看评论：Target"]'
        )
        await userEvent.click(commentButton)
        await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0)
        await nextAnimationFrame()
        await expectElementAlignedToRange(overlay, targetRange)

        const scrolledTargetRect = firstVisibleRect(targetRange)
        const scrolledScrollerRect = scroller.getBoundingClientRect()
        expect(scrolledTargetRect.top).toBeGreaterThanOrEqual(
          scrolledScrollerRect.top
        )
        expect(scrolledTargetRect.bottom).toBeLessThanOrEqual(
          scrolledScrollerRect.bottom
        )
        expect(commentButton.getAttribute('aria-current')).toBe('true')
      } finally {
        await screen.unmount()
      }
    })
  }
)

type EditorProps = {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
  readonly edit: DriveBrowserEditDto
  readonly editContext: NonNullable<
    ComponentProps<typeof DriveMDXeditorRenderer>['editContext']
  >
  readonly annotationContext: NonNullable<
    ComponentProps<typeof DriveMDXeditorRenderer>['annotationContext']
  >
}

function commentDocument(): {
  readonly markdown: string
  readonly targetRange: { readonly start: number; readonly end: number }
} {
  const blocks = [
    'Heading',
    ...Array.from(
      { length: 40 },
      (_, index) => `Filler paragraph ${index + 1}.`
    ),
    'Target anchor paragraph.',
  ]
  const markdown = [`# ${blocks[0]}`, ...blocks.slice(1)].join('\n\n')
  const start = Array.from(blocks.slice(0, -1).join('')).length
  return {
    markdown,
    targetRange: { start, end: start + Array.from('Target').length },
  }
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
  return {
    canEdit: true,
    editorKind: 'text',
    currentVersionId: 'version-1',
    reason: null,
  }
}

function editContext(): NonNullable<
  ComponentProps<typeof DriveMDXeditorRenderer>['editContext']
> {
  return {
    reload: vi.fn(async () => ({}) as never),
    reloading: false,
    saveText: vi.fn(async () => ({}) as never),
    savingText: false,
  }
}

function commentThread(range: {
  readonly start: number
  readonly end: number
}): DriveAnnotationThreadDto {
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
        semantic: {
          blockId: 'target-block',
          start: 0,
          end: 6,
          headingPath: [],
        },
      },
      positionStatus: 'attached',
      quoteStatus: 'exact',
      resolvedSourceRange: range,
      resolvedRenderedRange: range,
      confidence: 1,
      lastResolvedVersionId: 'version-1',
    },
    author: { id: 'user-1', email: null, handle: 'author' },
    comments: [
      {
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
      },
    ],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    status: 'open',
    permissions: { canDelete: true, canChangeStatus: true },
  }
}

async function waitForElement(selector: string): Promise<HTMLElement> {
  await expect
    .poll(() => document.querySelector<HTMLElement>(selector))
    .not.toBeNull()
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
  const rect = Array.from(range.getClientRects()).find(
    (candidate) => candidate.width > 0 && candidate.height > 0
  )
  if (!rect)
    throw new Error('The browser did not produce a visible Range rectangle')
  return rect
}

async function expectElementAlignedToRange(
  element: HTMLElement,
  range: Range
): Promise<void> {
  await expect
    .poll(() => {
      const actual = element.getBoundingClientRect()
      const expected = firstVisibleRect(range)
      return Math.max(
        Math.abs(actual.top - expected.top),
        Math.abs(actual.left - expected.left),
        Math.abs(actual.width - expected.width),
        Math.abs(actual.height - expected.height)
      )
    })
    .toBeLessThan(1.5)
}

async function nextAnimationFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

describe('rendered Markdown comment geometry in Chromium', () => {
  it('keeps the message composer full-width and enables publishing after rich-text input on a narrow surface', async () => {
    const create = vi.fn(async () => ({ id: 'new-message' }))
    const messages = {
      messages: [], canPost: true, loading: false, refreshing: false, error: null, create,
    }
    const screen = await render(
      <div className='w-96 bg-surface p-4'>
        <DriveMessagesSection messages={messages as never} fieldVariant='secondary' />
      </div>
    )
    try {
      const composer = await waitForElement('[data-drive-message-editor]')
      const input = composer.querySelector('textarea')!
      const publish = () => [...composer.querySelectorAll('button')].find((button) => button.textContent === '发布留言')!
      expect(publish().disabled).toBe(true)
      expect(Math.abs(input.getBoundingClientRect().width - composer.clientWidth)).toBeLessThan(2)
      await userEvent.click(input)
      const editor = await waitForElement('[data-drive-message-editor] [contenteditable="true"]')
      await userEvent.type(editor, 'Visual acceptance draft')
      await expect.poll(() => publish().disabled).toBe(false)
      await userEvent.click(publish())
      expect(create).toHaveBeenCalledExactlyOnceWith('Visual acceptance draft')
      await waitForElement('[data-drive-message-editor] textarea')
      expect(create.mock.calls).toHaveLength(1)
    } finally {
      await screen.unmount()
    }
  })

  it('keeps the native scroll node and anchor geometry across image loading, split resizing and menus', async () => {
    const imageSource = (height: number) =>
      `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${height}"><rect width="640" height="${height}" fill="currentColor"/></svg>`)}`
    const html = `<h1 id="heading">Heading</h1><p>Before the image.</p><p><img src="${imageSource(1)}" alt="Delayed image"></p><p>Target anchor paragraph.</p>${Array.from({ length: 30 }, (_, index) => `<p>Filler paragraph ${index}.</p>`).join('')}`
    const fixture = document.createElement('div')
    fixture.innerHTML = html
    const start =
      createMarkdownRenderedTextModel(fixture).text.indexOf('Target')
    vi.spyOn(driveAnnotationApi, 'listOwner').mockResolvedValue([
      commentThread({ start, end: start + 6 }),
    ])
    vi.spyOn(driveMessageApi, 'list').mockResolvedValue({
      itemId: 'file',
      canPost: false,
      messages: [],
    })
    const snapshot: DriveBrowserSnapshotDto = {
      context: 'owner',
      surface: 'standalone',
      current: {
        ...current(),
        browserUrl: '/drive/items/file?surface=standalone',
      },
      breadcrumbs: [],
      children: [],
      canDownload: true,
      canZip: false,
      preview: {
        ...preview('Target anchor paragraph.'),
        html,
        outline: [{ id: 'heading', depth: 1, text: 'Heading', children: [] }],
      },
      edit: editable(),
      annotation: { canComment: true, reason: null },
    }
    const screen = await render(
      <div
        className='h-[600px] w-[1280px] min-h-0 overflow-hidden'
        data-reader-geometry-fixture
      >
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <DriveRendererShell
            snapshot={snapshot}
            annotationContext={{ context: 'owner', itemId: 'file' }}
          />
        </QueryClientProvider>
      </div>
    )
    try {
      const body = await waitForElement('[data-testid="markdown-body"]')
      const scroller = await waitForElement(
        '[data-testid="markdown-document-scroll"]'
      )
      const overlaySelector =
        '[data-drive-annotation-overlay-thread-id="thread-target"]'
      const overlay = await waitForElement(overlaySelector)
      await expectElementAlignedToRange(overlay, rangeForText(body, 'Target'))
      const outlinePanel = await waitForElement('[data-markdown-resizable-panel="outline"]')
      const commentsPanel = await waitForElement('[data-markdown-resizable-panel="comments"]')
      await expect.poll(() => Math.round(outlinePanel.getBoundingClientRect().width)).toBe(224)
      await expect.poll(() => Math.round(commentsPanel.getBoundingClientRect().width)).toBe(384)
      const colorPixel = (element: HTMLElement) => {
        const context = document.createElement('canvas').getContext('2d')!
        context.fillStyle = getComputedStyle(element).backgroundColor
        context.fillRect(0, 0, 1, 1)
        return [...context.getImageData(0, 0, 1, 1).data]
      }
      expect(colorPixel(scroller)).toEqual(colorPixel(body))
      const image = body.querySelector('img')!
      image.src = imageSource(180)
      await expect.poll(() => image.naturalHeight).toBe(180)
      await expectElementAlignedToRange(
        await waitForElement(overlaySelector),
        rangeForText(body, 'Target')
      )
      scroller.scrollTop = 80
      await expect.poll(() => scroller.scrollTop).toBe(80)
      await expectElementAlignedToRange(
        await waitForElement(overlaySelector),
        rangeForText(body, 'Target')
      )
      const separator = await waitForElement(
        '[data-markdown-resizable-divider]'
      )
      separator.focus()
      await userEvent.keyboard('{ArrowRight}')
      await expectElementAlignedToRange(
        await waitForElement(overlaySelector),
        rangeForText(body, 'Target')
      )
      await userEvent.click(
        await waitForElement('button[aria-label="查看评论：Target"]')
      )
      const replyComposer = await waitForElement('[data-markdown-comment-reply-composer]')
      const replyInput = replyComposer.querySelector('textarea')!
      expect(Math.abs(replyInput.getBoundingClientRect().width - replyComposer.clientWidth)).toBeLessThan(2)
      await expectElementAlignedToRange(
        await waitForElement(overlaySelector),
        rangeForText(body, 'Target')
      )
      await userEvent.click(
        await waitForElement('button[aria-label="更多操作"]')
      )
      await waitForElement('[role="menu"]')
      expect(scroller).toBe(
        document.querySelector('[data-testid="markdown-document-scroll"]')
      )
      expect(scroller.style.overflow).not.toBe('hidden')
      await expectElementAlignedToRange(
        await waitForElement(overlaySelector),
        rangeForText(body, 'Target')
      )
      await userEvent.keyboard('{Escape}')
      await userEvent.click(
        await waitForElement('[data-markdown-outline-id="heading"]')
      )
      await expect.poll(() => scroller.scrollTop).toBe(0)
      expect(
        document.querySelector('[data-testid="markdown-document-scroll"]')
      ).toBe(scroller)
    } finally {
      await screen.unmount()
    }
  })
})
