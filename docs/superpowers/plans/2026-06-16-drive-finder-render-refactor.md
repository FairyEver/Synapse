# Drive Finder Render Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the dashboard Drive browser as a Finder plus Renderer Registry architecture that supports full-folder Finder views, split Finder/Renderer views, and body-level single-file renderers.

**Architecture:** Keep `useDriveBrowser()` and `DriveBrowserSnapshotDto` as the data boundary. Move formatting, icons, action selection, renderer option selection, Finder layout, and actual renderers out of the current monolithic `drive-browser-page.tsx` into focused module files under `dashboard/src/features/drive-browser/`. The first implementation uses a static typed renderer registry, not a runtime plugin system.

**Tech Stack:** React 19, TypeScript, TanStack Router, shadcn/Radix components, Tailwind token classes, Vitest server-side React rendering tests.

---

## File Structure

- Modify: `dashboard/src/features/drive-browser/drive-browser-page.tsx`
  - Keep the public `DriveBrowserPage`, `DriveConsoleBrowserPage`, and `DriveConsoleRootBrowser` exports.
  - Delegate ready-state rendering to new host/finder/renderer components.
- Modify: `dashboard/src/features/drive-browser/drive-console-page.tsx`
  - Keep console shell unchanged; only adjust imports if public exports move.
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.test.ts`
  - Replace tests that assert old panel internals with tests for Finder/Renderer behavior.
- Create: `dashboard/src/features/drive-browser/shared/drive-format.ts`
  - Own file size, date, and kind-label formatting.
- Create: `dashboard/src/features/drive-browser/shared/drive-icons.tsx`
  - Own item icon selection.
- Create: `dashboard/src/features/drive-browser/shared/drive-view-model.ts`
  - Own action and layout helper functions.
- Create: `dashboard/src/features/drive-browser/renderers/drive-renderer-registry.ts`
  - Own renderer ids, labels, enabled-state logic, and default renderer selection.
- Create: `dashboard/src/features/drive-browser/renderers/drive-renderer-shell.tsx`
  - Own renderer option state, renderer menu, body-level floating menu, and renderer dispatch.
- Create: `dashboard/src/features/drive-browser/renderers/markdown-renderer.tsx`
  - Own Markdown rendered/source tabs.
- Create: `dashboard/src/features/drive-browser/renderers/source-renderer.tsx`
  - Own text/source preview.
- Create: `dashboard/src/features/drive-browser/renderers/image-renderer.tsx`
  - Own image preview.
- Create: `dashboard/src/features/drive-browser/renderers/download-renderer.tsx`
  - Own download-only and non-preview state.
- Create: `dashboard/src/features/drive-browser/finder/drive-finder-breadcrumbs.tsx`
  - Own clickable breadcrumb rendering.
- Create: `dashboard/src/features/drive-browser/finder/drive-finder-list.tsx`
  - Own folder children table, empty state, row navigation, selection highlighting, and load-more action.
- Create: `dashboard/src/features/drive-browser/finder/drive-finder-layout.tsx`
  - Own full-folder and split Finder/Renderer layout.
- Create: `dashboard/src/features/drive-browser/finder/drive-finder.tsx`
  - Own Finder composition: breadcrumbs, directory actions, list, file header, and renderer shell.
- Modify: `RELEASE_NOTES_PENDING.md`
  - Add a user-facing note about the Drive Finder/Renderer interface.

## Task 1: Extract Shared Formatting, Icons, And View Model

**Files:**
- Create: `dashboard/src/features/drive-browser/shared/drive-format.ts`
- Create: `dashboard/src/features/drive-browser/shared/drive-icons.tsx`
- Create: `dashboard/src/features/drive-browser/shared/drive-view-model.ts`
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.test.ts`

- [ ] **Step 1: Write failing view-model tests**

Add these imports to `dashboard/src/features/drive-browser/drive-browser-page.test.ts`:

```ts
import {
  getDriveBrowserActions,
  getDriveBrowserChildUrls,
  getDriveFinderActions,
  shouldRenderDriveBodyRenderer,
  shouldRenderDriveSingleFileReader,
} from './shared/drive-view-model'
import { formatDriveBrowserSize, driveBrowserKindLabel } from './shared/drive-format'
```

Then add these tests near the existing view-model tests:

