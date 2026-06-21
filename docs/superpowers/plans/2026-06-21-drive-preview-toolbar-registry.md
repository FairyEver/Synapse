# Drive Preview Toolbar Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one Drive preview toolbar system where the host renders file identity and system actions, while active renderers register their own toolbar actions.

**Architecture:** Add a host-owned preview chrome layer around `DriveRendererShell`. Pure action helpers build system actions once, `DrivePreviewHeader` and `DrivePreviewFloatingMenu` render those actions in toolbar or floating form, and renderers use a context hook to register toolbar contributions. Finder-embedded previews and standalone/share readers share the same chrome path, with `iframe` using floating chrome.

**Tech Stack:** React 19, TypeScript, Vitest, shadcn/Radix dropdown/button components, lucide-react icons, existing `DriveBrowserSnapshotDto` data.

---

## File Structure

- Create: `dashboard/src/features/drive-browser/renderers/drive-preview-actions.ts`
  - Pure view-model helpers for file identity, system actions, open URLs, versions, and renderer selector options.
- Create: `dashboard/src/features/drive-browser/renderers/drive-renderer-toolbar-context.tsx`
  - React context, provider, registration hook, and contribution types.
- Create: `dashboard/src/features/drive-browser/renderers/drive-preview-header.tsx`
  - Shared toolbar header used for Finder and non-iframe standalone/share previews.
- Create: `dashboard/src/features/drive-browser/renderers/drive-preview-floating-menu.tsx`
  - Floating button/menu for iframe previews, reusing action definitions and contribution rendering.
- Modify: `dashboard/src/features/drive-browser/renderers/drive-renderer-shell.tsx`
  - Own contribution state, choose toolbar/floating chrome, render provider and selected renderer.
- Modify: `dashboard/src/features/drive-browser/finder/drive-finder.tsx`
  - Remove file header implementation and let `DriveRendererShell` render preview chrome.
- Modify: `dashboard/src/features/drive-browser/renderers/code-renderer.tsx`
  - Replace renderer top bar with toolbar contribution registration.
- Modify: `dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.tsx`
  - Replace file-level edit top bar with toolbar contribution registration while keeping MDXEditor native toolbar.
- Modify: `dashboard/src/features/drive-browser/renderers/markdown-renderer.tsx`
  - Replace sticky Markdown header with toolbar contribution registration.
- Modify: `dashboard/src/features/drive-browser/renderers/download-renderer.tsx`
  - Remove duplicate download button from body.
- Modify tests:
  - `dashboard/src/features/drive-browser/drive-browser-page.test.ts`
  - `dashboard/src/features/drive-browser/renderers/code-renderer.test.tsx`
  - `dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.test.tsx`
  - `dashboard/src/features/drive-browser/renderers/markdown-renderer.test.tsx`
- Modify: `RELEASE_NOTES_PENDING.md`
  - Add one user-facing note for consistent Drive preview toolbar behavior.

---

### Task 1: Add Pure Preview Action Helpers

**Files:**
- Create: `dashboard/src/features/drive-browser/renderers/drive-preview-actions.ts`
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.test.ts`

- [ ] **Step 1: Write failing tests for system action view models**

Add imports to `dashboard/src/features/drive-browser/drive-browser-page.test.ts`:

```ts
import {
  getDrivePreviewFileIdentity,
  getDrivePreviewSystemActions,
  getDrivePreviewSystemMenuSections,
} from './renderers/drive-preview-actions'
```

Add this test in `describe('drive browser view model', ...)`:

```ts
it('builds shared preview identity and system actions for owner files', () => {
  const consoleFile = createSnapshot({
    surface: 'console',
    current: {
      ...baseCurrent(),
      id: 'file',
      name: 'notes.md',
      size: '2048',
      previewKind: 'markdown',
      browserUrl: '/console/drive/items/file?surface=console',
      downloadUrl: '/drive/items/file/download',
    },
  })
  const standaloneFile = createSnapshot({
    surface: 'standalone',
    current: {
      ...baseCurrent(),
      id: 'file',
      name: 'notes.md',
      size: '2048',
      previewKind: 'markdown',
      browserUrl: '/drive/items/file?surface=standalone',
      downloadUrl: '/drive/items/file/download',
    },
  })

  expect(getDrivePreviewFileIdentity(consoleFile)).toMatchObject({
    name: 'notes.md',
    sizeLabel: '2 KB',
    kindLabel: 'Markdown',
  })
  expect(getDrivePreviewSystemActions(consoleFile).map((action) => action.id)).toEqual([
    'download',
    'open-new-window',
    'versions',
    'renderer-select',
  ])
  expect(getDrivePreviewSystemActions(standaloneFile).map((action) => action.id)).toEqual([
    'download',
    'open-in-drive',
    'versions',
    'renderer-select',
  ])
  expect(getDrivePreviewSystemMenuSections(standaloneFile).flatMap((section) => section.items.map((item) => item.id))).toContain('open-in-drive')
})
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run dashboard/src/features/drive-browser/drive-browser-page.test.ts
```

Expected: FAIL because `./renderers/drive-preview-actions` does not exist.

- [ ] **Step 3: Implement pure action helpers**

Create `dashboard/src/features/drive-browser/renderers/drive-preview-actions.ts`:

```ts
import { Download, ExternalLink, History, ListFilter } from 'lucide-react'
import { buildConsoleDriveBrowserUrl, buildConsoleDriveItemBrowserUrl, buildOwnerDriveBrowserUrl, type DriveBrowserSnapshotDto } from '@synapse/shared'
import { driveBrowserKindLabel, formatDriveBrowserDate, formatDriveBrowserSize } from '../shared/drive-format'
import { getDriveFileVersionItemId } from '../shared/drive-view-model'
import { getDriveRendererOptions, type DriveRendererId, type DriveRendererOption } from './drive-renderer-registry'

