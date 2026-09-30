import { useMemo, useState, type ReactNode, type Ref } from 'react'
import type { DriveMessageCommentDto, DriveMessageDto } from '@synapse/shared'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { startDriveOperation } from './shared/drive-telemetry'
import type { useDriveMessages } from './use-drive-messages'

type Messages = ReturnType<typeof useDriveMessages>
type Editor =
  | { readonly kind: 'message'; readonly id: string; readonly value: string }
  | { readonly kind: 'comment'; readonly id: string; readonly value: string }
  | { readonly kind: 'reply'; readonly messageId: string; readonly parentCommentId: string | null; readonly value: string }

export function DriveMessagesSection({ messages, sectionRef }: { readonly messages: Messages; readonly sectionRef?: Ref<HTMLElement> }) {
  const [draft, setDraft] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const value = editor?.value ?? draft
    if (!value.trim() || busy) return
    const finish = startDriveOperation(
      !editor ? 'web.drive.message.create'
        : editor.kind === 'message' ? 'web.drive.message.update'
          : editor.kind === 'comment' ? 'web.drive.message.update-comment'
            : 'web.drive.message.reply',
      'drive-messages',
    )
    setBusy(true)
    setError(null)
    try {
      if (!editor) {
        const created = await messages.create(value)
        setDraft('')
        requestAnimationFrame(() => document.querySelector(`[data-drive-message-id="${created.id}"]`)?.scrollIntoView({ block: 'nearest' }))
      } else if (editor.kind === 'message') {
        await messages.update({ messageId: editor.id, body: value })
        setEditor(null)
      } else if (editor.kind === 'comment') {
        await messages.updateComment({ commentId: editor.id, body: value })
        setEditor(null)
      } else {
        await messages.reply({ messageId: editor.messageId, parentCommentId: editor.parentCommentId, body: value })
        setEditor(null)
      }
      finish('success')
    } catch (cause) {
      finish('failure')
      setError(cause instanceof Error ? cause.message : '提交失败。')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (kind: 'message' | 'comment', id: string) => {
    const key = `${kind}:${id}`
    if (pendingDelete !== key) {
      setPendingDelete(key)
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (kind === 'message') await messages.delete(id)
      else await messages.deleteComment(id)
      setPendingDelete(null)
      setEditor(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败。')
    } finally {
      setBusy(false)
    }
  }

  const renderEditor = (value: string, setValue: (value: string) => void, label: string, cancel?: () => void) => (
    <div className='space-y-2'>
      <Textarea aria-label={label} value={value} maxLength={4000} onChange={(event) => setValue(event.target.value)} />
      <div className='flex items-center gap-2'>
        <Button type='button' disabled={busy || !value.trim()} onClick={() => { void submit() }}>{editor?.kind === 'reply' ? '回复' : cancel ? '保存' : '发布留言'}</Button>
        {cancel ? <Button type='button' variant='ghost' disabled={busy} onClick={cancel}>取消</Button> : null}
      </div>
    </div>
  )

  return (
    <section ref={sectionRef} tabIndex={-1} aria-labelledby='drive-messages-heading' className='mx-auto w-full max-w-3xl py-6 outline-none' data-drive-messages-section>
      <h2 id='drive-messages-heading' className='mb-4 text-lg font-semibold'>留言</h2>
      {messages.loading ? <p className='text-sm text-muted-foreground'>加载中</p> : null}
      {messages.error ? <p role='alert' className='text-sm text-destructive'>{messages.error}</p> : null}
      {!messages.loading && messages.messages.length === 0 ? <p className='mb-4 text-sm text-muted-foreground'>暂无留言</p> : null}
      <div className='space-y-6'>
        {messages.messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            canPost={messages.canPost}
            editor={editor}
            pendingDelete={pendingDelete}
            busy={busy}
            onEdit={(next) => { setEditor(next); setError(null) }}
            onDelete={remove}
            renderEditor={renderEditor}
          />
        ))}
      </div>
      {messages.canPost && !editor ? (
        <div className='mt-6'>
          {renderEditor(draft, setDraft, '新建留言')}
        </div>
      ) : null}
      {error ? <p role='alert' className='mt-2 text-sm text-destructive'>{error}</p> : null}
    </section>
  )
}

