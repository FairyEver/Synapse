import { useMemo, useState } from 'react'
import type { DriveAnnotationCommentDto, DriveAnnotationThreadDto } from '@synapse/shared'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export function MarkdownCommentsRail({
  threads,
  activeThreadId,
  onFocusThread,
  onReply,
  onUpdateComment,
  onDeleteComment,
  onDeleteThread,
}: {
  readonly threads: readonly DriveAnnotationThreadDto[]
  readonly activeThreadId: string | null
  readonly onFocusThread: (threadId: string) => void
  readonly onReply: (input: { readonly threadId: string; readonly parentCommentId: string | null; readonly body: string }) => Promise<void>
  readonly onUpdateComment: (input: { readonly commentId: string; readonly body: string }) => Promise<void>
  readonly onDeleteComment: (commentId: string) => Promise<void>
  readonly onDeleteThread: (threadId: string) => Promise<void>
}) {
  return (
    <aside className='w-72 shrink-0 border-l bg-background'>
      <div className='sticky top-0 border-b bg-background px-3 py-2 text-sm font-medium'>评论 {threads.length}</div>
      <div className='space-y-3 p-3'>
        {threads.map((thread) => (
          <ThreadView
            key={thread.id}
            thread={thread}
            active={thread.id === activeThreadId}
            onFocusThread={onFocusThread}
            onReply={onReply}
            onUpdateComment={onUpdateComment}
            onDeleteComment={onDeleteComment}
            onDeleteThread={onDeleteThread}
          />
        ))}
      </div>
    </aside>
  )
}

function ThreadView({
  thread,
  active,
  onFocusThread,
  onReply,
  onUpdateComment,
  onDeleteComment,
  onDeleteThread,
}: {
  readonly thread: DriveAnnotationThreadDto
  readonly active: boolean
  readonly onFocusThread: (threadId: string) => void
  readonly onReply: (input: { readonly threadId: string; readonly parentCommentId: string | null; readonly body: string }) => Promise<void>
  readonly onUpdateComment: (input: { readonly commentId: string; readonly body: string }) => Promise<void>
  readonly onDeleteComment: (commentId: string) => Promise<void>
  readonly onDeleteThread: (threadId: string) => Promise<void>
}) {
  const authorByCommentId = useMemo(() => new Map(thread.comments.map((comment) => [comment.id, comment.author])), [thread.comments])
  return (
    <section
      className={cn('rounded-md border bg-background p-2 text-sm', active && 'border-foreground')}
      onClick={() => onFocusThread(thread.id)}
    >
      {thread.anchorStatus === 'orphaned' ? (
        <div className='mb-2 text-xs text-muted-foreground'>位置已变化</div>
      ) : null}
      <div className='space-y-2'>
        {thread.comments.map((comment) => (
          <CommentView
            key={comment.id}
            comment={comment}
            replyToName={comment.parentCommentId ? displayAuthor(authorByCommentId.get(comment.parentCommentId)) : null}
            onReply={(body) => onReply({ threadId: thread.id, parentCommentId: comment.id, body })}
            onUpdateComment={onUpdateComment}
            onDeleteComment={onDeleteComment}
          />
        ))}
      </div>
      {thread.permissions.canDelete ? (
        <div className='mt-2 flex justify-end'>
          <Button type='button' variant='ghost' size='sm' onClick={() => { void onDeleteThread(thread.id) }}>删除讨论</Button>
        </div>
      ) : null}
    </section>
  )
}

function CommentView({
  comment,
  replyToName,
  onReply,
  onUpdateComment,
  onDeleteComment,
}: {
  readonly comment: DriveAnnotationCommentDto
  readonly replyToName: string | null
  readonly onReply: (body: string) => Promise<void>
  readonly onUpdateComment: (input: { readonly commentId: string; readonly body: string }) => Promise<void>
  readonly onDeleteComment: (commentId: string) => Promise<void>
}) {
  const [replying, setReplying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [replyValue, setReplyValue] = useState('')
  const [editValue, setEditValue] = useState(comment.body)
  if (comment.deleted) {
    return <div className='text-xs text-muted-foreground'>评论已删除</div>
  }
  return (
    <article className='space-y-1'>
      <div className='flex items-center justify-between gap-2'>
        <span className='truncate text-xs font-medium'>{displayAuthor(comment.author)}</span>
        <span className='text-xs text-muted-foreground'>{comment.editedAt ? '已编辑' : null}</span>
      </div>
      {replyToName ? <div className='text-xs text-muted-foreground'>回复 {replyToName}</div> : null}
      {editing ? (
        <CommentComposer
          value={editValue}
          onChange={setEditValue}
          submitLabel='保存'
          onCancel={() => {
            setEditValue(comment.body)
            setEditing(false)
          }}
          onSubmit={async () => {
            await onUpdateComment({ commentId: comment.id, body: editValue })
            setEditing(false)
          }}
        />
      ) : (
        <p className='whitespace-pre-wrap break-words text-sm'>{comment.body}</p>
      )}
      <div className='flex items-center gap-1'>
        <Button type='button' variant='ghost' size='sm' onClick={() => setReplying(true)}>回复</Button>
        {comment.permissions.canEdit ? (
          <Button type='button' variant='ghost' size='sm' onClick={() => setEditing(true)}>编辑</Button>
        ) : null}
        {comment.permissions.canDelete ? (
          <Button type='button' variant='ghost' size='sm' onClick={() => { void onDeleteComment(comment.id) }}>删除</Button>
        ) : null}
      </div>
      {replying ? (
        <CommentComposer
          value={replyValue}
          onChange={setReplyValue}
          submitLabel='发送'
          onCancel={() => {
            setReplyValue('')
            setReplying(false)
          }}
          onSubmit={async () => {
            await onReply(replyValue)
            setReplyValue('')
            setReplying(false)
          }}
        />
      ) : null}
    </article>
  )
}

function CommentComposer({
  value,
  submitLabel,
  onChange,
  onSubmit,
  onCancel,
}: {
  readonly value: string
  readonly submitLabel: string
  readonly onChange: (value: string) => void
  readonly onSubmit: () => Promise<void>
  readonly onCancel: () => void
}) {
  return (
    <div className='space-y-2'>
      <Textarea value={value} onChange={(event) => onChange(event.currentTarget.value)} />
      <div className='flex justify-end gap-1'>
        <Button type='button' variant='ghost' size='sm' onClick={onCancel}>取消</Button>
        <Button type='button' size='sm' disabled={!value.trim()} onClick={() => { void onSubmit() }}>{submitLabel}</Button>
      </div>
    </div>
  )
}

function displayAuthor(author: { readonly email: string; readonly displayName: string | null } | undefined): string {
  return author?.displayName || author?.email || ''
}
