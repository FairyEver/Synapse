import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { DriveAnnotationCommentDto, DriveAnnotationThreadDto, DriveAnnotationThreadStatus } from '@synapse/shared'
import { ChevronDown, ChevronRight, ChevronUp, Loader2, MapPinOff, MoreHorizontal, Pencil, Quote, RefreshCw, Reply, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { RelativeTime } from '@/components/relative-time'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFrame,
  DialogFrameBody,
  DialogFrameHeader,
} from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn, getDisplayNameInitials } from '@/lib/utils'

const COMMENT_CARD_ESTIMATED_HEIGHT = 128
const COMMENT_CARD_GAP = 8
const COMMENT_DRAFT_CARD_ID = '__comment-draft__'
const COMMENT_COMPOSER_EVENT_KEYS = {
  draft: 'web.drive.comment.create',
  reply: 'web.drive.comment.reply',
  edit: 'web.drive.comment.update',
} as const
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

type ThreadComposerState =
  | { readonly kind: 'closed' }
  | {
      readonly kind: 'reply'
      readonly parentCommentId: string | null
      readonly value: string
      readonly submitting: boolean
      readonly error: string | null
      readonly revision: number
    }
  | {
      readonly kind: 'edit'
      readonly commentId: string
      readonly value: string
      readonly submitting: boolean
      readonly error: string | null
    }

type ThreadEditComposerState = Extract<ThreadComposerState, { readonly kind: 'edit' }>

