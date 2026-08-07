import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DriveAnnotationCommentDto, DriveAnnotationThreadDto } from '@synapse/shared'
import { ChevronDown, Loader2, MoreHorizontal, RefreshCw } from 'lucide-react'
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
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
type CommentActionPromise = Promise<unknown>

type CommentRailMeasurements = {
  readonly cardHeights: Record<string, number>
  readonly headerHeight: number
  readonly unlocatedSectionHeight: number
}

type MeasurementTarget =
  | { readonly kind: 'card'; readonly threadId: string }
  | { readonly kind: 'header' }
  | { readonly kind: 'unlocated' }

type PendingMeasurement = number | HTMLElement | null

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
  onFocusThread,
  loading = false,
  onRefresh,
  onReply,
  onUpdateComment,
  onDeleteComment,
  onDeleteThread,
  onStartReassociate,
  anchorLayerRef,
  onAnchoredHeightChange,
  onAnchoredWheel,
}: {
  readonly mode?: 'anchored' | 'list'
  readonly threads: readonly MarkdownCommentsRailThread[]
  readonly activeThreadId: string | null
  readonly canReply: boolean
  readonly anchorBaseOffset?: number
  readonly onFocusThread: (threadId: string) => void
  readonly loading?: boolean
  readonly onRefresh?: () => void
  readonly onReply: (input: { readonly threadId: string; readonly parentCommentId: string | null; readonly body: string }) => CommentActionPromise
  readonly onUpdateComment: (input: { readonly commentId: string; readonly body: string }) => CommentActionPromise
  readonly onDeleteComment: (commentId: string) => CommentActionPromise
  readonly onDeleteThread: (threadId: string) => CommentActionPromise
  readonly onStartReassociate?: (threadId: string) => void
  readonly anchorLayerRef?: (element: HTMLDivElement | null) => void
  readonly onAnchoredHeightChange?: (height: number) => void
  readonly onAnchoredWheel?: (event: WheelEvent) => void
}) {
  const [unlocatedOpen, setUnlocatedOpen] = useState(true)
  const anchoredRegionRef = useRef<HTMLDivElement | null>(null)
  const partition = useMemo(() => partitionRailThreads(threads), [threads])
  const measurements = useCommentRailMeasurements(mode !== 'list', threads)
  const reservedTop = measurements.headerHeight + measurements.unlocatedSectionHeight
  const layout = useMemo(
    () => layoutRailThreads(partition.anchored, measurements.cardHeights, anchorBaseOffset, reservedTop),
    [anchorBaseOffset, measurements.cardHeights, partition.anchored, reservedTop]
  )

  const compact = mode === 'list'

  useLayoutEffect(() => {
    if (compact) return
    const anchoredDocumentHeight = layout.anchored.length > 0
      ? reservedTop + layout.anchoredHeight
      : 0
    onAnchoredHeightChange?.(anchoredDocumentHeight)
  }, [compact, layout.anchored.length, layout.anchoredHeight, onAnchoredHeightChange, reservedTop])

  useEffect(() => {
    const element = anchoredRegionRef.current
    if (compact || !element || !onAnchoredWheel) return
    element.addEventListener('wheel', onAnchoredWheel, { passive: false })
    return () => element.removeEventListener('wheel', onAnchoredWheel)
  }, [compact, onAnchoredWheel])

  if (compact) {
    return (
      <div
        data-markdown-comments-rail='true'
        data-markdown-comments-mode={mode}
        className='min-h-full bg-background'
      >
        <CommentsRailHeader compact threads={threads} loading={loading} onRefresh={onRefresh} />
        {threads.length === 0 ? (
          <div className='px-3 py-6 text-sm text-muted-foreground'>暂无评论</div>
        ) : (
          <div className='space-y-3 p-3'>
            {[...partition.orphaned, ...partition.anchored].map((item) => (
              <div key={item.thread.id} data-markdown-comment-thread-id={item.thread.id}>
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
                  onStartReassociate={onStartReassociate}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      data-markdown-comments-rail='true'
      data-markdown-comments-mode={mode}
      className='flex h-full min-h-0 flex-col overflow-hidden bg-background'
    >
      <CommentsRailHeader
        compact={false}
        threads={threads}
        loading={loading}
        onRefresh={onRefresh}
        elementRef={measurements.headerRef}
      />
      {partition.orphaned.length > 0 ? (
        <div ref={measurements.unlocatedSectionRef} data-markdown-comments-unlocated='true' className='shrink-0 border-b bg-muted/30'>
          <Collapsible open={unlocatedOpen} onOpenChange={setUnlocatedOpen}>
            <CollapsibleTrigger asChild>
              <Button type='button' variant='ghost' size='sm' className='w-full justify-between rounded-none px-3'>
                <span>未定位 {partition.orphaned.length}</span>
                <ChevronDown className={cn('size-4 transition-transform', unlocatedOpen && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div data-markdown-comments-unlocated-scroll='true' className='max-h-64 space-y-3 overflow-auto p-3 pt-0'>
                {partition.orphaned.map((item) => (
                  <div
                    key={item.thread.id}
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
                      onStartReassociate={onStartReassociate}
                    />
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      ) : null}
      <div ref={anchoredRegionRef} data-markdown-comments-scroll-region='true' className='relative min-h-0 flex-1 overflow-hidden'>
        {threads.length === 0 ? (
          <div className='px-3 py-6 text-sm text-muted-foreground'>暂无评论</div>
        ) : null}
        {layout.anchored.length > 0 ? (
          <div className='relative min-h-full overflow-hidden'>
            <div
              ref={anchorLayerRef}
              data-markdown-comments-anchored-layer='true'
              className='relative min-h-full p-3 will-change-transform'
              style={{ minHeight: layout.anchoredHeight }}
            >
              {layout.anchored.map(({ item, top }) => (
                <div
                  key={item.thread.id}
                  ref={measurements.cardRef(item.thread.id)}
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
                    onStartReassociate={onStartReassociate}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function CommentsRailHeader({
  compact,
  threads,
  loading,
  onRefresh,
  elementRef,
}: {
  readonly compact: boolean
  readonly threads: readonly MarkdownCommentsRailThread[]
  readonly loading: boolean
  readonly onRefresh?: () => void
  readonly elementRef?: (element: HTMLDivElement | null) => void
}) {
  return (
    <div ref={elementRef} data-markdown-comments-header='true' className={cn(
      'flex shrink-0 items-center justify-between border-b bg-background px-3 text-sm font-medium',
      compact ? 'sticky top-0 z-10 h-12 pr-14' : 'h-10'
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
  onStartReassociate,
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
  readonly onStartReassociate?: (threadId: string) => void
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
            <div className='min-w-0 space-y-1'>
              <div className='text-xs font-medium text-muted-foreground'>{annotationPositionLabel(thread)}</div>
              <div className='line-clamp-2 text-xs text-muted-foreground'>“{annotationQuoteExcerpt(thread)}”</div>
              {canReply && onStartReassociate ? (
                <Button type='button' variant='ghost' size='sm' className='h-7 px-2 text-xs' onClick={() => onStartReassociate(thread.id)}>
                  重新关联
                </Button>
              ) : null}
            </div>
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

function annotationPositionLabel(thread: DriveAnnotationThreadDto): string {
  if (thread.anchor?.positionStatus === 'source_deleted') return '原文已删除'
  if (thread.anchor?.positionStatus === 'ambiguous') return '位置不明确'
  if (thread.anchor?.positionStatus === 'unavailable') return '暂无法定位'
  return '原文已修改或删除'
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

function annotationQuoteExcerpt(thread: DriveAnnotationThreadDto): string {
  return thread.target.quote.exact.replace(/\s+/gu, ' ').trim()
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
  reservedTop = 0,
): {
  readonly anchored: readonly { readonly item: MarkdownCommentsRailThread; readonly top: number }[]
  readonly anchoredHeight: number
} {
  const anchoredSource = [...items].sort((a, b) => (a.anchorTop ?? 0) - (b.anchorTop ?? 0))
  const anchored: Array<{ readonly item: MarkdownCommentsRailThread; readonly top: number }> = []
  let previousBottom = 0

  for (const item of anchoredSource) {
    const requestedTop = Math.max(0, (item.anchorTop ?? 0) + anchorBaseOffset - reservedTop)
    const top = anchored.length === 0 ? requestedTop : Math.max(requestedTop, previousBottom + COMMENT_CARD_GAP)
    const height = measuredHeights[item.thread.id] ?? COMMENT_CARD_ESTIMATED_HEIGHT
    anchored.push({ item, top })
    previousBottom = top + height
  }

  return { anchored, anchoredHeight: anchored.length > 0 ? previousBottom : 0 }
}

function partitionRailThreads(items: readonly MarkdownCommentsRailThread[]): {
  readonly anchored: readonly MarkdownCommentsRailThread[]
  readonly orphaned: readonly MarkdownCommentsRailThread[]
} {
  const orphaned = items
    .filter((item) => item.anchorTop === null || item.thread.anchorStatus === 'orphaned')
    .sort((a, b) => Date.parse(b.thread.updatedAt) - Date.parse(a.thread.updatedAt))
  const anchored = items.filter((item) => item.anchorTop !== null && item.thread.anchorStatus !== 'orphaned')
  return { anchored, orphaned }
}

function useCommentRailMeasurements(enabled: boolean, threads: readonly MarkdownCommentsRailThread[]) {
  const cardElementsRef = useRef(new Map<string, HTMLElement>())
  const headerElementRef = useRef<HTMLElement | null>(null)
  const unlocatedElementRef = useRef<HTMLElement | null>(null)
  const targetByElementRef = useRef(new WeakMap<Element, MeasurementTarget>())
  const cardRefCallbacksRef = useRef(new Map<string, (element: HTMLDivElement | null) => void>())
  const observerRef = useRef<ResizeObserver | null>(null)
  const pendingCardMeasurementsRef = useRef(new Map<string, PendingMeasurement>())
  const pendingHeaderMeasurementRef = useRef<PendingMeasurement | undefined>(undefined)
  const pendingUnlocatedMeasurementRef = useRef<PendingMeasurement | undefined>(undefined)
  const frameRef = useRef<number | null>(null)
  const disposedRef = useRef(false)
  const initialMeasurements: CommentRailMeasurements = {
    cardHeights: {},
    headerHeight: 0,
    unlocatedSectionHeight: 0,
  }
  const measurementsRef = useRef(initialMeasurements)
  const [measurements, setMeasurements] = useState<CommentRailMeasurements>(initialMeasurements)

  const flushMeasurements = useCallback(() => {
    frameRef.current = null
    const pendingCards = [...pendingCardMeasurementsRef.current]
    const pendingHeader = pendingHeaderMeasurementRef.current
    const pendingUnlocated = pendingUnlocatedMeasurementRef.current
    pendingCardMeasurementsRef.current.clear()
    pendingHeaderMeasurementRef.current = undefined
    pendingUnlocatedMeasurementRef.current = undefined

    const resolvedCards = pendingCards.map(([threadId, value]) => [
      threadId,
      resolvePendingMeasurement(value, COMMENT_CARD_ESTIMATED_HEIGHT),
    ] as const)
    const resolvedHeader = pendingHeader === undefined
      ? undefined
      : resolvePendingMeasurement(pendingHeader, 0)
    const resolvedUnlocated = pendingUnlocated === undefined
      ? undefined
      : resolvePendingMeasurement(pendingUnlocated, 0)

    setMeasurements((current) => {
      let nextCardHeights = current.cardHeights
      let changed = false

      for (const [threadId, height] of resolvedCards) {
        if (height === null) {
          if (!(threadId in nextCardHeights)) continue
          if (nextCardHeights === current.cardHeights) nextCardHeights = { ...current.cardHeights }
          delete nextCardHeights[threadId]
          changed = true
          continue
        }
        if (nextCardHeights[threadId] === height) continue
        if (nextCardHeights === current.cardHeights) nextCardHeights = { ...current.cardHeights }
        nextCardHeights[threadId] = height
        changed = true
      }

      const nextHeaderHeight = resolvedHeader === undefined
        ? current.headerHeight
        : resolvedHeader ?? 0
      if (nextHeaderHeight !== current.headerHeight) changed = true
      const nextUnlocatedHeight = resolvedUnlocated === undefined
        ? current.unlocatedSectionHeight
        : resolvedUnlocated ?? 0
      if (nextUnlocatedHeight !== current.unlocatedSectionHeight) changed = true
      if (!changed) return current
      const next = {
        cardHeights: nextCardHeights,
        headerHeight: nextHeaderHeight,
        unlocatedSectionHeight: nextUnlocatedHeight,
      }
      measurementsRef.current = next
      return next
    })
  }, [])

  const scheduleFrame = useCallback(() => {
    if (disposedRef.current || frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(flushMeasurements)
  }, [flushMeasurements])

  const scheduleCardMeasurement = useCallback((threadId: string, value: PendingMeasurement) => {
    pendingCardMeasurementsRef.current.set(threadId, value)
    scheduleFrame()
  }, [scheduleFrame])

  const scheduleHeaderMeasurement = useCallback((value: PendingMeasurement) => {
    pendingHeaderMeasurementRef.current = value
    scheduleFrame()
  }, [scheduleFrame])

  const scheduleUnlocatedMeasurement = useCallback((value: PendingMeasurement) => {
    pendingUnlocatedMeasurementRef.current = value
    scheduleFrame()
  }, [scheduleFrame])

  const registerCardElement = useCallback((threadId: string, element: HTMLDivElement | null) => {
    const previous = cardElementsRef.current.get(threadId)
    if (previous === element) return
    if (previous) {
      unobserveElement(observerRef.current, previous)
      targetByElementRef.current.delete(previous)
    }
    if (!element) {
      cardElementsRef.current.delete(threadId)
      // Preserve the last valid height across transient ref detaches to avoid fallback-size oscillation.
      return
    }
    cardElementsRef.current.set(threadId, element)
    targetByElementRef.current.set(element, { kind: 'card', threadId })
    observerRef.current?.observe(element)
    if (typeof ResizeObserver === 'undefined') scheduleCardMeasurement(threadId, element)
  }, [scheduleCardMeasurement])

  const cardRef = useCallback((threadId: string) => {
    const existing = cardRefCallbacksRef.current.get(threadId)
    if (existing) return existing
    const callback = (element: HTMLDivElement | null) => {
      registerCardElement(threadId, element)
      if (!element) cardRefCallbacksRef.current.delete(threadId)
    }
    cardRefCallbacksRef.current.set(threadId, callback)
    return callback
  }, [registerCardElement])

  const headerRef = useCallback((element: HTMLDivElement | null) => {
    const previous = headerElementRef.current
    if (previous === element) return
    if (previous) {
      unobserveElement(observerRef.current, previous)
      targetByElementRef.current.delete(previous)
    }
    headerElementRef.current = element
    if (!element) {
      if (pendingHeaderMeasurementRef.current === undefined && measurementsRef.current.headerHeight === 0) return
      scheduleHeaderMeasurement(null)
      return
    }
    targetByElementRef.current.set(element, { kind: 'header' })
    observerRef.current?.observe(element)
    if (typeof ResizeObserver === 'undefined') scheduleHeaderMeasurement(element)
  }, [scheduleHeaderMeasurement])

  const unlocatedSectionRef = useCallback((element: HTMLDivElement | null) => {
    const previous = unlocatedElementRef.current
    if (previous === element) return
    if (previous) {
      unobserveElement(observerRef.current, previous)
      targetByElementRef.current.delete(previous)
    }
    unlocatedElementRef.current = element
    if (!element) {
      if (pendingUnlocatedMeasurementRef.current === undefined && measurementsRef.current.unlocatedSectionHeight === 0) return
      scheduleUnlocatedMeasurement(null)
      return
    }
    targetByElementRef.current.set(element, { kind: 'unlocated' })
    observerRef.current?.observe(element)
    if (typeof ResizeObserver === 'undefined') scheduleUnlocatedMeasurement(element)
  }, [scheduleUnlocatedMeasurement])

  useLayoutEffect(() => {
    if (!enabled || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = targetByElementRef.current.get(entry.target)
        if (!target) continue
        const height = resizeObserverEntryHeight(entry)
        if (target.kind === 'card') scheduleCardMeasurement(target.threadId, height)
        else if (target.kind === 'header') scheduleHeaderMeasurement(height)
        else scheduleUnlocatedMeasurement(height)
      }
    })
    observerRef.current = observer
    cardElementsRef.current.forEach((element) => observer.observe(element))
    if (headerElementRef.current) observer.observe(headerElementRef.current)
    if (unlocatedElementRef.current) observer.observe(unlocatedElementRef.current)
    return () => {
      if (observerRef.current === observer) observerRef.current = null
      observer.disconnect()
    }
  }, [enabled, scheduleCardMeasurement, scheduleHeaderMeasurement, scheduleUnlocatedMeasurement])

  useLayoutEffect(() => {
    if (!enabled || !headerElementRef.current) return
    const headerHeight = resolvePendingMeasurement(headerElementRef.current, 0) ?? 0
    setMeasurements((current) => {
      if (current.headerHeight === headerHeight) return current
      const next = { ...current, headerHeight }
      measurementsRef.current = next
      return next
    })
  }, [enabled])

  useLayoutEffect(() => {
    if (!enabled || typeof ResizeObserver !== 'undefined') return
    cardElementsRef.current.forEach((element, threadId) => scheduleCardMeasurement(threadId, element))
    scheduleHeaderMeasurement(headerElementRef.current)
    scheduleUnlocatedMeasurement(unlocatedElementRef.current)
  }, [enabled, threads, scheduleCardMeasurement, scheduleHeaderMeasurement, scheduleUnlocatedMeasurement])

  useEffect(() => {
    const activeThreadIds = new Set(threads.map((item) => item.thread.id))
    setMeasurements((current) => {
      const staleThreadIds = Object.keys(current.cardHeights).filter((threadId) => !activeThreadIds.has(threadId))
      if (staleThreadIds.length === 0) return current
      const cardHeights = { ...current.cardHeights }
      for (const threadId of staleThreadIds) {
        delete cardHeights[threadId]
        pendingCardMeasurementsRef.current.delete(threadId)
      }
      const next = { ...current, cardHeights }
      measurementsRef.current = next
      return next
    })
  }, [threads])

  useLayoutEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      pendingCardMeasurementsRef.current.clear()
      pendingHeaderMeasurementRef.current = undefined
      pendingUnlocatedMeasurementRef.current = undefined
    }
  }, [])

  return { ...measurements, cardRef, headerRef, unlocatedSectionRef }
}

function resolvePendingMeasurement(value: PendingMeasurement, fallback: number): number | null {
  if (value === null) return null
  if (typeof value === 'number') return Math.max(0, Math.ceil(value))
  if (!value.isConnected) return null
  const measured = value.getBoundingClientRect().height || value.offsetHeight
  return Math.max(0, Math.ceil(measured || fallback))
}

function resizeObserverEntryHeight(entry: ResizeObserverEntry): number {
  return entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
}

function unobserveElement(observer: ResizeObserver | null, element: Element): void {
  if (observer && typeof observer.unobserve === 'function') observer.unobserve(element)
}
