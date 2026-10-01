import { useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { Check, CheckCheck, ChevronLeft, ChevronRight, Circle, FileText, MessageSquare, MoreHorizontal, Pencil, Quote, Reply, RotateCcw, Trash2 } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn, getDisplayNameInitials } from '@/lib/utils'

type Comment = { id: string; author: string; body: string; time: string; editable?: boolean; edited?: boolean }
type Thread = { id: string; quote: string; resolved: boolean; comments: Comment[] }
type Composer = { kind: 'reply' } | { kind: 'edit'; commentId: string } | null
type Layout = 'compact' | 'text'

const INITIAL_THREADS: Thread[] = [
  { id: 'submit', quote: '提交', resolved: true, comments: [
    { id: 'original', author: '1711467488', time: '1 小时前', body: '哦哦哦哦', editable: true },
  ] },
  { id: 'failure', quote: '提交失败时允许重试', resolved: false, comments: [
    { id: 'failure-comment', author: '李杨', time: '35 分钟前', body: '重试时保留已经填写的内容，避免重新输入。', editable: true },
    { id: 'failure-reply', author: '陈安', time: '18 分钟前', body: '同意，失败原因也需要明确显示。' },
  ] },
  { id: 'history', quote: '记录提交时间、操作人及变更内容', resolved: true, comments: [
    { id: 'history-comment', author: '李杨', time: '2 小时前', body: '已补充记录要求。', editable: true },
  ] },
]

function usePreviewThreads() {
  const [threads, setThreads] = useState(INITIAL_THREADS)
  const [activeId, setActiveId] = useState('submit')
  const [announcement, setAnnouncement] = useState('')

  function changeStatus(threadId: string) {
    const thread = threads.find((item) => item.id === threadId)
    if (!thread) return
    setThreads((items) => items.map((item) => item.id === threadId ? { ...item, resolved: !item.resolved } : item))
    setAnnouncement(thread.resolved ? '讨论已重新打开' : '讨论已解决')
  }

  function saveComment(threadId: string, body: string, commentId?: string) {
    const value = body.trim()
    if (!value) return
    setThreads((items) => items.map((thread) => {
      if (thread.id !== threadId) return thread
      const comments = commentId
        ? thread.comments.map((comment) => comment.id === commentId ? { ...comment, body: value, edited: true } : comment)
        : [...thread.comments, { id: crypto.randomUUID(), author: '李杨', time: '刚刚', body: value, editable: true }]
      return { ...thread, comments }
    }))
    setAnnouncement(commentId ? '评论已保存' : '回复已发送')
  }

  function deleteComment(threadId: string, commentId: string) {
    setThreads((items) => items.map((thread) => thread.id === threadId
      ? { ...thread, comments: thread.comments.filter((comment) => comment.id !== commentId) }
      : thread))
    setAnnouncement('评论已删除')
  }

  function navigate(direction: number) {
    const index = threads.findIndex((thread) => thread.id === activeId)
    const next = threads[index + direction]
    if (next) setActiveId(next.id)
  }

  return { threads, activeId, setActiveId, announcement, changeStatus, saveComment, deleteComment, navigate }
}

type PreviewModel = ReturnType<typeof usePreviewThreads>