function MessageItem({ message, canPost, editor, pendingDelete, busy, onEdit, onDelete, renderEditor }: {
  readonly message: DriveMessageDto
  readonly canPost: boolean
  readonly editor: Editor | null
  readonly pendingDelete: string | null
  readonly busy: boolean
  readonly onEdit: (editor: Editor | null) => void
  readonly onDelete: (kind: 'message' | 'comment', id: string) => Promise<void>
  readonly renderEditor: (value: string, setValue: (value: string) => void, label: string, cancel?: () => void) => ReactNode
}) {
  const rows = useMemo(() => flattenComments(message.comments), [message.comments])
  const editing = editor?.kind === 'message' && editor.id === message.id
  const reply = editor?.kind === 'reply' && editor.messageId === message.id
  return (
    <article data-drive-message-id={message.id} className='border-b pb-6'>
      <div className='mb-2 flex items-center justify-between gap-2'>
        <span className='text-sm font-medium'>{displayAuthor(message.author)}</span>
        <time className='text-sm text-muted-foreground' dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
      </div>
      {editing ? renderEditor(editor.value, (value) => onEdit({ ...editor, value }), '编辑留言', () => onEdit(null)) : <p className='whitespace-pre-wrap break-words text-sm'>{message.body}</p>}
      {!editing ? <div className='mt-2 flex items-center gap-1'>
        {canPost ? <Button type='button' size='sm' variant='ghost' onClick={() => onEdit({ kind: 'reply', messageId: message.id, parentCommentId: null, value: '' })}>回复</Button> : null}
        {message.permissions.canEdit ? <Button type='button' size='sm' variant='ghost' onClick={() => onEdit({ kind: 'message', id: message.id, value: message.body })}>编辑</Button> : null}
        {message.permissions.canDelete ? <DeleteButton pending={pendingDelete === `message:${message.id}`} busy={busy} onClick={() => { void onDelete('message', message.id) }} /> : null}
      </div> : null}
      <div className='mt-3 space-y-3'>
        {rows.map(({ comment, depth, replyTo }) => {
          const commentEditing = editor?.kind === 'comment' && editor.id === comment.id
          return <div key={comment.id} className={depthClass(depth)} data-drive-message-comment-id={comment.id}>
            <div className='flex items-center gap-2 text-sm'>
              <span className='font-medium'>{displayAuthor(comment.author)}</span>
              {replyTo ? <span className='text-muted-foreground'>回复 {replyTo}</span> : null}
              <time className='text-muted-foreground' dateTime={comment.createdAt}>{formatTime(comment.createdAt)}</time>
            </div>
            {commentEditing ? renderEditor(editor.value, (value) => onEdit({ ...editor, value }), '编辑回复', () => onEdit(null)) : <p className='whitespace-pre-wrap break-words text-sm'>{comment.body}</p>}
            {!commentEditing ? <div className='flex items-center gap-1'>
              {canPost ? <Button type='button' size='sm' variant='ghost' onClick={() => onEdit({ kind: 'reply', messageId: message.id, parentCommentId: comment.id, value: '' })}>回复</Button> : null}
              {comment.permissions.canEdit ? <Button type='button' size='sm' variant='ghost' onClick={() => onEdit({ kind: 'comment', id: comment.id, value: comment.body })}>编辑</Button> : null}
              {comment.permissions.canDelete ? <DeleteButton pending={pendingDelete === `comment:${comment.id}`} busy={busy} onClick={() => { void onDelete('comment', comment.id) }} /> : null}
            </div> : null}
            {reply && editor.parentCommentId === comment.id ? renderEditor(editor.value, (value) => onEdit({ ...editor, value }), '回复评论', () => onEdit(null)) : null}
          </div>
        })}
      </div>
      {reply && editor.parentCommentId === null ? renderEditor(editor.value, (value) => onEdit({ ...editor, value }), '回复留言', () => onEdit(null)) : null}
    </article>
  )
}

function DeleteButton({ pending, busy, onClick }: { readonly pending: boolean; readonly busy: boolean; readonly onClick: () => void }) {
  return <Button type='button' size='sm' variant='ghost' disabled={busy} onClick={onClick}>{pending ? '确认删除（含下级回复）' : '删除'}</Button>
}

function flattenComments(comments: readonly DriveMessageCommentDto[]) {
  const byId = new Map(comments.map((comment) => [comment.id, comment]))
  const children = new Map<string | null, DriveMessageCommentDto[]>()
  for (const comment of comments) {
    const parent = comment.parentCommentId && byId.has(comment.parentCommentId) ? comment.parentCommentId : null
    children.set(parent, [...(children.get(parent) ?? []), comment])
  }
  const result: { comment: DriveMessageCommentDto; depth: number; replyTo: string | null }[] = []
  const pending = (children.get(null) ?? []).map((comment) => ({ comment, depth: 0 })).reverse()
  while (pending.length > 0) {
    const row = pending.pop()!
    const parent = row.comment.parentCommentId ? byId.get(row.comment.parentCommentId) : null
    result.push({ ...row, replyTo: parent ? displayAuthor(parent.author) : null })
    pending.push(...(children.get(row.comment.id) ?? []).map((comment) => ({ comment, depth: row.depth + 1 })).reverse())
  }
  return result
}

function depthClass(depth: number) {
  return ['border-l pl-3', 'ml-4 border-l pl-3', 'ml-8 border-l pl-3', 'ml-12 border-l pl-3'][Math.min(depth, 3)]
}

function displayAuthor(author: { readonly handle: string | null; readonly email: string | null }) {
  return author.handle ?? author.email ?? '用户'
}

function formatTime(value: string) {
  return new Date(value).toLocaleString()
}
