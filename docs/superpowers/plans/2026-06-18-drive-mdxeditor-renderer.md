# Drive MDXeditor Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Drive browser renderer named `MDXeditor` for `.md` and `.mdx` files, using `@mdxeditor/editor` and the existing Drive text save flow.

**Architecture:** The server continues to build Drive browser snapshots with `preview.kind === "markdown"` and `preview.text`. The dashboard renderer registry adds `mdxeditor` as the default Markdown renderer, while existing rendered Markdown preview and Monaco code renderer remain available. The new renderer wraps the official MDXEditor component and reuses `editContext.saveText(...)`, reload, version guards, and existing conflict semantics.

**Tech Stack:** React 19, Vite 8, TypeScript 6, `@mdxeditor/editor@4.0.3`, shadcn/Radix dashboard components, Vitest.

---

## File Structure

- Modify: `dashboard/package.json`
  - Add `@mdxeditor/editor` to dashboard dependencies.
- Modify: `pnpm-lock.yaml`
  - Updated by `pnpm --filter @synapse/dashboard add @mdxeditor/editor@4.0.3`.
- Modify: `server/src/drive/drive-browser.ts`
  - Add `.mdx` to Markdown file recognition.
- Modify: `server/src/drive/drive-browser.spec.ts`
  - Add a `.mdx` classification assertion.
- Modify: `dashboard/src/features/drive-browser/renderers/drive-renderer-registry.ts`
  - Add `mdxeditor` renderer id and make it the default Markdown renderer option.
- Modify: `dashboard/src/features/drive-browser/renderers/drive-renderer-shell.tsx`
  - Import and dispatch `DriveMdxEditorRenderer`.
- Create: `dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.tsx`
  - MDXEditor adapter with save, reload, read-only, login-required, and conflict handling.
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.test.ts`
  - Add registry and render dispatch coverage, with a lightweight MDXEditor mock.
- Create: `dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.test.tsx`
  - Unit tests for dirty state, save, reload, read-only, login-required, and conflict behavior.
- Modify: `RELEASE_NOTES_PENDING.md`
  - Add a user-facing note for Drive Markdown files using MDXeditor.

## Task 1: Add Server Recognition For `.mdx`

**Files:**
- Modify: `server/src/drive/drive-browser.spec.ts`
- Modify: `server/src/drive/drive-browser.ts`

- [ ] **Step 1: Write the failing `.mdx` classification assertion**

In `server/src/drive/drive-browser.spec.ts`, update the existing `classifies markdown files by extension and mime type` test:

```ts
  it("classifies markdown files by extension and mime type", () => {
    expect(resolveDriveBrowserPreviewKind({ ...baseItem, name: "notes.md", mimeType: null })).toBe("markdown")
    expect(resolveDriveBrowserPreviewKind({ ...baseItem, name: "guide.markdown", mimeType: null })).toBe("markdown")
    expect(resolveDriveBrowserPreviewKind({ ...baseItem, name: "component.mdx", mimeType: null })).toBe("markdown")
    expect(resolveDriveBrowserPreviewKind({ ...baseItem, name: "upload.bin", mimeType: "text/markdown" })).toBe("markdown")
    expect(resolveDriveBrowserPreviewKind({ ...baseItem, name: "legacy.bin", mimeType: "text/x-markdown" })).toBe("markdown")
  })
```

- [ ] **Step 2: Run the focused server helper test and confirm it fails**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/drive/drive-browser.spec.ts
```

Expected: FAIL, with the `.mdx` assertion returning `download-only` or `text` instead of `markdown`.

- [ ] **Step 3: Implement `.mdx` recognition**

In `server/src/drive/drive-browser.ts`, update `isMarkdownDriveItem`:

```ts
function isMarkdownDriveItem(lowerName: string, mimeType: string): boolean {
  return lowerName.endsWith(".md")
    || lowerName.endsWith(".markdown")
    || lowerName.endsWith(".mdx")
    || mimeType === "text/markdown"
    || mimeType === "text/x-markdown"
}
```

