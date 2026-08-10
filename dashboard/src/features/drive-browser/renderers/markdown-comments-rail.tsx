import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { DriveAnnotationCommentDto, DriveAnnotationThreadDto } from '@synapse/shared'
import { ChevronDown, Loader2, MoreHorizontal, RefreshCw } from 'lucide-react'
import { RelativeTime } from '@/components/relative-time'
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import { cn, getDisplayNameInitials } from '@/lib/utils'

const COMMENT_CARD_ESTIMATED_HEIGHT = 128
const COMMENT_CARD_GAP = 12
const COMMENT_DRAFT_CARD_ID = '__comment-draft__'
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

export type MarkdownCommentDraft = {
  readonly anchorTop: number
  readonly quote: string
  readonly value: string
  readonly submitting: boolean
  readonly error: string | null
  readonly onValueChange: (value: string) => void
  readonly onSubmit: () => void
  readonly onCancel: () => void
}

type AnchoredRailCard =
  | { readonly id: string; readonly kind: 'thread'; readonly anchorTop: number; readonly item: MarkdownCommentsRailThread }
  | { readonly id: typeof COMMENT_DRAFT_CARD_ID; readonly kind: 'draft'; readonly anchorTop: number; readonly draft: MarkdownCommentDraft }

export function MarkdownCommentsRail({
  mode = 'anchored',
  threads,
  draft,
  activeThreadId,
  canReply,
  anchorBaseOffset = 0,
  onFocusThread,
  loading = false,
  onRefresh,
  onReply,
  onUpdateComment,
  onDeleteComment,
  onStartReassociate,
  anchorLayerRef,
  onAnchoredHeightChange,
  onAnchoredWheel,
}: {
  readonly mode?: 'anchored' | 'list'
  readonly threads: readonly MarkdownCommentsRailThread[]
  readonly draft?: MarkdownCommentDraft | null
  readonly activeThreadId: string | null
  readonly canReply: boolean
  readonly anchorBaseOffset?: number
  readonly onFocusThread: (threadId: string) => void
  readonly loading?: boolean
  readonly onRefresh?: () => void
  readonly onReply: (input: { readonly threadId: string; readonly parentCommentId: string | null; readonly body: string }) => CommentActionPromise
  readonly onUpdateComment: (input: { readonly commentId: string; readonly body: string }) => CommentActionPromise
  readonly onDeleteComment: (commentId: string) => CommentActionPromise
  readonly onStartReassociate?: (threadId: string) => void
  readonly anchorLayerRef?: (element: HTMLDivElement | null) => void
  readonly onAnchoredHeightChange?: (height: number) => void
  readonly onAnchoredWheel?: (event: WheelEvent) => void
}) {
  const [unlocatedOpen, setUnlocatedOpen] = useState(true)
  const anchoredRegionRef = useRef<HTMLDivElement | null>(null)
  const partition = useMemo(() => partitionRailThreads(threads), [threads])
  const anchoredCards = useMemo<readonly AnchoredRailCard[]>(() => {
    const cards: AnchoredRailCard[] = partition.anchored.map((item) => ({
      id: item.thread.id,
      kind: 'thread',
      anchorTop: item.anchorTop ?? 0,
      item,
    }))
    if (draft) cards.push({ id: COMMENT_DRAFT_CARD_ID, kind: 'draft', anchorTop: draft.anchorTop, draft })
    return cards
  }, [draft, partition.anchored])
  const measurementIds = useMemo(
    () => [...threads.map((item) => item.thread.id), ...(draft ? [COMMENT_DRAFT_CARD_ID] : [])],
    [draft, threads]
  )
  const measurements = useCommentRailMeasurements(mode !== 'list', measurementIds)
  const reservedTop = measurements.headerHeight + measurements.unlocatedSectionHeight
  const layout = useMemo(
    () => layoutRailCards(anchoredCards, measurements.cardHeights, anchorBaseOffset, reservedTop),
    [anchorBaseOffset, anchoredCards, measurements.cardHeights, reservedTop]
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
        {threads.length === 0 && !draft ? (
          <div className='px-3 py-6 text-sm text-muted-foreground'>暂无评论</div>
        ) : (
          <div className='space-y-3 p-3'>
            {draft ? <CommentDraftCard draft={draft} compact /> : null}
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
        {threads.length === 0 && !draft ? (
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
                  key={item.id}
                  ref={measurements.cardRef(item.id)}
                  data-markdown-comment-thread-id={item.kind === 'thread' ? item.item.thread.id : undefined}
                  data-markdown-comment-draft={item.kind === 'draft' ? 'true' : undefined}
                  className='absolute left-3 right-3'
                  style={{ top }}
                >
                  {item.kind === 'thread' ? (
                    <ThreadView
                      thread={item.item.thread}
                      active={item.item.thread.id === activeThreadId}
                      canReply={canReply}
                      compact={false}
                      onFocusThread={onFocusThread}
                      onReply={onReply}
                      onUpdateComment={onUpdateComment}
                      onDeleteComment={onDeleteComment}
                      onStartReassociate={onStartReassociate}
                    />
                  ) : <CommentDraftCard draft={item.draft} compact={false} />}
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

function CommentDraftCard({ draft, compact }: { readonly draft: MarkdownCommentDraft; readonly compact: boolean }) {
  return (
    <section
      data-markdown-comment-draft-card='true'
      className='relative overflow-hidden rounded-lg border border-amber-400/70 bg-muted/30 p-3 pt-4 text-sm dark:border-amber-600/70'
    >
      <div aria-hidden className='absolute inset-x-0 top-0 h-1 bg-amber-400 dark:bg-amber-600' />
      <div className='mb-3 line-clamp-2 text-xs font-medium text-muted-foreground'>“{draft.quote}”</div>
      <CommentComposer
        dataAttribute='draft'
        value={draft.value}
        ariaLabel='添加评论'
        placeholder='添加评论'
        compact={compact}
        submitting={draft.submitting}
        error={draft.error}
        submitLabel='评论'
        submittingLabel='提交中'
        autoFocus
        onValueChange={draft.onValueChange}
        onCancel={draft.onCancel}
        onSubmit={draft.onSubmit}
      />
    </section>
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
  readonly onStartReassociate?: (threadId: string) => void
}) {
  const [replyingToCommentId, setReplyingToCommentId] = useState<string | null>(null)
  const [replyComposerOpen, setReplyComposerOpen] = useState(active)
  const [replyComposerRevision, setReplyComposerRevision] = useState(0)
  const [replyValue, setReplyValue] = useState('')
  const [replySubmitting, setReplySubmitting] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const previousActiveRef = useRef(active)
  const authorByCommentId = useMemo(() => new Map(thread.comments.map((comment) => [comment.id, comment.author])), [thread.comments])
  const replyingToComment = thread.comments.find((comment) => comment.id === replyingToCommentId && !comment.deleted) ?? null
  const composerVisible = replyComposerOpen && (active || replyingToCommentId !== null)
  const emphasized = active || composerVisible
  const quote = annotationQuoteExcerpt(thread)

  useEffect(() => {
    if (active && !previousActiveRef.current) setReplyComposerOpen(true)
    previousActiveRef.current = active
  }, [active])

  const openReplyComposer = (commentId: string | null) => {
    setReplyingToCommentId(commentId)
    setReplyComposerOpen(true)
    setReplyValue('')
    setReplyError(null)
    setReplyComposerRevision((current) => current + 1)
  }

  const submitReply = async () => {
    if (!replyValue.trim() || replySubmitting) return
    setReplySubmitting(true)
    setReplyError(null)
    try {
      await onReply({ threadId: thread.id, parentCommentId: replyingToComment?.id ?? null, body: replyValue })
      setReplyComposerOpen(false)
      setReplyingToCommentId(null)
      setReplyValue('')
    } catch (cause) {
      setReplyError(getCommentActionErrorMessage(cause))
    } finally {
      setReplySubmitting(false)
    }
  }

  return (
    <section
      tabIndex={0}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'relative cursor-default overflow-hidden rounded-lg border border-border bg-card p-3 pt-4 text-sm transition-colors hover:border-ring/60 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-within:border-ring',
        emphasized && 'border-amber-400/70 bg-muted/30 dark:border-amber-600/70'
      )}
      onClick={(event) => {
        if (isInteractiveCommentTarget(event.target) || hasSelectionWithin(event.currentTarget)) return
        onFocusThread(thread.id)
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        onFocusThread(thread.id)
      }}
    >
      {active ? <span className='sr-only'>当前评论</span> : null}
      {emphasized ? <div aria-hidden className='absolute inset-x-0 top-0 h-1 bg-amber-400 dark:bg-amber-600' /> : null}
      <div className='mb-3 flex items-start gap-2'>
        <span aria-hidden className='mt-0.5 h-4 w-0.5 shrink-0 rounded-full bg-border' />
        <div className='min-w-0 flex-1 space-y-1'>
          <div className='line-clamp-2 text-xs font-medium text-muted-foreground'>“{quote}”</div>
          {thread.anchorStatus === 'orphaned' ? (
            <div className='flex flex-wrap items-center gap-1'>
              <span className='text-xs text-muted-foreground'>{annotationPositionLabel(thread)}</span>
              {canReply && onStartReassociate ? (
                <Button type='button' variant='ghost' size='sm' className='h-7 px-2 text-xs' onClick={() => onStartReassociate(thread.id)}>
                  重新关联
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className='space-y-4'>
        {thread.comments.map((comment) => (
          <CommentView
            key={comment.id}
            comment={comment}
            replyToName={comment.parentCommentId ? displayAuthor(authorByCommentId.get(comment.parentCommentId)) : null}
            canReply={canReply}
            compact={compact}
            deleteDescription={commentDeleteDescription(comment, thread.comments)}
            onStartReply={() => openReplyComposer(comment.id)}
            onStartEdit={() => setReplyComposerOpen(false)}
            onUpdateComment={onUpdateComment}
            onDeleteComment={onDeleteComment}
          />
        ))}
      </div>
      {replyComposerOpen ? (
        <div className={cn(!composerVisible && 'hidden')}>
          <CommentComposer
            key={replyComposerRevision}
            dataAttribute='reply'
            value={replyValue}
            ariaLabel={replyingToComment ? `回复 ${displayAuthor(replyingToComment.author)}` : '回复讨论'}
            label={replyingToComment ? `回复 ${displayAuthor(replyingToComment.author)}` : null}
            placeholder='回复'
            compact={compact}
            submitting={replySubmitting}
            error={replyError}
            submitLabel='发送'
            submittingLabel='发送中'
            autoFocus={replyingToCommentId !== null}
            onValueChange={(value) => {
              setReplyValue(value)
              if (replyError) setReplyError(null)
            }}
            onCancel={() => {
              setReplyComposerOpen(false)
              setReplyingToCommentId(null)
              setReplyValue('')
              setReplyError(null)
            }}
            onSubmit={() => { void submitReply() }}
          />
        </div>
      ) : null}
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
  deleteDescription,
  onStartReply,
  onStartEdit,
  onUpdateComment,
  onDeleteComment,
}: {
  readonly comment: DriveAnnotationCommentDto
  readonly replyToName: string | null
  readonly canReply: boolean
  readonly compact: boolean
  readonly deleteDescription: string
  readonly onStartReply: () => void
  readonly onStartEdit: () => void
  readonly onUpdateComment: (input: { readonly commentId: string; readonly body: string }) => CommentActionPromise
  readonly onDeleteComment: (commentId: string) => CommentActionPromise
}) {
  const [editValue, setEditValue] = useState<string | null>(null)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  if (comment.deleted) {
    return <div className='text-xs text-muted-foreground'>评论已删除</div>
  }
  const authorName = displayAuthor(comment.author)
  return (
    <article className='group/comment'>
      <div className='flex items-start gap-2.5'>
        <Avatar className='size-8'>
          <AvatarFallback className='text-xs font-medium text-muted-foreground'>
            {getDisplayNameInitials(authorName)}
          </AvatarFallback>
        </Avatar>
        <div className='min-w-0 flex-1 space-y-1.5'>
          <div className='flex items-start justify-between gap-2'>
            <div className='flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5'>
              <span className='truncate text-sm font-medium'>{authorName}</span>
              <RelativeTime value={comment.createdAt} className='text-xs text-muted-foreground' />
              {comment.editedAt ? <span className='text-xs text-muted-foreground'>已编辑</span> : null}
            </div>
            {comment.permissions.canDelete ? (
              <div className={cn('shrink-0 transition-opacity', !compact && 'opacity-40 group-hover/comment:opacity-100 group-focus-within/comment:opacity-100')}>
                <CommentActionMenu
                  compact={compact}
                  deleteDescription={deleteDescription}
                  onDeleteComment={() => onDeleteComment(comment.id)}
                />
              </div>
            ) : null}
          </div>
          {replyToName ? <div className='text-xs text-muted-foreground'>回复 {replyToName}</div> : null}
          <p className='whitespace-pre-wrap break-words text-sm leading-5'>{comment.body}</p>
          <div className={cn(
            '-ml-2 flex flex-wrap items-center gap-1 transition-opacity',
            !compact && 'opacity-70 group-hover/comment:opacity-100 group-focus-within/comment:opacity-100'
          )}>
            {canReply ? (
              <Button type='button' variant='ghost' size='sm' className={cn(compact ? 'min-h-11 px-3' : 'h-7 px-2', 'text-xs')} onClick={onStartReply}>回复</Button>
            ) : null}
            {comment.permissions.canEdit ? (
              <Button type='button' variant='ghost' size='sm' className={cn(compact ? 'min-h-11 px-3' : 'h-7 px-2', 'text-xs')} onClick={() => {
                onStartEdit()
                setEditValue(comment.body)
              }}>编辑</Button>
            ) : null}
          </div>
        </div>
      </div>
      {editValue !== null ? (
        <CommentComposer
          dataAttribute='edit'
          value={editValue}
          ariaLabel='编辑评论'
          placeholder='编辑评论'
          compact={compact}
          submitting={editSubmitting}
          error={editError}
          submitLabel='保存'
          submittingLabel='保存中'
          autoFocus
          onValueChange={(value) => {
            setEditValue(value)
            if (editError) setEditError(null)
          }}
          onCancel={() => {
            setEditValue(null)
            setEditError(null)
          }}
          onSubmit={() => {
            if (!editValue.trim() || editSubmitting) return
            setEditSubmitting(true)
            setEditError(null)
            void onUpdateComment({ commentId: comment.id, body: editValue })
              .then(() => setEditValue(null))
              .catch((cause) => setEditError(getCommentActionErrorMessage(cause)))
              .finally(() => setEditSubmitting(false))
          }}
        />
      ) : null}
    </article>
  )
}

function CommentComposer({
  dataAttribute,
  value,
  ariaLabel,
  label = null,
  placeholder,
  compact,
  submitting,
  error,
  submitLabel,
  submittingLabel,
  autoFocus = false,
  onValueChange,
  onCancel,
  onSubmit,
}: {
  readonly dataAttribute: 'draft' | 'reply' | 'edit'
  readonly value: string
  readonly ariaLabel: string
  readonly label?: string | null
  readonly placeholder: string
  readonly compact: boolean
  readonly submitting: boolean
  readonly error: string | null
  readonly submitLabel: string
  readonly submittingLabel: string
  readonly autoFocus?: boolean
  readonly onValueChange: (value: string) => void
  readonly onCancel: () => void
  readonly onSubmit: () => void
}) {
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onSubmit()
      return
    }
    if (event.key === 'Escape' && !value.trim()) {
      event.preventDefault()
      onCancel()
    }
  }

  return (
    <div
      data-markdown-comment-draft-composer={dataAttribute === 'draft' ? 'true' : undefined}
      data-markdown-comment-reply-composer={dataAttribute === 'reply' ? 'true' : undefined}
      data-markdown-comment-edit-composer={dataAttribute === 'edit' ? 'true' : undefined}
      className='mt-3 border-t pt-3'
      onClick={(event) => event.stopPropagation()}
    >
      {label ? <div className='mb-2 text-xs text-muted-foreground'>{label}</div> : null}
      <Textarea
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={submitting}
        autoFocus={autoFocus}
        onChange={(event) => onValueChange(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      {error ? <div role='status' className='mt-2 text-sm text-destructive'>{error}</div> : null}
      <div className='mt-2 flex justify-end gap-1'>
        <Button type='button' variant='ghost' size='sm' className={compact ? 'min-h-11' : 'h-7'} disabled={submitting} onClick={onCancel}>取消</Button>
        <Button type='button' size='sm' className={compact ? 'min-h-11' : 'h-7'} disabled={!value.trim() || submitting} onClick={onSubmit}>
          {submitting ? submittingLabel : submitLabel}
        </Button>
      </div>
    </div>
  )
}

function CommentActionMenu({
  compact = false,
  deleteDescription,
  onDeleteComment,
}: {
  readonly compact?: boolean
  readonly deleteDescription: string
  readonly onDeleteComment: () => CommentActionPromise
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button type='button' variant='ghost' size='icon' className={compact ? 'size-11' : 'h-7 w-7'} aria-label='更多评论操作' onClick={() => setMenuOpen(true)}>
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
      {deleteOpen ? (
        <DeleteConfirmDialog
          open={true}
          onOpenChange={setDeleteOpen}
          title='删除评论？'
          description={deleteDescription}
          actionLabel='删除评论'
          onConfirm={onDeleteComment}
        />
      ) : null}
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

function displayAuthor(author: { readonly handle: string | null; readonly email: string | null } | undefined): string {
  return author?.handle || author?.email || '评论者'
}

function isInteractiveCommentTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('button, textarea, input, select, a, [contenteditable="true"], [role="button"]'))
}

function hasSelectionWithin(element: HTMLElement): boolean {
  const selection = element.ownerDocument.getSelection()
  if (!selection || selection.isCollapsed || !selection.toString()) return false
  return [selection.anchorNode, selection.focusNode].some((node) => node && element.contains(node))
}

function commentDeleteDescription(
  comment: DriveAnnotationCommentDto,
  comments: readonly DriveAnnotationCommentDto[]
): string {
  const visibleComments = comments.filter((item) => !item.deleted)
  if (visibleComments.length === 1) return '删除后，该讨论和原文标记会一并移除。'
  if (hasVisibleDescendant(comment.id, visibleComments)) return '删除后将显示“评论已删除”，回复会保留。'
  return '删除后无法恢复。'
}

function hasVisibleDescendant(commentId: string, comments: readonly DriveAnnotationCommentDto[]): boolean {
  const parentById = new Map(comments.map((comment) => [comment.id, comment.parentCommentId]))
  return comments.some((comment) => {
    let parentCommentId = comment.parentCommentId
    const visited = new Set<string>()
    while (parentCommentId && !visited.has(parentCommentId)) {
      if (parentCommentId === commentId) return true
      visited.add(parentCommentId)
      parentCommentId = parentById.get(parentCommentId) ?? null
    }
    return false
  })
}

function annotationQuoteExcerpt(thread: DriveAnnotationThreadDto): string {
  return thread.target.quote.exact.replace(/\s+/gu, ' ').trim()
}

export function getCommentActionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return '操作失败'
}

function layoutRailCards(
  items: readonly AnchoredRailCard[],
  measuredHeights: Record<string, number>,
  anchorBaseOffset = 0,
  reservedTop = 0,
): {
  readonly anchored: readonly { readonly item: AnchoredRailCard; readonly top: number }[]
  readonly anchoredHeight: number
} {
  const anchoredSource = [...items].sort((a, b) => a.anchorTop - b.anchorTop)
  const anchored: Array<{ readonly item: AnchoredRailCard; readonly top: number }> = []
  let previousBottom = 0

  for (const item of anchoredSource) {
    const requestedTop = Math.max(0, item.anchorTop + anchorBaseOffset - reservedTop)
    const top = anchored.length === 0 ? requestedTop : Math.max(requestedTop, previousBottom + COMMENT_CARD_GAP)
    const height = measuredHeights[item.id] ?? COMMENT_CARD_ESTIMATED_HEIGHT
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

function useCommentRailMeasurements(enabled: boolean, cardIds: readonly string[]) {
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
  }, [cardIds, enabled, scheduleCardMeasurement, scheduleHeaderMeasurement, scheduleUnlocatedMeasurement])

  useEffect(() => {
    const activeCardIds = new Set(cardIds)
    setMeasurements((current) => {
      const staleCardIds = Object.keys(current.cardHeights).filter((cardId) => !activeCardIds.has(cardId))
      if (staleCardIds.length === 0) return current
      const cardHeights = { ...current.cardHeights }
      for (const cardId of staleCardIds) {
        delete cardHeights[cardId]
        pendingCardMeasurementsRef.current.delete(cardId)
      }
      const next = { ...current, cardHeights }
      measurementsRef.current = next
      return next
    })
  }, [cardIds])

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
