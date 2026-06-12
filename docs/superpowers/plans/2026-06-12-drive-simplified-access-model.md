# Drive Simplified Access Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify Synapse Drive so the desktop main drive focuses on file management/opening, public sharing and publication management live in one `公开链接` center, and Markdown previews render by default in owner and share browser pages.

**Architecture:** Keep the first implementation narrow. Update the desktop Drive module in place instead of splitting its large file during this pass; reuse existing shadcn/Radix components and merge the existing share/publication dialogs behind a tabbed public-links dialog. Extend the existing Drive browser DTO and server preview builder so sanitized Markdown HTML can be embedded in the browser preview while `源码` remains available as a toggle.

**Tech Stack:** Electron, React, TypeScript, shadcn/Radix, Tailwind tokens, NestJS, Prisma, Vitest, React DOM test utilities.

---

## Current Context

- Design spec: `docs/superpowers/specs/2026-06-12-drive-simplified-access-model-design.md`.
- Desktop Drive module: `desktop/src/modules/drive/index.tsx`.
- Desktop Drive tests: `desktop/src/modules/drive/__tests__/drive-module.test.tsx`.
- Shared Drive DTOs and URL helpers: `shared/src/drive.ts`.
- Dashboard Drive browser UI: `dashboard/src/features/drive-browser/drive-browser-page.tsx`.
- Dashboard Drive browser tests: `dashboard/src/features/drive-browser/drive-browser-page.test.ts`.
- Server Drive browser helpers: `server/src/drive/drive-browser.ts`.
- Server Drive service: `server/src/drive/drive.service.ts`.
- Server Markdown renderer: `server/src/drive/drive-markdown-renderer.ts`.
- Server tests: `server/src/drive/drive-browser.spec.ts`, `server/src/drive/drive.service.spec.ts`, `server/src/drive/drive-markdown-renderer.spec.ts`.
- Release notes: `RELEASE_NOTES_PENDING.md`.

## File Structure

- Modify `desktop/src/modules/drive/index.tsx`
  - Rename the list action from `预览` to `打开`.
  - Replace top-level `已分享` and `已发布` buttons with one `公开链接` button.
  - Introduce `DrivePublicLinksDialog` in the same file, backed by existing share and publication list components.
  - Move visible `删除` from row inline actions into the row `更多` menu.
- Modify `desktop/src/modules/drive/__tests__/drive-module.test.tsx`
  - Update toolbar and action tests.
  - Add regression coverage for `公开链接` tabs and row action layout.
- Modify `shared/src/drive.ts`
  - Add `html: string | null` to `DriveBrowserPreviewDto`.
- Modify `server/src/drive/drive-markdown-renderer.ts`
  - Export a fragment renderer used by browser previews.
  - Keep complete document rendering for owner render routes.
- Modify `server/src/drive/drive-browser.ts`
  - Carry optional rendered HTML through `buildDriveBrowserPreview`.
  - Stop adding owner-only `visitUrl` for Markdown previews.
- Modify `server/src/drive/drive.service.ts`
  - Render Markdown fragment during browser preview creation for owner and share contexts.
- Modify `server/src/drive/drive-browser.spec.ts`
  - Update Markdown visit-url behavior.
- Modify `server/src/drive/drive-markdown-renderer.spec.ts`
  - Cover fragment rendering and raw HTML sanitization.
- Modify `server/src/drive/drive.service.spec.ts`
  - Cover owner and share Markdown browser previews with rendered HTML.
- Modify `dashboard/src/features/drive-browser/drive-browser-page.tsx`
  - Render Markdown HTML by default and add a `源码` toggle.
  - Keep HTML previews as source by default.
- Modify `dashboard/src/features/drive-browser/drive-browser-page.test.ts`
  - Update Markdown action expectations.
  - Add Markdown view-model tests for default rendered mode and source availability.
- Modify `RELEASE_NOTES_PENDING.md`
  - Add a user-facing note for the Drive simplification.

---

## Task 1: Desktop Main Drive Tests