- [ ] **Step 4: Run the focused server helper test and confirm it passes**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/drive/drive-browser.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the `.mdx` recognition change**

Run:

```bash
git add server/src/drive/drive-browser.ts server/src/drive/drive-browser.spec.ts
git commit -m "feat(drive): recognize mdx browser previews"
```

## Task 2: Install MDXEditor In The Dashboard Package

**Files:**
- Modify: `dashboard/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add the exact MDXEditor dependency**

Run:

```bash
pnpm --filter @synapse/dashboard add @mdxeditor/editor@4.0.3
```

Expected: `dashboard/package.json` includes `@mdxeditor/editor` in `dependencies`, and `pnpm-lock.yaml` records the resolved package graph.

- [ ] **Step 2: Inspect the installed package exports before coding**

Run:

```bash
node -e "import('@mdxeditor/editor').then((m)=>console.log(Object.keys(m).filter((k)=>/Plugin|MDXEditor|Toolbar|Toggle|Select|Link|Table|Code|Break|Undo|Redo/.test(k)).sort().join('\n')))"
```

Expected: output includes `MDXEditor`, `headingsPlugin`, `listsPlugin`, `quotePlugin`, `thematicBreakPlugin`, `linkPlugin`, `tablePlugin`, `codeBlockPlugin`, `codeMirrorPlugin`, `markdownShortcutPlugin`, and `toolbarPlugin`. It should also include toolbar controls such as `BlockTypeSelect`, `BoldItalicUnderlineToggles`, `CreateLink`, `InsertTable`, `InsertThematicBreak`, and `UndoRedo`.

- [ ] **Step 3: Run dashboard TypeScript to confirm the dependency resolves**

Run:

```bash
pnpm --filter @synapse/dashboard run tsc
```

Expected: PASS or only pre-existing unrelated errors. If it fails because the package cannot resolve, stop and inspect `dashboard/package.json` and `pnpm-lock.yaml` before continuing.

- [ ] **Step 4: Commit the dependency change**

Run:

```bash
git add dashboard/package.json pnpm-lock.yaml
git commit -m "chore(dashboard): add mdxeditor dependency"
```

## Task 3: Add The Renderer Registry Entry

**Files:**
- Modify: `dashboard/src/features/drive-browser/renderers/drive-renderer-registry.ts`
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.test.ts`

- [ ] **Step 1: Update the registry tests first**

In `dashboard/src/features/drive-browser/drive-browser-page.test.ts`, update the existing Markdown options test to expect `mdxeditor` by default:

```ts
  it('returns MDXeditor, markdown preview, and code renderer options with MDXeditor as default', () => {
    const snapshot = createSnapshot({
      current: { ...baseCurrent(), name: 'notes.md', previewKind: 'markdown' },
      preview: { ...basePreview(), kind: 'markdown', html: '<h1>Notes</h1>', text: '# Notes' },
    })

    const options = getDriveRendererOptions(snapshot)

    expect(options.map((option) => option.id)).toEqual(['mdxeditor', 'markdown', 'code'])
    expect(options.map((option) => option.label)).toEqual(['MDXeditor', '预览', '代码'])
    expect(selectDefaultDriveRenderer(snapshot)?.id).toBe('mdxeditor')
  })
```

Also add a non-Markdown guard near the other renderer option tests:

```ts
  it('does not offer MDXeditor for non-markdown previews', () => {
    const text = createSnapshot({
      current: { ...baseCurrent(), name: 'notes.txt', previewKind: 'text' },
      preview: { ...basePreview(), kind: 'text', text: 'plain text' },
    })
    const image = createSnapshot({
      current: { ...baseCurrent(), name: 'image.png', previewKind: 'image' },
      preview: { ...basePreview(), kind: 'image', imageUrl: '/drive/items/file/download' },
    })

    expect(getDriveRendererOptions(text).map((option) => option.id)).toEqual(['code'])
    expect(getDriveRendererOptions(image).map((option) => option.id)).toEqual(['image'])
  })
```

