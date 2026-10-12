// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DriveDiscussionLocationContext, useDriveDiscussionLocation } from './use-drive-discussion-location'
import { DriveMessagesSection } from './drive-messages-section'
import { DriveCommentsRail } from './drive-comments-rail'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | null = null; let host: HTMLElement | null = null
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = null; host = null; history.replaceState(null, '', '/'); vi.restoreAllMocks() })
function Provider({ children }: { children: ReactNode }) {
  const pending = useDriveDiscussionLocation('file')
  return <DriveDiscussionLocationContext value={pending}>{children}<p role='alert'>{pending.error}</p></DriveDiscussionLocationContext>
}
async function render(children: ReactNode) {
  if (!host) { host = document.createElement('div'); document.body.append(host); root = createRoot(host) }
  await act(async () => { root!.render(<Provider>{children}</Provider>); await new Promise((done) => setTimeout(done, 40)) })
  await act(async () => { await new Promise((done) => setTimeout(done, 40)) })
}
const author = { id: 'author', handle: 'author', email: null }
const permissions = { canEdit: false, canDelete: false }
const comment = (id: string, parentCommentId: string | null) => ({ id, messageId: 'm99', parentCommentId, body: id, author, permissions, createdAt: '2026-10-12T00:00:00Z' })
const messages = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, body: `body ${i}`, author, permissions, createdAt: '2026-10-12T00:00:00Z', comments: i === 99 ? [comment('one', null), comment('two', 'one'), comment('three', 'two')] : [] }))
it('focuses a deep reply in the 100th message once and ignores refetch', async () => {
  history.replaceState(null, '', '/drive/items/file#discussion=message&messageId=m99&commentId=three')
  const scroll = vi.fn(); Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: scroll, configurable: true })
  const data = { messages, canPost: false, loading: false, error: null }
  await render(<DriveMessagesSection messages={data as never} />)
  expect(document.activeElement?.getAttribute('data-drive-message-comment-id')).toBe('three')
  expect(scroll).toHaveBeenCalledTimes(1)
  const refetch = { ...data, messages: [...messages] }
  await render(<DriveMessagesSection messages={refetch as never} />)
  expect(scroll).toHaveBeenCalledTimes(1)
})
it('shows the deleted target after content loading and never focuses an unrelated reply', async () => {
  history.replaceState(null, '', '/drive/items/file#discussion=message&messageId=m99&commentId=gone')
  await render(<DriveMessagesSection messages={{ messages, loading: false, error: null, canPost: false } as never} />)
  expect(document.body.textContent).toContain('该回复已删除')
  expect(document.activeElement?.hasAttribute('data-drive-message-comment-id')).toBe(false)
})
it('opens an orphaned resolved comment without changing its status', async () => {
  history.replaceState(null, '', '/drive/items/file#discussion=annotation&threadId=t&commentId=c')
  const mutation = vi.fn()
  const thread = { id: 't', status: 'resolved', anchorStatus: 'orphaned', createdAt: '2026-10-12T00:00:00Z', targetKind: 'textRange', target: { kind: 'textRange', quote: { exact: 'Quote' } }, author, permissions: { canChangeStatus: false, canDelete: false }, comments: [{ ...comment('c', null), threadId: 't', deleted: false }] }
  await render(<DriveCommentsRail threads={[{ thread, placement: { status: 'unavailable' } }] as never} activeThreadId='t' canReply={false} onFocusThread={() => {}} onReply={mutation} onUpdateComment={mutation} onUpdateThreadStatus={mutation} onDeleteComment={mutation} />)
  expect(document.activeElement?.getAttribute('data-drive-annotation-comment-id')).toBe('c')
  expect(document.querySelector('[data-markdown-comments-unlocated-dialog]')).not.toBeNull()
  expect(mutation).not.toHaveBeenCalled()
})
it('does not treat an invalid fragment as a discussion', async () => {
  history.replaceState(null, '', '/drive/items/file#discussion=message&messageId=%22%5Dbody')
  await render(<DriveMessagesSection messages={{ messages, loading: false, error: null, canPost: false } as never} />)
  expect(document.querySelector('[role=alert]')?.textContent).toBe('')
  expect(document.activeElement?.hasAttribute('data-drive-message-comment-id')).toBe(false)
})
it('waits for current data instead of declaring a target absent from stale cache deleted', async () => {
  history.replaceState(null, '', '/drive/items/file#discussion=message&messageId=m99&commentId=three')
  await render(<DriveMessagesSection messages={{ messages: [], loading: false, refreshing: true, error: null, canPost: false } as never} />)
  expect(document.querySelector('[role=alert]')?.textContent).toBe('')
  await render(<DriveMessagesSection messages={{ messages, loading: false, refreshing: false, error: null, canPost: false } as never} />)
  expect(document.activeElement?.getAttribute('data-drive-message-comment-id')).toBe('three')
})
