// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { driveAnnotationApi } from '@/lib/api'
import { useDriveAnnotations } from './use-drive-annotations'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  driveAnnotationApi: {
    createOwner: vi.fn(),
    createShare: vi.fn(),
    deleteOwnerComment: vi.fn(),
    deleteOwnerThread: vi.fn(),
    deleteShareComment: vi.fn(),
    deleteShareThread: vi.fn(),
    listOwner: vi.fn(),
    listShare: vi.fn(),
    replyOwner: vi.fn(),
    replyShare: vi.fn(),
    updateOwnerComment: vi.fn(),
    updateShareComment: vi.fn(),
  },
}))

const mockedDriveAnnotationApi = vi.mocked(driveAnnotationApi)

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('useDriveAnnotations', () => {
  it('sends only the comment update body to the owner update endpoint', async () => {
    mockedDriveAnnotationApi.listOwner.mockResolvedValue([])
    mockedDriveAnnotationApi.updateOwnerComment.mockResolvedValue(comment())
    const { result } = renderDriveAnnotationsHook({ context: 'owner', itemId: 'item-1' })

    await act(async () => {
      await result.current.updateComment({ commentId: 'comment-1', body: 'Updated comment' })
    })

    expect(mockedDriveAnnotationApi.updateOwnerComment).toHaveBeenCalledWith(
      'item-1',
      'comment-1',
      { body: 'Updated comment' },
    )
  })

  it('sends only the reply body to the owner reply endpoint', async () => {
    mockedDriveAnnotationApi.listOwner.mockResolvedValue([])
    mockedDriveAnnotationApi.replyOwner.mockResolvedValue(comment({ id: 'reply-1', parentCommentId: 'comment-1' }))
    const { result } = renderDriveAnnotationsHook({ context: 'owner', itemId: 'item-1' })

    await act(async () => {
      await result.current.reply({
        threadId: 'thread-1',
        parentCommentId: 'comment-1',
        body: 'Reply body',
      })
    })

    expect(mockedDriveAnnotationApi.replyOwner).toHaveBeenCalledWith(
      'item-1',
      'thread-1',
      { parentCommentId: 'comment-1', body: 'Reply body' },
    )
  })
})

function renderDriveAnnotationsHook(input: Parameters<typeof useDriveAnnotations>[0]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const result: { current: ReturnType<typeof useDriveAnnotations> } = {
    current: null as unknown as ReturnType<typeof useDriveAnnotations>,
  }

  function Harness() {
    result.current = useDriveAnnotations(input)
    return null
  }

  act(() => {
    root?.render(createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(Harness)
    ))
  })

  return { result }
}

function comment(input: { readonly id?: string; readonly parentCommentId?: string | null } = {}) {
  return {
    id: input.id ?? 'comment-1',
    threadId: 'thread-1',
    parentCommentId: input.parentCommentId ?? null,
    body: 'Comment body',
    deleted: false,
    editedAt: null,
    createdAt: '2026-06-21T00:00:00.000Z',
    author: {
      id: 'user-1',
      displayName: '李杨',
      email: 'liyang@example.com',
    },
    permissions: {
      canDelete: true,
      canEdit: true,
    },
  }
}
