# Drive Single File Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Drive file pages render as a focused single-file reader while keeping folder pages in the existing browser split layout.

**Architecture:** Reuse the existing `DriveSingleFileReaderView` and change the layout predicate from share-file-only to all file snapshots. Add a small metadata row to the reader header using existing formatter helpers so file identity and actions live in the header instead of a side panel.

**Tech Stack:** React, TypeScript, TanStack Router, shadcn/Radix UI, Tailwind utilities, Vitest.

---

## File Structure

- Modify `dashboard/src/features/drive-browser/drive-browser-page.tsx`: update the reader predicate, add reader header metadata, and keep existing folder split layout untouched.
- Modify `dashboard/src/features/drive-browser/drive-browser-page.test.ts`: add red/green tests for owner files using the single reader and for metadata in the reader header.
- Modify `RELEASE_NOTES_PENDING.md`: add a user-facing pending release note for the Drive reader layout change.

## Task 1: Lock File Reader Behavior With Tests

**Files:**
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.test.ts`

- [ ] **Step 1: Write the failing tests**

Add one test that expects owner files to use the single-file reader predicate, and one render test that expects an owner Markdown file reader to omit the split browser chrome and include file metadata.

```ts
  it('uses the single file reader for owner and shared files', () => {
    const sharedFile = createSnapshot({ context: 'share' })
    const sharedFolder = createSnapshot({
      context: 'share',
      current: { ...baseCurrent(), type: 'folder' },
    })
    const ownerFile = createSnapshot({ context: 'owner' })
    const ownerFolder = createSnapshot({
      context: 'owner',
      current: { ...baseCurrent(), type: 'folder' },
    })

    expect(shouldRenderDriveSingleFileReader(sharedFile)).toBe(true)
    expect(shouldRenderDriveSingleFileReader(sharedFolder)).toBe(false)
    expect(shouldRenderDriveSingleFileReader(ownerFile)).toBe(true)
    expect(shouldRenderDriveSingleFileReader(ownerFolder)).toBe(false)
  })

  it('renders owner markdown files as a reader with header metadata', () => {
    const snapshot = createSnapshot({
      context: 'owner',
      current: {
        ...baseCurrent(),
        name: 'notes.md',
        size: '7372',
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

    const html = renderToStaticMarkup(createElement(DriveSingleFileReaderView, { snapshot }))

    expect(html).toContain('data-reader-toolbar="true"')
    expect(html).toContain('notes.md')
    expect(html).toContain('7.2 KB')
    expect(html).toContain('Markdown')
    expect(html).toContain('href="/drive/items/root/items/file/download"')
    expect(html).toContain('<h1>Notes</h1>')
    expect(html).not.toContain('data-slot="resizable-panel-group"')
  })
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm --filter @synapse/dashboard test -- drive-browser-page.test.ts
```

Expected: the predicate test fails because owner files currently return `false`, and the metadata expectation fails because the reader header does not yet render size/kind metadata.

## Task 2: Implement The Single Reader Layout

**Files:**
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.tsx`

- [ ] **Step 1: Change the reader predicate**

Replace:

```ts
export function shouldRenderDriveSingleFileReader(snapshot: DriveBrowserSnapshotDto): boolean {
  return snapshot.context === 'share' && snapshot.current.type === 'file'
}
```

With:

```ts
export function shouldRenderDriveSingleFileReader(snapshot: DriveBrowserSnapshotDto): boolean {
  return snapshot.current.type === 'file'
}
```

- [ ] **Step 2: Add compact reader metadata**

Inside `DriveSingleFileReaderView`, under the filename row, add a muted metadata row that uses existing helpers:

```tsx
            <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
              <span>{formatDriveBrowserSize(snapshot.current)}</span>
              <span>{driveBrowserKindLabel(snapshot.current.previewKind)}</span>
              <span>{formatDriveBrowserDate(snapshot.current.updatedAt)}</span>
            </div>
```

Keep breadcrumbs only when they are useful:

```tsx
            {snapshot.breadcrumbs.length > 1 ? (
              <DriveBrowserBreadcrumbs snapshot={snapshot} />
            ) : null}
```

- [ ] **Step 3: Run the focused test to verify it passes**

Run:

```bash
pnpm --filter @synapse/dashboard test -- drive-browser-page.test.ts
```

Expected: all tests in `drive-browser-page.test.ts` pass.

## Task 3: Add Release Note And Final Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add the release note**

Add a concise user-facing bullet:

```md
- 网盘里直接打开文件时会进入更专注的阅读布局，顶部保留文件信息和下载操作，正文区域不再显示多余的左右分栏。
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm --filter @synapse/dashboard test -- drive-browser-page.test.ts
```

Expected: all tests in `drive-browser-page.test.ts` pass.

- [ ] **Step 3: Review the diff**

Run:

```bash
git diff -- dashboard/src/features/drive-browser/drive-browser-page.tsx dashboard/src/features/drive-browser/drive-browser-page.test.ts RELEASE_NOTES_PENDING.md
```

Expected: diff only changes the reader predicate, reader header metadata, focused tests, and release note.
