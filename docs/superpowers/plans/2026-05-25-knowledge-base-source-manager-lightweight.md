# Knowledge Base Source Manager Lightweight UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the Knowledge Base source manager into a lighter consumer-style file list while keeping the existing raw file manager APIs and behavior unchanged.

**Architecture:** Keep `KnowledgeBaseSourceManagerWindow` as the state owner and split the heavy JSX into local renderer-only components. Replace the table surface with list rows, move selected-state actions into an inline selection bar, and make drag-and-drop visible only during drag-over.

**Tech Stack:** Electron renderer, React, TypeScript, shadcn/Radix components, lucide-react, Vitest jsdom.

---

## File Structure

- Modify: `desktop/src/modules/knowledge-base/source-manager-window.tsx`
  - Remove the shadcn `Table` rendering from the right pane.
  - Add narrow local components in the same file: `SourceManagerSidebar`, `SourceManagerToolbar`, `SourceSelectionBar`, `SourceEntryList`.
  - Keep existing bridge calls and dialog behavior unchanged.
- Modify: `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`
  - Update tests from table-oriented copy to list-oriented copy.
  - Add coverage for hidden normal-state drag copy and inline selection bar.
- Reference: `docs/superpowers/specs/2026-05-25-knowledge-base-source-manager-lightweight-design.md`
  - Do not edit during implementation unless the approved design changes.

## Task 1: Lock The Lightweight UI Copy With Tests

**Files:**
- Modify: `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`

- [ ] **Step 1: Update the existing render test expectations**

In `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`, replace the body of `it("renders raw files as a file browser without import statuses", async () => { ... })` with:

```tsx
it("renders raw files as a lightweight file browser without import statuses", async () => {
  renderWindow()

  await waitForExpectation(() => {
    expect(document.body.textContent).toContain("brief.md")
  })

  expect(document.querySelector('[aria-label="资料文件"]')).not.toBeNull()
  expect(document.querySelector('[aria-label="文件夹树"]')).not.toBeNull()
  expect(document.querySelector('[aria-label="资料列表"]')).not.toBeNull()
  expect(document.body.textContent).toContain("资料")
  expect(document.body.textContent).toContain("客户")
  expect(document.body.textContent).toContain("上传")
  expect(document.body.textContent).not.toContain("新文件")
  expect(document.body.textContent).not.toContain("已放入")
  expect(document.body.textContent).not.toContain("粘贴网页 URL")
  expect(document.body.textContent).not.toContain("选择文件")
  expect(document.body.textContent).not.toContain("大小")
  expect(document.body.textContent).not.toContain("更新时间")
  expect(document.body.textContent).not.toContain("拖拽文件到这里上传")
  expect(document.body.textContent).not.toContain("拖拽文件到窗口")
  expect(document.body.textContent).not.toContain("已选择")
  expect(bridgeMocks.agent.createSession).not.toHaveBeenCalled()
  expect(bridgeMocks.agent.send).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Add a focused selection bar test**

After the render test, add:

```tsx
it("shows batch actions only after selecting entries", async () => {
  renderWindow()

  await waitForExpectation(() => {
    expect(document.body.textContent).toContain("brief.md")
  })

  expect(document.body.textContent).not.toContain("已选择")
  expect(document.querySelector('button[aria-label="移动所选"]')).toBeNull()

  await act(async () => {
    buttonByLabel("选择 brief.md").click()
  })

  expect(document.body.textContent).toContain("已选择 1 项")
  expect(buttonByLabel("移动所选")).not.toBeDisabled()
  expect(buttonByLabel("移到废纸篓")).not.toBeDisabled()
})
```

- [ ] **Step 3: Run the focused renderer test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx --testNamePattern "lightweight|batch actions"
```

Expected:

- The lightweight render test fails because the current UI still renders table headers `大小` and `更新时间`.
- The selection bar test may fail because batch buttons are currently rendered in the normal state.

- [ ] **Step 4: Commit the failing tests**

```bash
git add desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
git commit -m "test: cover lightweight knowledge source manager ui"
```

## Task 2: Extract Sidebar And Toolbar Components

**Files:**
- Modify: `desktop/src/modules/knowledge-base/source-manager-window.tsx`

- [ ] **Step 1: Add local prop types above `KnowledgeBaseSourceManagerWindow`**

Update the React import at the top of `desktop/src/modules/knowledge-base/source-manager-window.tsx` from:

```tsx
import { type DragEvent, useCallback, useEffect, useMemo, useState } from "react"
```