**Files:**
- Modify: `desktop/src/modules/drive/__tests__/drive-module.test.tsx`

- [ ] **Step 1: Update toolbar expectations to the new public links entry**

Replace the first toolbar test with:

```tsx
it("renders the cloud drive toolbar actions", () => {
  const html = renderToStaticMarkup(<DriveModule />)

  expect(html).toContain("云盘")
  expect(html).toContain("公开链接")
  expect(html).not.toContain("已分享")
  expect(html).not.toContain("已发布")
  expect(html).toContain("上传文件")
  expect(html).toContain("上传文件夹")
  expect(html).toContain("新建文件夹")
  expect(html).toContain("刷新")
})
```

- [ ] **Step 2: Replace the top-bar management action test**

Replace `shows share and publication management actions in the drive top bar` with:

```tsx
it("opens public link management from one top-bar action", async () => {
  await render(<DriveModule />)
  await flushAct()

  expect(getButton("公开链接")).not.toBeNull()
  expect(queryButton("已分享")).toBeNull()
  expect(queryButton("已发布")).toBeNull()

  await clickButtonText("公开链接")
  await flushAct()

  expect(document.body.textContent).toContain("公开链接")
  expect(document.body.textContent).toContain("全部")
  expect(document.body.textContent).toContain("分享")
  expect(document.body.textContent).toContain("发布")
})
```

- [ ] **Step 3: Update unauthenticated and authenticating expectations**

In the unauthenticated and authenticating tests, replace:

```tsx
expect(getButton("已分享").disabled).toBe(true)
expect(getButton("已发布").disabled).toBe(true)
```

with:

```tsx
expect(getButton("公开链接").disabled).toBe(true)
expect(queryButton("已分享")).toBeNull()
expect(queryButton("已发布")).toBeNull()
```

- [ ] **Step 4: Add a row action regression test**

Add this test near the existing preview/share/delete tests:

```tsx
it("keeps row actions focused on opening and sharing", async () => {
  mocks.listDriveItems.mockResolvedValue([
    createDriveItem({ id: "file-1", name: "notes.md", type: "file", mimeType: "text/markdown" }),
  ])

  await render(<DriveModule />)
  await flushAct()

  expect(getButton("打开")).not.toBeNull()
  expect(getButton("分享")).not.toBeNull()
  expect(queryButton("预览")).toBeNull()
  expect(queryButton("删除")).toBeNull()
  expect(getButton("更多 notes.md")).not.toBeNull()
})
```

- [ ] **Step 5: Add a public links tab loading test**

Add this test near the existing share/publication dialog tests:

```tsx
it("loads share and publication data in the public links dialog", async () => {
  mocks.listDriveShares.mockResolvedValue([
    createDriveShare({ id: "share-1", itemName: "notes.md", itemType: "file" }),
  ])
  mocks.listDrivePublications.mockResolvedValue([
    createDrivePublication({ id: "pub-1", name: "index.html", type: "page" }),
  ])

  await render(<DriveModule />)
  await flushAct()

  await clickButtonText("公开链接")
  await flushAct()

  expect(mocks.listDriveShares).toHaveBeenCalledTimes(1)
  expect(mocks.listDrivePublications).toHaveBeenCalledTimes(1)
  expect(document.body.textContent).toContain("notes.md")
  expect(document.body.textContent).toContain("index.html")
})
```

- [ ] **Step 6: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/drive/__tests__/drive-module.test.tsx
```

Expected: FAIL because `公开链接` does not exist yet, `预览` is still rendered, and `已分享` / `已发布` are still top-level actions.

- [ ] **Step 7: Commit failing tests**

```bash
git add desktop/src/modules/drive/__tests__/drive-module.test.tsx
git commit -m "test(drive): capture simplified desktop drive actions"
```

---

## Task 2: Desktop Main Drive UI

**Files:**
- Modify: `desktop/src/modules/drive/index.tsx`

- [ ] **Step 1: Import Tabs**

Add this import near the existing UI imports:

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
```

- [ ] **Step 2: Replace separate dialog state with one public-links state**

Replace:

```tsx
const [publicationsOpen, setPublicationsOpen] = useState(false)
const [sharesOpen, setSharesOpen] = useState(false)
```

with:

```tsx
const [publicLinksOpen, setPublicLinksOpen] = useState(false)
```

- [ ] **Step 3: Replace top-bar buttons**

Replace the `已分享` / `已发布` button group with:

```tsx
<Button
  variant="outline"
  size="sm"
  disabled={!accountAuthenticated || loading}
  onClick={() => setPublicLinksOpen(true)}
>
  <Link2 data-icon="inline-start" />
  公开链接
</Button>
```

- [ ] **Step 4: Replace dialog rendering**

Replace:

```tsx
<DriveSharesDialog open={sharesOpen} onOpenChange={setSharesOpen} />
<DrivePublicationsDialog
  open={publicationsOpen}
  onOpenChange={setPublicationsOpen}
  onPublicationDeployed={setPublicationSuccess}
/>
```

with:

```tsx
<DrivePublicLinksDialog
  open={publicLinksOpen}
  onOpenChange={setPublicLinksOpen}
  onPublicationDeployed={setPublicationSuccess}
/>
```

- [ ] **Step 5: Rename the item action callback**

In `DriveFileList` and `DriveFileListRow` props, rename `onPreview` to `onOpenItem`. Use this call site:

```tsx
onOpenItem={handlePreview}
```

In `DriveFileListRow`, replace the visible button:

```tsx
<Button type="button" variant="ghost" size="xs" onClick={() => onOpenItem(item)}>
  打开
</Button>
```

- [ ] **Step 6: Move delete into the more menu**

Remove the visible destructive `删除` button from `DriveFileListRow`. Pass `onDelete` into `DriveItemMenu` and add this menu item after `移动`:

```tsx
<DropdownMenuItem
  variant="destructive"
  onClick={() => onDelete(item)}
>
  删除
</DropdownMenuItem>
```

Keep the table action cell narrow enough for `打开` / `分享` / `更多`:

```tsx
<TableHead className="w-40 text-right">操作</TableHead>
```

- [ ] **Step 7: Add the public links dialog**

Add this component above the old `DrivePublicationsDialog` implementation:

```tsx
type DrivePublicLinkTab = "all" | "shares" | "publications"

function DrivePublicLinksDialog({
  open,
  onOpenChange,
  onPublicationDeployed,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onPublicationDeployed: (publication: DrivePublicationSuccessState) => void
}) {
  const [tab, setTab] = useState<DrivePublicLinkTab>("all")
  const [shares, setShares] = useState<DriveShareListItemDto[]>([])
  const [publications, setPublications] = useState<DrivePublicationDto[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadPublicLinks = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [nextShares, nextPublications] = await Promise.all([
        requireSynapseBridge().account.listDriveShares(),
        requireSynapseBridge().account.listDrivePublications(),
      ])
      setShares(nextShares)
      setPublications(nextPublications)
    } catch (rawError) {
      const message = errorMessage(rawError, "公开链接加载失败")
      setLoadError(message)
      toast(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void loadPublicLinks()
  }, [loadPublicLinks, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialog
        title="公开链接"
        contentClassName="sm:max-w-5xl"
        onSubmit={(event) => event.preventDefault()}
        footer={<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>}
      >
        <Tabs value={tab} onValueChange={(value) => setTab(value as DrivePublicLinkTab)}>
          <TabsList>
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="shares">分享</TabsTrigger>
            <TabsTrigger value="publications">发布</TabsTrigger>
          </TabsList>
          <TabsContent value="all">
            <DrivePublicLinkList
              error={loadError}
              loading={loading}
              publications={publications}
              shares={shares}
              onPublicationDeployed={onPublicationDeployed}
              onReload={loadPublicLinks}
            />
          </TabsContent>
          <TabsContent value="shares">
            <DrivePublicLinkList
              error={loadError}
              loading={loading}
              publications={[]}
              shares={shares}
              onPublicationDeployed={onPublicationDeployed}
              onReload={loadPublicLinks}
            />
          </TabsContent>
          <TabsContent value="publications">
            <DrivePublicLinkList
              error={loadError}
              loading={loading}
              publications={publications}
              shares={[]}
              onPublicationDeployed={onPublicationDeployed}
              onReload={loadPublicLinks}
            />
          </TabsContent>
        </Tabs>
      </FormDialog>
    </Dialog>
  )
}
```