export type DrivePreviewSystemActionId =
  | 'download'
  | 'open-in-drive'
  | 'open-new-window'
  | 'versions'
  | 'renderer-select'

export type DrivePreviewFileIdentity = {
  readonly name: string
  readonly sizeLabel: string
  readonly kindLabel: string
  readonly updatedAtLabel: string
}

export type DrivePreviewLinkAction = {
  readonly kind: 'link'
  readonly id: Exclude<DrivePreviewSystemActionId, 'versions' | 'renderer-select'>
  readonly label: string
  readonly href: string
  readonly external?: boolean
  readonly icon: typeof Download
}

export type DrivePreviewVersionsAction = {
  readonly kind: 'versions'
  readonly id: 'versions'
  readonly label: string
  readonly itemId: string
  readonly icon: typeof History
}

export type DrivePreviewRendererSelectAction = {
  readonly kind: 'renderer-select'
  readonly id: 'renderer-select'
  readonly label: string
  readonly options: readonly DriveRendererOption[]
  readonly selectedId: DriveRendererId | null
  readonly icon: typeof ListFilter
}

export type DrivePreviewSystemAction =
  | DrivePreviewLinkAction
  | DrivePreviewVersionsAction
  | DrivePreviewRendererSelectAction

export type DrivePreviewSystemMenuSection = {
  readonly id: 'file' | 'renderer'
  readonly items: readonly DrivePreviewSystemAction[]
}

export function getDrivePreviewFileIdentity(snapshot: DriveBrowserSnapshotDto): DrivePreviewFileIdentity {
  return {
    name: snapshot.current.name,
    sizeLabel: formatDriveBrowserSize(snapshot.current),
    kindLabel: driveBrowserKindLabel(snapshot.current.previewKind),
    updatedAtLabel: formatDriveBrowserDate(snapshot.current.updatedAt),
  }
}

export function getDrivePreviewSystemActions(
  snapshot: DriveBrowserSnapshotDto,
  selectedRendererId: DriveRendererId | null = null
): readonly DrivePreviewSystemAction[] {
  if (snapshot.current.type !== 'file') return []
  const actions: DrivePreviewSystemAction[] = []
  if (snapshot.current.downloadUrl) {
    actions.push({
      kind: 'link',
      id: 'download',
      label: '下载',
      href: snapshot.current.downloadUrl,
      icon: Download,
    })
  }
  const driveBrowserUrl = getDrivePreviewDriveBrowserUrl(snapshot)
  if (driveBrowserUrl) {
    actions.push({
      kind: 'link',
      id: 'open-in-drive',
      label: '在云盘中查看',
      href: driveBrowserUrl,
      icon: ExternalLink,
    })
  }
  const newWindowUrl = getDrivePreviewNewWindowUrl(snapshot)
  if (newWindowUrl) {
    actions.push({
      kind: 'link',
      id: 'open-new-window',
      label: '新窗口打开',
      href: newWindowUrl,
      external: true,
      icon: ExternalLink,
    })
  }
  const versionItemId = getDriveFileVersionItemId(snapshot)
  if (versionItemId) {
    actions.push({
      kind: 'versions',
      id: 'versions',
      label: '历史版本',
      itemId: versionItemId,
      icon: History,
    })
  }
  const rendererOptions = getDriveRendererOptions(snapshot)
  if (rendererOptions.length > 1) {
    actions.push({
      kind: 'renderer-select',
      id: 'renderer-select',
      label: '打开方式',
      options: rendererOptions,
      selectedId: selectedRendererId,
      icon: ListFilter,
    })
  }
  return actions
}

export function getDrivePreviewSystemMenuSections(
  snapshot: DriveBrowserSnapshotDto,
  selectedRendererId: DriveRendererId | null = null
): readonly DrivePreviewSystemMenuSection[] {
  const actions = getDrivePreviewSystemActions(snapshot, selectedRendererId)
  const fileItems = actions.filter((action) => action.kind !== 'renderer-select')
  const rendererItems = actions.filter((action) => action.kind === 'renderer-select')
  return [
    fileItems.length > 0 ? { id: 'file', items: fileItems } : null,
    rendererItems.length > 0 ? { id: 'renderer', items: rendererItems } : null,
  ].filter((section): section is DrivePreviewSystemMenuSection => Boolean(section))
}

export function getDrivePreviewNewWindowUrl(snapshot: DriveBrowserSnapshotDto): string | null {
  if (snapshot.current.type !== 'file') return null
  if (snapshot.context !== 'owner' || snapshot.surface !== 'console') return null
  const url = new URL(buildOwnerDriveBrowserUrl(snapshot.current.id), 'http://synapse.local')
  url.searchParams.set('surface', 'standalone')
  return `${url.pathname}${url.search}${url.hash}`
}