- [ ] **Step 2: Run the focused dashboard test and confirm it fails**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/drive-browser-page.test.ts
```

Expected: FAIL because `mdxeditor` is not yet a valid renderer id and Markdown options are still `['markdown', 'code']`.

- [ ] **Step 3: Implement the registry entry**

In `dashboard/src/features/drive-browser/renderers/drive-renderer-registry.ts`, replace the top section with:

```ts
import type { DriveBrowserSnapshotDto } from '@synapse/shared'

export type DriveRendererId = 'mdxeditor' | 'markdown' | 'code' | 'image' | 'iframe' | 'download'
export type DriveRendererContainer = 'reading' | 'media' | 'full'

export type DriveRendererOption = {
  readonly id: DriveRendererId
  readonly label: string
  readonly container: DriveRendererContainer
}

const RENDERERS: Record<DriveRendererId, DriveRendererOption> = {
  mdxeditor: { id: 'mdxeditor', label: 'MDXeditor', container: 'full' },
  markdown: { id: 'markdown', label: '预览', container: 'reading' },
  code: { id: 'code', label: '代码', container: 'full' },
  image: { id: 'image', label: '图片', container: 'media' },
  iframe: { id: 'iframe', label: '网页', container: 'full' },
  download: { id: 'download', label: '下载', container: 'reading' },
}
```

Then update the Markdown branch:

```ts
  if (preview.kind === 'markdown') return [RENDERERS.mdxeditor, RENDERERS.markdown, RENDERERS.code]
```

- [ ] **Step 4: Run the focused dashboard test and confirm it passes**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/drive-browser-page.test.ts
```

Expected: PASS for the registry tests. Other failures at this point should only be from missing renderer dispatch when full rendering paths hit `mdxeditor`.

- [ ] **Step 5: Commit the registry change**

Run:

```bash
git add dashboard/src/features/drive-browser/renderers/drive-renderer-registry.ts dashboard/src/features/drive-browser/drive-browser-page.test.ts
git commit -m "feat(drive): add mdxeditor renderer option"
```

## Task 4: Add The MDXeditor Renderer Component

**Files:**
- Create: `dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.tsx`
- Create: `dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.test.tsx`

- [ ] **Step 1: Create a test mock for `@mdxeditor/editor`**

Create `dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.test.tsx` with this initial content:

```tsx
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DriveBrowserEditDto,
  DriveBrowserItemDto,
  DriveBrowserPreviewDto,
} from '@synapse/shared'
import { ApiError } from '@/lib/api'
import { DriveMdxEditorRenderer } from './mdxeditor-renderer'
import type { DriveRendererEditContext } from './drive-renderer-shell'

vi.mock('@mdxeditor/editor/style.css', () => ({}))

vi.mock('@mdxeditor/editor', async () => {
  const React = await import('react')
  return {
    MDXEditor: ({
      markdown,
      onChange,
      readOnly,
    }: {
      markdown: string
      onChange?: (value: string) => void
      readOnly?: boolean
    }) => (
      <textarea
        aria-label='MDXeditor body'
        data-mdxeditor-readonly={readOnly ? 'true' : 'false'}
        readOnly={readOnly}
        value={markdown}
        onChange={(event) => onChange?.(event.currentTarget.value)}
      />
    ),
    BlockTypeSelect: () => <button type='button'>Block</button>,
    BoldItalicUnderlineToggles: () => <button type='button'>Style</button>,
    CreateLink: () => <button type='button'>Link</button>,
    InsertCodeBlock: () => <button type='button'>Code</button>,
    InsertTable: () => <button type='button'>Table</button>,
    InsertThematicBreak: () => <button type='button'>Break</button>,
    ListsToggle: () => <button type='button'>List</button>,
    UndoRedo: () => <button type='button'>UndoRedo</button>,
    codeBlockPlugin: vi.fn(() => ({ name: 'codeBlockPlugin' })),
    codeMirrorPlugin: vi.fn(() => ({ name: 'codeMirrorPlugin' })),
    headingsPlugin: vi.fn(() => ({ name: 'headingsPlugin' })),
    linkPlugin: vi.fn(() => ({ name: 'linkPlugin' })),
    listsPlugin: vi.fn(() => ({ name: 'listsPlugin' })),
    markdownShortcutPlugin: vi.fn(() => ({ name: 'markdownShortcutPlugin' })),
    quotePlugin: vi.fn(() => ({ name: 'quotePlugin' })),
    tablePlugin: vi.fn(() => ({ name: 'tablePlugin' })),
    thematicBreakPlugin: vi.fn(() => ({ name: 'thematicBreakPlugin' })),
    toolbarPlugin: vi.fn(() => ({ name: 'toolbarPlugin' })),
  }
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  document.body.innerHTML = ''
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

describe('DriveMdxEditorRenderer', () => {
  it('renders preview text in MDXEditor', async () => {
    await renderRenderer()

    expect(editorBody().value).toBe('# Notes')
    expect(editorBody().dataset.mdxeditorReadonly).toBe('false')
  })
})

async function renderRenderer(overrides: {
  readonly current?: Partial<DriveBrowserItemDto>
  readonly preview?: Partial<DriveBrowserPreviewDto>
  readonly edit?: Partial<DriveBrowserEditDto> | null
  readonly editContext?: Partial<DriveRendererEditContext>
} = {}) {
  const current: DriveBrowserItemDto = {
    id: 'file-1',
    name: 'notes.md',
    type: 'file',
    size: '7',
    mimeType: 'text/markdown',
    updatedAt: '2026-06-18T00:00:00.000Z',
    previewKind: 'markdown',
    browserUrl: '/drive/items/file-1',
    downloadUrl: '/drive/items/file-1/download',
    ...overrides.current,
  }
  const preview: DriveBrowserPreviewDto = {
    kind: 'markdown',
    text: '# Notes',
    html: '<h1>Notes</h1>',
    outline: [],
    truncated: false,
    imageUrl: null,
    visitUrl: null,
    ...overrides.preview,
  }
  const edit: DriveBrowserEditDto | null = overrides.edit === null
    ? null
    : {
        canEdit: true,
        editorKind: 'text',
        currentVersionId: 'version-1',
        maxInlineEditBytes: '131072',
        reason: null,
        ...overrides.edit,
      }
  const editContext: DriveRendererEditContext = {
    reload: vi.fn(async () => createSnapshot()),
    reloading: false,
    saveText: vi.fn(async () => ({
      item: {
        id: 'file-1',
        parentId: null,
        type: 'file',
        name: 'notes.md',
        size: '7',
        mimeType: 'text/markdown',
        storageStatus: 'active',
        shared: false,
        createdAt: '2026-06-18T00:00:00.000Z',
        updatedAt: '2026-06-18T00:00:00.000Z',
      },
      version: {
        id: 'version-2',
        itemId: 'file-1',
        versionNumber: 2,
        size: '8',
        mimeType: 'text/markdown',
        source: 'online_edit',
        isCurrent: true,
        isPinned: false,
        deletePending: false,
        restoredFromVersionId: null,
        createdAt: '2026-06-18T00:00:00.000Z',
        createdBy: 'user-1',
      },
    })),
    savingText: false,
    ...overrides.editContext,
  }

  await act(async () => {
    root.render(
      <DriveMdxEditorRenderer
        current={current}
        preview={preview}
        edit={edit}
        editContext={editContext}
      />
    )
  })

  return { current, preview, edit, editContext }
}

function createSnapshot() {
  return {
    context: 'owner' as const,
    surface: 'standalone' as const,
    current: {
      id: 'file-1',
      name: 'notes.md',
      type: 'file' as const,
      size: '7',
      mimeType: 'text/markdown',
      updatedAt: '2026-06-18T00:00:00.000Z',
      previewKind: 'markdown' as const,
      browserUrl: '/drive/items/file-1',
      downloadUrl: '/drive/items/file-1/download',
    },
    breadcrumbs: [],
    children: [],
    preview: null,
    edit: null,
    canDownload: true,
    canZip: false,
  }
}

function editorBody(): HTMLTextAreaElement {
  const element = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="MDXeditor body"]')
  if (!element) throw new Error('MDXeditor body not found')
  return element
}
```

