import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type {
  DriveAnnotationTextRangeTargetV1,
  DriveBrowserItemDto,
  DriveBrowserPreviewDto,
  DriveMarkdownOutlineItemDto,
} from '@synapse/shared'
import { ListTree, MessageSquare, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import type { DriveAnnotationContext } from '../use-drive-annotations'
import { useDriveAnnotations } from '../use-drive-annotations'
import { DriveCodeRenderer } from './code-renderer'
import { renderMarkdownAnnotationHtml } from './markdown-annotation-render'
import { createMarkdownAnnotationTargetFromSelection } from './markdown-annotation-target'
import { MarkdownCommentsRail } from './markdown-comments-rail'
import { useRegisterDriveRendererToolbarItems, type DriveRendererToolbarItem } from './drive-renderer-toolbar-context'

const MARKDOWN_BODY_CLASSNAME = 'max-w-full space-y-3 text-base leading-7 [&_a]:underline [&_blockquote]:border-l [&_blockquote]:pl-3 [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_h1]:scroll-mt-6 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:scroll-mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:scroll-mt-6 [&_h3]:font-medium [&_h4]:scroll-mt-6 [&_h5]:scroll-mt-6 [&_h6]:scroll-mt-6 [&_hr]:border-border [&_li]:ml-4 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_ul]:list-disc'

export function DriveMarkdownRenderer({
  current,
  preview,
  annotationContext,
}: {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
  readonly annotationContext?: DriveAnnotationContext
}) {
  const renderedHtml = preview.html?.trim()
  if (!renderedHtml) return <DriveCodeRenderer current={current} preview={preview} />
  const outline = preview.outline ?? []
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const commentsTouchedRef = useRef(false)
  const isAuthenticated = useAuthStore((state) => state.auth.isAuthenticated)
  const annotationsEnabled = current.name.toLowerCase().endsWith('.md')
  const effectiveAnnotationContext = annotationsEnabled ? annotationContext : undefined
  const annotations = useDriveAnnotations(effectiveAnnotationContext)
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [pendingTarget, setPendingTarget] = useState<DriveAnnotationTextRangeTargetV1 | null>(null)
  const [commentBody, setCommentBody] = useState('')
  const annotated = useMemo(
    () => renderMarkdownAnnotationHtml(renderedHtml, annotations.threads),
    [annotations.threads, renderedHtml]
  )
  const canWriteAnnotations = effectiveAnnotationContext?.context === 'owner' || Boolean(effectiveAnnotationContext?.canWrite)
  const canCreateAnnotation = annotationsEnabled
    && Boolean(effectiveAnnotationContext)
    && canWriteAnnotations
    && (effectiveAnnotationContext?.context === 'owner' || isAuthenticated)
  const resolvedByThreadId = useMemo(
    () => new Map(annotated.resolved.map((item) => [item.threadId, item])),
    [annotated.resolved]
  )
  const sortedThreads = useMemo(() => {
    return [...annotations.threads].sort((a, b) => {
      const first = resolvedByThreadId.get(a.id)
      const second = resolvedByThreadId.get(b.id)
      const firstPosition = first?.range?.start
      const secondPosition = second?.range?.start
      if (typeof firstPosition === 'number' && typeof secondPosition === 'number' && firstPosition !== secondPosition) {
        return firstPosition - secondPosition
      }
      if (typeof firstPosition === 'number' && typeof secondPosition !== 'number') return -1
      if (typeof firstPosition !== 'number' && typeof secondPosition === 'number') return 1
      return Date.parse(a.createdAt) - Date.parse(b.createdAt)
    })
  }, [annotations.threads, resolvedByThreadId])
  const railThreads = useMemo(
    () => sortedThreads.map((thread) => {
      const resolved = resolvedByThreadId.get(thread.id)
      if (!resolved || resolved.anchorStatus === thread.anchorStatus) return thread
      return { ...thread, anchorStatus: resolved.anchorStatus }
    }),
    [resolvedByThreadId, sortedThreads]
  )

  useEffect(() => {
    if (commentsTouchedRef.current || annotations.threads.length === 0) return
    setCommentsOpen(true)
  }, [annotations.threads.length])

  const setCommentPanelOpen = useCallback((open: boolean) => {
    commentsTouchedRef.current = true
    setCommentsOpen(open)
  }, [])

  const toolbarItems = useMemo<readonly DriveRendererToolbarItem[]>(() => {
    const items: DriveRendererToolbarItem[] = []
    if (outline.length > 0) {
      items.push({
        kind: 'toggle',
        id: 'markdown-outline',
        label: '目录',
        icon: ListTree,
        pressed: outlineOpen,
        onPressedChange: setOutlineOpen,
      })
    }
    if (annotationsEnabled) {
      items.push(
        {
          kind: 'toggle',
          id: 'markdown-comments',
          label: `评论 ${annotations.threads.length}`,
          icon: MessageSquare,
          pressed: commentsOpen,
          onPressedChange: setCommentPanelOpen,
        },
        {
          kind: 'button',
          id: 'markdown-refresh-comments',
          label: '刷新评论',
          icon: RefreshCw,
          variant: 'ghost',
          onClick: () => { void annotations.refresh() },
        },
      )
    }
    return items
  }, [
    annotations.refresh,
    annotations.threads.length,
    annotationsEnabled,
    commentsOpen,
    outline.length,
    outlineOpen,
    setCommentPanelOpen,
  ])

  useRegisterDriveRendererToolbarItems('markdown', toolbarItems)

  const focusThread = (threadId: string) => {
    setActiveThreadId(threadId)
    setCommentPanelOpen(true)
    const marker = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>('[data-drive-annotation-thread-id]') ?? [])
      .find((item) => item.dataset.driveAnnotationThreadId === threadId)
    marker?.scrollIntoView({ block: 'center', inline: 'nearest' })
  }

  const handleBodyMouseUp = () => {
    if (!canCreateAnnotation) return
    const root = bodyRef.current
    if (!root) return
    const target = createMarkdownAnnotationTargetFromSelection(root, window.getSelection())
    if (!target) return
    setPendingTarget(target)
    setCommentPanelOpen(true)
  }

  const handleBodyClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const marker = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-drive-annotation-thread-id]')
    const threadId = marker?.dataset.driveAnnotationThreadId
    if (!threadId) return
    focusThread(threadId)
  }

  const createThread = async () => {
    if (!pendingTarget || !commentBody.trim()) return
    const thread = await annotations.createThread({
      targetKind: 'textRange',
      target: pendingTarget,
      body: commentBody,
    })
    setActiveThreadId(thread.id)
    setPendingTarget(null)
    setCommentBody('')
    setCommentPanelOpen(true)
    window.getSelection()?.removeAllRanges()
  }

  return (
    <div className='min-h-0 bg-background'>
      {pendingTarget ? (
        <div className='border-b px-3 py-2'>
          <div className='flex items-start gap-2'>
            <Textarea
              value={commentBody}
              onChange={(event) => setCommentBody(event.currentTarget.value)}
              className='min-h-10'
            />
            <div className='flex shrink-0 items-center gap-1'>
              <Button type='button' size='sm' disabled={!commentBody.trim() || annotations.creatingThread} onClick={() => { void createThread() }}>
                评论
              </Button>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                onClick={() => {
                  setPendingTarget(null)
                  setCommentBody('')
                  window.getSelection()?.removeAllRanges()
                }}
              >
                <X />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <div className={cn('mx-auto flex min-h-0 w-full gap-6 px-4 py-6 md:px-6', commentsOpen || outlineOpen ? 'max-w-7xl' : 'max-w-3xl')}>
        {outline.length > 0 && outlineOpen ? (
          <aside className='hidden w-52 shrink-0 xl:block'>
            <nav className='sticky top-16 max-h-[calc(100vh-5rem)] overflow-auto pl-4' aria-label='目录'>
              <p className='mb-2 text-xs font-medium text-muted-foreground'>目录</p>
              <MarkdownOutlineTree items={outline} />
            </nav>
          </aside>
        ) : null}
        <div className='min-w-0 flex-1'>
          <div className='mx-auto max-w-3xl'>
            <div
              ref={bodyRef}
              data-testid='markdown-body'
              className={MARKDOWN_BODY_CLASSNAME}
              onClick={handleBodyClick}
              onMouseUp={handleBodyMouseUp}
              dangerouslySetInnerHTML={{ __html: annotated.html }}
            />
            {preview.truncated ? (
              <div className='mt-4 border-t pt-2 text-xs text-muted-foreground'>内容已截断</div>
            ) : null}
          </div>
        </div>
        {commentsOpen ? (
          <MarkdownCommentsRail
            threads={railThreads}
            activeThreadId={activeThreadId}
            canReply={canCreateAnnotation}
            onFocusThread={focusThread}
            onReply={annotations.reply}
            onUpdateComment={annotations.updateComment}
            onDeleteComment={annotations.deleteComment}
            onDeleteThread={annotations.deleteThread}
          />
        ) : null}
      </div>
      {annotations.error ? (
        <div className='border-t px-3 py-2 text-xs text-muted-foreground'>{annotations.error}</div>
      ) : null}
      {annotated.resolved.some((item) => item.anchorStatus === 'orphaned') ? (
        <div className='sr-only'>位置已变化</div>
      ) : null}
    </div>
  )
}

export function MarkdownOutlineTree({ items }: { readonly items: readonly DriveMarkdownOutlineItemDto[] }) {
  return (
    <ul className='space-y-1'>
      {items.map((item) => (
        <MarkdownOutlineNode key={item.id} item={item} />
      ))}
    </ul>
  )
}

function MarkdownOutlineNode({ item }: { readonly item: DriveMarkdownOutlineItemDto }) {
  return (
    <li>
      <a
        className={cn(
          'block truncate rounded-sm py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          outlineDepthClassName(item.depth)
        )}
        href={`#${item.id}`}
      >
        {item.text}
      </a>
      {item.children.length > 0 ? <MarkdownOutlineTree items={item.children} /> : null}
    </li>
  )
}

function outlineDepthClassName(depth: number): string {
  if (depth <= 1) return 'pl-0'
  if (depth === 2) return 'pl-3'
  if (depth === 3) return 'pl-6'
  if (depth === 4) return 'pl-9'
  if (depth === 5) return 'pl-12'
  return 'pl-14'
}
