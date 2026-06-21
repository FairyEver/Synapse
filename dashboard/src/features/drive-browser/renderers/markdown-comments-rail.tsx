import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DriveAnnotationCommentDto, DriveAnnotationThreadDto } from '@synapse/shared'
import { MoreHorizontal } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const COMMENT_CARD_ESTIMATED_HEIGHT = 128
const COMMENT_CARD_GAP = 12

export type MarkdownCommentsRailThread = {
  readonly thread: DriveAnnotationThreadDto
  readonly anchorTop: number | null
}

export function MarkdownCommentsRail({
  threads,
  activeThreadId,
  canReply,
  onFocusThread,
  onReply,
  onUpdateComment,
  onDeleteComment,
  onDeleteThread,
}: {
  readonly threads: readonly MarkdownCommentsRailThread[]
  readonly activeThreadId: string | null
  readonly canReply: boolean
  readonly onFocusThread: (threadId: string) => void
  readonly onReply: (input: { readonly threadId: string; readonly parentCommentId: string | null; readonly body: string }) => Promise<void>
  readonly onUpdateComment: (input: { readonly commentId: string; readonly body: string }) => Promise<void>
  readonly onDeleteComment: (commentId: string) => Promise<void>
  readonly onDeleteThread: (threadId: string) => Promise<void>
}) {
  const cardRefs = useRef(new Map<string, HTMLElement>())
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({})
  const layout = useMemo(() => layoutRailThreads(threads, measuredHeights), [measuredHeights, threads])

  useLayoutEffect(() => {
    const next: Record<string, number> = {}
    for (const [threadId, element] of cardRefs.current) {
      next[threadId] = Math.ceil(element.getBoundingClientRect().height || element.offsetHeight || COMMENT_CARD_ESTIMATED_HEIGHT)
    }
    setMeasuredHeights((current) => sameHeightMap(current, next) ? current : next)
  }, [threads])

  return (
    <aside className='w-72 shrink-0 border-l bg-background'>
      <div className='sticky top-0 z-10 border-b bg-background px-3 py-2 text-sm font-medium'>评论 {threads.length}</div>
      {layout.anchored.length > 0 ? (
        <div className='relative p-3' style={{ minHeight: layout.anchoredHeight }}>
          {layout.anchored.map(({ item, top }) => (
            <div
              key={item.thread.id}
              ref={(element) => setCardRef(cardRefs.current, item.thread.id, element)}
              data-markdown-comment-thread-id={item.thread.id}
              className='absolute left-3 right-3'
              style={{ top }}
            >
              <ThreadView
                thread={item.thread}
                active={item.thread.id === activeThreadId}
                canReply={canReply}
                onFocusThread={onFocusThread}
                onReply={onReply}
                onUpdateComment={onUpdateComment}
                onDeleteComment={onDeleteComment}
                onDeleteThread={onDeleteThread}
              />
            </div>
          ))}
        </div>
      ) : null}
      {layout.orphaned.length > 0 ? (
        <div className={cn('space-y-3 p-3', layout.anchored.length > 0 && 'pt-0')}>
          {layout.orphaned.map((item) => (
            <div
              key={item.thread.id}
              ref={(element) => setCardRef(cardRefs.current, item.thread.id, element)}
              data-markdown-comment-thread-id={item.thread.id}
            >
              <ThreadView
                thread={item.thread}
                active={item.thread.id === activeThreadId}
                canReply={canReply}
                onFocusThread={onFocusThread}
                onReply={onReply}
                onUpdateComment={onUpdateComment}
                onDeleteComment={onDeleteComment}
                onDeleteThread={onDeleteThread}
              />
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  )
}

function ThreadView({
  thread,
  active,
  canReply,
  onFocusThread,
  onReply,
  onUpdateComment,
  onDeleteComment,
  onDeleteThread,
}: {
  readonly thread: DriveAnnotationThreadDto
  readonly active: boolean
  readonly canReply: boolean
  readonly onFocusThread: (threadId: string) => void
  readonly onReply: (input: { readonly threadId: string; readonly parentCommentId: string | null; readonly body: string }) => Promise<void>
  readonly onUpdateComment: (input: { readonly commentId: string; readonly body: string }) => Promise<void>
  readonly onDeleteComment: (commentId: string) => Promise<void>
  readonly onDeleteThread: (threadId: string) => Promise<void>
}) {
  const authorByCommentId = useMemo(() => new Map(thread.comments.map((comment) => [comment.id, comment.author])), [thread.comments])
  const showThreadHeader = thread.anchorStatus === 'orphaned' || thread.permissions.canDelete
  return (
    <section
      className={cn(
        'rounded-md border border-border bg-background p-3 text-sm',
        active && 'border-ring bg-muted/30'
      )}
      onClick={(event) => {
        if (isInteractiveCommentTarget(event.target)) return
        onFocusThread(thread.id)
      }}
    >
      {showThreadHeader ? (
        <div className='mb-2 flex items-center justify-between gap-2'>
          {thread.anchorStatus === 'orphaned' ? (
            <div className='rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground'>位置已变化</div>
          ) : <span />}
          {thread.permissions.canDelete ? (
            <ThreadActionMenu onDeleteThread={() => onDeleteThread(thread.id)} />
          ) : null}
        </div>
      ) : null}
      <div className='space-y-3'>
        {thread.comments.map((comment) => (
          <CommentView
            key={comment.id}
            comment={comment}
            replyToName={comment.parentCommentId ? displayAuthor(authorByCommentId.get(comment.parentCommentId)) : null}
            canReply={canReply}
            onReply={(body) => onReply({ threadId: thread.id, parentCommentId: comment.id, body })}
            onUpdateComment={onUpdateComment}
            onDeleteComment={onDeleteComment}
          />
        ))}
      </div>
    </section>
  )
}

function CommentView({
  comment,
  replyToName,
  canReply,
  onReply,
  onUpdateComment,
  onDeleteComment,
}: {
  readonly comment: DriveAnnotationCommentDto
  readonly replyToName: string | null
  readonly canReply: boolean
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
    <article className='space-y-2'>
      <div className='flex items-center justify-between gap-2'>
        <span className='truncate text-sm font-medium'>{displayAuthor(comment.author)}</span>
        <div className='flex shrink-0 items-center gap-1'>
          <span className='text-xs text-muted-foreground'>{comment.editedAt ? '已编辑' : null}</span>
          {comment.permissions.canDelete ? (
            <CommentActionMenu onDeleteComment={() => onDeleteComment(comment.id)} />
          ) : null}
        </div>
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
        <p className='whitespace-pre-wrap break-words text-sm leading-5'>{comment.body}</p>
      )}
      <div className='-ml-2 flex flex-wrap items-center gap-1'>
        {canReply ? (
          <Button type='button' variant='ghost' size='sm' className='h-7 px-2 text-xs' onClick={() => setReplying(true)}>回复</Button>
        ) : null}
        {comment.permissions.canEdit ? (
          <Button type='button' variant='ghost' size='sm' className='h-7 px-2 text-xs' onClick={() => setEditing(true)}>编辑</Button>
        ) : null}
      </div>
      {canReply && replying ? (
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

function CommentActionMenu({
  onDeleteComment,
}: {
  readonly onDeleteComment: () => Promise<void>
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button type='button' variant='ghost' size='icon' className='h-7 w-7' aria-label='评论操作' onClick={() => setMenuOpen(true)}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem variant='destructive' onSelect={() => {
            setMenuOpen(false)
            setDeleteOpen(true)
          }}>
            删除评论
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title='删除评论？'
        description='会删除这条评论。'
        actionLabel='删除评论'
        onConfirm={onDeleteComment}
      />
    </>
  )
}

function ThreadActionMenu({
  onDeleteThread,
}: {
  readonly onDeleteThread: () => Promise<void>
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button type='button' variant='ghost' size='icon' className='h-7 w-7' aria-label='讨论操作' onClick={() => setMenuOpen(true)}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem variant='destructive' onSelect={() => {
            setMenuOpen(false)
            setDeleteOpen(true)
          }}>
            删除讨论
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title='删除讨论？'
        description='会删除这条讨论及其回复。'
        actionLabel='删除讨论'
        onConfirm={onDeleteThread}
      />
    </>
  )
}

function DeleteConfirmDialog({
  open,
  title,
  description,
  actionLabel,
  onOpenChange,
  onConfirm,
}: {
  readonly open: boolean
  readonly title: string
  readonly description: string
  readonly actionLabel: string
  readonly onOpenChange: (open: boolean) => void
  readonly onConfirm: () => Promise<void>
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const handleConfirm = async () => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (cause) {
      setError(getCommentActionErrorMessage(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => {
      if (submitting) return
      if (!nextOpen) setError(null)
      onOpenChange(nextOpen)
    }}>
      <AlertDialogContent onClick={(event) => event.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <div role='status' className='text-sm text-muted-foreground'>{error}</div> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={submitting}
            onClick={(event) => {
              event.preventDefault()
              void handleConfirm()
            }}
          >
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const handleSubmit = async () => {
    if (!value.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit()
    } catch (cause) {
      setError(getCommentActionErrorMessage(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className='space-y-2 pt-1' onClick={(event) => event.stopPropagation()}>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className='min-h-20 resize-y text-sm shadow-none'
      />
      <div className='flex items-center justify-between gap-2'>
        {error ? <div role='status' className='min-w-0 text-xs text-muted-foreground'>{error}</div> : <span />}
        <div className='flex shrink-0 justify-end gap-1'>
          <Button type='button' variant='ghost' size='sm' className='h-7 px-2 text-xs' onClick={onCancel}>取消</Button>
          <Button type='button' size='sm' className='h-7 px-2 text-xs' disabled={!value.trim() || submitting} onClick={() => { void handleSubmit() }}>{submitLabel}</Button>
        </div>
      </div>
    </div>
  )
}

function displayAuthor(author: { readonly displayName: string | null } | undefined): string {
  return author?.displayName || '评论者'
}

function isInteractiveCommentTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('button, textarea, input, a'))
}

function getCommentActionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return '操作失败'
}

function layoutRailThreads(
  items: readonly MarkdownCommentsRailThread[],
  measuredHeights: Record<string, number>,
): {
  readonly anchored: readonly { readonly item: MarkdownCommentsRailThread; readonly top: number }[]
  readonly orphaned: readonly MarkdownCommentsRailThread[]
  readonly anchoredHeight: number
} {
  const anchoredSource = items
    .filter((item) => item.anchorTop !== null && item.thread.anchorStatus !== 'orphaned')
    .sort((a, b) => (a.anchorTop ?? 0) - (b.anchorTop ?? 0))
  const orphaned = items.filter((item) => item.anchorTop === null || item.thread.anchorStatus === 'orphaned')
  const anchored: Array<{ readonly item: MarkdownCommentsRailThread; readonly top: number }> = []
  let previousBottom = 0

  for (const item of anchoredSource) {
    const requestedTop = Math.max(0, item.anchorTop ?? 0)
    const top = anchored.length === 0 ? requestedTop : Math.max(requestedTop, previousBottom + COMMENT_CARD_GAP)
    const height = measuredHeights[item.thread.id] ?? COMMENT_CARD_ESTIMATED_HEIGHT
    anchored.push({ item, top })
    previousBottom = top + height
  }

  return { anchored, orphaned, anchoredHeight: anchored.length > 0 ? previousBottom : 0 }
}

function setCardRef(map: Map<string, HTMLElement>, threadId: string, element: HTMLElement | null): void {
  if (element) {
    map.set(threadId, element)
    return
  }
  map.delete(threadId)
}

function sameHeightMap(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => left[key] === right[key])
}