export function getDrivePreviewDriveBrowserUrl(snapshot: DriveBrowserSnapshotDto): string | null {
  if (snapshot.context !== 'owner' || snapshot.surface !== 'standalone') return null
  return snapshot.current.type === 'folder'
    ? buildConsoleDriveBrowserUrl(snapshot.current.id)
    : buildConsoleDriveItemBrowserUrl(snapshot.current.id)
}
```

- [ ] **Step 4: Run test and verify it passes**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run dashboard/src/features/drive-browser/drive-browser-page.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/features/drive-browser/renderers/drive-preview-actions.ts dashboard/src/features/drive-browser/drive-browser-page.test.ts
git commit -m "test: add drive preview action model"
```

---

### Task 2: Add Toolbar Contribution Context

**Files:**
- Create: `dashboard/src/features/drive-browser/renderers/drive-renderer-toolbar-context.tsx`
- Create: `dashboard/src/features/drive-browser/renderers/drive-renderer-toolbar-context.test.tsx`

- [ ] **Step 1: Write failing context tests**

Create `dashboard/src/features/drive-browser/renderers/drive-renderer-toolbar-context.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DriveRendererToolbarProvider,
  useDriveRendererToolbar,
  type DriveRendererToolbarItem,
} from './drive-renderer-toolbar-context'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
})

describe('DriveRendererToolbarProvider', () => {
  it('replaces registered items by stable id and clears them on unmount', () => {
    const snapshots: readonly DriveRendererToolbarItem[][] = []

    function Recorder() {
      const toolbar = useDriveRendererToolbar()
      snapshots.push(toolbar.items)
      return null
    }

    function Contributor({ label }: { readonly label: string }) {
      const toolbar = useDriveRendererToolbar()
      useEffect(() => toolbar.registerItems('code', [{
        kind: 'status',
        id: 'sync',
        label,
      }]), [label, toolbar])
      return null
    }

    render(
      <DriveRendererToolbarProvider>
        <Recorder />
        <Contributor label='未保存' />
      </DriveRendererToolbarProvider>
    )
    render(
      <DriveRendererToolbarProvider>
        <Recorder />
        <Contributor label='已同步' />
      </DriveRendererToolbarProvider>
    )
    render(
      <DriveRendererToolbarProvider>
        <Recorder />
      </DriveRendererToolbarProvider>
    )

    expect(document.body.textContent).toBe('')
    expect(snapshots.at(-1)).toEqual([])
  })
})

function render(element: React.ReactElement) {
  if (!host) {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  }
  act(() => root?.render(element))
}
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run dashboard/src/features/drive-browser/renderers/drive-renderer-toolbar-context.test.tsx
```

Expected: FAIL because the context file does not exist.

- [ ] **Step 3: Implement toolbar context**

Create `dashboard/src/features/drive-browser/renderers/drive-renderer-toolbar-context.tsx`:

```tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export type DriveRendererToolbarItem =
  | {
      readonly kind: 'status'
      readonly id: string
      readonly label: string
    }
  | {
      readonly kind: 'button'
      readonly id: string
      readonly label: string
      readonly icon?: LucideIcon
      readonly variant?: 'default' | 'outline' | 'secondary' | 'ghost'
      readonly disabled?: boolean
      readonly loading?: boolean
      readonly href?: string
      readonly external?: boolean
      readonly onClick?: () => void
    }
  | {
      readonly kind: 'toggle'
      readonly id: string
      readonly label: string
      readonly icon?: LucideIcon
      readonly pressed: boolean
      readonly disabled?: boolean
      readonly onPressedChange: (pressed: boolean) => void
    }
  | {
      readonly kind: 'menu'
      readonly id: string
      readonly label: string
      readonly icon?: LucideIcon
      readonly items: readonly DriveRendererToolbarMenuItem[]
    }

export type DriveRendererToolbarMenuItem = {
  readonly id: string
  readonly label: string
  readonly disabled?: boolean
  readonly onSelect: () => void
}

export type DriveRendererToolbarContextValue = {
  readonly items: readonly DriveRendererToolbarItem[]
  readonly registerItems: (scope: string, items: readonly DriveRendererToolbarItem[]) => () => void
  readonly clearScope: (scope: string) => void
}

const DriveRendererToolbarContext = createContext<DriveRendererToolbarContextValue | null>(null)

export function DriveRendererToolbarProvider({ children }: { readonly children: ReactNode }) {
  const [itemsByScope, setItemsByScope] = useState<ReadonlyMap<string, readonly DriveRendererToolbarItem[]>>(() => new Map())

  const clearScope = useCallback((scope: string) => {
    setItemsByScope((current) => {
      if (!current.has(scope)) return current
      const next = new Map(current)
      next.delete(scope)
      return next
    })
  }, [])

  const registerItems = useCallback((scope: string, items: readonly DriveRendererToolbarItem[]) => {
    setItemsByScope((current) => {
      const next = new Map(current)
      next.set(scope, items)
      return next
    })
    return () => clearScope(scope)
  }, [clearScope])

  const items = useMemo(
    () => Array.from(itemsByScope.values()).flat(),
    [itemsByScope]
  )

  const value = useMemo<DriveRendererToolbarContextValue>(() => ({
    items,
    registerItems,
    clearScope,
  }), [clearScope, items, registerItems])

  return (
    <DriveRendererToolbarContext.Provider value={value}>
      {children}
    </DriveRendererToolbarContext.Provider>
  )
}

export function useDriveRendererToolbar(): DriveRendererToolbarContextValue {
  const value = useContext(DriveRendererToolbarContext)
  if (!value) throw new Error('useDriveRendererToolbar must be used inside DriveRendererToolbarProvider')
  return value
}
```