function StatusAction({ thread, layout, onClick }: { thread: Thread; layout: Layout; onClick: () => void }) {
  const label = thread.resolved ? '重新打开' : '标记为已解决'
  const icon = thread.resolved ? <RotateCcw aria-hidden /> : <Check aria-hidden />
  if (layout === 'text') {
    return <Button type='button' variant='ghost' onClick={onClick}>{icon}{label}</Button>
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type='button' variant='ghost' size='icon' aria-label={label} onClick={onClick}>{icon}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function CommentRow({ comment, onEdit, onDelete }: { comment: Comment; onEdit: () => void; onDelete: () => void }) {
  return (
    <article className='flex items-start gap-3'>
      <Avatar><AvatarFallback className='text-xs text-muted-foreground'>{getDisplayNameInitials(comment.author)}</AvatarFallback></Avatar>
      <div className='min-w-0 flex-1'>
        <div className='flex min-h-8 items-center justify-between gap-1'>
          <div className='flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5'>
            <span className='break-all text-sm font-medium'>{comment.author}</span>
            <span className='whitespace-nowrap text-xs text-muted-foreground'>{comment.time}</span>
            {comment.edited ? <span className='text-xs text-muted-foreground'>已编辑</span> : null}
          </div>
          {comment.editable ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type='button' variant='ghost' size='icon' aria-label={`更多操作：${comment.author}`}><MoreHorizontal aria-hidden /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem onSelect={onEdit}><Pencil aria-hidden />编辑评论</DropdownMenuItem>
                <DropdownMenuItem variant='destructive' onSelect={onDelete}><Trash2 aria-hidden />删除评论</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        <p className='whitespace-pre-wrap break-words text-sm leading-6'>{comment.body}</p>
      </div>
    </article>
  )
}

function ThreadCard({ thread, layout, model }: { thread: Thread; layout: Layout; model: PreviewModel }) {
  const [composer, setComposer] = useState<Composer>(null)
  const [draft, setDraft] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const replyButtonRef = useRef<HTMLButtonElement>(null)
  const active = model.activeId === thread.id

  function openComposer(next: NonNullable<Composer>, value = '') {
    setComposer(next)
    setDraft(value)
    setDeleteId(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function closeComposer() {
    setComposer(null)
    setDraft('')
    replyButtonRef.current?.focus()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!composer || !draft.trim()) return
    model.saveComment(thread.id, draft, composer.kind === 'edit' ? composer.commentId : undefined)
    closeComposer()
  }

  function confirmDelete() {
    if (!deleteId) return
    model.deleteComment(thread.id, deleteId)
    setDeleteId(null)
    replyButtonRef.current?.focus()
  }

  return (
    <section aria-label={`讨论：${thread.quote}`} className={cn('rounded-lg border bg-card p-4', active ? 'border-ring' : 'border-border')}>
      <header className='mb-4 flex items-center gap-2'>
        <Button type='button' variant='ghost' size='sm' className='min-w-0 flex-1 justify-start' aria-label={`定位原文：${thread.quote}`} onClick={() => model.setActiveId(thread.id)}>
          <Quote className='text-muted-foreground' aria-hidden /><span className='truncate'>{thread.quote}</span>
        </Button>
        <Badge variant={thread.resolved ? 'secondary' : 'outline'}>
          {thread.resolved ? <CheckCheck aria-hidden /> : <Circle aria-hidden />}{thread.resolved ? '已解决' : '未解决'}
        </Badge>
        {layout === 'compact' ? <StatusAction thread={thread} layout={layout} onClick={() => model.changeStatus(thread.id)} /> : null}
      </header>
      <div className='space-y-4'>
        {thread.comments.map((comment) => <CommentRow key={comment.id} comment={comment} onEdit={() => openComposer({ kind: 'edit', commentId: comment.id }, comment.body)} onDelete={() => setDeleteId(comment.id)} />)}
        {thread.comments.length === 0 ? <p className='text-sm text-muted-foreground'>评论已删除</p> : null}
      </div>
      {deleteId ? (
        <div className='mt-4 space-y-3' role='group' aria-label='删除评论'>
          <p className='text-sm'>删除这条评论？</p>
          <div className='flex justify-end gap-2'><Button type='button' variant='ghost' onClick={() => setDeleteId(null)}>取消</Button><Button type='button' variant='destructive' onClick={confirmDelete}>删除评论</Button></div>
        </div>
      ) : null}
      {composer ? (
        <form className='mt-4 space-y-3' onSubmit={submit}>
          <label className='block text-sm font-medium' htmlFor={`${layout}-${thread.id}-draft`}>{composer.kind === 'edit' ? '编辑评论' : '回复讨论'}</label>
          <Textarea ref={inputRef} id={`${layout}-${thread.id}-draft`} value={draft} rows={3} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') closeComposer() }} />
          <div className='flex justify-end gap-2'><Button type='button' variant='ghost' onClick={closeComposer}>取消</Button><Button type='submit' disabled={!draft.trim()}>{composer.kind === 'edit' ? '保存' : '发送'}</Button></div>
        </form>
      ) : (
        <footer className='mt-3 flex items-center justify-between gap-1'>
          <Button ref={replyButtonRef} type='button' variant='ghost' onClick={() => openComposer({ kind: 'reply' })}><Reply aria-hidden />回复</Button>
          {layout === 'text' ? <StatusAction thread={thread} layout={layout} onClick={() => model.changeStatus(thread.id)} /> : null}
        </footer>
      )}
    </section>
  )
}

function DocumentText({ model }: { model: PreviewModel }) {
  function quoteClass(id: string) {
    return cn('rounded-sm px-1', model.activeId === id ? 'bg-secondary text-secondary-foreground' : 'bg-transparent text-foreground')
  }
  return (
    <article className='min-w-0 space-y-8 p-6 md:col-span-3 md:p-8' aria-label='文档正文'>
      <header className='space-y-3'><h1 className='text-2xl font-semibold'>提交规范</h1><p className='text-xs text-muted-foreground'>李杨 · 10 月 1 日</p></header>
      <section className='space-y-3'><h2 className='text-lg font-semibold'><mark className={quoteClass('submit')}>提交</mark></h2><p className='text-sm leading-7'>确认内容无误后提交。未保存的修改应保留，<mark className={quoteClass('failure')}>提交失败时允许重试</mark>。</p></section>
      <section className='space-y-3'><h2 className='text-lg font-semibold'>失败处理</h2><p className='text-sm leading-7'>保留用户输入，显示失败原因；重试成功后更新状态。</p></section>
      <section className='space-y-3'><h2 className='text-lg font-semibold'>更新记录</h2><p className='text-sm leading-7'><mark className={quoteClass('history')}>记录提交时间、操作人及变更内容</mark>，便于后续追溯。</p></section>
    </article>
  )
}

function PreviewPage({ layout }: { layout: Layout }) {
  const model = usePreviewThreads()
  const activeIndex = model.threads.findIndex((thread) => thread.id === model.activeId)
  return (
    <main className='min-w-0 bg-background font-sans text-foreground antialiased'>
      <header className='flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4'>
        <div className='flex min-w-0 items-center gap-3'><FileText className='size-5 shrink-0 text-muted-foreground' aria-hidden /><span className='truncate text-sm font-medium'>提交规范.md</span></div>
        <span className='text-xs text-muted-foreground'>云盘 / 文档</span>
      </header>
      <div className='grid min-w-0 md:grid-cols-5'>
        <DocumentText model={model} />
        <aside className='min-w-0 border-t border-border p-4 md:col-span-2 md:border-t-0 md:border-l md:p-5' aria-label='文档评论'>
          <header className='mb-4 flex items-center justify-between gap-3'>
            <h2 className='flex items-center gap-2 text-sm font-semibold'><MessageSquare className='size-4' aria-hidden />评论</h2>
            <div className='flex items-center gap-1'>
              <Button type='button' variant='ghost' size='icon' aria-label='上一条讨论' disabled={activeIndex === 0} onClick={() => model.navigate(-1)}><ChevronLeft aria-hidden /></Button>
              <span className='text-xs tabular-nums text-muted-foreground'>{activeIndex + 1} / {model.threads.length}</span>
              <Button type='button' variant='ghost' size='icon' aria-label='下一条讨论' disabled={activeIndex === model.threads.length - 1} onClick={() => model.navigate(1)}><ChevronRight aria-hidden /></Button>
            </div>
          </header>
          <div className='space-y-3'>{model.threads.map((thread) => <ThreadCard key={thread.id} thread={thread} layout={layout} model={model} />)}</div>
        </aside>
      </div>
      <p className='sr-only' role='status' aria-live='polite'>{model.announcement}</p>
    </main>
  )
}

function PreviewSwitcher() {
  const [selected, setSelected] = useState<Layout>('compact')
  function select(layout: Layout) {
    const root = document.getElementById('comment-status-preview')
    if (!root) return
    Array.from(root.children).forEach((variant, index) => { (variant as HTMLElement).hidden = index !== (layout === 'compact' ? 0 : 1) })
    setSelected(layout)
  }
  return (
    <nav className='flex items-center justify-center gap-3 border-t border-border bg-background p-4' aria-label='设计方案'>
      <Button type='button' variant={selected === 'compact' ? 'default' : 'ghost'} aria-pressed={selected === 'compact'} onClick={() => select('compact')}>紧凑标题</Button>
      <Button type='button' variant={selected === 'text' ? 'default' : 'ghost'} aria-pressed={selected === 'text'} onClick={() => select('text')}>文字操作</Button>
    </nav>
  )
}

const compactRoot = document.getElementById('comment-status-compact')
const textRoot = document.getElementById('comment-status-text')
if (!compactRoot || !textRoot) throw new Error('评论预览容器缺失')
createRoot(compactRoot).render(<PreviewPage layout='compact' />)
createRoot(textRoot).render(<PreviewPage layout='text' />)
const switcherRoot = document.getElementById('comment-status-switcher')
if (switcherRoot) createRoot(switcherRoot).render(<PreviewSwitcher />)