export type DriveCommentsRailItem = {
  readonly thread: DriveAnnotationThreadDto
  readonly placement:
    | { readonly status: 'positioned'; readonly anchorTop: number }
    | { readonly status: 'unavailable' }
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
  | { readonly id: string; readonly kind: 'thread'; readonly anchorTop: number; readonly item: DriveCommentsRailItem }
  | { readonly id: typeof COMMENT_DRAFT_CARD_ID; readonly kind: 'draft'; readonly anchorTop: number; readonly draft: MarkdownCommentDraft }

export function DriveCommentsRail({
  mode = 'anchored',
  threads,
  draft,
  activeThreadId,
  canReply,
  anchorBaseOffset = 0,
  onFocusThread,
  loading = false,
  onRefresh,
  onNavigatePrevious,
  onNavigateNext,
  onReply,
  onUpdateComment,
  onUpdateThreadStatus,
  onDeleteComment,
  anchorLayerRef,
  onAnchoredHeightChange,
  onAnchoredWheel,
}: {
  readonly mode?: 'anchored' | 'list'
  readonly threads: readonly DriveCommentsRailItem[]
  readonly draft?: MarkdownCommentDraft | null
  readonly activeThreadId: string | null
  readonly canReply: boolean
  readonly anchorBaseOffset?: number
  readonly onFocusThread: (threadId: string) => void
  readonly loading?: boolean
  readonly onRefresh?: () => void
  readonly onNavigatePrevious?: () => void
  readonly onNavigateNext?: () => void
  readonly onReply: (input: { readonly threadId: string; readonly parentCommentId: string | null; readonly body: string }) => CommentActionPromise
  readonly onUpdateThreadStatus: (input: { readonly threadId: string; readonly status: DriveAnnotationThreadStatus }) => CommentActionPromise
  readonly onUpdateComment: (input: { readonly commentId: string; readonly body: string }) => CommentActionPromise
  readonly onDeleteComment: (commentId: string) => CommentActionPromise
  readonly anchorLayerRef?: (element: HTMLDivElement | null) => void
  readonly onAnchoredHeightChange?: (height: number) => void
  readonly onAnchoredWheel?: (event: WheelEvent) => void
}) {
  const [unlocatedDialogOpen, setUnlocatedDialogOpen] = useState(false)
  const anchoredRegionRef = useRef<HTMLDivElement | null>(null)
  const partition = useMemo(() => partitionRailThreads(threads), [threads])
  const unlocatedThreads = useMemo(
    () => mode === 'list'
      ? partition.orphaned
      : [...partition.orphaned, ...partition.unavailable],
    [mode, partition]
  )
  const listThreads = useMemo(
    () => mode === 'list'
      ? [...partition.anchored, ...partition.unavailable]
      : partition.anchored,
    [mode, partition]
  )
  const anchoredCards = useMemo<readonly AnchoredRailCard[]>(() => {
    const cards: AnchoredRailCard[] = partition.anchored.map((item) => ({
      id: item.thread.id,
      kind: 'thread',
      anchorTop: item.placement.status === 'positioned' ? item.placement.anchorTop : 0,
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

  useEffect(() => {
    if (unlocatedThreads.length === 0) setUnlocatedDialogOpen(false)
  }, [unlocatedThreads.length])

  const unlocatedButton = unlocatedThreads.length > 0 ? (
    <UnlocatedCommentsButton
      count={unlocatedThreads.length}
      label={partition.orphaned.length > 0 ? '未定位评论' : '编辑中暂未定位'}
      compact={compact}
      elementRef={compact ? undefined : measurements.unlocatedSectionRef}
      onClick={() => setUnlocatedDialogOpen(true)}
    />
  ) : null
  const unlocatedDialog = unlocatedThreads.length > 0 ? (
    <UnlocatedCommentsDialog
      open={unlocatedDialogOpen}
      threads={unlocatedThreads}
      activeThreadId={activeThreadId}
      canReply={canReply}
      compact={compact}
      onOpenChange={setUnlocatedDialogOpen}
      onFocusThread={onFocusThread}
      onReply={onReply}
      onUpdateThreadStatus={onUpdateThreadStatus}
      onUpdateComment={onUpdateComment}
      onDeleteComment={onDeleteComment}
    />
  ) : null

  if (compact) {
    return (
      <div
        data-markdown-comments-rail='true'
        data-markdown-comments-mode={mode}
        className='min-h-full bg-background'
      >
        <CommentsRailHeader
          compact
          count={threads.length + (draft ? 1 : 0)}
          loading={loading}
          onRefresh={onRefresh}
          onNavigatePrevious={onNavigatePrevious}
          onNavigateNext={onNavigateNext}
        />
        {unlocatedButton}
        {listThreads.length === 0 && !draft ? (
          <div className='px-3 py-6 text-sm text-muted-foreground'>
            {threads.length === 0 ? '暂无评论' : '暂无已定位评论'}
          </div>
        ) : (
          <div className='space-y-2 p-3'>
            {draft ? <CommentDraftCard draft={draft} compact /> : null}
            {listThreads.map((item) => (
              <div key={item.thread.id} data-markdown-comment-thread-id={item.thread.id}>
                <ThreadView
                  thread={item.thread}
                  positionUnavailable={item.placement.status === 'unavailable' && item.thread.anchorStatus !== 'orphaned'}
                  active={item.thread.id === activeThreadId}
                  canReply={canReply}
                  compact
                  onFocusThread={onFocusThread}
                  onReply={onReply}
                  onUpdateThreadStatus={onUpdateThreadStatus}
                  onUpdateComment={onUpdateComment}
                  onDeleteComment={onDeleteComment}
                />
              </div>
            ))}
          </div>
        )}
        {unlocatedDialog}
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
        count={threads.length + (draft ? 1 : 0)}
        loading={loading}
        onRefresh={onRefresh}
        onNavigatePrevious={onNavigatePrevious}
        onNavigateNext={onNavigateNext}
        elementRef={measurements.headerRef}
      />
      {unlocatedButton}
      <div ref={anchoredRegionRef} data-markdown-comments-scroll-region='true' className='relative min-h-0 flex-1 overflow-hidden'>
        {partition.anchored.length === 0 && !draft ? (
          <div className='px-3 py-6 text-sm text-muted-foreground'>
            {threads.length === 0 ? '暂无评论' : '暂无已定位评论'}
          </div>
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
                      positionUnavailable={false}
                      active={item.item.thread.id === activeThreadId}
                      canReply={canReply}
                      compact={false}
                      onFocusThread={onFocusThread}
                      onReply={onReply}
                      onUpdateThreadStatus={onUpdateThreadStatus}
                      onUpdateComment={onUpdateComment}
                      onDeleteComment={onDeleteComment}
                    />
                  ) : <CommentDraftCard draft={item.draft} compact={false} />}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {unlocatedDialog}
    </div>
  )
}

function UnlocatedCommentsButton({
  count,
  label,
  compact,
  elementRef,
  onClick,
}: {
  readonly count: number
  readonly label: string
  readonly compact: boolean
  readonly elementRef?: (element: HTMLDivElement | null) => void
  readonly onClick: () => void
}) {
  return (
    <div
      ref={elementRef}
      data-markdown-comments-unlocated='true'
      className='shrink-0 border-b bg-background p-3'
    >
      <Button
        type='button'
        variant='outline'
        size='sm'
        className={cn('w-full justify-between', compact && 'min-h-11')}
        aria-label={`查看 ${count} 条${label}`}
        aria-haspopup='dialog'
        onClick={onClick}
      >
        <span className='flex min-w-0 items-center gap-2'>
          <MapPinOff />
          <span>{label}</span>
        </span>
        <span className='flex items-center gap-1.5'>
          <Badge variant='secondary'>{count}</Badge>
          <ChevronRight className='text-muted-foreground' />
        </span>
      </Button>
    </div>
  )
}

function UnlocatedCommentsDialog({
  open,
  threads,
  activeThreadId,
  canReply,
  compact,
  onOpenChange,
  onFocusThread,
  onReply,
  onUpdateComment,
  onUpdateThreadStatus,
  onDeleteComment,
}: {
  readonly open: boolean
  readonly threads: readonly DriveCommentsRailItem[]
  readonly activeThreadId: string | null
  readonly canReply: boolean
  readonly compact: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onFocusThread: (threadId: string) => void
  readonly onReply: (input: { readonly threadId: string; readonly parentCommentId: string | null; readonly body: string }) => CommentActionPromise
  readonly onUpdateThreadStatus: (input: { readonly threadId: string; readonly status: DriveAnnotationThreadStatus }) => CommentActionPromise
  readonly onUpdateComment: (input: { readonly commentId: string; readonly body: string }) => CommentActionPromise
  readonly onDeleteComment: (commentId: string) => CommentActionPromise
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-drive-telemetry-scope='portal'
        showCloseButton={false}
        data-markdown-comments-unlocated-dialog='true'
        className='h-[min(44rem,calc(100svh-2rem))] gap-0 overflow-hidden p-0 sm:max-w-2xl'
      >
        <DialogFrame>
          <DialogFrameHeader
            bordered
            title='未定位评论'
            description={`${threads.length} 条评论无法定位到当前文档`}
          />
          <DialogFrameBody>
            <ScrollArea className='h-full'>
              <div className='space-y-2 p-4'>
                {threads.map((item) => (
                  <div key={item.thread.id} data-markdown-comment-thread-id={item.thread.id}>
                    <ThreadView
                      thread={item.thread}
                      positionUnavailable={item.placement.status === 'unavailable' && item.thread.anchorStatus !== 'orphaned'}
                      active={item.thread.id === activeThreadId}
                      canReply={canReply}
                      compact={compact}
                      onFocusThread={onFocusThread}
                      onReply={onReply}
                      onUpdateThreadStatus={onUpdateThreadStatus}
                      onUpdateComment={onUpdateComment}
                      onDeleteComment={onDeleteComment}
                    />
                  </div>
                ))}
              </div>
            </ScrollArea>
          </DialogFrameBody>
        </DialogFrame>
      </DialogContent>
    </Dialog>
  )
}

function CommentsRailHeader({
  compact,
  count,
  loading,
  onRefresh,
  onNavigatePrevious,
  onNavigateNext,
  elementRef,
}: {
  readonly compact: boolean
  readonly count: number
  readonly loading: boolean
  readonly onRefresh?: () => void
  readonly onNavigatePrevious?: () => void
  readonly onNavigateNext?: () => void
  readonly elementRef?: (element: HTMLDivElement | null) => void
}) {
  return (
    <div ref={elementRef} data-markdown-comments-header='true' className={cn(
      'flex shrink-0 items-center justify-between border-b bg-background px-3 text-sm font-medium',
      compact ? 'sticky top-0 z-10 h-12 pr-14' : 'h-10'
    )}>
      <span>评论</span>
      <div className='flex items-center gap-1'>
        <span className='text-xs font-normal text-muted-foreground'>{count}</span>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className={compact ? 'size-11' : 'size-7'}
          aria-label='上一条评论'
          disabled={!onNavigatePrevious}
          onClick={onNavigatePrevious}
        >
          <ChevronUp />
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className={compact ? 'size-11' : 'size-7'}
          aria-label='下一条评论'
          disabled={!onNavigateNext}
          onClick={onNavigateNext}
        >
          <ChevronDown />
        </Button>
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
      className='relative overflow-hidden rounded-lg border border-amber-400/70 bg-muted/30 px-3 pb-2 pt-3 text-sm'
    >
      <div aria-hidden className='absolute inset-x-0 top-0 h-1 bg-amber-400' />
      <div className='mb-2 line-clamp-2 text-xs font-medium text-muted-foreground'>“{draft.quote}”</div>
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
  positionUnavailable,
  active,
  canReply,
  compact,
  onFocusThread,
  onReply,
  onUpdateComment,
  onUpdateThreadStatus,
  onDeleteComment,
}: {
  readonly thread: DriveAnnotationThreadDto
  readonly positionUnavailable: boolean
  readonly active: boolean
  readonly canReply: boolean
  readonly compact: boolean
  readonly onFocusThread: (threadId: string) => void
  readonly onReply: (input: { readonly threadId: string; readonly parentCommentId: string | null; readonly body: string }) => CommentActionPromise
  readonly onUpdateThreadStatus: (input: { readonly threadId: string; readonly status: DriveAnnotationThreadStatus }) => CommentActionPromise
  readonly onUpdateComment: (input: { readonly commentId: string; readonly body: string }) => CommentActionPromise
  readonly onDeleteComment: (commentId: string) => CommentActionPromise
}) {
  const [composer, setComposer] = useState<ThreadComposerState>(() => active
    ? { kind: 'reply', parentCommentId: null, value: '', submitting: false, error: null, revision: 0 }
    : { kind: 'closed' })
  const [statusSubmitting, setStatusSubmitting] = useState(false)
  const statusSubmittingRef = useRef(false)
  const statusButtonRef = useRef<HTMLButtonElement>(null)
  const statusMenuRef = useRef<HTMLDivElement>(null)
  const restoreStatusFocusRef = useRef(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const previousActiveRef = useRef(active)
  const authorByCommentId = useMemo(() => new Map(thread.comments.map((comment) => [comment.id, comment.author])), [thread.comments])
  const replyingToComment = composer.kind === 'reply'
    ? thread.comments.find((comment) => comment.id === composer.parentCommentId && !comment.deleted) ?? null
    : null
  const composerVisible = composer.kind === 'edit'
    || (composer.kind === 'reply' && (active || composer.parentCommentId !== null))
  const emphasized = active || composerVisible
  const composerSubmitting = composer.kind !== 'closed' && composer.submitting
  const quote = annotationQuoteExcerpt(thread)
  const resolved = thread.status === 'resolved'

  useLayoutEffect(() => {
    if (statusSubmitting || !restoreStatusFocusRef.current) return
    if (document.activeElement === document.body || document.activeElement === statusButtonRef.current) {
      statusButtonRef.current?.focus()
    }
    restoreStatusFocusRef.current = false
  }, [resolved, statusSubmitting])

  const changeStatus = async () => {
    if (statusSubmittingRef.current || composerSubmitting || !thread.permissions.canChangeStatus) return
    restoreStatusFocusRef.current = document.activeElement === statusButtonRef.current
      || Boolean(statusMenuRef.current?.contains(document.activeElement))
    statusSubmittingRef.current = true
    setStatusSubmitting(true)
    setStatusError(null)
    try {
      await onUpdateThreadStatus({ threadId: thread.id, status: resolved ? 'open' : 'resolved' })
    } catch (cause) {
      setStatusError(getCommentActionErrorMessage(cause))
    } finally {
      statusSubmittingRef.current = false
      setStatusSubmitting(false)
    }
  }

  useEffect(() => {
    if (active && !previousActiveRef.current) {
      setComposer((current) => current.kind === 'closed'
        ? { kind: 'reply', parentCommentId: null, value: '', submitting: false, error: null, revision: 0 }
        : current)
    }
    previousActiveRef.current = active
  }, [active])

  const openReplyComposer = (commentId: string | null) => {
    if (composerSubmitting) return
    setComposer((current) => ({
      kind: 'reply',
      parentCommentId: commentId,
      value: '',
      submitting: false,
      error: null,
      revision: current.kind === 'reply' ? current.revision + 1 : 0,
    }))
  }

  const openEditComposer = (comment: DriveAnnotationCommentDto) => {
    if (composerSubmitting) return
    setComposer({
      kind: 'edit',
      commentId: comment.id,
      value: comment.body,
      submitting: false,
      error: null,
    })
  }

  const submitReply = async () => {
    if (composer.kind !== 'reply' || !composer.value.trim() || composer.submitting) return
    const submission = composer
    setComposer({ ...submission, submitting: true, error: null })
    try {
      await onReply({ threadId: thread.id, parentCommentId: submission.parentCommentId, body: submission.value })
      setComposer({ kind: 'closed' })
    } catch (cause) {
      setComposer((current) => current.kind === 'reply'
        ? { ...current, submitting: false, error: getCommentActionErrorMessage(cause) }
        : current)
    }
  }

  const submitEdit = async () => {
    if (composer.kind !== 'edit' || !composer.value.trim() || composer.submitting) return
    const submission = composer
    setComposer({ ...submission, submitting: true, error: null })
    try {
      await onUpdateComment({ commentId: submission.commentId, body: submission.value })
      setComposer({ kind: 'closed' })
    } catch (cause) {
      setComposer((current) => current.kind === 'edit'
        ? { ...current, submitting: false, error: getCommentActionErrorMessage(cause) }
        : current)
    }
  }

  return (
    <section
      className={cn(
        'relative cursor-default overflow-hidden rounded-lg border bg-card p-4 text-sm transition-colors hover:border-ring/60 focus-within:border-ring contain-inline-size',
        emphasized ? 'border-ring' : 'border-border'
      )}
      onClick={(event) => {
        if (isInteractiveCommentTarget(event.target) || hasSelectionWithin(event.currentTarget)) return
        onFocusThread(thread.id)
      }}
    >
      {active ? <span className='sr-only'>当前评论</span> : null}
      <div className='mb-4 space-y-2'>
        <div className='flex items-center gap-2'>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className={cn('min-w-0 flex-1 justify-start', compact && 'min-h-11')}
                aria-label={`查看评论：${quote}`}
                aria-current={active ? 'true' : undefined}
                onClick={() => onFocusThread(thread.id)}
              >
                <Quote aria-hidden className='text-muted-foreground' />
                <span className='min-w-0 w-0 max-w-full flex-1 truncate text-left'>{quote}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent className='max-w-sm break-all'>{quote}</TooltipContent>
          </Tooltip>
          {thread.permissions.canChangeStatus ? (
            resolved ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    ref={statusButtonRef}
                    type='button'
                    variant='secondary'
                    size='sm'
                    className={compact ? 'min-h-11' : undefined}
                    disabled={composerSubmitting || statusSubmitting}
                    aria-label='已解决'
                    aria-busy={statusSubmitting}
                  >
                    {statusSubmitting ? <Loader2 aria-hidden className='animate-spin motion-reduce:animate-none' /> : null}
                    已解决
                    <ChevronDown aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent ref={statusMenuRef} align='end' data-drive-telemetry-scope='portal' onClick={(event) => event.stopPropagation()}>
                  <DropdownMenuItem
                    className={compact ? 'min-h-11' : undefined}
                    data-drive-telemetry-event='web.drive.comment.status-update'
                    disabled={composerSubmitting || statusSubmitting}
                    onSelect={() => { void changeStatus() }}
                  >
                    <RotateCcw aria-hidden />
                    重新打开
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                ref={statusButtonRef}
                type='button'
                variant='secondary'
                size='sm'
                className={compact ? 'min-h-11' : undefined}
                data-drive-telemetry-event='web.drive.comment.status-update'
                disabled={composerSubmitting || statusSubmitting}
                aria-label='标记为已解决'
                aria-busy={statusSubmitting}
                onClick={() => { void changeStatus() }}
              >
                {statusSubmitting ? <Loader2 aria-hidden className='animate-spin motion-reduce:animate-none' /> : null}
                标记为已解决
              </Button>
            )
          ) : (
            <Badge variant={resolved ? 'secondary' : 'outline'}>{resolved ? '已解决' : '未解决'}</Badge>
          )}
        </div>
        {statusError ? <p role='alert' className='text-xs text-destructive'>{statusError}</p> : null}
        {thread.anchorStatus === 'orphaned' || positionUnavailable ? (
          <div className='flex flex-wrap items-center gap-1'>
            <span className='text-xs text-muted-foreground'>
              {positionUnavailable ? '编辑中暂未定位' : annotationPositionLabel(thread)}
            </span>
          </div>
        ) : null}
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
            editComposer={composer.kind === 'edit' && composer.commentId === comment.id ? composer : null}
            actionsHidden={composer.kind === 'edit'}
            actionsDisabled={composerSubmitting}
            onStartReply={() => openReplyComposer(comment.id)}
            onStartEdit={() => openEditComposer(comment)}
            onEditValueChange={(value) => {
              setComposer((current) => current.kind === 'edit'
                ? { ...current, value, error: null }
                : current)
            }}
            onCancelEdit={() => setComposer({ kind: 'closed' })}
            onSubmitEdit={() => { void submitEdit() }}
            onDeleteComment={onDeleteComment}
          />
        ))}
      </div>
      {composer.kind === 'reply' ? (
        <div className={cn(!composerVisible && 'hidden')}>
          <CommentComposer
            key={composer.revision}
            dataAttribute='reply'
            value={composer.value}
            ariaLabel={replyingToComment ? `回复 ${displayAuthor(replyingToComment.author)}` : '回复讨论'}
            label={replyingToComment ? `回复 ${displayAuthor(replyingToComment.author)}` : null}
            placeholder='回复'
            compact={compact}
            submitting={composer.submitting}
            error={composer.error}
            submitLabel='发送'
            submittingLabel='发送中'
            autoFocus={composer.parentCommentId !== null}
            onValueChange={(value) => {
              setComposer((current) => current.kind === 'reply'
                ? { ...current, value, error: null }
                : current)
            }}
            onCancel={() => setComposer({ kind: 'closed' })}
            onSubmit={() => { void submitReply() }}
          />
        </div>
      ) : null}
    </section>
  )
}

function annotationPositionLabel(thread: DriveAnnotationThreadDto): string {
  if (thread.targetKind === 'image') return '图片已替换或删除'
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
  editComposer,
  actionsHidden,
  actionsDisabled,
  onStartReply,
  onStartEdit,
  onEditValueChange,
  onCancelEdit,
  onSubmitEdit,
  onDeleteComment,
}: {
  readonly comment: DriveAnnotationCommentDto
  readonly replyToName: string | null
  readonly canReply: boolean
  readonly compact: boolean
  readonly deleteDescription: string
  readonly editComposer: ThreadEditComposerState | null
  readonly actionsHidden: boolean
  readonly actionsDisabled: boolean
  readonly onStartReply: () => void
  readonly onStartEdit: () => void
  readonly onEditValueChange: (value: string) => void
  readonly onCancelEdit: () => void
  readonly onSubmitEdit: () => void
  readonly onDeleteComment: (commentId: string) => CommentActionPromise
}) {
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const authorName = displayAuthor(comment.author)
  return (
    <article className='group/comment'>
      <div className='flex items-start gap-3'>
        <Avatar className='size-8'>
          <AvatarFallback className='text-xs font-medium text-muted-foreground'>
            {getDisplayNameInitials(authorName)}
          </AvatarFallback>
        </Avatar>
        <div className='min-w-0 flex-1 space-y-1'>
          <div className='flex min-h-9 items-center justify-between gap-2'>
            <div className='flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5'>
              <span className='truncate text-sm font-medium'>{authorName}</span>
              <RelativeTime value={comment.createdAt} className='text-xs text-muted-foreground' />
              {comment.editedAt ? <span className='text-xs text-muted-foreground'>已编辑</span> : null}
            </div>
            {(comment.permissions.canEdit || comment.permissions.canDelete) && !actionsHidden ? (
              <div className='shrink-0'>
                <CommentActionsMenu
                  authorName={authorName}
                  canEdit={comment.permissions.canEdit}
                  canDelete={comment.permissions.canDelete}
                  compact={compact}
                  disabled={actionsDisabled}
                  onStartEdit={() => {
                    setDeleteConfirming(false)
                    onStartEdit()
                  }}
                  onStartDelete={() => setDeleteConfirming(true)}
                />
              </div>
            ) : null}
          </div>
          {replyToName ? <div className='text-xs text-muted-foreground'>回复 {replyToName}</div> : null}
          {editComposer ? (
            <CommentComposer
              dataAttribute='edit'
              value={editComposer.value}
              ariaLabel='编辑评论'
              placeholder='编辑评论'
              compact={compact}
              submitting={editComposer.submitting}
              error={editComposer.error}
              submitLabel='保存'
              submittingLabel='保存中'
              autoFocus
              onValueChange={onEditValueChange}
              onCancel={onCancelEdit}
              onSubmit={onSubmitEdit}
            />
          ) : (
            <>
              <p className='whitespace-pre-wrap break-words text-sm leading-6'>{comment.body}</p>
              {!actionsHidden && canReply ? (
                <div className='-ml-3 pt-1'>
                  <Button
                    data-drive-telemetry-event='web.drive.comment.reply-open'
                    type='button'
                    variant='ghost'
                    className={compact ? 'min-h-11' : undefined}
                    disabled={actionsDisabled}
                    onClick={() => {
                      setDeleteConfirming(false)
                      onStartReply()
                    }}
                  ><Reply aria-hidden />回复</Button>
                </div>
              ) : null}
              {deleteConfirming && !actionsHidden ? (
                <CommentDeleteConfirmation
                  compact={compact}
                  disabled={actionsDisabled}
                  deleteDescription={deleteDescription}
                  onCancel={() => setDeleteConfirming(false)}
                  onDeleteComment={() => onDeleteComment(comment.id)}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    if (autoFocus) textareaRef.current?.focus({ preventScroll: true })
  }, [autoFocus])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onSubmit()
      return
    }
    if (event.key === 'Escape' && (dataAttribute !== 'reply' || !value.trim())) {
      event.preventDefault()
      onCancel()
    }
  }

  return (
    <div
      data-markdown-comment-draft-composer={dataAttribute === 'draft' ? 'true' : undefined}
      data-markdown-comment-reply-composer={dataAttribute === 'reply' ? 'true' : undefined}
      data-markdown-comment-edit-composer={dataAttribute === 'edit' ? 'true' : undefined}
      className={cn(dataAttribute === 'edit' ? 'mt-2' : 'mt-3 border-t pt-3')}
      onClick={(event) => event.stopPropagation()}
    >
      {label ? <div className='mb-2 text-xs text-muted-foreground'>{label}</div> : null}
      <Textarea
        ref={textareaRef}
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={submitting}
        onChange={(event) => onValueChange(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      {error ? <div role='status' className='mt-2 text-sm text-destructive'>{error}</div> : null}
      <div className='mt-2 flex justify-end gap-1'>
        <Button type='button' variant='ghost' size='sm' className={compact ? 'min-h-11' : 'h-7'} disabled={submitting} onClick={onCancel}>取消</Button>
        <Button data-drive-telemetry-event={COMMENT_COMPOSER_EVENT_KEYS[dataAttribute]} type='button' size='sm' className={compact ? 'min-h-11' : 'h-7'} disabled={!value.trim() || submitting} onClick={onSubmit}>
          {submitting ? submittingLabel : submitLabel}
        </Button>
      </div>
    </div>
  )
}

function CommentActionsMenu({
  authorName,
  canEdit,
  canDelete,
  compact,
  disabled,
  onStartEdit,
  onStartDelete,
}: {
  readonly authorName: string
  readonly canEdit: boolean
  readonly canDelete: boolean
  readonly compact: boolean
  readonly disabled: boolean
  readonly onStartEdit: () => void
  readonly onStartDelete: () => void
}) {
  const editingRef = useRef(false)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type='button' variant='ghost' size='icon' className={compact ? 'size-11' : undefined} aria-label={`评论操作：${authorName}`} disabled={disabled}><MoreHorizontal aria-hidden /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-drive-telemetry-scope='portal'
        align='end'
        onClick={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => {
          if (editingRef.current) event.preventDefault()
          editingRef.current = false
        }}
      >
        {canEdit ? (
          <DropdownMenuItem data-drive-telemetry-event='web.drive.comment.edit-open' disabled={disabled} onSelect={() => {
            editingRef.current = true
            onStartEdit()
          }}><Pencil aria-hidden />编辑评论</DropdownMenuItem>
        ) : null}
        {canDelete ? <DropdownMenuItem variant='destructive' disabled={disabled} onSelect={onStartDelete}><Trash2 aria-hidden />删除评论</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CommentDeleteConfirmation({
  compact = false,
  disabled = false,
  deleteDescription,
  onCancel,
  onDeleteComment,
}: {
  readonly compact?: boolean
  readonly disabled?: boolean
  readonly deleteDescription: string
  readonly onCancel: () => void
  readonly onDeleteComment: () => CommentActionPromise
}) {
  const [deleting, setDeleting] = useState(false)
  const handleDelete = async () => {
    if (disabled || deleting) return
    setDeleting(true)
    try {
      await onDeleteComment()
      onCancel()
    } catch (cause) {
      onCancel()
      toast.error(getCommentActionErrorMessage(cause))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      role='group'
      aria-label='删除评论确认'
      className='mt-3 space-y-3'
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !deleting) onCancel()
      }}
    >
      <p className='text-sm'>{deleteDescription}</p>
      <div className='flex justify-end gap-2'>
        <Button type='button' variant='ghost' className={compact ? 'min-h-11' : undefined} disabled={disabled || deleting} onClick={onCancel}>取消</Button>
        <Button
          data-drive-telemetry-event='web.drive.comment.delete'
          type='button'
          variant='destructive'
          className={compact ? 'min-h-11' : undefined}
          aria-label='确认删除评论'
          aria-busy={deleting}
          disabled={disabled || deleting}
          onClick={() => { void handleDelete() }}
        >{deleting ? <Loader2 aria-hidden className='animate-spin motion-reduce:animate-none' /> : null}{deleting ? '删除中' : '删除评论'}</Button>
      </div>
    </div>
  )
}

function displayAuthor(author: { readonly handle: string | null; readonly email: string | null } | undefined): string {
  return author?.handle || author?.email || '评论者'
}

function isInteractiveCommentTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('button, textarea, input, select, a, [contenteditable="true"], [role="button"]'))
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
  if (visibleComments[0]?.id === comment.id) return '删除后，整条讨论及原文标记将一并移除，且无法恢复。'
  if (hasVisibleDescendant(comment.id, visibleComments)) return '删除后，该评论及其所有回复将一并删除，且无法恢复。'
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
  if (thread.target.kind === 'image') {
    const alt = thread.target.snapshot.alt.trim()
    if (alt) return alt
    const source = thread.target.snapshot.src.split(/[?#]/u)[0] ?? ''
    const pathSegments = source.split(/[\\/]/u)
    const fileName = pathSegments[pathSegments.length - 1]?.trim()
    return fileName || '图片'
  }
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

function partitionRailThreads(items: readonly DriveCommentsRailItem[]): {
  readonly anchored: readonly DriveCommentsRailItem[]
  readonly orphaned: readonly DriveCommentsRailItem[]
  readonly unavailable: readonly DriveCommentsRailItem[]
} {
  const orphaned = items
    .filter((item) => item.thread.anchorStatus === 'orphaned')
    .sort((a, b) => Date.parse(b.thread.updatedAt) - Date.parse(a.thread.updatedAt))
  const unavailable = items
    .filter((item) => item.thread.anchorStatus !== 'orphaned' && item.placement.status === 'unavailable')
    .sort((a, b) => Date.parse(b.thread.updatedAt) - Date.parse(a.thread.updatedAt))
  const anchored = items.filter((item) => item.placement.status === 'positioned' && item.thread.anchorStatus !== 'orphaned')
  return { anchored, orphaned, unavailable }
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