- [ ] **Step 4: Run context test**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run dashboard/src/features/drive-browser/renderers/drive-renderer-toolbar-context.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/features/drive-browser/renderers/drive-renderer-toolbar-context.tsx dashboard/src/features/drive-browser/renderers/drive-renderer-toolbar-context.test.tsx
git commit -m "feat: add drive renderer toolbar registry"
```

---

### Task 3: Build Shared Header And Floating Menu Components

**Files:**
- Create: `dashboard/src/features/drive-browser/renderers/drive-preview-header.tsx`
- Create: `dashboard/src/features/drive-browser/renderers/drive-preview-floating-menu.tsx`
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.test.ts`

- [ ] **Step 1: Write failing render tests for shared chrome**

In `dashboard/src/features/drive-browser/drive-browser-page.test.ts`, add a test that renders the new components directly:

```ts
it('renders shared toolbar and floating menu from the same action model', () => {
  const snapshot = createSnapshot({
    surface: 'standalone',
    current: {
      ...baseCurrent(),
      name: 'notes.md',
      previewKind: 'markdown',
      downloadUrl: '/drive/items/file/download',
    },
  })
  const rendererOptions = getDriveRendererOptions(snapshot)
  const headerHtml = renderToStaticMarkup(createElement(DrivePreviewHeader, {
    snapshot,
    rendererItems: [{ kind: 'status', id: 'sync', label: '已同步' }],
    rendererOptions,
    selectedRendererId: 'markdown',
    onRendererChange: vi.fn(),
    onOpenVersions: vi.fn(),
  }))
  const floatingHtml = renderToStaticMarkup(createElement(DrivePreviewFloatingMenu, {
    snapshot,
    rendererItems: [{ kind: 'status', id: 'sync', label: '已同步' }],
    rendererOptions,
    selectedRendererId: 'markdown',
    onRendererChange: vi.fn(),
    onOpenVersions: vi.fn(),
  }))

  expect(headerHtml).toContain('notes.md')
  expect(headerHtml).toContain('已同步')
  expect(headerHtml).toContain('下载')
  expect(headerHtml).toContain('历史版本')
  expect(headerHtml).toContain('打开方式')
  expect(floatingHtml).toContain('文件操作')
  expect(floatingHtml).toContain('已同步')
  expect(floatingHtml).toContain('下载')
})
```

Add imports:

```ts
import { DrivePreviewFloatingMenu } from './renderers/drive-preview-floating-menu'
import { DrivePreviewHeader } from './renderers/drive-preview-header'
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run dashboard/src/features/drive-browser/drive-browser-page.test.ts
```

Expected: FAIL because the chrome components do not exist.

- [ ] **Step 3: Implement `DrivePreviewHeader`**

Create `dashboard/src/features/drive-browser/renderers/drive-preview-header.tsx` with these exported props and rendering rules:

```tsx
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DriveBrowserItemIcon } from '../shared/drive-icons'
import { getDrivePreviewFileIdentity, getDrivePreviewSystemActions } from './drive-preview-actions'
import type { DriveRendererId, DriveRendererOption } from './drive-renderer-registry'
import type { DriveRendererToolbarItem } from './drive-renderer-toolbar-context'

export function DrivePreviewHeader({
  snapshot,
  rendererItems,
  selectedRendererId,
  onRendererChange,
  onOpenVersions,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly rendererItems: readonly DriveRendererToolbarItem[]
  readonly rendererOptions: readonly DriveRendererOption[]
  readonly selectedRendererId: DriveRendererId | null
  readonly onRendererChange: (id: DriveRendererId) => void
  readonly onOpenVersions: (itemId: string) => void
}) {
  const identity = getDrivePreviewFileIdentity(snapshot)
  const systemActions = getDrivePreviewSystemActions(snapshot, selectedRendererId)
  return (
    <header data-drive-preview-header='true' className='flex shrink-0 flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:justify-between'>
      <div className='flex min-w-0 flex-col gap-1'>
        <div className='flex min-w-0 items-center gap-2 text-sm font-medium'>
          <DriveBrowserItemIcon item={snapshot.current} />
          <span className='min-w-0 truncate'>{identity.name}</span>
        </div>
        <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
          <span>{identity.sizeLabel}</span>
          <span>{identity.kindLabel}</span>
          <span>{identity.updatedAtLabel}</span>
        </div>
      </div>
      <div className='flex shrink-0 flex-wrap items-center gap-2'>
        {rendererItems.map((item) => <DrivePreviewToolbarItemView key={item.id} item={item} />)}
        {systemActions.map((action) => {
          if (action.kind === 'link') {
            return (
              <Button key={action.id} asChild variant='outline' size='sm'>
                <a href={action.href} target={action.external ? '_blank' : undefined} rel={action.external ? 'noreferrer' : undefined}>
                  <action.icon data-icon='inline-start' />
                  {action.label}
                </a>
              </Button>
            )
          }
          if (action.kind === 'versions') {
            return (
              <Button key={action.id} type='button' variant='outline' size='sm' onClick={() => onOpenVersions(action.itemId)}>
                <action.icon data-icon='inline-start' />
                {action.label}
              </Button>
            )
          }
          return (
            <DropdownMenu key={action.id}>
              <DropdownMenuTrigger asChild>
                <Button type='button' variant='outline' size='sm'>{action.label}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                {action.options.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.id}
                    checked={option.id === selectedRendererId}
                    onCheckedChange={() => onRendererChange(option.id)}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        })}
      </div>
    </header>
  )
}

function DrivePreviewToolbarItemView({ item }: { readonly item: DriveRendererToolbarItem }) {
  if (item.kind === 'status') return <span className='text-xs text-muted-foreground'>{item.label}</span>
  if (item.kind === 'button') {
    const content = (
      <>
        {item.loading ? <Loader2 className='animate-spin' /> : item.icon ? <item.icon data-icon='inline-start' /> : null}
        {item.label}
      </>
    )
    if (item.href) {
      return (
        <Button asChild variant={item.variant ?? 'outline'} size='sm' disabled={item.disabled}>
          <a href={item.href} target={item.external ? '_blank' : undefined} rel={item.external ? 'noreferrer' : undefined}>{content}</a>
        </Button>
      )
    }
    return (
      <Button type='button' variant={item.variant ?? 'outline'} size='sm' disabled={item.disabled} onClick={item.onClick}>
        {content}
      </Button>
    )
  }
  if (item.kind === 'toggle') {
    return (
      <Button type='button' variant={item.pressed ? 'secondary' : 'ghost'} size='sm' disabled={item.disabled} onClick={() => item.onPressedChange(!item.pressed)}>
        {item.icon ? <item.icon data-icon='inline-start' /> : null}
        {item.label}
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type='button' variant='outline' size='sm'>
          {item.icon ? <item.icon data-icon='inline-start' /> : null}
          {item.label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {item.items.map((menuItem) => (
          <DropdownMenuItem key={menuItem.id} disabled={menuItem.disabled} onSelect={menuItem.onSelect}>
            {menuItem.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 4: Implement `DrivePreviewFloatingMenu`**

Create `dashboard/src/features/drive-browser/renderers/drive-preview-floating-menu.tsx` by moving floating-position logic from `DriveRendererFloatingMenu`, and use `DrivePreviewHeader` helper rendering decisions through the same props. Preserve exported helpers by re-exporting or keeping them in `drive-renderer-shell.tsx` until Task 4 updates imports:

```tsx
export { clampDriveFloatingMenuPosition, shouldSuppressDriveFloatingMenuOpen } from './drive-renderer-shell'
```

The component must render the trigger with this exact shape:

```tsx
<Button
  type='button'
  size='icon'
  className={cn(
    'touch-none rounded-full cursor-grab transition-opacity duration-200 active:cursor-grabbing',
    idleDimmed && !open ? 'opacity-50 hover:opacity-100 focus-visible:opacity-100' : 'opacity-100'
  )}
  aria-label='文件操作'
  onPointerEnter={() => setInteractionActive(true)}
  onPointerLeave={() => setInteractionActive(false)}
  onPointerDown={handlePointerDown}
  onPointerMove={handlePointerMove}
  onPointerUp={handlePointerUp}
  onPointerCancel={handlePointerCancel}
  onFocus={() => setInteractionActive(true)}
  onBlur={() => setInteractionActive(false)}
  onClick={handleClick}
>
  <MoreHorizontal />
</Button>
```

and menu contents in this order:

```text
file label
file metadata
renderer contribution menu items
system link/version items
renderer selector checkbox items
```

Use only existing `DropdownMenu*`, `Button`, `DriveBrowserItemIcon`, `MoreHorizontal`, and token classes copied from the current floating menu.

- [ ] **Step 5: Run test**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run dashboard/src/features/drive-browser/drive-browser-page.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/features/drive-browser/renderers/drive-preview-header.tsx dashboard/src/features/drive-browser/renderers/drive-preview-floating-menu.tsx dashboard/src/features/drive-browser/drive-browser-page.test.ts
git commit -m "feat: add drive preview chrome components"
```

---

### Task 4: Wire Chrome Into `DriveRendererShell` And Finder

**Files:**
- Modify: `dashboard/src/features/drive-browser/renderers/drive-renderer-shell.tsx`
- Modify: `dashboard/src/features/drive-browser/finder/drive-finder.tsx`
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.test.ts`

- [ ] **Step 1: Update failing shell tests**

Change existing assertions in `dashboard/src/features/drive-browser/drive-browser-page.test.ts`:

```ts
expect(html).toContain('data-drive-preview-header="true"')
expect(html).not.toContain('文件操作')
```

for standalone Markdown reader tests.

Add an HTML iframe reader test:

```ts
it('uses floating chrome for iframe html previews', () => {
  const snapshot = createSnapshot({
    surface: 'standalone',
    current: { ...baseCurrent(), name: 'page.html', previewKind: 'html-source' },
    preview: { ...basePreview(), kind: 'html-source', visitUrl: '/drive/items/file/render' },
  })

  const html = renderToStaticMarkup(createElement(DriveSingleFileReaderView, { snapshot }))

  expect(html).toContain('文件操作')
  expect(html).not.toContain('data-drive-preview-header="true"')
})
```

Update Finder test around the current file header:

```ts
expect(html).toContain('data-drive-preview-header="true"')
expect(html).toContain('打开方式')
expect(html).not.toContain('文件操作')
```

- [ ] **Step 2: Run tests and verify failures**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run dashboard/src/features/drive-browser/drive-browser-page.test.ts
```

Expected: FAIL because shell still renders the old floating menu for all `body` mode and Finder still renders its own file header.

