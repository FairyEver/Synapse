import { useState } from 'react'
import type {
  DriveBrowserItemDto,
  DriveBrowserPreviewDto,
  DriveBrowserSnapshotDto,
  DriveBrowserSurface,
} from '@synapse/shared'
import {
  Archive,
  Download,
  ExternalLink,
  File,
  FileText,
  Folder,
  Image,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useDriveBrowser } from './use-drive-browser'

export type DriveBrowserPageProps =
  | {
      context: 'owner'
      surface: DriveBrowserSurface
      rootItemId: string
      itemId?: string
    }
  | {
      context: 'share'
      shareId: string
      itemId?: string
      initialPassword?: string
    }

export function DriveBrowserPage(props: DriveBrowserPageProps) {
  const state = useDriveBrowser(props)
  const framed = props.context === 'share' || props.surface === 'standalone'
  const content = (
    <div className='mx-auto flex min-h-0 w-full max-w-7xl flex-col gap-3'>
      {state.status === 'loading' ? <DriveBrowserLoading /> : null}
      {state.status === 'error' ? <DriveBrowserError message={state.message} /> : null}
      {state.status === 'passwordRequired' ? (
        <DriveBrowserPasswordForm
          message={state.message}
          unlocking={state.unlocking}
          unlockError={state.unlockError}
          onUnlock={state.unlock}
        />
      ) : null}
      {state.status === 'ready' ? <DriveBrowserView snapshot={state.snapshot} /> : null}
    </div>
  )

  if (!framed) return content
  return <main className='min-h-svh bg-background p-4 md:p-6'>{content}</main>
}

export function DriveConsoleBrowserPage(props: Omit<Extract<DriveBrowserPageProps, { context: 'owner' }>, 'context' | 'surface'>) {
  return <DriveBrowserPage {...props} context='owner' surface='console' />
}

export function DriveConsoleRootBrowser() {
  const state = useDriveBrowser({ context: 'console-root' })
  if (state.status === 'loading') return <DriveBrowserLoading />
  if (state.status === 'error') return <DriveBrowserError message={state.message} />
  if (state.status !== 'ready') return null
  return <DriveBrowserView snapshot={state.snapshot} />
}

export function DriveBrowserView({ snapshot }: { readonly snapshot: DriveBrowserSnapshotDto }) {
  const actions = getDriveBrowserActions(snapshot)
  return (
    <section className='flex min-h-0 flex-col rounded-md border bg-background'>
      <div className='flex flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:justify-between'>
        <DriveBrowserBreadcrumbs snapshot={snapshot} />
        <div className='flex shrink-0 flex-wrap gap-2'>
          {actions.downloadUrl ? (
            <Button asChild variant='outline' size='sm'>
              <a href={actions.downloadUrl}>
                <Download data-icon='inline-start' />
                下载
              </a>
            </Button>
          ) : null}
          {actions.visitUrl ? (
            <Button asChild size='sm'>
              <a href={actions.visitUrl} target='_blank' rel='noreferrer'>
                <ExternalLink data-icon='inline-start' />
                访问
              </a>
            </Button>
          ) : null}
        </div>
      </div>
      <div className='grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]'>
        <div className='min-h-0 border-b md:border-r md:border-b-0'>
          <DriveBrowserList snapshot={snapshot} />
        </div>
        <DriveBrowserPreview preview={snapshot.preview} current={snapshot.current} />
      </div>
    </section>
  )
}

function DriveBrowserBreadcrumbs({ snapshot }: { readonly snapshot: DriveBrowserSnapshotDto }) {
  return (
    <nav className='flex min-w-0 flex-wrap items-center gap-1 text-sm' aria-label='当前位置'>
      {snapshot.breadcrumbs.map((item, index) => (
        <span key={item.id} className='flex min-w-0 items-center gap-1'>
          {index > 0 ? <span className='text-muted-foreground'>/</span> : null}
          <a
            href={item.browserUrl}
            className={cn(
              'min-w-0 truncate rounded-sm px-1 py-0.5 hover:bg-accent',
              index === snapshot.breadcrumbs.length - 1 ? 'font-medium' : 'text-muted-foreground'
            )}
          >
            {item.name}
          </a>
        </span>
      ))}
    </nav>
  )
}

