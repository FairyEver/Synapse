import { useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'
import type { DriveAnnotationCommentDto, DriveAnnotationThreadDto } from '@synapse/shared'
import { Loader2, MoreHorizontal, RefreshCw } from 'lucide-react'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
const COMMENT_RAIL_HEADER_HEIGHT = 40
type CommentActionPromise = Promise<unknown>

export type MarkdownCommentsRailThread = {
  readonly thread: DriveAnnotationThreadDto
  readonly anchorTop: number | null
}

export function MarkdownCommentsRail({
  mode = 'anchored',
  threads,
  activeThreadId,
  canReply,
  anchorBaseOffset = 0,
  anchoredLayerRef,
  onFocusThread,
  loading = false,
  onRefresh,
  onReply,
  onUpdateComment,
  onDeleteComment,
  onDeleteThread,
}: {
  readonly mode?: 'anchored' | 'list'
  readonly threads: readonly MarkdownCommentsRailThread[]
  readonly activeThreadId: string | null
  readonly canReply: boolean
  readonly anchorBaseOffset?: number
  readonly anchoredLayerRef?: Ref<HTMLDivElement>
  readonly onFocusThread: (threadId: string) => void
  readonly loading?: boolean
  readonly onRefresh?: () => void
  readonly onReply: (input: { readonly threadId: string; readonly parentCommentId: string | null; readonly body: string }) => CommentActionPromise
  readonly onUpdateComment: (input: { readonly commentId: string; readonly body: string }) => CommentActionPromise
  readonly onDeleteComment: (commentId: string) => CommentActionPromise
  readonly onDeleteThread: (threadId: string) => CommentActionPromise
}) {
  const cardRefs = useRef(new Map<string, HTMLElement>())
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({})
  const layout = useMemo(() => layoutRailThreads(threads, measuredHeights, anchorBaseOffset), [anchorBaseOffset, measuredHeights, threads])

  useLayoutEffect(() => {
    if (mode === 'list') return
    const next: Record<string, number> = {}
    for (const [threadId, element] of cardRefs.current) {
      next[threadId] = Math.ceil(element.getBoundingClientRect().height || element.offsetHeight || COMMENT_CARD_ESTIMATED_HEIGHT)
    }
    setMeasuredHeights((current) => sameHeightMap(current, next) ? current : next)
  }, [mode, threads])

  const compact = mode === 'list'

  return (
    <div
      data-markdown-comments-rail='true'
      data-markdown-comments-mode={mode}
      className='h-full min-h-full bg-background'
    >
      <div className={cn(
        'sticky top-0 z-10 flex shrink-0 items-center justify-between border-b bg-background px-3 text-sm font-medium',
        compact ? 'h-12 pr-14' : 'h-10'
      )}>
        <span>评论</span>
        <div className='flex items-center gap-1'>
          <span className='text-xs font-normal text-muted-foreground'>{threads.length}</span>
          {onRefresh ? (
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className={compact ? 'size-11' : 'size-7'}
              aria-label='刷新评论'
              disabled={loading}
              onClick={onRefresh}
            >
              {loading ? <Loader2 className='animate-spin' /> : <RefreshCw />}
            </Button>
          ) : null}
        </div>
      </div>
      <div>
        {threads.length === 0 ? (
          <div className='px-3 py-6 text-sm text-muted-foreground'>暂无评论</div>
        ) : null}
        {compact && threads.length > 0 ? (
          <div className='space-y-3 p-3'>
            {threads.map((item) => (
              <div
                key={item.thread.id}
                data-markdown-comment-thread-id={item.thread.id}
              >
                <ThreadView
                  thread={item.thread}
                  active={item.thread.id === activeThreadId}
                  canReply={canReply}
                  compact
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
        {!compact && layout.anchored.length > 0 ? (
          <div
            ref={anchoredLayerRef}
            data-markdown-comments-anchored-layer='true'
            className='relative p-3 will-change-transform'
            style={{ minHeight: layout.anchoredHeight }}
          >
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
                  compact={false}
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
        {!compact && layout.orphaned.length > 0 ? (
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
                  compact={false}
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
      </div>
    </div>
  )
}

function ThreadView({
  thread,
  active,
  canReply,
  compact,
  onFocusThread,
  onReply,
  onUpdateComment,
  onDeleteComment,
  onDeleteThread,
}: {
  readonly thread: DriveAnnotationThreadDto
  readonly active: boolean
  readonly canReply: boolean
  readonly compact: boolean
  readonly onFocusThread: (threadId: string) => void
  readonly onReply: (input: { readonly threadId: string; readonly parentCommentId: string | null; readonly body: string }) => CommentActionPromise
  readonly onUpdateComment: (input: { readonly commentId: string; readonly body: string }) => CommentActionPromise
  readonly onDeleteComment: (commentId: string) => CommentActionPromise
  readonly onDeleteThread: (threadId: string) => CommentActionPromise
}) {
  const authorByCommentId = useMemo(() => new Map(thread.comments.map((comment) => [comment.id, comment.author])), [thread.comments])
  const firstVisibleCommentId = thread.comments.find((comment) => !comment.deleted)?.id ?? null
  const showThreadHeader = thread.anchorStatus === 'orphaned' || (thread.permissions.canDelete && !firstVisibleCommentId)
  return (
    <section
      className={cn(
        'cursor-default rounded-lg border border-border bg-card p-3 text-sm transition-colors',
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
          {thread.permissions.canDelete && !firstVisibleCommentId ? (
            <ThreadActionMenu compact={compact} onDeleteThread={() => onDeleteThread(thread.id)} />
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
            compact={compact}
            onReply={(body) => onReply({ threadId: thread.id, parentCommentId: comment.id, body })}
            onUpdateComment={onUpdateComment}
            onDeleteComment={onDeleteComment}
            onDeleteThread={thread.permissions.canDelete && comment.id === firstVisibleCommentId ? () => onDeleteThread(thread.id) : undefined}
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
  compact,
  onReply,
  onUpdateComment,
  onDeleteComment,
  onDeleteThread,
}: {
  readonly comment: DriveAnnotationCommentDto
  readonly replyToName: string | null
  readonly canReply: boolean
  readonly compact: boolean
  readonly onReply: (body: string) => CommentActionPromise
  readonly onUpdateComment: (input: { readonly commentId: string; readonly body: string }) => CommentActionPromise
  readonly onDeleteComment: (commentId: string) => CommentActionPromise
  readonly onDeleteThread?: () => CommentActionPromise
}) {
  const [textDialog, setTextDialog] = useState<CommentTextDialogState | null>(null)
  if (comment.deleted) {
    return <div className='text-xs text-muted-foreground'>评论已删除</div>
  }
  return (
    <article className='space-y-2'>
      <div className='flex items-center justify-between gap-2'>
        <span className='truncate text-sm font-medium'>{displayAuthor(comment.author)}</span>
        <div className='flex shrink-0 items-center gap-1'>
          <span className='text-xs text-muted-foreground'>{comment.editedAt ? '已编辑' : null}</span>
          {comment.permissions.canDelete || onDeleteThread ? (
            <CommentActionMenu
              compact={compact}
              onDeleteComment={comment.permissions.canDelete ? () => onDeleteComment(comment.id) : undefined}
              onDeleteThread={onDeleteThread}
            />
          ) : null}
        </div>
      </div>
      {replyToName ? <div className='text-xs text-muted-foreground'>回复 {replyToName}</div> : null}
      <p className='whitespace-pre-wrap break-words text-sm leading-5'>{comment.body}</p>
      <div className='-ml-2 flex flex-wrap items-center gap-1'>
        {canReply ? (
          <Button type='button' variant='ghost' size='sm' className={cn(compact ? 'min-h-11 px-3' : 'h-7 px-2', 'text-xs')} onClick={() => setTextDialog({ mode: 'reply', value: '' })}>回复</Button>
        ) : null}
        {comment.permissions.canEdit ? (
          <Button type='button' variant='ghost' size='sm' className={cn(compact ? 'min-h-11 px-3' : 'h-7 px-2', 'text-xs')} onClick={() => setTextDialog({ mode: 'edit', value: comment.body })}>编辑</Button>
        ) : null}
      </div>
      {textDialog ? (
        <CommentTextDialog
          state={textDialog}
          onStateChange={setTextDialog}
          onSubmit={async (body) => {
            if (textDialog.mode === 'reply') {
              await onReply(body)
              return
            }
            await onUpdateComment({ commentId: comment.id, body })
          }}
        />
      ) : null}
    </article>
  )
}

type CommentTextDialogState =
  | { readonly mode: 'reply'; readonly value: string }
  | { readonly mode: 'edit'; readonly value: string }

function CommentTextDialog({
  state,
  onStateChange,
  onSubmit,
}: {
  readonly state: CommentTextDialogState
  readonly onStateChange: (state: CommentTextDialogState | null) => void
  readonly onSubmit: (body: string) => CommentActionPromise
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const title = state.mode === 'edit' ? '编辑评论' : '回复评论'
  const submitLabel = state.mode === 'edit' ? '保存' : '发送'
  const handleSubmit = async () => {
    const body = state.value
    if (!body.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(body)
      onStateChange(null)
    } catch (cause) {
      setError(getCommentActionErrorMessage(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (submitting) return
        if (!open) onStateChange(null)
      }}
    >
      <DialogContent onClick={(event) => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className='sr-only'>{title}</DialogDescription>
        </DialogHeader>
        <Textarea
          value={state.value}
          aria-label={title}
          onChange={(event) => {
            onStateChange({ ...state, value: event.currentTarget.value })
            if (error) setError(null)
          }}
          className='min-h-24'
          autoFocus
        />
        {error ? <div role='status' className='text-sm text-destructive'>{error}</div> : null}
        <DialogFooter>
          <Button type='button' variant='ghost' disabled={submitting} onClick={() => onStateChange(null)}>取消</Button>
          <Button type='button' disabled={!state.value.trim() || submitting} onClick={() => { void handleSubmit() }}>
            {submitting ? `${submitLabel}中` : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CommentActionMenu({
  compact = false,
  onDeleteComment,
  onDeleteThread,
}: {
  readonly compact?: boolean
  readonly onDeleteComment?: () => CommentActionPromise
  readonly onDeleteThread?: () => CommentActionPromise
}) {
  const [activeDeleteConfig, setActiveDeleteConfig] = useState<CommentDeleteConfig | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const deleteConfigs = getCommentDeleteConfigs(onDeleteComment, onDeleteThread)
  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button type='button' variant='ghost' size='icon' className={compact ? 'size-11' : 'h-7 w-7'} aria-label='更多评论操作' onClick={() => setMenuOpen(true)}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          {deleteConfigs.map((config) => (
            <DropdownMenuItem key={config.key} variant='destructive' onSelect={() => {
              setMenuOpen(false)
              setActiveDeleteConfig(config)
            }}>
              {config.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {activeDeleteConfig ? (
        <DeleteConfirmDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setActiveDeleteConfig(null)
          }}
          title={activeDeleteConfig.title}
          description={activeDeleteConfig.description}
          actionLabel={activeDeleteConfig.actionLabel}
          onConfirm={activeDeleteConfig.onConfirm}
        />
      ) : null}
    </>
  )
}

function ThreadActionMenu({
  compact = false,
  onDeleteThread,
}: {
  readonly compact?: boolean
  readonly onDeleteThread: () => CommentActionPromise
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button type='button' variant='ghost' size='icon' className={compact ? 'size-11' : 'h-7 w-7'} aria-label='讨论操作' onClick={() => setMenuOpen(true)}>
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
  readonly onConfirm: () => CommentActionPromise
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
        {error ? <div role='status' className='text-sm text-destructive'>{error}</div> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
          <AlertDialogAction
            className='bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40'
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

type CommentDeleteConfig = {
  readonly key: 'comment' | 'thread'
  readonly label: string
  readonly title: string
  readonly description: string
  readonly actionLabel: string
  readonly onConfirm: () => CommentActionPromise
}

function getCommentDeleteConfigs(
  onDeleteComment: (() => CommentActionPromise) | undefined,
  onDeleteThread: (() => CommentActionPromise) | undefined,
): CommentDeleteConfig[] {
  const configs: CommentDeleteConfig[] = []
  if (onDeleteComment) {
    configs.push({
      key: 'comment',
      label: '删除评论',
      title: '删除评论？',
      description: '会删除这条评论。',
      actionLabel: '删除评论',
      onConfirm: onDeleteComment,
    })
  }
  if (onDeleteThread) {
    configs.push({
      key: 'thread',
      label: '删除讨论',
      title: '删除讨论？',
      description: '会删除这条讨论及其回复。',
      actionLabel: '删除讨论',
      onConfirm: onDeleteThread,
    })
  }
  return configs
}

function displayAuthor(author: { readonly handle: string | null; readonly email: string | null } | undefined): string {
  return author?.handle || author?.email || '评论者'
}

function isInteractiveCommentTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('button, textarea, input, a'))
}

export function getCommentActionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return '操作失败'
}

function layoutRailThreads(
  items: readonly MarkdownCommentsRailThread[],
  measuredHeights: Record<string, number>,
  anchorBaseOffset = 0,
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
    const requestedTop = Math.max(0, (item.anchorTop ?? 0) + anchorBaseOffset - COMMENT_RAIL_HEADER_HEIGHT)
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
