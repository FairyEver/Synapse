// @vitest-environment jsdom

import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import {
  DriveDocumentEditorCommentsFrame,
  type DriveDocumentEditorCommentsController,
  type DriveDocumentEditorCommentsDataAttributes,
} from './drive-document-editor-comments'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const dataAttributes = {
  layout: 'data-test-editor-layout',
  scroll: 'data-test-editor-scroll',
  contentHost: 'data-test-editor-content',
  overlay: 'data-test-editor-overlay',
  overlayThreadId: 'data-test-editor-overlay-thread',
  bottomCompensation: 'data-test-editor-bottom-compensation',
  editorPanel: 'data-test-editor-panel',
  commentsPanel: 'data-test-editor-panel',
  sheet: 'data-test-editor-sheet',
} satisfies DriveDocumentEditorCommentsDataAttributes

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount()
      await Promise.resolve()
    })
  }
  host?.remove()
  root = null
  host = null
  vi.unstubAllGlobals()
})

it('keeps one editor mounted while responsive side panels move into sheets', async () => {
  vi.stubGlobal('ResizeObserver', class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal('IntersectionObserver', class IntersectionObserver {
    readonly root = null
    readonly rootMargin = '0px'
    readonly thresholds = [0]
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const editorContainerRef = createRef<HTMLDivElement>()
  const editorContentHostRef = createRef<HTMLDivElement>()

  const renderFrame = ({
    commentsOpen,
    compactCommentsOpen = false,
    isCompact,
  }: {
    readonly commentsOpen: boolean
    readonly compactCommentsOpen?: boolean
    readonly isCompact: boolean
  }) => {
    const comments = {
      activeThreadId: null,
      annotationsEnabled: true,
      commentBottomCompensation: 0,
      commentsOpen,
      compactCommentsOpen,
      editorContainerRef,
      editorContentHostRef,
      geometry: { overlayRects: [] },
      handleCommentsWheel: () => undefined,
      handleEditorScroll: () => undefined,
      isCompact,
      renderRailProps: {
        activeThreadId: null,
        canReply: false,
        loading: false,
        onDeleteComment: async () => undefined,
        onFocusThread: () => undefined,
        onReply: async () => undefined,
        onUpdateComment: async () => undefined,
        threads: [],
      },
      setCommentPanelOpen: () => undefined,
      sourceMode: true,
    } as unknown as DriveDocumentEditorCommentsController

    root?.render(
      <DriveDocumentEditorCommentsFrame
        comments={comments}
        dataAttributes={dataAttributes}
        editorView={<textarea aria-label='Document editor' defaultValue='Initial' />}
      />
    )
  }

  act(() => renderFrame({ commentsOpen: true, isCompact: false }))
  const editor = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Document editor"]')
  if (!editor) throw new Error('Missing document editor')
  await inputTextarea(editor, 'Unsaved draft')
  expect(panel('comments')).not.toBeNull()

  act(() => renderFrame({ commentsOpen: false, isCompact: false }))
  expect(document.querySelector('textarea[aria-label="Document editor"]')).toBe(editor)
  expect(editor.value).toBe('Unsaved draft')
  expect(panel('comments')).toBeNull()

  act(() => renderFrame({ commentsOpen: true, compactCommentsOpen: true, isCompact: true }))
  expect(document.querySelector('textarea[aria-label="Document editor"]')).toBe(editor)
  expect(editor.value).toBe('Unsaved draft')
  expect(sheet('comments')).not.toBeNull()

  act(() => renderFrame({ commentsOpen: true, isCompact: false }))
  expect(document.querySelector('textarea[aria-label="Document editor"]')).toBe(editor)
  expect(editor.value).toBe('Unsaved draft')
  expect(panel('comments')).not.toBeNull()
})

function panel(name: 'editor' | 'comments'): Element | null {
  return document.querySelector(`[data-test-editor-panel="${name}"]`)
}

function sheet(name: 'comments'): Element | null {
  return document.querySelector(`[data-test-editor-sheet="${name}"]`)
}

async function inputTextarea(editor: HTMLTextAreaElement, value: string): Promise<void> {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (!valueSetter) throw new Error('Missing textarea value setter')
  await act(async () => {
    editor.focus()
    valueSetter.call(editor, value)
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}