function DriveBrowserList({ snapshot }: { readonly snapshot: DriveBrowserSnapshotDto }) {
  if (snapshot.current.type !== 'folder') {
    return (
      <div className='flex min-h-72 flex-col gap-2 p-4 text-sm'>
        <div className='flex items-center gap-2 font-medium'>
          <DriveBrowserItemIcon item={snapshot.current} />
          <span className='min-w-0 truncate'>{snapshot.current.name}</span>
        </div>
        <div className='text-muted-foreground'>{formatDriveBrowserSize(snapshot.current)}</div>
        <Badge variant='outline' className='w-fit'>
          {driveBrowserKindLabel(snapshot.current.previewKind)}
        </Badge>
      </div>
    )
  }

  if (snapshot.children.length === 0) {
    return <div className='flex min-h-72 items-center justify-center text-sm text-muted-foreground'>暂无文件</div>
  }

  return (
    <ScrollArea className='h-[520px]'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead className='w-28 text-right'>大小</TableHead>
            <TableHead className='w-40'>更新时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {snapshot.children.map((item) => (
            <TableRow
              key={item.id}
              role='link'
              tabIndex={0}
              className='cursor-pointer'
              onClick={() => {
                window.location.assign(item.browserUrl)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') window.location.assign(item.browserUrl)
              }}
            >
              <TableCell>
                <div className='flex min-w-0 items-center gap-2'>
                  <DriveBrowserItemIcon item={item} />
                  <span className='min-w-0 truncate font-medium'>{item.name}</span>
                </div>
              </TableCell>
              <TableCell className='text-right text-muted-foreground'>
                {formatDriveBrowserSize(item)}
              </TableCell>
              <TableCell className='text-muted-foreground'>
                {formatDriveBrowserDate(item.updatedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  )
}

function DriveBrowserPreview({
  preview,
  current,
}: {
  readonly preview: DriveBrowserPreviewDto | null
  readonly current: DriveBrowserItemDto
}) {
  if (current.type === 'folder') {
    return <div className='min-h-72 p-4 text-sm text-muted-foreground'>选择文件预览</div>
  }
  if (!preview || preview.kind === 'download-only') {
    return (
      <div className='flex min-h-72 flex-col items-start gap-3 p-4 text-sm'>
        <div className='font-medium'>{current.name}</div>
        <div className='text-muted-foreground'>此文件只能下载。</div>
        {current.downloadUrl ? (
          <Button asChild variant='outline' size='sm'>
            <a href={current.downloadUrl}>
              <Download data-icon='inline-start' />
              下载
            </a>
          </Button>
        ) : null}
      </div>
    )
  }
  if (preview.kind === 'image') {
    return (
      <div className='flex min-h-72 items-center justify-center p-4'>
        {preview.imageUrl ? (
          <img src={preview.imageUrl} alt={current.name} className='max-h-[520px] max-w-full rounded-md object-contain' />
        ) : (
          <div className='text-sm text-muted-foreground'>图片不可预览</div>
        )}
      </div>
    )
  }
  if (preview.kind === 'markdown') {
    return <DriveBrowserMarkdownPreview preview={preview} />
  }
  return (
    <ScrollArea className='h-[520px]'>
      <pre className='whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed'>
        {preview.text}
      </pre>
      {preview.truncated ? (
        <div className='border-t px-4 py-2 text-xs text-muted-foreground'>内容已截断</div>
      ) : null}
    </ScrollArea>
  )
}

function DriveBrowserMarkdownPreview({ preview }: { readonly preview: DriveBrowserPreviewDto }) {
  const renderedHtml = preview.html?.trim()
  if (!renderedHtml) {
    return <DriveBrowserTextPreview preview={preview} />
  }

  return (
    <Tabs defaultValue='rendered' className='h-[520px] min-h-0 gap-0'>
      <div className='border-b px-4 py-2'>
        <TabsList>
          <TabsTrigger type='button' value='rendered'>预览</TabsTrigger>
          <TabsTrigger type='button' value='source'>源码</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value='rendered' className='min-h-0'>
        <ScrollArea className='h-[468px]'>
          <div
            className='space-y-3 p-4 text-sm leading-relaxed [&_a]:underline [&_blockquote]:border-l [&_blockquote]:pl-3 [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-medium [&_hr]:border-border [&_li]:ml-4 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_ul]:list-disc'
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
          {preview.truncated ? (
            <div className='border-t px-4 py-2 text-xs text-muted-foreground'>内容已截断</div>
          ) : null}
        </ScrollArea>
      </TabsContent>
      <TabsContent value='source' className='min-h-0'>
        <DriveBrowserTextPreview preview={preview} />
      </TabsContent>
    </Tabs>
  )
}

function DriveBrowserTextPreview({ preview }: { readonly preview: DriveBrowserPreviewDto }) {
  return (
    <ScrollArea className='h-[520px]'>
      <pre className='whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed'>
        {preview.text}
      </pre>
      {preview.truncated ? (
        <div className='border-t px-4 py-2 text-xs text-muted-foreground'>内容已截断</div>
      ) : null}
    </ScrollArea>
  )
}

function DriveBrowserPasswordForm({
  message,
  unlocking,
  unlockError,
  onUnlock,
}: {
  readonly message: string
  readonly unlocking: boolean
  readonly unlockError: string | null
  readonly onUnlock: (password: string) => void
}) {
  const [password, setPassword] = useState('')
  return (
    <form
      className='mx-auto flex w-full max-w-sm flex-col gap-3 rounded-md border bg-background p-4'
      onSubmit={(event) => {
        event.preventDefault()
        onUnlock(password)
      }}
    >
      <div className='text-sm font-medium'>{message}</div>
      <Input
        type='password'
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete='current-password'
      />
      {unlockError ? <div className='text-sm text-destructive'>{unlockError}</div> : null}
      <Button type='submit' disabled={unlocking || password.length === 0}>
        确定
      </Button>
    </form>
  )
}

function DriveBrowserLoading() {
  return (
    <div className='flex flex-col gap-3 rounded-md border p-4'>
      <div className='text-sm text-muted-foreground'>加载中...</div>
      <Skeleton className='h-10 w-full' />
      <Skeleton className='h-64 w-full' />
    </div>
  )
}

function DriveBrowserError({ message }: { readonly message: string }) {
  return (
    <Alert variant='destructive'>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

function DriveBrowserItemIcon({ item }: { readonly item: DriveBrowserItemDto }) {
  if (item.type === 'folder') return <Folder className='size-4 shrink-0 text-muted-foreground' />
  if (item.previewKind === 'image') return <Image className='size-4 shrink-0 text-muted-foreground' />
  if (item.previewKind === 'text' || item.previewKind === 'html-source' || item.previewKind === 'markdown') return <FileText className='size-4 shrink-0 text-muted-foreground' />
  if (item.previewKind === 'download-only') return <Archive className='size-4 shrink-0 text-muted-foreground' />
  return <File className='size-4 shrink-0 text-muted-foreground' />
}

export function getDriveBrowserActions(snapshot: DriveBrowserSnapshotDto) {
  return {
    downloadUrl: snapshot.current.downloadUrl,
    visitUrl: snapshot.preview?.visitUrl ?? null,
  }
}

export function getDriveBrowserChildUrls(snapshot: DriveBrowserSnapshotDto) {
  return snapshot.children.map((item) => item.browserUrl)
}

function driveBrowserKindLabel(kind: DriveBrowserItemDto['previewKind']) {
  const labels: Record<DriveBrowserItemDto['previewKind'], string> = {
    image: '图片',
    text: '文本',
    'html-source': 'HTML',
    markdown: 'Markdown',
    'download-only': '下载',
  }
  return labels[kind]
}

function formatDriveBrowserSize(item: DriveBrowserItemDto) {
  if (item.type === 'folder') return '-'
  const bytes = Number(item.size)
  if (!Number.isFinite(bytes)) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatDriveBrowserDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN')
}