```ts
it('formats drive file metadata from shared helpers', () => {
  expect(formatDriveBrowserSize({ ...baseCurrent(), size: '7372' })).toBe('7.2 KB')
  expect(formatDriveBrowserSize({ ...baseCurrent(), type: 'folder' })).toBe('-')
  expect(driveBrowserKindLabel('markdown')).toBe('Markdown')
})

it('keeps finder actions limited to browser actions', () => {
  const folder = createSnapshot({
    current: {
      ...baseCurrent(),
      id: 'folder',
      type: 'folder',
      browserUrl: '/drive/items/folder',
      downloadUrl: '/drive/items/folder/zip',
    },
  })
  const file = createSnapshot({
    current: {
      ...baseCurrent(),
      id: 'file',
      type: 'file',
      browserUrl: '/drive/items/folder/items/file',
      downloadUrl: '/drive/items/folder/items/file/download',
    },
  })

  expect(getDriveFinderActions(folder)).toEqual({
    directoryDownloadUrl: '/drive/items/folder/zip',
    fileDownloadUrl: null,
    fileOpenUrl: null,
    visitUrl: null,
  })
  expect(getDriveFinderActions(file)).toEqual({
    directoryDownloadUrl: null,
    fileDownloadUrl: '/drive/items/folder/items/file/download',
    fileOpenUrl: '/drive/items/folder/items/file',
    visitUrl: '/drive/items/root/items/file/render',
  })
})

it('uses body renderer for standalone and shared files but not console files or folders', () => {
  expect(shouldRenderDriveBodyRenderer(createSnapshot({ context: 'share' }))).toBe(true)
  expect(shouldRenderDriveBodyRenderer(createSnapshot({ context: 'owner', surface: 'standalone' }))).toBe(true)
  expect(shouldRenderDriveBodyRenderer(createSnapshot({ context: 'owner', surface: 'console' }))).toBe(false)
  expect(shouldRenderDriveBodyRenderer(createSnapshot({
    context: 'share',
    current: { ...baseCurrent(), type: 'folder' },
  }))).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/drive-browser-page.test.ts
```

Expected: FAIL because `./shared/drive-view-model` and `./shared/drive-format` do not exist.

- [ ] **Step 3: Create formatting helpers**

Create `dashboard/src/features/drive-browser/shared/drive-format.ts`:

```ts
import type { DriveBrowserItemDto, DriveBrowserPreviewKind } from '@synapse/shared'

export function driveBrowserKindLabel(kind: DriveBrowserPreviewKind) {
  const labels: Record<DriveBrowserPreviewKind, string> = {
    image: '图片',
    text: '文本',
    'html-source': 'HTML',
    markdown: 'Markdown',
    'download-only': '下载',
  }
  return labels[kind]
}

export function formatDriveBrowserSize(item: DriveBrowserItemDto) {
  if (item.type === 'folder') return '-'
  const bytes = Number(item.size)
  if (!Number.isFinite(bytes)) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export function formatDriveBrowserDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN')
}
```

- [ ] **Step 4: Create icon helper component**

Create `dashboard/src/features/drive-browser/shared/drive-icons.tsx`:

```tsx
import type { DriveBrowserItemDto } from '@synapse/shared'
import { Archive, File, FileText, Folder, Image } from 'lucide-react'

export function DriveBrowserItemIcon({ item }: { readonly item: DriveBrowserItemDto }) {
  if (item.type === 'folder') return <Folder className='size-4 shrink-0 text-muted-foreground' />
  if (item.previewKind === 'image') return <Image className='size-4 shrink-0 text-muted-foreground' />
  if (
    item.previewKind === 'text' ||
    item.previewKind === 'html-source' ||
    item.previewKind === 'markdown'
  ) {
    return <FileText className='size-4 shrink-0 text-muted-foreground' />
  }
  if (item.previewKind === 'download-only') return <Archive className='size-4 shrink-0 text-muted-foreground' />
  return <File className='size-4 shrink-0 text-muted-foreground' />
}
```

- [ ] **Step 5: Create view-model helpers**

Create `dashboard/src/features/drive-browser/shared/drive-view-model.ts`:

```ts
import type { DriveBrowserSnapshotDto } from '@synapse/shared'

export type DriveHostMode = 'console' | 'standalone' | 'share'

export function getDriveBrowserActions(snapshot: DriveBrowserSnapshotDto) {
  return {
    downloadUrl: snapshot.current.downloadUrl,
    visitUrl: snapshot.preview?.visitUrl ?? null,
  }
}

export function getDriveFinderActions(snapshot: DriveBrowserSnapshotDto) {
  const isFolder = snapshot.current.type === 'folder'
  return {
    directoryDownloadUrl: isFolder ? snapshot.current.downloadUrl : null,
    fileDownloadUrl: isFolder ? null : snapshot.current.downloadUrl,
    fileOpenUrl: isFolder ? null : snapshot.current.browserUrl,
    visitUrl: isFolder ? null : snapshot.preview?.visitUrl ?? null,
  }
}

export function getDriveBrowserChildUrls(snapshot: DriveBrowserSnapshotDto) {
  return snapshot.children.map((item) => item.browserUrl)
}

export function shouldRenderDriveSingleFileReader(snapshot: DriveBrowserSnapshotDto): boolean {
  return snapshot.current.type === 'file'
}

export function shouldRenderDriveBodyRenderer(snapshot: DriveBrowserSnapshotDto): boolean {
  return snapshot.current.type === 'file' && (snapshot.context === 'share' || snapshot.surface === 'standalone')
}
```

- [ ] **Step 6: Re-export helpers from `drive-browser-page.tsx` while the old file still owns rendering**

At the bottom of `dashboard/src/features/drive-browser/drive-browser-page.tsx`, remove the local `getDriveBrowserActions`, `getDriveBrowserChildUrls`, `shouldRenderDriveSingleFileReader`, `driveBrowserKindLabel`, `formatDriveBrowserSize`, and `formatDriveBrowserDate` implementations. Import them from the new shared files at the top:

```ts
import { driveBrowserKindLabel, formatDriveBrowserDate, formatDriveBrowserSize } from './shared/drive-format'
import { DriveBrowserItemIcon } from './shared/drive-icons'
import {
  getDriveBrowserActions,
  getDriveBrowserChildUrls,
  shouldRenderDriveSingleFileReader,
} from './shared/drive-view-model'
```