- [ ] **Step 3: Modify `DriveRendererShell`**

In `dashboard/src/features/drive-browser/renderers/drive-renderer-shell.tsx`:

- Import `DriveRendererToolbarProvider`, `useDriveRendererToolbar`, `DrivePreviewHeader`, `DrivePreviewFloatingMenu`, and `DriveFileVersionsDialog`.
- Remove `DriveRendererFloatingMenu`.
- Add a wrapper component:

```tsx
function DriveRendererShellInner(props: DriveRendererShellProps) {
  const toolbar = useDriveRendererToolbar()
  const [versionsOpenItemId, setVersionsOpenItemId] = useState<string | null>(null)
  const chromeMode = props.body && selected?.id === 'iframe' ? 'floating' : 'toolbar'

  return (
    <section className='flex h-full min-h-0 flex-col bg-background'>
      {chromeMode === 'toolbar' ? (
        <DrivePreviewHeader
          snapshot={snapshot}
          rendererItems={toolbar.items}
          rendererOptions={options}
          selectedRendererId={selected.id}
          onRendererChange={setRenderer}
          onOpenVersions={setVersionsOpenItemId}
        />
      ) : (
        <DrivePreviewFloatingMenu
          snapshot={snapshot}
          rendererItems={toolbar.items}
          rendererOptions={options}
          selectedRendererId={selected.id}
          onRendererChange={setRenderer}
          onOpenVersions={setVersionsOpenItemId}
        />
      )}
      <div className='min-h-0 flex-1'>
        <DriveRendererContent
          snapshot={snapshot}
          selected={selected}
          body={body}
          editContext={editContext}
          annotationContext={annotationContext}
        />
      </div>
      {versionsOpenItemId ? (
        <DriveFileVersionsDialog
          itemId={versionsOpenItemId}
          open
          onChanged={editContext?.reload}
          onOpenChange={(open) => { if (!open) setVersionsOpenItemId(null) }}
        />
      ) : null}
    </section>
  )
}
```

Wrap `DriveRendererShellInner`:

```tsx
return (
  <DriveRendererToolbarProvider key={selected?.id ?? 'none'}>
    <DriveRendererShellInner
      snapshot={snapshot}
      body={body}
      initialRendererId={initialRendererId}
      rendererId={rendererId}
      onRendererChange={onRendererChange}
      editContext={editContext}
      annotationContext={annotationContext}
    />
  </DriveRendererToolbarProvider>
)
```

Keep `key={selected?.id}` so renderer contributions clear when switching renderers.

- [ ] **Step 4: Modify Finder**

In `dashboard/src/features/drive-browser/finder/drive-finder.tsx`:

- Remove `DriveFinderFileHeader`.
- Remove `versionsOpen`, `versionItemId`, `DriveFileVersionsDialog`, and related imports.
- Keep renderer state and pass it to `DriveRendererShell`.
- Keep `DriveFinderToolbar` for folder-level breadcrumbs and directory download.

The file-selected branch becomes:

```tsx
<DriveFinderFileLayout>
  <DriveRendererShell
    snapshot={snapshot}
    rendererId={selectedRenderer?.id ?? null}
    onRendererChange={setRendererId}
    editContext={editContext}
  />
</DriveFinderFileLayout>
```

- [ ] **Step 5: Run Drive browser tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run dashboard/src/features/drive-browser/drive-browser-page.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/features/drive-browser/renderers/drive-renderer-shell.tsx dashboard/src/features/drive-browser/finder/drive-finder.tsx dashboard/src/features/drive-browser/drive-browser-page.test.ts
git commit -m "feat: route drive preview chrome through renderer shell"
```

---

### Task 5: Migrate Code Renderer Contributions

**Files:**
- Modify: `dashboard/src/features/drive-browser/renderers/code-renderer.tsx`
- Modify: `dashboard/src/features/drive-browser/renderers/code-renderer.test.tsx`

- [ ] **Step 1: Update failing code renderer tests**

In `code-renderer.test.tsx`, wrap `DriveCodeRenderer` with `DriveRendererToolbarProvider` and add a small toolbar probe:

```tsx
function ToolbarProbe() {
  const toolbar = useDriveRendererToolbar()
  return (
    <div data-testid='toolbar-items'>
      {toolbar.items.map((item) => item.label).join('|')}
    </div>
  )
}
```

Render:

```tsx
<DriveRendererToolbarProvider>
  <ToolbarProbe />
  <DriveCodeRenderer
    current={input.current ?? baseCurrent()}
    preview={input.preview ?? basePreview()}
    edit={input.edit === undefined ? editable() : input.edit}
    editContext={input.editContext ?? createEditContext()}
  />
</DriveRendererToolbarProvider>
```

Update assertions:

```ts
expect(toolbarItems().textContent).toContain('未保存')
expect(toolbarItems().textContent).toContain('重新加载')
expect(toolbarItems().textContent).toContain('保存')
expect(document.querySelector('[data-drive-code-renderer-toolbar]')).toBeNull()
```

Add helper:

```ts
function toolbarItems(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-testid="toolbar-items"]')
  if (!element) throw new Error('toolbar items not found')
  return element
}
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run dashboard/src/features/drive-browser/renderers/code-renderer.test.tsx
```

Expected: FAIL because Code renderer still renders its own top bar and does not register toolbar items.

- [ ] **Step 3: Register toolbar items from Code renderer**

In `code-renderer.tsx`:

- Import `useEffect`, `useDriveRendererToolbar`, `LogIn`, `RefreshCw`, `Save`, and `Loader2`.
- Remove the top bar with `className='flex shrink-0 items-center justify-between gap-3 border-b px-3 py-2'`.
- Add:

```tsx
const toolbar = useDriveRendererToolbar()