- [ ] **Step 8: Add a unified public link list**

Add this component after `DrivePublicLinksDialog`:

```tsx
function DrivePublicLinkList({
  error,
  loading,
  publications,
  shares,
  onPublicationDeployed,
  onReload,
}: {
  readonly error: string | null
  readonly loading: boolean
  readonly publications: readonly DrivePublicationDto[]
  readonly shares: readonly DriveShareListItemDto[]
  readonly onPublicationDeployed: (publication: DrivePublicationSuccessState) => void
  readonly onReload: () => Promise<void>
}) {
  if (loading) return <DrivePublicationTableSkeleton />
  if (error) return <DriveDialogErrorState message={error} onRetry={onReload} />
  if (publications.length === 0 && shares.length === 0) return <DriveDialogEmptyState title="暂无公开链接" />

  return (
    <div className="grid gap-3">
      {shares.length > 0 ? (
        <section className="grid gap-2">
          <h3 className="text-sm font-medium">分享</h3>
          <DriveShareList error={null} items={shares} loading={false} onReload={onReload} />
        </section>
      ) : null}
      {publications.length > 0 ? (
        <section className="grid gap-2">
          <h3 className="text-sm font-medium">发布</h3>
          <DrivePublicationList
            error={null}
            items={publications}
            loading={false}
            onPublicationDeployed={onPublicationDeployed}
            onReload={onReload}
          />
        </section>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 9: Keep old dialog components private but unused**

After the new dialog passes tests, remove `DriveSharesDialog` and `DrivePublicationsDialog` if TypeScript reports they are unused. Keep `DriveShareList`, `DrivePublicationList`, action components, skeletons, and helpers because the new dialog reuses them.

- [ ] **Step 10: Run focused desktop tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/drive/__tests__/drive-module.test.tsx
```

Expected: PASS.

- [ ] **Step 11: Run desktop typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 12: Commit desktop UI**

```bash
git add desktop/src/modules/drive/index.tsx desktop/src/modules/drive/__tests__/drive-module.test.tsx
git commit -m "feat(drive): simplify desktop drive actions"
```

---

## Task 3: Shared Markdown Preview Contract Tests

**Files:**
- Modify: `shared/src/drive.ts`
- Modify: `server/src/drive/drive-browser.spec.ts`
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.test.ts`

- [ ] **Step 1: Extend the shared preview DTO**

In `shared/src/drive.ts`, change `DriveBrowserPreviewDto` to:

```ts
export interface DriveBrowserPreviewDto {
  readonly kind: DriveBrowserPreviewKind
  readonly text: string | null
  readonly html: string | null
  readonly truncated: boolean
  readonly imageUrl: string | null
  readonly visitUrl: string | null
}
```

- [ ] **Step 2: Update server helper tests for Markdown**

In `server/src/drive/drive-browser.spec.ts`, replace `adds owner-only visit url for markdown previews` with:

```ts
it("keeps owner markdown previews in the browser without visit url", () => {
  const item = { ...baseItem, id: "child-1", name: "notes.md", mimeType: "text/markdown" }
  const preview = buildDriveBrowserPreview({
    item,
    route: { context: "owner", surface: "standalone", rootItemId: "root-1" },
    text: "# Notes",
    html: "<h1>Notes</h1>",
  })

  expect(preview.kind).toBe("markdown")
  expect(preview.text).toBe("# Notes")
  expect(preview.html).toBe("<h1>Notes</h1>")
  expect(preview.visitUrl).toBeNull()
})
```

Update the share Markdown test to include HTML:

```ts
expect(preview.html).toBe("<h1>Notes</h1>")
expect(preview.visitUrl).toBeNull()
```

- [ ] **Step 3: Update dashboard view-model tests**

In `dashboard/src/features/drive-browser/drive-browser-page.test.ts`, replace `shows visit for owner markdown previews` with:

```ts
it('does not show visit for owner markdown previews', () => {
  const snapshot = createSnapshot({
    current: {
      ...baseCurrent(),
      name: 'notes.md',
      mimeType: 'text/markdown',
      previewKind: 'markdown',
    },
    preview: {
      ...basePreview(),
      kind: 'markdown',
      text: '# Notes',
      html: '<h1>Notes</h1>',
      visitUrl: null,
    },
  })

  expect(getDriveBrowserActions(snapshot)).toMatchObject({
    downloadUrl: '/drive/items/root/items/file/download',
    visitUrl: null,
  })
})
```

Update `basePreview()` to include:

```ts
html: null,
```

- [ ] **Step 4: Run tests and verify expected failures**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/drive/drive-browser.spec.ts
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/drive-browser-page.test.ts
```