Add this export block near the existing exports:

```ts
export {
  getDriveBrowserActions,
  getDriveBrowserChildUrls,
  shouldRenderDriveSingleFileReader,
} from './shared/drive-view-model'
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/drive-browser-page.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add dashboard/src/features/drive-browser
git commit -m "refactor: extract drive browser view model"
```

## Task 2: Add Renderer Registry And Renderer Shell

**Files:**
- Create: `dashboard/src/features/drive-browser/renderers/drive-renderer-registry.ts`
- Create: `dashboard/src/features/drive-browser/renderers/drive-renderer-shell.tsx`
- Create: `dashboard/src/features/drive-browser/renderers/markdown-renderer.tsx`
- Create: `dashboard/src/features/drive-browser/renderers/source-renderer.tsx`
- Create: `dashboard/src/features/drive-browser/renderers/image-renderer.tsx`
- Create: `dashboard/src/features/drive-browser/renderers/iframe-renderer.tsx`
- Create: `dashboard/src/features/drive-browser/renderers/download-renderer.tsx`
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.test.ts`

- [ ] **Step 1: Write failing registry tests**

Add these imports to `dashboard/src/features/drive-browser/drive-browser-page.test.ts`:

```ts
import {
  getDriveRendererOptions,
  selectDefaultDriveRenderer,
} from './renderers/drive-renderer-registry'
```

Add these tests:

```ts
it('returns markdown renderer options with rendered preview as default', () => {
  const snapshot = createSnapshot({
    current: { ...baseCurrent(), name: 'notes.md', previewKind: 'markdown' },
    preview: { ...basePreview(), kind: 'markdown', html: '<h1>Notes</h1>', text: '# Notes' },
  })

  const options = getDriveRendererOptions(snapshot)

  expect(options.map((option) => option.id)).toEqual(['markdown', 'source'])
  expect(selectDefaultDriveRenderer(snapshot)?.id).toBe('markdown')
})