useEffect(() => {
  const items: DriveRendererToolbarItem[] = [{
    kind: 'status',
    id: 'code-status',
    label: dirty ? '未保存' : canEdit ? '已同步' : '只读',
  }]
  if (loginRequired) {
    items.push({
      kind: 'button',
      id: 'code-login',
      label: '登录后编辑',
      icon: LogIn,
      href: loginUrl,
      variant: 'outline',
    })
  }
  if (canEdit) {
    items.push({
      kind: 'button',
      id: 'code-reload',
      label: '重新加载',
      icon: RefreshCw,
      loading: Boolean(editContext?.reloading),
      disabled: Boolean(editContext?.reloading || editContext?.savingText),
      onClick: () => { void handleReload() },
    })
    items.push({
      kind: 'button',
      id: 'code-save',
      label: '保存',
      icon: Save,
      loading: Boolean(editContext?.savingText),
      disabled: !dirty || Boolean(editContext?.savingText || editContext?.reloading),
      variant: 'default',
      onClick: () => { void handleSave() },
    })
  }
  return toolbar.registerItems('code', items)
}, [canEdit, dirty, editContext?.reloading, editContext?.savingText, handleReload, handleSave, loginRequired, loginUrl, toolbar])
```

Use `useCallback` for `handleSave` and `handleReload` before the effect so dependencies are stable.

- [ ] **Step 4: Run test**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run dashboard/src/features/drive-browser/renderers/code-renderer.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/features/drive-browser/renderers/code-renderer.tsx dashboard/src/features/drive-browser/renderers/code-renderer.test.tsx
git commit -m "feat: register code renderer toolbar actions"
```

---

### Task 6: Migrate MDXeditor Renderer Contributions

**Files:**
- Modify: `dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.tsx`
- Modify: `dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.test.tsx`

- [ ] **Step 1: Update MDXeditor tests**

Mirror the Code renderer test harness:

- Wrap `DriveMDXeditorRenderer` in `DriveRendererToolbarProvider`.
- Add `ToolbarProbe`.
- Replace direct button lookup for `保存` and `重新加载` with toolbar item button clicks when testing renderer through a host-style wrapper.
- Keep the test that checks `data-toolbar-plugin` and `data-toolbar-controls` on the mocked MDXEditor.

Expected assertions:

```ts
expect(toolbarItems().textContent).toContain('已同步')
expect(toolbarItems().textContent).toContain('重新加载')
expect(toolbarItems().textContent).toContain('保存')
expect(editor().dataset.toolbarPlugin).toBe('true')
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.test.tsx
```

Expected: FAIL because MDXeditor still renders file-level edit actions inside the renderer.

- [ ] **Step 3: Register MDXeditor toolbar items**

In `mdxeditor-renderer.tsx`:

- Remove the top bar containing `未保存`, `登录后编辑`, `重新加载`, and `保存`.
- Keep the MDXEditor plugin toolbar in `toolbarPlugin`.
- Extract the existing inline `onChange` logic into this local handler before the return block:

```ts
const handleEditorChange = (nextValue: string, initialMarkdownNormalize?: boolean) => {
  if (!canEdit) return
  setValue(nextValue)
  const matchesExternalMarkdownTarget = applyingExternalMarkdownRef.current
    && externalMarkdownTargetRef.current === nextValue
  if (initialMarkdownNormalize || matchesExternalMarkdownTarget) {
    savedValueRef.current = nextValue
    setDirty(false)
    return
  }
  clearExternalMarkdownSync()
  setDirty(nextValue !== savedValueRef.current)
}
```

- Register the same contribution pattern as Code, using scope `mdxeditor` and ids:
  - `mdxeditor-status`
  - `mdxeditor-login`
  - `mdxeditor-reload`
  - `mdxeditor-save`

The body structure becomes:

```tsx
<div data-drive-mdxeditor-renderer='true' className='flex h-full min-h-0 w-full flex-col overflow-hidden'>
  <div className='min-h-0 flex-1 overflow-auto'>
    <MDXEditor
      ref={editorRef}
      markdown={value}
      readOnly={!canEdit}
      onChange={handleEditorChange}
      plugins={plugins}
      className='h-full min-h-full'
      contentEditableClassName='mx-auto min-h-full max-w-4xl px-4 py-6 md:px-6'
    />
  </div>
  {error ? <div className='border-t px-3 py-2 text-xs text-destructive'>{error}</div> : null}
  {preview.truncated ? <div className='border-t px-3 py-2 text-xs text-muted-foreground'>内容已截断</div> : null}
  <AlertDialog open={conflictOpen} onOpenChange={setConflictOpen}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>文件已有新内容</AlertDialogTitle>
        <AlertDialogDescription>
          你的编辑仍保留，可以下载到本地或重新加载。
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>取消</AlertDialogCancel>
        <Button type='button' variant='outline' onClick={() => downloadLocalVersion(current.name, value)}>
          <Download data-icon='inline-start' />
          下载本地版本
        </Button>
        <AlertDialogAction onClick={() => { void handleReload() }}>重新加载</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</div>
```