to:

```tsx
import { type DragEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
```

Then add these types after `type DirectoryTree = ...`:

```tsx
type TreeRenderer = (items: SynapseKnowledgeBaseRawEntry[]) => ReactNode

type SourceManagerSidebarProps = {
  currentDirectory: string
  rootItems: SynapseKnowledgeBaseRawEntry[]
  renderTreeItems: TreeRenderer
  onOpenRoot: () => void
}

type SourceManagerToolbarProps = {
  breadcrumbs: Array<{ label: string; path: string }>
  query: string
  onQueryChange: (query: string) => void
  onNavigate: (path: string) => void
  onCreateFolder: () => void
  onUpload: () => void
}
```

- [ ] **Step 2: Add `SourceManagerSidebar`**

Add this component above `KnowledgeBaseSourceManagerWindow`:

```tsx
function SourceManagerSidebar({
  currentDirectory,
  rootItems,
  renderTreeItems,
  onOpenRoot,
}: SourceManagerSidebarProps) {
  return (
    <aside aria-label="文件夹树" className="flex w-64 shrink-0 flex-col border-r border-border bg-muted/30 p-3">
      <div className="px-2 py-2 text-sm font-semibold">资料</div>
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          variant={currentDirectory === "" ? "secondary" : "ghost"}
          className="justify-start"
          onClick={onOpenRoot}
          aria-label="打开树文件夹 资料"
        >
          <Folder data-icon="inline-start" />
          资料
        </Button>
        {renderTreeItems(rootItems)}
      </div>
    </aside>
  )
}
```

- [ ] **Step 3: Add `SourceManagerToolbar`**

Add this component below `SourceManagerSidebar`:

```tsx
function SourceManagerToolbar({
  breadcrumbs,
  query,
  onQueryChange,
  onNavigate,
  onCreateFolder,
  onUpload,
}: SourceManagerToolbarProps) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
      <nav aria-label="当前位置" className="flex min-w-0 items-center gap-1 text-sm">
        {breadcrumbs.map((item, index) => (
          <div key={item.path || "root"} className="flex min-w-0 items-center gap-1">
            {index > 0 ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-w-0"
              onClick={() => onNavigate(item.path)}
            >
              <span className="truncate">{item.label}</span>
            </Button>
          </div>
        ))}
      </nav>
      <div className="flex shrink-0 items-center gap-2">
        <Input
          className="w-48"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索当前文件夹"
        />
        <Button type="button" variant="outline" onClick={onCreateFolder} aria-label="新建文件夹">
          <FolderPlus data-icon="inline-start" />
          新建文件夹
        </Button>
        <Button type="button" onClick={onUpload} aria-label="上传">
          <Upload data-icon="inline-start" />
          上传
        </Button>
      </div>
    </header>
  )
}
```

- [ ] **Step 4: Replace the inline sidebar JSX**

In the main `return`, replace the current `<aside aria-label="文件夹树" ...>...</aside>` block with:

```tsx
<SourceManagerSidebar
  currentDirectory={currentDirectory}
  rootItems={directoryTree[""] ?? []}
  renderTreeItems={renderTreeItems}
  onOpenRoot={() => openTreeDirectory("")}
/>
```

- [ ] **Step 5: Replace the inline header JSX**

Replace the current `<header ...>...</header>` block with:

```tsx
<SourceManagerToolbar
  breadcrumbs={breadcrumbs}
  query={query}
  onQueryChange={setQuery}
  onNavigate={setCurrentDirectory}
  onCreateFolder={() => {
    setNewFolderName("")
    setCreateFolderOpen(true)
  }}
  onUpload={chooseFiles}
/>
```

- [ ] **Step 6: Run the full source manager test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: existing tests still pass or only the intentionally failing lightweight tests from Task 1 remain failing.

- [ ] **Step 7: Commit the component extraction**

```bash
git add desktop/src/modules/knowledge-base/source-manager-window.tsx
git commit -m "refactor: split knowledge source manager shell"
```

## Task 3: Replace The Table With A Lightweight Entry List

**Files:**
- Modify: `desktop/src/modules/knowledge-base/source-manager-window.tsx`
- Modify: `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`

- [ ] **Step 1: Remove unused table imports**

Remove this import block:

```tsx
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
```

- [ ] **Step 2: Add list helper types and metadata formatter**

Add these types near the prop types from Task 2:

```tsx
type SourceSelectionBarProps = {
  selectedCount: number
  onMove: () => void
  onTrash: () => void
}

type SourceEntryListProps = {
  entries: SynapseKnowledgeBaseRawEntry[]
  isLoading: boolean
  query: string
  selectedPaths: Set<string>
  onToggleSelected: (relativePath: string, checked: boolean) => void
  onOpenDirectory: (relativePath: string) => void
  onRename: (entry: SynapseKnowledgeBaseRawEntry) => void
  onMoveEntry: (entry: SynapseKnowledgeBaseRawEntry) => void
  onTrashEntry: (entry: SynapseKnowledgeBaseRawEntry) => void
}
```

Add this helper after `formatModifiedAt`:

```tsx
function formatEntryMeta(entry: SynapseKnowledgeBaseRawEntry): string {
  const primary = entry.kind === "directory" ? "文件夹" : formatBytes(entry.size)
  return `${primary} · ${formatModifiedAt(entry.modifiedAt)}`
}
```

- [ ] **Step 3: Add `SourceSelectionBar`**

Add this component below `SourceManagerToolbar`:

```tsx
function SourceSelectionBar({ selectedCount, onMove, onTrash }: SourceSelectionBarProps) {
  if (selectedCount === 0) return null
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <div className="text-sm text-muted-foreground">已选择 {selectedCount} 项</div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onMove} aria-label="移动所选">
          <MoveRight data-icon="inline-start" />
          移动
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onTrash} aria-label="移到废纸篓">
          <Trash2 data-icon="inline-start" />
          删除
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add `SourceEntryList`**

Add this component below `SourceSelectionBar`:

```tsx
function SourceEntryList({
  entries,
  isLoading,
  query,
  selectedPaths,
  onToggleSelected,
  onOpenDirectory,
  onRename,
  onMoveEntry,
  onTrashEntry,
}: SourceEntryListProps) {
  if (entries.length === 0) {
    return (
      <Empty className="border-0 py-16">
        <EmptyHeader>
          <EmptyTitle>{isLoading ? "读取中" : query ? "没有匹配项" : "没有文件"}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div role="list" aria-label="资料列表" className="divide-y divide-border">
      {entries.map((entry) => {
        const selected = selectedPaths.has(entry.relativePath)
        return (
          <div
            key={entry.relativePath}
            role="listitem"
            className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-1 py-2"
          >
            <Checkbox
              aria-label={`选择 ${entry.name}`}
              checked={selected}
              onCheckedChange={(checked) => onToggleSelected(entry.relativePath, checked === true)}
            />
            <div className="flex min-w-0 items-center gap-3">
              {entry.kind === "directory" ? (
                <Folder className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0">
                {entry.kind === "directory" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto min-w-0 justify-start px-0 py-0 font-medium"
                    onClick={() => onOpenDirectory(entry.relativePath)}
                    aria-label={`打开文件夹 ${entry.name}`}
                  >
                    <span className="truncate">{entry.name}</span>
                  </Button>
                ) : (
                  <div className="truncate text-sm font-medium">{entry.name}</div>
                )}
                <div className="truncate text-xs text-muted-foreground">{formatEntryMeta(entry)}</div>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" aria-label={`更多 ${entry.name}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {entry.kind === "directory" ? (
                  <DropdownMenuItem onSelect={() => onOpenDirectory(entry.relativePath)}>
                    <Folder />
                    打开
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => onRename(entry)}>
                  <Pencil />
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onMoveEntry(entry)}>
                  <MoveRight />
                  移动
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => onTrashEntry(entry)}>
                  <Trash2 />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 5: Replace the right-pane table block**

Replace the block from the selected-count toolbar through the closing `</Table>` with:

```tsx
<div className="space-y-2 p-4">
  <SourceSelectionBar
    selectedCount={selectedList.length}
    onMove={() => {
      setMoveTargetPath("")
      setMoveOpen(true)
    }}
    onTrash={() => setTrashPaths(selectedList)}
  />
  <SourceEntryList
    entries={visibleEntries}
    isLoading={isLoading}
    query={query}
    selectedPaths={selectedPaths}
    onToggleSelected={toggleSelected}
    onOpenDirectory={setCurrentDirectory}
    onRename={openRenameDialog}
    onMoveEntry={(entry) => {
      setSelectedPaths(new Set([entry.relativePath]))
      setMoveTargetPath(parentPath(entry.relativePath))
      setMoveOpen(true)
    }}
    onTrashEntry={(entry) => setTrashPaths([entry.relativePath])}
  />
</div>
```

- [ ] **Step 6: Run the focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit the list redesign**

```bash
git add desktop/src/modules/knowledge-base/source-manager-window.tsx desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
git commit -m "feat: lighten knowledge source manager list"
```

## Task 4: Make Drag-Over Feedback Ephemeral

**Files:**
- Modify: `desktop/src/modules/knowledge-base/source-manager-window.tsx`
- Modify: `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`

- [ ] **Step 1: Add drag-over assertion to the drop upload test**

In `it("uploads dropped files to the current folder", ...)`, before dispatching the `drop` event, add:

```tsx
expect(dropTarget.textContent).not.toContain("拖拽文件到这里上传")
expect(dropTarget.textContent).not.toContain("拖拽文件到窗口")
```

Then add this drag-over check before the drop dispatch:

```tsx
const dragOverEvent = new Event("dragover", { bubbles: true, cancelable: true })

await act(async () => {
  dropTarget.dispatchEvent(dragOverEvent)
  await Promise.resolve()
})

expect(dropTarget.textContent).toContain("松开上传")
```

- [ ] **Step 2: Update the right-pane section class and drag-over rendering**

In `source-manager-window.tsx`, replace the current right-pane section opening:

```tsx
<section
  aria-label="拖拽上传资料"
  className={cn("min-h-0 flex-1 overflow-auto", isDragging && "bg-accent")}
>
```

with:

```tsx
<section
  aria-label="拖拽上传资料"
  className={cn("relative min-h-0 flex-1 overflow-auto", isDragging && "bg-accent/50")}
>
```

Inside the section, after the list wrapper from Task 3, add:

```tsx
{isDragging ? (
  <div className="pointer-events-none absolute inset-4 flex items-center justify-center rounded-lg border border-dashed border-border bg-background/80 text-sm text-muted-foreground">
    松开上传
  </div>
) : null}
```

The section body should now look like:

```tsx
<section
  aria-label="拖拽上传资料"
  className={cn("relative min-h-0 flex-1 overflow-auto", isDragging && "bg-accent/50")}
>
  <div className="space-y-2 p-4">
    <SourceSelectionBar
      selectedCount={selectedList.length}
      onMove={() => {
        setMoveTargetPath("")
        setMoveOpen(true)
      }}
      onTrash={() => setTrashPaths(selectedList)}
    />
    <SourceEntryList
      entries={visibleEntries}
      isLoading={isLoading}
      query={query}
      selectedPaths={selectedPaths}
      onToggleSelected={toggleSelected}
      onOpenDirectory={setCurrentDirectory}
      onRename={openRenameDialog}
      onMoveEntry={(entry) => {
        setSelectedPaths(new Set([entry.relativePath]))
        setMoveTargetPath(parentPath(entry.relativePath))
        setMoveOpen(true)
      }}
      onTrashEntry={(entry) => setTrashPaths([entry.relativePath])}
    />
  </div>
  {isDragging ? (
    <div className="pointer-events-none absolute inset-4 flex items-center justify-center rounded-lg border border-dashed border-border bg-background/80 text-sm text-muted-foreground">
      松开上传
    </div>
  ) : null}
</section>
```

- [ ] **Step 3: Run the focused drag test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx --testNamePattern "uploads dropped files"
```

Expected: PASS.

- [ ] **Step 4: Commit drag-over feedback**

```bash
git add desktop/src/modules/knowledge-base/source-manager-window.tsx desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
git commit -m "feat: show knowledge source drop state only while dragging"
```

## Task 5: Final Verification And Cleanup

**Files:**
- Modify if needed: `desktop/src/modules/knowledge-base/source-manager-window.tsx`
- Modify if needed: `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`

- [ ] **Step 1: Run the source manager test suite**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript check for desktop**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints if implementation touched imports or Electron-facing code**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git diff -- desktop/src/modules/knowledge-base/source-manager-window.tsx desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected:

- no custom color literals,
- no `style={{ ... }}`,
- no persistent `拖拽文件到这里上传` or `拖拽文件到窗口`,
- no new Electron IPC or bridge API,
- no changes outside the source manager renderer file and its tests.

- [ ] **Step 5: Final commit if cleanup changed files**

If Step 4 required cleanup, commit it:

```bash
git add desktop/src/modules/knowledge-base/source-manager-window.tsx desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
git commit -m "chore: verify knowledge source manager polish"
```

If no cleanup was needed, do not create an empty commit.