it('only exposes iframe renderer for owner html files with visit urls', () => {
  const owner = createSnapshot({
    context: 'owner',
    current: { ...baseCurrent(), name: 'page.html', previewKind: 'html-source' },
    preview: { ...basePreview(), kind: 'html-source', visitUrl: '/drive/items/root/items/file/render' },
  })
  const shared = createSnapshot({
    context: 'share',
    current: { ...baseCurrent(), name: 'page.html', previewKind: 'html-source' },
    preview: { ...basePreview(), kind: 'html-source', visitUrl: null },
  })

  expect(getDriveRendererOptions(owner).map((option) => option.id)).toEqual(['source', 'iframe'])
  expect(getDriveRendererOptions(shared).map((option) => option.id)).toEqual(['source'])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/drive-browser-page.test.ts
```

Expected: FAIL because renderer registry files do not exist.

- [ ] **Step 3: Create renderer registry**

Create `dashboard/src/features/drive-browser/renderers/drive-renderer-registry.ts`:

```ts
import type { DriveBrowserSnapshotDto } from '@synapse/shared'

export type DriveRendererId = 'markdown' | 'source' | 'image' | 'iframe' | 'download'
export type DriveRendererContainer = 'reading' | 'media' | 'full'

export type DriveRendererOption = {
  readonly id: DriveRendererId
  readonly label: string
  readonly container: DriveRendererContainer
}

const RENDERERS: Record<DriveRendererId, DriveRendererOption> = {
  markdown: { id: 'markdown', label: '预览', container: 'reading' },
  source: { id: 'source', label: '源码', container: 'reading' },
  image: { id: 'image', label: '图片', container: 'media' },
  iframe: { id: 'iframe', label: '网页', container: 'full' },
  download: { id: 'download', label: '下载', container: 'reading' },
}

export function getDriveRendererOptions(snapshot: DriveBrowserSnapshotDto): readonly DriveRendererOption[] {
  if (snapshot.current.type === 'folder') return []
  const preview = snapshot.preview
  if (!preview || preview.kind === 'download-only') return [RENDERERS.download]
  if (preview.kind === 'markdown') return [RENDERERS.markdown, RENDERERS.source]
  if (preview.kind === 'image') return [RENDERERS.image]
  if (preview.kind === 'html-source') {
    return snapshot.context === 'owner' && preview.visitUrl
      ? [RENDERERS.source, RENDERERS.iframe]
      : [RENDERERS.source]
  }
  return [RENDERERS.source]
}

export function selectDefaultDriveRenderer(snapshot: DriveBrowserSnapshotDto): DriveRendererOption | null {
  return getDriveRendererOptions(snapshot)[0] ?? null
}

export function findDriveRendererOption(
  snapshot: DriveBrowserSnapshotDto,
  rendererId: DriveRendererId | null
): DriveRendererOption | null {
  const options = getDriveRendererOptions(snapshot)
  if (!rendererId) return options[0] ?? null
  return options.find((option) => option.id === rendererId) ?? options[0] ?? null
}
```

- [ ] **Step 4: Create renderer components**

Create `dashboard/src/features/drive-browser/renderers/source-renderer.tsx`:

```tsx
import type { DriveBrowserPreviewDto } from '@synapse/shared'
import { cn } from '@/lib/utils'

export function DriveSourceRenderer({
  preview,
  className,
}: {
  readonly preview: DriveBrowserPreviewDto
  readonly className?: string
}) {
  return (
    <div className={cn('py-6', className)}>
      <pre className='whitespace-pre-wrap break-words font-mono text-sm leading-6'>
        {preview.text}
      </pre>
      {preview.truncated ? (
        <div className='mt-4 border-t pt-2 text-xs text-muted-foreground'>内容已截断</div>
      ) : null}
    </div>
  )
}
```

Create `dashboard/src/features/drive-browser/renderers/markdown-renderer.tsx`:

```tsx
import type { DriveBrowserPreviewDto } from '@synapse/shared'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DriveSourceRenderer } from './source-renderer'

export function DriveMarkdownRenderer({ preview }: { readonly preview: DriveBrowserPreviewDto }) {
  const renderedHtml = preview.html?.trim()
  if (!renderedHtml) return <DriveSourceRenderer preview={preview} />

  return (
    <Tabs defaultValue='rendered' className='min-h-0 gap-0 py-6'>
      <div data-renderer-toolbar='markdown' className='flex justify-end pb-4'>
        <TabsList>
          <TabsTrigger type='button' value='rendered'>预览</TabsTrigger>
          <TabsTrigger type='button' value='source'>源码</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value='rendered' className='min-h-0'>
        <div
          className='space-y-3 text-base leading-7 [&_a]:underline [&_blockquote]:border-l [&_blockquote]:pl-3 [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:font-medium [&_hr]:border-border [&_li]:ml-4 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_ul]:list-disc'
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
        {preview.truncated ? (
          <div className='mt-4 border-t pt-2 text-xs text-muted-foreground'>内容已截断</div>
        ) : null}
      </TabsContent>
      <TabsContent value='source' className='min-h-0'>
        <DriveSourceRenderer preview={preview} className='py-0' />
      </TabsContent>
    </Tabs>
  )
}
```

Create `dashboard/src/features/drive-browser/renderers/image-renderer.tsx`:

```tsx
import type { DriveBrowserItemDto, DriveBrowserPreviewDto } from '@synapse/shared'

export function DriveImageRenderer({
  current,
  preview,
}: {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
}) {
  return (
    <div className='flex min-h-0 items-center justify-center py-6'>
      {preview.imageUrl ? (
        <img src={preview.imageUrl} alt={current.name} className='max-h-screen max-w-full rounded-md object-contain' />
      ) : (
        <div className='text-sm text-muted-foreground'>图片不可预览</div>
      )}
    </div>
  )
}
```

Create `dashboard/src/features/drive-browser/renderers/download-renderer.tsx`:

```tsx
import type { DriveBrowserItemDto } from '@synapse/shared'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function DriveDownloadRenderer({ current }: { readonly current: DriveBrowserItemDto }) {
  return (
    <div className='flex flex-col items-start gap-3 py-8 text-sm'>
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
```

- [ ] **Step 5: Create iframe renderer**

Create `dashboard/src/features/drive-browser/renderers/iframe-renderer.tsx`:

```tsx
import type { DriveBrowserItemDto } from '@synapse/shared'

export function DriveIframeRenderer({
  current,
  visitUrl,
}: {
  readonly current: DriveBrowserItemDto
  readonly visitUrl: string
}) {
  return (
    <iframe
      title={current.name}
      src={visitUrl}
      className='h-svh w-full border-0 bg-background'
      sandbox='allow-same-origin allow-scripts'
    />
  )
}

```

- [ ] **Step 6: Create renderer shell**

Create `dashboard/src/features/drive-browser/renderers/drive-renderer-shell.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { Download, ExternalLink, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { driveBrowserKindLabel, formatDriveBrowserDate, formatDriveBrowserSize } from '../shared/drive-format'
import { DriveBrowserItemIcon } from '../shared/drive-icons'
import {
  findDriveRendererOption,
  getDriveRendererOptions,
  type DriveRendererId,
  type DriveRendererOption,
} from './drive-renderer-registry'
import { DriveDownloadRenderer } from './download-renderer'
import { DriveIframeRenderer } from './iframe-renderer'
import { DriveImageRenderer } from './image-renderer'
import { DriveMarkdownRenderer } from './markdown-renderer'
import { DriveSourceRenderer } from './source-renderer'

const READING_CONTAINER_CLASSNAME = 'mx-auto w-full max-w-4xl px-4 md:px-6'
const MEDIA_CONTAINER_CLASSNAME = 'mx-auto w-full max-w-6xl px-4 md:px-6'

export function DriveRendererShell({
  snapshot,
  body = false,
  rendererId,
  onRendererChange,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly body?: boolean
  readonly rendererId?: DriveRendererId | null
  readonly onRendererChange?: (id: DriveRendererId) => void
}) {
  const options = useMemo(() => getDriveRendererOptions(snapshot), [snapshot])
  const [internalRendererId, setInternalRendererId] = useState<DriveRendererId | null>(options[0]?.id ?? null)
  const activeRendererId = rendererId === undefined ? internalRendererId : rendererId
  const selected = findDriveRendererOption(snapshot, activeRendererId)
  const setRenderer = (id: DriveRendererId) => {
    if (onRendererChange) {
      onRendererChange(id)
      return
    }
    setInternalRendererId(id)
  }

  useEffect(() => {
    if (rendererId !== undefined) return
    setInternalRendererId((current) => findDriveRendererOption(snapshot, current)?.id ?? null)
  }, [rendererId, snapshot])

  if (!selected) return null

  return (
    <section className={cn('min-h-0 bg-background', body ? 'min-h-svh' : 'h-full')}>
      {body ? (
        <DriveRendererFloatingMenu snapshot={snapshot} options={options} selected={selected} onSelect={setRenderer} />
      ) : null}
      <DriveRendererContent snapshot={snapshot} selected={selected} />
    </section>
  )
}

export function DriveRendererContent({
  snapshot,
  selected,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly selected: DriveRendererOption
}) {
  const preview = snapshot.preview
  const containerClassName = selected.container === 'media'
    ? MEDIA_CONTAINER_CLASSNAME
    : selected.container === 'reading'
      ? READING_CONTAINER_CLASSNAME
      : 'min-h-svh w-full px-4 md:px-6'

  if (!preview || selected.id === 'download') {
    return (
      <div className={containerClassName}>
        <DriveDownloadRenderer current={snapshot.current} />
      </div>
    )
  }
  if (selected.id === 'markdown') {
    return (
      <div className={containerClassName}>
        <DriveMarkdownRenderer preview={preview} />
      </div>
    )
  }
  if (selected.id === 'image') {
    return (
      <div className={containerClassName}>
        <DriveImageRenderer current={snapshot.current} preview={preview} />
      </div>
    )
  }
  if (selected.id === 'iframe' && preview.visitUrl) {
    return <DriveIframeRenderer current={snapshot.current} visitUrl={preview.visitUrl} />
  }
  return (
    <div className={containerClassName}>
      <DriveSourceRenderer preview={preview} />
    </div>
  )
}

function DriveRendererFloatingMenu({
  snapshot,
  options,
  selected,
  onSelect,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly options: readonly DriveRendererOption[]
  readonly selected: DriveRendererOption
  readonly onSelect: (id: DriveRendererId) => void
}) {
  return (
    <div className='fixed right-5 bottom-5 z-50'>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type='button' size='icon' className='rounded-full' aria-label='文件操作'>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-64'>
          <DropdownMenuLabel className='flex min-w-0 items-center gap-2'>
            <DriveBrowserItemIcon item={snapshot.current} />
            <span className='min-w-0 truncate'>{snapshot.current.name}</span>
          </DropdownMenuLabel>
          <div className='px-2 pb-2 text-xs text-muted-foreground'>
            {formatDriveBrowserSize(snapshot.current)} / {driveBrowserKindLabel(snapshot.current.previewKind)} / {formatDriveBrowserDate(snapshot.current.updatedAt)}
          </div>
          <DropdownMenuSeparator />
          {snapshot.current.downloadUrl ? (
            <DropdownMenuItem asChild>
              <a href={snapshot.current.downloadUrl}>
                <Download data-icon='inline-start' />
                下载
              </a>
            </DropdownMenuItem>
          ) : null}
          {snapshot.preview?.visitUrl ? (
            <DropdownMenuItem asChild>
              <a href={snapshot.preview.visitUrl} target='_blank' rel='noreferrer'>
                <ExternalLink data-icon='inline-start' />
                新窗口打开
              </a>
            </DropdownMenuItem>
          ) : null}
          {options.length > 1 ? <DropdownMenuSeparator /> : null}
          {options.length > 1 ? options.map((option) => (
            <DropdownMenuItem key={option.id} onClick={() => onSelect(option.id)}>
              {option.id === selected.id ? '当前：' : null}{option.label}
            </DropdownMenuItem>
          )) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/drive-browser-page.test.ts
```

Expected: PASS for registry tests while old rendering tests may still fail only if imports were already moved. Fix import paths, not behavior, in this task.

- [ ] **Step 8: Commit**

```bash
git add dashboard/src/features/drive-browser
git commit -m "feat: add drive renderer registry"
```

## Task 3: Build Finder Components And Split Layout

**Files:**
- Create: `dashboard/src/features/drive-browser/finder/drive-finder-breadcrumbs.tsx`
- Create: `dashboard/src/features/drive-browser/finder/drive-finder-list.tsx`
- Create: `dashboard/src/features/drive-browser/finder/drive-finder-layout.tsx`
- Create: `dashboard/src/features/drive-browser/finder/drive-finder.tsx`
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.test.ts`

- [ ] **Step 1: Write failing Finder rendering tests**

Add this import:

```ts
import { DriveFinder } from './finder/drive-finder'
```

Add these tests:

```ts
it('renders console folders as full-width finder without renderer chrome', () => {
  const snapshot = createSnapshot({
    context: 'owner',
    surface: 'console',
    current: {
      ...baseCurrent(),
      id: 'folder',
      type: 'folder',
      browserUrl: '/drive/items/folder',
      downloadUrl: '/drive/items/folder/zip',
    },
    children: [
      { ...baseCurrent(), id: 'file', name: 'notes.md', browserUrl: '/drive/items/folder/items/file' },
    ],
    preview: null,
  })

  const html = renderToStaticMarkup(createElement(DriveFinder, { snapshot, mode: 'console' }))

  expect(html).toContain('data-drive-finder="full"')
  expect(html).toContain('下载整个目录')
  expect(html).toContain('notes.md')
  expect(html).not.toContain('data-drive-renderer-region="true"')
})

it('renders console files as split finder and renderer layout', () => {
  const snapshot = createSnapshot({
    context: 'owner',
    surface: 'console',
    current: {
      ...baseCurrent(),
      id: 'file',
      name: 'notes.md',
      browserUrl: '/drive/items/folder/items/file',
      downloadUrl: '/drive/items/folder/items/file/download',
      previewKind: 'markdown',
    },
    children: [
      { ...baseCurrent(), id: 'file', name: 'notes.md', browserUrl: '/drive/items/folder/items/file', previewKind: 'markdown' },
    ],
    preview: { ...basePreview(), kind: 'markdown', html: '<h1>Notes</h1>', text: '# Notes' },
  })

  const html = renderToStaticMarkup(createElement(DriveFinder, { snapshot, mode: 'console' }))

  expect(html).toContain('data-drive-finder="split"')
  expect(html).toContain('data-drive-renderer-region="true"')
  expect(html).toContain('新窗口打开')
  expect(html).toContain('切换显示')
  expect(html).toContain('<h1>Notes</h1>')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/drive-browser-page.test.ts
```

Expected: FAIL because Finder files do not exist.

- [ ] **Step 3: Create breadcrumbs component**

Create `dashboard/src/features/drive-browser/finder/drive-finder-breadcrumbs.tsx`:

```tsx
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { cn } from '@/lib/utils'

export function DriveFinderBreadcrumbs({ snapshot }: { readonly snapshot: DriveBrowserSnapshotDto }) {
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
```

- [ ] **Step 4: Create list component**

Create `dashboard/src/features/drive-browser/finder/drive-finder-list.tsx`:

```tsx
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { formatDriveBrowserDate, formatDriveBrowserSize } from '../shared/drive-format'
import { DriveBrowserItemIcon } from '../shared/drive-icons'

export function DriveFinderList({
  snapshot,
  onLoadMoreChildren,
  loadingMoreChildren = false,
  loadMoreChildrenError = null,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly onLoadMoreChildren?: () => void
  readonly loadingMoreChildren?: boolean
  readonly loadMoreChildrenError?: string | null
}) {
  if (snapshot.children.length === 0) {
    return (
      <div className='flex h-full min-h-72 items-center justify-center text-sm text-muted-foreground'>
        暂无文件
      </div>
    )
  }

  const canLoadMoreChildren = Boolean(snapshot.childrenPage?.hasMore && onLoadMoreChildren)

  return (
    <ScrollArea className='h-full min-h-0'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead className='w-28 text-right'>大小</TableHead>
            <TableHead className='w-40'>更新时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {snapshot.children.map((item) => {
            const selected = snapshot.current.id === item.id
            return (
              <TableRow
                key={item.id}
                role='link'
                tabIndex={0}
                aria-current={selected ? 'page' : undefined}
                className={cn('cursor-pointer', selected && 'bg-muted')}
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
            )
          })}
        </TableBody>
      </Table>
      {canLoadMoreChildren || loadMoreChildrenError ? (
        <div className='flex flex-col items-center gap-2 border-t px-3 py-3'>
          {canLoadMoreChildren ? (
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={onLoadMoreChildren}
              disabled={loadingMoreChildren}
            >
              {loadingMoreChildren ? <Loader2 data-icon='inline-start' className='animate-spin' /> : null}
              加载更多
            </Button>
          ) : null}
          {loadMoreChildrenError ? (
            <div className='text-sm text-destructive'>{loadMoreChildrenError}</div>
          ) : null}
        </div>
      ) : null}
    </ScrollArea>
  )
}
```

- [ ] **Step 5: Create Finder layout and composition**

Create `dashboard/src/features/drive-browser/finder/drive-finder-layout.tsx`:

```tsx
import type { ReactNode } from 'react'

export function DriveFinderFullLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div data-drive-finder='full' className='min-h-0 flex-1 overflow-hidden rounded-md border bg-background'>
      {children}
    </div>
  )
}

export function DriveFinderSplitLayout({
  list,
  renderer,
}: {
  readonly list: ReactNode
  readonly renderer: ReactNode
}) {
  return (
    <div
      data-drive-finder='split'
      className='grid min-h-0 flex-1 overflow-hidden rounded-md border bg-background md:grid-cols-[minmax(260px,32%)_minmax(0,1fr)]'
    >
      <div className='min-h-0 border-b md:border-r md:border-b-0'>{list}</div>
      <div data-drive-renderer-region='true' className='min-h-0'>{renderer}</div>
    </div>
  )
}
```

Create `dashboard/src/features/drive-browser/finder/drive-finder.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { Download, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { driveBrowserKindLabel, formatDriveBrowserDate, formatDriveBrowserSize } from '../shared/drive-format'
import { DriveBrowserItemIcon } from '../shared/drive-icons'
import { getDriveFinderActions } from '../shared/drive-view-model'
import {
  findDriveRendererOption,
  getDriveRendererOptions,
  type DriveRendererId,
} from '../renderers/drive-renderer-registry'
import { DriveRendererShell } from '../renderers/drive-renderer-shell'
import { DriveFinderBreadcrumbs } from './drive-finder-breadcrumbs'
import { DriveFinderList } from './drive-finder-list'
import { DriveFinderFullLayout, DriveFinderSplitLayout } from './drive-finder-layout'

export function DriveFinder({
  snapshot,
  mode,
  onLoadMoreChildren,
  loadingMoreChildren = false,
  loadMoreChildrenError = null,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly mode: 'console' | 'share' | 'standalone'
  readonly onLoadMoreChildren?: () => void
  readonly loadingMoreChildren?: boolean
  readonly loadMoreChildrenError?: string | null
}) {
  const fileSelected = snapshot.current.type === 'file'
  const rendererOptions = useMemo(() => getDriveRendererOptions(snapshot), [snapshot])
  const [rendererId, setRendererId] = useState<DriveRendererId | null>(rendererOptions[0]?.id ?? null)
  const selectedRenderer = findDriveRendererOption(snapshot, rendererId)

  useEffect(() => {
    setRendererId((current) => findDriveRendererOption(snapshot, current)?.id ?? null)
  }, [snapshot])

  const list = (
    <DriveFinderList
      snapshot={snapshot}
      onLoadMoreChildren={onLoadMoreChildren}
      loadingMoreChildren={loadingMoreChildren}
      loadMoreChildrenError={loadMoreChildrenError}
    />
  )

  return (
    <section data-drive-finder-mode={mode} className='flex min-h-0 flex-1 flex-col gap-3'>
      <DriveFinderToolbar snapshot={snapshot} />
      {fileSelected ? (
        <DriveFinderSplitLayout
          list={list}
          renderer={(
            <div className='flex h-full min-h-0 flex-col'>
              <DriveFinderFileHeader
                snapshot={snapshot}
                rendererId={selectedRenderer?.id ?? null}
                onRendererChange={setRendererId}
              />
              <div className='min-h-0 flex-1 overflow-auto'>
                <DriveRendererShell
                  snapshot={snapshot}
                  rendererId={selectedRenderer?.id ?? null}
                  onRendererChange={setRendererId}
                />
              </div>
            </div>
          )}
        />
      ) : (
        <DriveFinderFullLayout>{list}</DriveFinderFullLayout>
      )}
    </section>
  )
}

function DriveFinderToolbar({ snapshot }: { readonly snapshot: DriveBrowserSnapshotDto }) {
  const actions = getDriveFinderActions(snapshot)
  return (
    <div className='flex shrink-0 flex-col gap-3 md:flex-row md:items-center md:justify-between'>
      <DriveFinderBreadcrumbs snapshot={snapshot} />
      <div className='flex shrink-0 flex-wrap gap-2'>
        {actions.directoryDownloadUrl ? (
          <Button asChild variant='outline' size='sm'>
            <a href={actions.directoryDownloadUrl}>
              <Download data-icon='inline-start' />
              下载整个目录
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function DriveFinderFileHeader({
  snapshot,
  rendererId,
  onRendererChange,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly rendererId: DriveRendererId | null
  readonly onRendererChange: (id: DriveRendererId) => void
}) {
  const actions = getDriveFinderActions(snapshot)
  const rendererOptions = getDriveRendererOptions(snapshot)
  return (
    <header className='flex shrink-0 flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:justify-between'>
      <div className='flex min-w-0 flex-col gap-1'>
        <div className='flex min-w-0 items-center gap-2 text-sm font-medium'>
          <DriveBrowserItemIcon item={snapshot.current} />
          <span className='min-w-0 truncate'>{snapshot.current.name}</span>
        </div>
        <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
          <span>{formatDriveBrowserSize(snapshot.current)}</span>
          <span>{driveBrowserKindLabel(snapshot.current.previewKind)}</span>
          <span>{formatDriveBrowserDate(snapshot.current.updatedAt)}</span>
        </div>
      </div>
      <div className='flex shrink-0 flex-wrap gap-2'>
        {actions.fileDownloadUrl ? (
          <Button asChild variant='outline' size='sm'>
            <a href={actions.fileDownloadUrl}>
              <Download data-icon='inline-start' />
              下载
            </a>
          </Button>
        ) : null}
        {actions.fileOpenUrl ? (
          <Button asChild variant='outline' size='sm'>
            <a href={actions.fileOpenUrl} target='_blank' rel='noreferrer'>
              <ExternalLink data-icon='inline-start' />
              新窗口打开
            </a>
          </Button>
        ) : null}
        {rendererOptions.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type='button' variant='outline' size='sm'>切换显示</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              {rendererOptions.map((option) => (
                <DropdownMenuItem key={option.id} onClick={() => onRendererChange(option.id)}>
                  {option.id === rendererId ? '当前：' : null}{option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </header>
  )
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/drive-browser-page.test.ts
```

Expected: Finder tests PASS. If old `DriveBrowserView` tests fail because they still assert resizable panels, update them in Task 4 when wiring replaces the old layout.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/features/drive-browser
git commit -m "feat: add drive finder layout"
```

## Task 4: Wire Hosts To Finder And Body Renderer

**Files:**
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.tsx`
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.test.ts`

- [ ] **Step 1: Replace old layout assertions with host-level expectations**

In `dashboard/src/features/drive-browser/drive-browser-page.test.ts`, remove tests that expect `ResizablePanelGroup`, `flex-basis:33%`, `flex-basis:67%`, and old reader-toolbar classes.

Add these host tests:

```ts
it('DriveBrowserView delegates folder pages to full finder layout', () => {
  const snapshot = createSnapshot({
    current: { ...baseCurrent(), id: 'folder', type: 'folder', downloadUrl: '/drive/items/folder/zip' },
    preview: null,
    children: [{ ...baseCurrent(), id: 'file', name: 'notes.md' }],
  })

  const html = renderToStaticMarkup(createElement(DriveBrowserView, { snapshot, layoutMode: 'fixed' }))

  expect(html).toContain('data-drive-finder="full"')
  expect(html).toContain('下载整个目录')
  expect(html).not.toContain('data-slot="resizable-panel-group"')
})

it('DriveSingleFileReaderView delegates to body renderer and floating menu', () => {
  const snapshot = createSnapshot({
    current: { ...baseCurrent(), name: 'notes.md', previewKind: 'markdown' },
    preview: { ...basePreview(), kind: 'markdown', html: '<h1>Notes</h1>', text: '# Notes' },
  })

  const html = renderToStaticMarkup(createElement(DriveSingleFileReaderView, { snapshot }))

  expect(html).toContain('<h1>Notes</h1>')
  expect(html).toContain('文件操作')
  expect(html).not.toContain('data-reader-toolbar="true"')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/drive-browser-page.test.ts
```

Expected: FAIL because `DriveBrowserView` and `DriveSingleFileReaderView` still use the old implementation.

- [ ] **Step 3: Replace `drive-browser-page.tsx` ready-state rendering**

In `dashboard/src/features/drive-browser/drive-browser-page.tsx`, keep imports for `useEffect`, `useState`, shadcn form/loading/error pieces, `cn`, and `useDriveBrowser`. Remove old Resizable/Table/Tabs renderer/list code. Add:

```ts
import { DriveFinder } from './finder/drive-finder'
import { DriveRendererShell } from './renderers/drive-renderer-shell'
import { shouldRenderDriveBodyRenderer } from './shared/drive-view-model'
```

Update `DriveBrowserPage` ready branch:

```tsx
if (state.status === 'ready' && shouldRenderDriveBodyRenderer(state.snapshot)) {
  return <DriveSingleFileReaderView snapshot={state.snapshot} />
}
```

Update `DriveBrowserView` to delegate:

```tsx
export function DriveBrowserView({
  snapshot,
  layoutMode = 'auto',
  onLoadMoreChildren,
  loadingMoreChildren = false,
  loadMoreChildrenError = null,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly layoutMode?: DriveBrowserLayoutMode
  readonly onLoadMoreChildren?: () => void
  readonly loadingMoreChildren?: boolean
  readonly loadMoreChildrenError?: string | null
}) {
  return (
    <DriveFinder
      snapshot={snapshot}
      mode={snapshot.context === 'share' ? 'share' : snapshot.surface}
      onLoadMoreChildren={onLoadMoreChildren}
      loadingMoreChildren={loadingMoreChildren}
      loadMoreChildrenError={loadMoreChildrenError}
    />
  )
}
```

Update `DriveSingleFileReaderView`:

```tsx
export function DriveSingleFileReaderView({
  snapshot,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly embedded?: boolean
}) {
  return <DriveRendererShell snapshot={snapshot} body />
}
```

Keep `DriveBrowserPasswordForm`, `DriveBrowserLoading`, and `DriveBrowserError` in this file. Remove local preview/list functions that now live under `finder/` and `renderers/`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/drive-browser-page.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run hook tests to catch API regressions**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/use-drive-browser.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/features/drive-browser
git commit -m "refactor: wire drive finder renderer hosts"
```

## Task 5: Release Note And Full Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add a concise bullet under the pending release notes section:

```md
- 网盘承接页重构为 Finder 和 Renderer 两层：目录浏览、文件预览、新窗口打开和分享文件访问的布局更清晰，文件页可以直接进入阅读/预览视图。
```

- [ ] **Step 2: Run Drive browser tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/drive-browser-page.test.ts src/features/drive-browser/use-drive-browser.test.ts src/routes/-drive-browser-route.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run dashboard typecheck**

Run:

```bash
pnpm --filter @synapse/dashboard run tsc
```

Expected: PASS.

- [ ] **Step 4: Run dashboard build if typecheck passes**

Run:

```bash
pnpm --filter @synapse/dashboard run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add RELEASE_NOTES_PENDING.md dashboard/src/features/drive-browser
git commit -m "chore: document drive finder renderer update"
```

## Manual QA Checklist

- [ ] Open `/console/drive` with a folder snapshot and verify the file list fills the content area.
- [ ] Open `/console/drive/items/:rootItemId/items/:browserItemId` for a file and verify Finder appears left and Renderer appears right.
- [ ] Open a file route in a new tab and verify the page is renderer-first with the right-bottom floating menu.
- [ ] Open a shared file route and verify no owner-only iframe or access action appears.
- [ ] Open a shared folder route and verify Finder remains usable.
- [ ] Toggle Markdown preview/source and verify content does not resize the page header.
- [ ] Verify all colors are token classes and no new inline style, hex, rgb, hsl, arbitrary Tailwind colors, gradients, glow, or nested cards were added.
