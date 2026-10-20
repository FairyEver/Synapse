import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import type { DriveMessageCommentDto, DriveMessageDto } from '@synapse/shared'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { DriveMessageComposer } from './drive-message-composer'
import { DriveMessageBody } from './drive-message-body'
import { startDriveOperation } from './shared/drive-telemetry'
import type { useDriveMessages } from './use-drive-messages'
import { useDiscussionTargetFocus, usePendingDriveDiscussion } from './use-drive-discussion-location'

type Messages = ReturnType<typeof useDriveMessages>
type Editor =
  | { readonly kind: 'message'; readonly id: string; readonly value: string }
  | { readonly kind: 'comment'; readonly id: string; readonly value: string }
  | { readonly kind: 'reply'; readonly messageId: string; readonly parentCommentId: string | null; readonly value: string }

export function DriveMessagesSection({ messages, sectionRef }: { readonly messages: Messages; readonly sectionRef?: Ref<HTMLElement> }) {
  const [draft, setDraft] = useState('')
  const [composerExpanded, setComposerExpanded] = useState(false)
  const [composerVersion, setComposerVersion] = useState(0)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = usePendingDriveDiscussion()
  useEffect(() => {
    const target = pending?.location
    if (!pending || target?.kind !== 'message' || messages.loading || messages.refreshing || messages.error) return
    const message = messages.messages.find((item) => item.id === target.messageId)
    if (!message) pending.unavailable('该留言已删除')
    else if (target.commentId && !message.comments.some((comment) => comment.id === target.commentId)) pending.unavailable('该回复已删除')
  }, [messages.error, messages.loading, messages.refreshing, messages.messages, pending])

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
        setComposerExpanded(false)
        setComposerVersion((version) => version + 1)
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
    <DriveMessageComposer
      key={editor ? editor.kind === 'reply' ? `reply:${editor.messageId}:${editor.parentCommentId}` : `${editor.kind}:${editor.id}` : `new-message:${composerVersion}`}
      value={value}
      onChange={setValue}
      label={label}
      submitLabel={editor?.kind === 'reply' ? '回复' : cancel ? '保存' : '发布留言'}
      busy={busy}
      imageUploadContext={messages.imageUploadContext}
      expanded={Boolean(editor) || composerExpanded}
      onExpand={() => { pending?.cancel(); setComposerExpanded(true) }}
      onSubmit={() => { void submit() }}
      onCancel={cancel}
    />
  )

  return (
    <section ref={sectionRef} tabIndex={-1} aria-labelledby='drive-messages-heading' className='mx-auto mt-12 w-full max-w-3xl border-t border-border pt-8 pb-10 outline-none' data-drive-messages-section>
      <h2 id='drive-messages-heading' className='mb-4 text-lg font-semibold'>留言</h2>
      {messages.loading ? <p className='text-sm text-muted-foreground'>加载中</p> : null}
      {messages.error ? <p role='alert' className='text-sm text-destructive'>{messages.error}</p> : null}
      {!messages.loading && messages.messages.length === 0 ? <p className='mb-4 text-sm text-muted-foreground'>暂无留言</p> : null}
      <div className='space-y-6'>
        {messages.messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            canFocus={!messages.loading && !messages.refreshing && !messages.error}
            canPost={messages.canPost}
            editor={editor}
            pendingDelete={pendingDelete}
            busy={busy}
            onEdit={(next) => { pending?.cancel(); setEditor(next); setError(null) }}
            onDelete={remove}
            onCancelDelete={() => setPendingDelete(null)}
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

function MessageItem({ message, canFocus, canPost, editor, pendingDelete, busy, onEdit, onDelete, onCancelDelete, renderEditor }: {
  readonly message: DriveMessageDto
  readonly canFocus: boolean
  readonly canPost: boolean
  readonly editor: Editor | null
  readonly pendingDelete: string | null
  readonly busy: boolean
  readonly onEdit: (editor: Editor | null) => void
  readonly onDelete: (kind: 'message' | 'comment', id: string) => Promise<void>
  readonly onCancelDelete: () => void
  readonly renderEditor: (value: string, setValue: (value: string) => void, label: string, cancel?: () => void) => ReactNode
}) {
  const elementRef = useRef<HTMLElement | null>(null)
  const pending = usePendingDriveDiscussion()
  const target = pending?.location
  useDiscussionTargetFocus(elementRef, canFocus && target?.kind === 'message' && target.messageId === message.id && target.commentId === null)
  const rows = useMemo(() => flattenComments(message.comments), [message.comments])
  const editing = editor?.kind === 'message' && editor.id === message.id
  const reply = editor?.kind === 'reply' && editor.messageId === message.id
  return (
    <article ref={elementRef} tabIndex={-1} data-drive-message-id={message.id} className='border-b pb-6'>
      <MessageHeader author={message.author} createdAt={message.createdAt}>
        {!editing ? <MessageActionsMenu authorName={displayAuthor(message.author)} kind='留言' permissions={message.permissions} busy={busy}
          onEdit={() => onEdit({ kind: 'message', id: message.id, value: message.body })}
          onDelete={() => { void onDelete('message', message.id) }} /> : null}
      </MessageHeader>
      <div className='mt-3 sm:pl-11'>
        {editing ? renderEditor(editor.value, (value) => onEdit({ ...editor, value }), '编辑留言', () => onEdit(null)) : <DriveMessageBody html={message.bodyHtml} />}
        {!editing ? <div className='mt-2 flex items-center gap-1'>
          {canPost ? <Button type='button' variant='ghost' onClick={() => onEdit({ kind: 'reply', messageId: message.id, parentCommentId: null, value: '' })}>回复</Button> : null}
        </div> : null}
        {pendingDelete === `message:${message.id}` ? <DeleteConfirmation busy={busy} onCancel={onCancelDelete} onConfirm={() => { void onDelete('message', message.id) }} /> : null}
        <div className='mt-3 space-y-3'>
          {rows.map(({ comment, depth, replyTo }) => {
            const commentEditing = editor?.kind === 'comment' && editor.id === comment.id
            return <MessageCommentRow key={comment.id} id={comment.id} messageId={message.id} canFocus={canFocus} className={depthClass(depth)}>
              <MessageHeader author={comment.author} createdAt={comment.createdAt} replyTo={replyTo}>
                {!commentEditing ? <MessageActionsMenu authorName={displayAuthor(comment.author)} kind='回复' permissions={comment.permissions} busy={busy}
                  onEdit={() => onEdit({ kind: 'comment', id: comment.id, value: comment.body })}
                  onDelete={() => { void onDelete('comment', comment.id) }} /> : null}
              </MessageHeader>
              <div className='mt-2 sm:pl-11'>
                {commentEditing ? renderEditor(editor.value, (value) => onEdit({ ...editor, value }), '编辑回复', () => onEdit(null)) : <DriveMessageBody html={comment.bodyHtml} />}
                {!commentEditing ? <div className='flex items-center gap-1'>
                  {canPost ? <Button type='button' variant='ghost' onClick={() => onEdit({ kind: 'reply', messageId: message.id, parentCommentId: comment.id, value: '' })}>回复</Button> : null}
                </div> : null}
                {pendingDelete === `comment:${comment.id}` ? <DeleteConfirmation busy={busy} onCancel={onCancelDelete} onConfirm={() => { void onDelete('comment', comment.id) }} /> : null}
                {reply && editor.parentCommentId === comment.id ? renderEditor(editor.value, (value) => onEdit({ ...editor, value }), '回复留言', () => onEdit(null)) : null}
              </div>
            </MessageCommentRow>
          })}
        </div>
        {reply && editor.parentCommentId === null ? renderEditor(editor.value, (value) => onEdit({ ...editor, value }), '回复留言', () => onEdit(null)) : null}
      </div>
    </article>
  )
}

function MessageCommentRow({ id, messageId, canFocus, className, children }: { id: string; messageId: string; canFocus: boolean; className: string; children: ReactNode }) {
  const elementRef = useRef<HTMLDivElement | null>(null)
  const target = usePendingDriveDiscussion()?.location
  useDiscussionTargetFocus(elementRef, canFocus && target?.kind === 'message' && target.messageId === messageId && target.commentId === id)
  return <div ref={elementRef} tabIndex={-1} className={className} data-drive-message-comment-id={id}>{children}</div>
}

function MessageHeader({ author, createdAt, replyTo, children }: {
  readonly author: DriveMessageDto['author']
  readonly createdAt: string
  readonly replyTo?: string | null
  readonly children: ReactNode
}) {
  const name = displayAuthor(author)
  return <div className='flex items-center gap-3'>
    <Avatar aria-hidden><AvatarFallback className='text-xs font-medium'>{Array.from(name)[0]?.toLocaleUpperCase()}</AvatarFallback></Avatar>
    <div className='flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm'>
      <span className='min-w-0 truncate font-medium' title={name}>{name}</span>
      {replyTo ? <span className='min-w-0 truncate text-xs text-muted-foreground' title={replyTo}>回复 {replyTo}</span> : null}
      <time className='shrink-0 text-xs text-muted-foreground' dateTime={createdAt} title={new Date(createdAt).toLocaleString()}>{formatTime(createdAt)}</time>
    </div>
    {children}
  </div>
}

function MessageActionsMenu({ authorName, kind, permissions, busy, onEdit, onDelete }: {
  readonly authorName: string
  readonly kind: '留言' | '回复'
  readonly permissions: DriveMessageDto['permissions']
  readonly busy: boolean
  readonly onEdit: () => void
  readonly onDelete: () => void
}) {
  const editingRef = useRef(false)
  if (!permissions.canEdit && !permissions.canDelete) return null
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type='button' variant='ghost' size='icon' className='size-10' disabled={busy} aria-label={`${kind}操作：${authorName}`}><MoreHorizontal aria-hidden /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent data-drive-telemetry-scope='portal' align='end' onCloseAutoFocus={(event) => {
      if (editingRef.current) event.preventDefault()
      editingRef.current = false
    }}>
      {permissions.canEdit ? <DropdownMenuItem disabled={busy} onSelect={() => { editingRef.current = true; onEdit() }}><Pencil aria-hidden />编辑</DropdownMenuItem> : null}
      {permissions.canDelete ? <DropdownMenuItem variant='destructive' disabled={busy} onSelect={onDelete}><Trash2 aria-hidden />删除</DropdownMenuItem> : null}
    </DropdownMenuContent>
  </DropdownMenu>
}

function DeleteConfirmation({ busy, onCancel, onConfirm }: { readonly busy: boolean; readonly onCancel: () => void; readonly onConfirm: () => void }) {
  return <div role='group' aria-label='删除留言确认' className='mt-3 space-y-2' onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onCancel() }}>
    <p className='text-sm'>删除后，下级回复也会删除。</p>
    <div className='flex flex-wrap gap-2'>
      <Button type='button' variant='ghost' disabled={busy} onClick={onCancel}>取消</Button>
      <Button type='button' variant='destructive' disabled={busy} onClick={onConfirm}>{busy ? '删除中' : '确认删除（含下级回复）'}</Button>
    </div>
  </div>
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
  const date = new Date(value)
  const today = new Date()
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (date.toDateString() === today.toDateString()) return `今天 ${time}`
  const day = date.toLocaleDateString('zh-CN', { ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' as const } : {}), month: 'numeric', day: 'numeric' })
  return `${day} ${time}`
}