Expected: FAIL because `html` is not populated yet and owner Markdown still receives a visit URL.

- [ ] **Step 5: Commit failing contract tests**

```bash
git add shared/src/drive.ts server/src/drive/drive-browser.spec.ts dashboard/src/features/drive-browser/drive-browser-page.test.ts
git commit -m "test(drive): capture markdown browser preview contract"
```

---

## Task 4: Server Markdown Preview Rendering

**Files:**
- Modify: `server/src/drive/drive-markdown-renderer.ts`
- Modify: `server/src/drive/drive-markdown-renderer.spec.ts`
- Modify: `server/src/drive/drive-browser.ts`
- Modify: `server/src/drive/drive.service.ts`
- Modify: `server/src/drive/drive.service.spec.ts`

- [ ] **Step 1: Add fragment renderer tests**

In `server/src/drive/drive-markdown-renderer.spec.ts`, add:

```ts
it("renders a sanitized markdown fragment for embedded previews", async () => {
  const html = await renderDriveMarkdownFragment([
    "# Notes",
    "",
    "<script>alert(1)</script>",
    "",
    '<img src="x" onerror="alert(1)">',
  ].join("\n"))

  expect(html).toContain("<h1>Notes</h1>")
  expect(html).not.toContain("<script>")
  expect(html).not.toContain("onerror")
  expect(html).toContain("script&gt;alert(1)")
})
```

Update the import:

```ts
import { renderDriveMarkdownDocument, renderDriveMarkdownFragment } from "./drive-markdown-renderer"
```

- [ ] **Step 2: Implement the fragment renderer**

In `server/src/drive/drive-markdown-renderer.ts`, export:

```ts
export async function renderDriveMarkdownFragment(markdown: string): Promise<string> {
  return renderMarkdownBody(markdown)
}
```

Keep `renderDriveMarkdownDocument()` unchanged except that it continues to call `renderMarkdownBody()`.

- [ ] **Step 3: Extend buildDriveBrowserPreview**

In `server/src/drive/drive-browser.ts`, change the input type:

```ts
export function buildDriveBrowserPreview(input: {
  readonly item: DriveBrowserSourceItem
  readonly route: DriveBrowserRouteContext
  readonly text?: string | null
  readonly html?: string | null
  readonly truncated?: boolean
  readonly imageUrl?: string | null
}): DriveBrowserPreviewDto {
```

Return `html` and restrict `visitUrl` to owner HTML only:

```ts
return {
  kind,
  text: textPreview ? input.text ?? "" : null,
  html: kind === "markdown" ? input.html ?? null : null,
  truncated: textPreview ? input.truncated ?? false : false,
  imageUrl: kind === "image" ? input.imageUrl ?? null : null,
  visitUrl: input.route.context === "owner" && kind === "html-source"
    ? buildRenderUrl(input.route, input.item.id)
    : null,
}
```

- [ ] **Step 4: Render Markdown HTML in browser previews**

In `server/src/drive/drive.service.ts`, import:

```ts
import { renderDriveMarkdownDocument, renderDriveMarkdownFragment } from "./drive-markdown-renderer"
```

In `buildBrowserPreview`, replace the text-preview branch with:

```ts
if (shouldReadDriveBrowserTextPreview(kind)) {
  const preview = await this.readTextPreview(storageKey)
  if (kind === "markdown") {
    const html = await renderDriveMarkdownFragment(preview.text)
    return buildDriveBrowserPreview({
      item,
      route,
      text: preview.text,
      html,
      truncated: preview.truncated,
    })
  }
  return buildDriveBrowserPreview({ item, route, text: preview.text, truncated: preview.truncated })
}
```

- [ ] **Step 5: Update service tests for owner Markdown preview**

In `server/src/drive/drive.service.spec.ts`, rename `builds owner browser snapshots with markdown visit urls` to `builds owner browser snapshots with rendered markdown previews` and change the assertion to:

```ts
expect(snapshot.preview).toMatchObject({
  kind: "markdown",
  text: "# Notes",
  html: expect.stringContaining("<h1>Notes</h1>"),
  visitUrl: null,
})
```

- [ ] **Step 6: Add share Markdown service test**

Add this test near the owner Markdown browser snapshot test:

```ts
it("builds share browser snapshots with rendered markdown previews", async () => {
  const prisma = createPrismaMemory()
  const storage: DriveStoragePort = {
    ...storageMock,
    getObjectStream: vi.fn(async () => ({ stream: Readable.from("# Shared"), size: 8n, contentType: "text/markdown" })),
  }
  const service = new DriveService(prisma as unknown as PrismaService, storage)
  await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
  const file = await createCompletedUpload(service, "user-1", {
    parentId: null,
    name: "shared.md",
    mimeType: "text/markdown",
  })
  const share = await service.shareItem("user-1", file.id, "https://synapse.test", {
    passwordEnabled: false,
    expiresIn: "3d",
  })

  const snapshot = await service.getShareBrowserSnapshot({ shareId: share.shareId })

  expect(snapshot.context).toBe("share")
  expect(snapshot.preview).toMatchObject({
    kind: "markdown",
    text: "# Shared",
    html: expect.stringContaining("<h1>Shared</h1>"),
    visitUrl: null,
  })
})
```

- [ ] **Step 7: Run server tests**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/drive/drive-markdown-renderer.spec.ts src/drive/drive-browser.spec.ts src/drive/drive.service.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit server Markdown preview support**

```bash
git add shared/src/drive.ts server/src/drive/drive-markdown-renderer.ts server/src/drive/drive-markdown-renderer.spec.ts server/src/drive/drive-browser.ts server/src/drive/drive.service.ts server/src/drive/drive-browser.spec.ts server/src/drive/drive.service.spec.ts
git commit -m "feat(drive): render markdown in browser previews"
```

---

## Task 5: Dashboard Markdown Preview UI

**Files:**
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.tsx`
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.test.ts`

- [ ] **Step 1: Add preview-mode tests**

In `dashboard/src/features/drive-browser/drive-browser-page.test.ts`, import renderer helpers if they are not already present:

```ts
import { renderToStaticMarkup } from 'react-dom/server'
import { DriveBrowserView } from './drive-browser-page'
```

Add:

```ts
it('renders markdown html by default in the browser preview', () => {
  const snapshot = createSnapshot({
    current: {
      ...baseCurrent(),
      name: 'notes.md',
      mimeType: 'text/markdown',
      previewKind: 'markdown',
    },
    preview: {
      ...basePreview(),
      kind: 'markdown',
      text: '# Notes',
      html: '<h1>Notes</h1>',
      visitUrl: null,
    },
  })

  const html = renderToStaticMarkup(<DriveBrowserView snapshot={snapshot} />)

  expect(html).toContain('<h1>Notes</h1>')
  expect(html).toContain('源码')
  expect(html).not.toContain('访问')
})
```

- [ ] **Step 2: Implement Markdown preview mode**

In `dashboard/src/features/drive-browser/drive-browser-page.tsx`, change the import:

```tsx
import { useMemo, useState } from 'react'
```

Replace the final text-preview return branch in `DriveBrowserPreview` with:

```tsx
if (preview.kind === 'markdown') {
  return <DriveMarkdownPreview preview={preview} />
}
return <DriveSourcePreview preview={preview} />
```

Add these components below `DriveBrowserPreview`:

```tsx
function DriveMarkdownPreview({ preview }: { readonly preview: DriveBrowserPreviewDto }) {
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered')
  const renderedHtml = useMemo(() => ({ __html: preview.html ?? '' }), [preview.html])
  const canRender = Boolean(preview.html)

  return (
    <div className='flex h-[520px] flex-col'>
      <div className='flex items-center justify-end gap-1 border-b px-4 py-2'>
        <Button
          type='button'
          variant={mode === 'rendered' ? 'secondary' : 'ghost'}
          size='sm'
          disabled={!canRender}
          onClick={() => setMode('rendered')}
        >
          预览
        </Button>
        <Button
          type='button'
          variant={mode === 'source' ? 'secondary' : 'ghost'}
          size='sm'
          onClick={() => setMode('source')}
        >
          源码
        </Button>
      </div>
      {mode === 'rendered' && canRender ? (
        <ScrollArea className='min-h-0 flex-1'>
          <article className='max-w-none space-y-3 p-4 text-sm leading-7' dangerouslySetInnerHTML={renderedHtml} />
        </ScrollArea>
      ) : (
        <DriveSourcePreview preview={preview} />
      )}
    </div>
  )
}

function DriveSourcePreview({ preview }: { readonly preview: DriveBrowserPreviewDto }) {
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
```

- [ ] **Step 3: Keep HTML source behavior unchanged**

Verify the HTML source tests still pass:

```ts
expect(getDriveBrowserActions(snapshot)).toMatchObject({
  downloadUrl: '/drive/items/root/items/file/download',
  visitUrl: '/drive/items/root/items/file/render',
})
```

- [ ] **Step 4: Run dashboard tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/drive-browser-page.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run dashboard typecheck**

Run:

```bash
pnpm --filter @synapse/dashboard run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit dashboard preview UI**

```bash
git add dashboard/src/features/drive-browser/drive-browser-page.tsx dashboard/src/features/drive-browser/drive-browser-page.test.ts
git commit -m "feat(drive): show rendered markdown previews"
```

---

## Task 6: Release Notes And Final Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add this bullet under the user-facing pending section:

```md
- 云盘主界面更清爽了：查看文件统一改为“打开”，分享和发布管理合并到“公开链接”，Markdown 文件自己看和分享给别人看时默认显示渲染后的内容。
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/drive/__tests__/drive-module.test.tsx
pnpm --filter @synapse/server exec vitest run src/drive/drive-markdown-renderer.spec.ts src/drive/drive-browser.spec.ts src/drive/drive.service.spec.ts
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/drive-browser-page.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run package typechecks**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/dashboard run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run hard constraints if Electron files changed**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS. This change should not add bare `ipcMain`, `webContents.send`, server bindings, or business-data `fs.writeFile`.

- [ ] **Step 5: Commit final notes**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note drive simplification"
```

---

## Self-Review

- Spec coverage:
  - Main Drive action simplification: Tasks 1 and 2.
  - Public links center: Tasks 1 and 2.
  - Markdown rendered by default for owner/share: Tasks 3, 4, and 5.
  - HTML owner-only access unchanged: Tasks 3, 4, and 5 preserve HTML `visitUrl`.
  - Share browser no owner-only access: existing tests remain plus Task 3 updates Markdown to no `visitUrl`.
  - Release note: Task 6.
- Scope:
  - This plan avoids a broad module split and keeps the first implementation surgical.
  - It does not implement Office/PDF/audio/video preview, access stats, transfer, or team drive features.
- Type consistency:
  - `DriveBrowserPreviewDto.html` is added in shared and populated by server before dashboard reads it.
  - Markdown `visitUrl` is removed from server preview generation and dashboard action tests.