- [ ] **Step 2: Run the renderer test and confirm it fails**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/renderers/mdxeditor-renderer.test.tsx
```

Expected: FAIL because `./mdxeditor-renderer` does not exist.

- [ ] **Step 3: Implement `DriveMdxEditorRenderer`**

Create `dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  InsertCodeBlock,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  UndoRedo,
  codeBlockPlugin,
  codeMirrorPlugin,
  headingsPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import type { DriveBrowserEditDto, DriveBrowserItemDto, DriveBrowserPreviewDto } from '@synapse/shared'
import { Download, Loader2, LogIn, RefreshCw, Save } from 'lucide-react'
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
import { ApiError } from '@/lib/api'
import type { DriveRendererEditContext } from './drive-renderer-shell'

export function DriveMdxEditorRenderer({
  current,
  preview,
  edit,
  editContext,
}: {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
  readonly edit?: DriveBrowserEditDto | null
  readonly editContext?: DriveRendererEditContext
}) {
  const initialText = preview.text ?? ''
  const [value, setValue] = useState(initialText)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  const canEdit = Boolean(edit?.canEdit && edit.currentVersionId && editContext)
  const loginRequired = edit?.reason === 'login_required'
  const loginUrl = useMemo(() => buildLoginUrl(), [])
  const plugins = useMemo(() => createMdxEditorPlugins(), [])

  useEffect(() => {
    setValue(initialText)
    setDirty(false)
    setError(null)
  }, [current.id, edit?.currentVersionId, initialText])

  const handleSave = async () => {
    if (!canEdit || !edit?.currentVersionId || !editContext) return
    setError(null)
    try {
      await editContext.saveText({ text: value, baseVersionId: edit.currentVersionId })
      setDirty(false)
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 409) {
        setConflictOpen(true)
        return
      }
      setError(saveError instanceof Error ? saveError.message : '保存失败。')
    }
  }

  const handleReload = async () => {
    if (!editContext) return
    setError(null)
    try {
      await editContext.reload()
      setValue(initialText)
      setDirty(false)
      setConflictOpen(false)
    } catch (reloadError) {
      setError(reloadError instanceof Error ? reloadError.message : '重新加载失败。')
    }
  }

  return (
    <div
      data-drive-mdxeditor-renderer='true'
      className='flex h-full min-h-0 w-full flex-col overflow-hidden'
    >
      {canEdit || loginRequired ? (
        <div className='flex shrink-0 items-center justify-between gap-3 border-b px-3 py-2'>
          <div className='min-w-0 text-xs text-muted-foreground'>
            {dirty ? '未保存' : canEdit ? '已同步' : '只读'}
          </div>
          <div className='flex shrink-0 items-center gap-2'>
            {loginRequired ? (
              <Button asChild variant='outline' size='sm'>
                <a href={loginUrl}>
                  <LogIn data-icon='inline-start' />
                  登录后编辑
                </a>
              </Button>
            ) : null}
            {canEdit ? (
              <>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => { void handleReload() }}
                  disabled={editContext?.reloading || editContext?.savingText}
                >
                  {editContext?.reloading ? <Loader2 className='animate-spin' /> : <RefreshCw data-icon='inline-start' />}
                  重新加载
                </Button>
                <Button
                  type='button'
                  size='sm'
                  onClick={() => { void handleSave() }}
                  disabled={!dirty || editContext?.savingText || editContext?.reloading}
                >
                  {editContext?.savingText ? <Loader2 className='animate-spin' /> : <Save data-icon='inline-start' />}
                  保存
                </Button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className='min-h-0 flex-1 overflow-auto'>
        <MDXEditor
          markdown={value}
          readOnly={!canEdit}
          plugins={plugins}
          onChange={(nextValue) => {
            if (!canEdit) return
            setValue(nextValue)
            setDirty(nextValue !== initialText)
          }}
        />
      </div>
      {error ? (
        <div className='border-t px-3 py-2 text-xs text-destructive'>{error}</div>
      ) : null}
      {preview.truncated ? (
        <div className='border-t px-3 py-2 text-xs text-muted-foreground'>内容已截断</div>
      ) : null}
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
  )
}

function createMdxEditorPlugins() {
  return [
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    tablePlugin(),
    codeBlockPlugin({ defaultCodeBlockLanguage: 'markdown' }),
    codeMirrorPlugin({
      codeBlockLanguages: {
        bash: 'Bash',
        css: 'CSS',
        html: 'HTML',
        js: 'JavaScript',
        json: 'JSON',
        markdown: 'Markdown',
        sh: 'Shell',
        ts: 'TypeScript',
        txt: 'Text',
      },
    }),
    markdownShortcutPlugin(),
    toolbarPlugin({
      toolbarContents: () => (
        <>
          <UndoRedo />
          <BlockTypeSelect />
          <BoldItalicUnderlineToggles />
          <ListsToggle />
          <CreateLink />
          <InsertTable />
          <InsertCodeBlock />
          <InsertThematicBreak />
        </>
      ),
    }),
  ]
}

function buildLoginUrl(): string {
  if (typeof window === 'undefined') return '/sign-in'
  const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`
  return `/sign-in?redirect=${encodeURIComponent(redirect)}`
}

function downloadLocalVersion(name: string, value: string): void {
  const url = URL.createObjectURL(new Blob([value], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: Run the renderer test and confirm the initial test passes**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/renderers/mdxeditor-renderer.test.tsx
```

Expected: PASS for the initial render test.

- [ ] **Step 5: Commit the initial renderer component**

Run:

```bash
git add dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.tsx dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.test.tsx
git commit -m "feat(drive): add mdxeditor renderer"
```

## Task 5: Wire Renderer Dispatch And Body Rendering

**Files:**
- Modify: `dashboard/src/features/drive-browser/renderers/drive-renderer-shell.tsx`
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.test.ts`

- [ ] **Step 1: Add dispatch tests**

At the top of `dashboard/src/features/drive-browser/drive-browser-page.test.ts`, add the MDXEditor mock before imports that render `DriveRendererContent`:

```ts
import { vi } from 'vitest'

vi.mock('@mdxeditor/editor/style.css', () => ({}))

vi.mock('@mdxeditor/editor', async () => {
  const React = await import('react')
  return {
    MDXEditor: ({ markdown, readOnly }: { markdown: string; readOnly?: boolean }) => (
      <div data-mdxeditor-readonly={readOnly ? 'true' : 'false'}>{markdown}</div>
    ),
    BlockTypeSelect: () => <span />,
    BoldItalicUnderlineToggles: () => <span />,
    CreateLink: () => <span />,
    InsertCodeBlock: () => <span />,
    InsertTable: () => <span />,
    InsertThematicBreak: () => <span />,
    ListsToggle: () => <span />,
    UndoRedo: () => <span />,
    codeBlockPlugin: vi.fn(() => ({})),
    codeMirrorPlugin: vi.fn(() => ({})),
    headingsPlugin: vi.fn(() => ({})),
    linkPlugin: vi.fn(() => ({})),
    listsPlugin: vi.fn(() => ({})),
    markdownShortcutPlugin: vi.fn(() => ({})),
    quotePlugin: vi.fn(() => ({})),
    tablePlugin: vi.fn(() => ({})),
    thematicBreakPlugin: vi.fn(() => ({})),
    toolbarPlugin: vi.fn(() => ({})),
  }
})
```

If the file already imports `describe`, `expect`, and `it` from `vitest`, combine the import:

```ts
import { describe, expect, it, vi } from 'vitest'
```

Then add this test near other renderer content tests:

```ts
  it('dispatches markdown files to the MDXeditor renderer by default', () => {
    const snapshot = createSnapshot({
      current: { ...baseCurrent(), name: 'notes.md', previewKind: 'markdown' },
      preview: { ...basePreview(), kind: 'markdown', text: '# Notes', html: '<h1>Notes</h1>' },
      edit: {
        canEdit: true,
        editorKind: 'text',
        currentVersionId: 'version-1',
        maxInlineEditBytes: '131072',
        reason: null,
      },
    })

    const html = renderToStaticMarkup(createElement(DriveSingleFileReaderView, { snapshot }))

    expect(html).toContain('data-drive-mdxeditor-renderer="true"')
    expect(html).toContain('# Notes')
    expect(html).not.toContain('<h1>Notes</h1>')
  })
```

- [ ] **Step 2: Run the focused dashboard page test and confirm it fails**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/drive-browser-page.test.ts
```

Expected: FAIL because `DriveRendererContent` does not yet handle `selected.id === 'mdxeditor'`.

- [ ] **Step 3: Wire the renderer shell**

In `dashboard/src/features/drive-browser/renderers/drive-renderer-shell.tsx`, add the import:

```ts
import { DriveMdxEditorRenderer } from './mdxeditor-renderer'
```

Update `DriveRendererContent` so the `mdxeditor` branch comes before `markdown`:

```tsx
  if (selected.id === 'mdxeditor') {
    return renderContent(<DriveMdxEditorRenderer current={snapshot.current} preview={preview} edit={snapshot.edit} editContext={editContext} />)
  }
  if (selected.id === 'markdown') {
    return renderContent(<DriveMarkdownRenderer current={snapshot.current} preview={preview} />)
  }
```

- [ ] **Step 4: Adjust floating menu positioning if needed**

Find the floating menu class logic in `DriveRendererFloatingMenu`. If it currently special-cases only `code`, keep the `top-14` offset for full editing renderers:

```ts
selected.id === 'code' || selected.id === 'mdxeditor' ? 'top-14' : 'top-5'
```

Update the existing source assertion in `drive-browser-page.test.ts` from:

```ts
expect(source).toContain("selected.id === 'code' ? 'top-14' : 'top-5'")
```

to:

```ts
expect(source).toContain("selected.id === 'code' || selected.id === 'mdxeditor' ? 'top-14' : 'top-5'")
```

- [ ] **Step 5: Run focused dashboard tests and confirm they pass**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/drive-browser-page.test.ts src/features/drive-browser/renderers/mdxeditor-renderer.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit renderer dispatch**

Run:

```bash
git add dashboard/src/features/drive-browser/renderers/drive-renderer-shell.tsx dashboard/src/features/drive-browser/drive-browser-page.test.ts
git commit -m "feat(drive): render markdown with mdxeditor"
```

## Task 6: Complete MDXeditor Behavior Tests

**Files:**
- Modify: `dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.test.tsx`
- Modify: `dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.tsx` if tests expose small behavior gaps

- [ ] **Step 1: Add dirty/save behavior tests**

Append to `describe('DriveMdxEditorRenderer', ...)`:

```tsx
  it('marks changes dirty and saves with the current version guard', async () => {
    const { editContext } = await renderRenderer()

    await act(async () => {
      editorBody().value = '# Notes\n\nUpdated'
      editorBody().dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(document.body.textContent).toContain('未保存')

    await act(async () => {
      button('保存').click()
    })

    expect(editContext.saveText).toHaveBeenCalledWith({
      text: '# Notes\n\nUpdated',
      baseVersionId: 'version-1',
    })
  })

  it('disables save before content changes', async () => {
    await renderRenderer()

    expect(button('保存').disabled).toBe(true)
  })
```

- [ ] **Step 2: Add read-only and login-required tests**

Append:

```tsx
  it('keeps permission-denied files read-only without save controls', async () => {
    const { editContext } = await renderRenderer({
      edit: {
        canEdit: false,
        reason: 'permission_denied',
        currentVersionId: 'version-1',
      },
    })

    expect(editorBody().readOnly).toBe(true)
    expect(queryButton('保存')).toBeNull()

    await act(async () => {
      editorBody().value = '# Changed'
      editorBody().dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(editContext.saveText).not.toHaveBeenCalled()
  })

  it('shows login action for login-required editable shares', async () => {
    await renderRenderer({
      edit: {
        canEdit: false,
        reason: 'login_required',
        currentVersionId: 'version-1',
      },
    })

    expect(editorBody().readOnly).toBe(true)
    expect(document.querySelector('a[href^="/sign-in?redirect="]')?.textContent).toContain('登录后编辑')
    expect(queryButton('保存')).toBeNull()
  })
```

- [ ] **Step 3: Add reload and conflict tests**

Append:

```tsx
  it('reloads through edit context and clears dirty state', async () => {
    const { editContext } = await renderRenderer()

    await act(async () => {
      editorBody().value = '# Changed'
      editorBody().dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(document.body.textContent).toContain('未保存')

    await act(async () => {
      button('重新加载').click()
    })

    expect(editContext.reload).toHaveBeenCalled()
    expect(document.body.textContent).toContain('已同步')
  })

  it('opens the conflict dialog on version conflicts and keeps local text', async () => {
    await renderRenderer({
      editContext: {
        saveText: vi.fn(async () => {
          throw new ApiError('conflict', 409)
        }),
      },
    })

    await act(async () => {
      editorBody().value = '# Local'
      editorBody().dispatchEvent(new Event('input', { bubbles: true }))
    })

    await act(async () => {
      button('保存').click()
    })

    expect(document.body.textContent).toContain('文件已有新内容')
    expect(editorBody().value).toBe('# Local')
  })
```

Add helper functions at the bottom:

```tsx
function button(text: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find((element) => element.textContent?.includes(text))
  if (!match) throw new Error(`Button not found: ${text}`)
  return match
}

function queryButton(text: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find((element) => element.textContent?.includes(text)) ?? null
}
```

- [ ] **Step 4: Run the renderer test and confirm it passes**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/renderers/mdxeditor-renderer.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit behavior coverage**

Run:

```bash
git add dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.test.tsx dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.tsx
git commit -m "test(drive): cover mdxeditor renderer editing"
```

## Task 7: Update Release Notes And Run Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add a release note**

Add a concise bullet under the most relevant pending section in `RELEASE_NOTES_PENDING.md`:

```md
- 云盘 Markdown 文件新增 MDXeditor 编辑方式，打开 `.md` / `.mdx` 文件后可以用富文本 Markdown 编辑器手动保存新版本。
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/drive/drive-browser.spec.ts
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/drive-browser-page.test.ts src/features/drive-browser/renderers/mdxeditor-renderer.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run package type checks**

Run:

```bash
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/dashboard run tsc
```

Expected: PASS. If MDXEditor export names differ from the plan, fix imports according to the installed `@mdxeditor/editor` type declarations and rerun dashboard `tsc`.

- [ ] **Step 4: Run broader tests if focused checks pass**

Run:

```bash
pnpm --filter @synapse/server test
pnpm --filter @synapse/dashboard run build
```

Expected: PASS. Dashboard build is the practical bundling check for the MDXEditor CSS and plugin imports.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only the files listed in this plan are changed.

- [ ] **Step 6: Commit release note and final fixes**

Run:

```bash
git add RELEASE_NOTES_PENDING.md dashboard/package.json pnpm-lock.yaml dashboard/src/features/drive-browser server/src/drive/drive-browser.ts server/src/drive/drive-browser.spec.ts
git commit -m "feat(drive): support mdxeditor markdown editing"
```

If all implementation changes were already committed in earlier tasks and only the release note remains, use:

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note drive mdxeditor support"
```