- [ ] **Step 4: Run MDXeditor tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.tsx dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.test.tsx
git commit -m "feat: register mdxeditor toolbar actions"
```

---

### Task 7: Migrate Markdown Renderer Contributions

**Files:**
- Modify: `dashboard/src/features/drive-browser/renderers/markdown-renderer.tsx`
- Modify: `dashboard/src/features/drive-browser/renderers/markdown-renderer.test.tsx`

- [ ] **Step 1: Update Markdown tests**

Wrap `DriveMarkdownRenderer` in `DriveRendererToolbarProvider` and add `ToolbarProbe`.

Update assertions:

```ts
expect(toolbarItems().textContent).toContain('目录')
expect(toolbarItems().textContent).toContain('评论 1')
expect(document.querySelector('[data-drive-markdown-header]')).toBeNull()
```

Keep body assertions for comment rail and selected-text comment creation.

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run dashboard/src/features/drive-browser/renderers/markdown-renderer.test.tsx
```

Expected: FAIL because Markdown renderer still renders the sticky header and does not register toolbar toggles.

- [ ] **Step 3: Register Markdown toolbar items**

In `markdown-renderer.tsx`:

- Import `useDriveRendererToolbar`.
- Remove the sticky header block.
- Register items:

```tsx
useEffect(() => {
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
    items.push({
      kind: 'toggle',
      id: 'markdown-comments',
      label: `评论 ${annotations.threads.length}`,
      icon: MessageSquare,
      pressed: commentsOpen,
      onPressedChange: setCommentPanelOpen,
    })
    items.push({
      kind: 'button',
      id: 'markdown-comments-refresh',
      label: '刷新评论',
      icon: RefreshCw,
      variant: 'ghost',
      onClick: () => { void annotations.refresh() },
    })
  }
  return toolbar.registerItems('markdown', items)
}, [annotations, annotationsEnabled, commentsOpen, outline.length, outlineOpen, setCommentPanelOpen, toolbar])
```

Use `useCallback` for `setCommentPanelOpen` before the effect.

Keep the pending comment form and rails inside the renderer body.

- [ ] **Step 4: Run Markdown tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run dashboard/src/features/drive-browser/renderers/markdown-renderer.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/features/drive-browser/renderers/markdown-renderer.tsx dashboard/src/features/drive-browser/renderers/markdown-renderer.test.tsx
git commit -m "feat: register markdown preview toolbar actions"
```

---

### Task 8: Remove Download Renderer Duplication

**Files:**
- Modify: `dashboard/src/features/drive-browser/renderers/download-renderer.tsx`
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.test.ts`

- [ ] **Step 1: Add failing duplication test**

In `drive-browser-page.test.ts`, update or add:

```ts
it('does not duplicate download actions for download-only files', () => {
  const snapshot = createSnapshot({
    current: { ...baseCurrent(), name: 'archive.zip', previewKind: 'download-only' },
    preview: { ...basePreview(), kind: 'download-only', text: null },
  })

  const html = renderToStaticMarkup(createElement(DriveSingleFileReaderView, { snapshot }))

  expect(html.match(/下载/g)?.length).toBe(1)
  expect(html).toContain('此文件只能下载')
})
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run dashboard/src/features/drive-browser/drive-browser-page.test.ts
```

Expected: FAIL because both header and renderer body include download.

- [ ] **Step 3: Simplify download renderer**

Modify `download-renderer.tsx`:

```tsx
import type { DriveBrowserItemDto } from '@synapse/shared'

export function DriveDownloadRenderer({ current }: { readonly current: DriveBrowserItemDto }) {
  return (
    <div className='flex flex-col items-start gap-2 py-8 text-sm'>
      <div className='font-medium'>{current.name}</div>
      <div className='text-muted-foreground'>此文件只能下载。</div>
    </div>
  )
}
```

- [ ] **Step 4: Run test**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run dashboard/src/features/drive-browser/drive-browser-page.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/features/drive-browser/renderers/download-renderer.tsx dashboard/src/features/drive-browser/drive-browser-page.test.ts
git commit -m "fix: avoid duplicate drive download action"
```

---

### Task 9: Full Verification And Release Note

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add one bullet near the top of `RELEASE_NOTES_PENDING.md` with the existing pending-note format:

```md
- 云盘文件预览统一了顶部工具栏，保存、重新加载、目录、评论、下载和打开方式等操作会出现在同一个位置，HTML 网页预览仍保留悬浮菜单。
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run \
  dashboard/src/features/drive-browser/drive-browser-page.test.ts \
  dashboard/src/features/drive-browser/renderers/code-renderer.test.tsx \
  dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.test.tsx \
  dashboard/src/features/drive-browser/renderers/markdown-renderer.test.tsx \
  dashboard/src/features/drive-browser/renderers/drive-renderer-toolbar-context.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript verification**

Run:

```bash
pnpm --filter @synapse/dashboard run tsc
```

Expected: PASS.

- [ ] **Step 4: Scan for banned UI patterns in touched files**

Run:

```bash
rg -n "style=\\{|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|bg-\\[|text-\\[|styled\\." dashboard/src/features/drive-browser/renderers dashboard/src/features/drive-browser/finder
```

Expected: no new matches introduced by this work. Existing `text-[...]` matches outside touched lines should be left alone unless the current task created them.

- [ ] **Step 5: Commit final verification update**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note drive preview toolbar unification"
```
