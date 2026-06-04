# Knowledge Base Source List Lightweight Hover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Knowledge Base source manager list lighter and easier to use by replacing dividers with row hover surfaces and making directory rows clickable.

**Architecture:** Keep the change local to `SourceEntryList` in the source manager window. Add row-level directory click handling and stop propagation on child controls so selection and menus remain independent. Verify behavior through focused jsdom renderer tests.

**Tech Stack:** React, TypeScript, Tailwind token classes, shadcn/Radix UI, Vitest with jsdom.

---

## File Structure

- Modify `desktop/src/modules/knowledge-base/source-manager-window.tsx`: update source row layout classes, directory row click handling, and child event propagation.
- Modify `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`: add focused interaction tests for row click and child-control interception.
- Modify `RELEASE_NOTES_PENDING.md`: record the user-visible source list usability improvement.

### Task 1: Add Failing Row Interaction Tests

**Files:**
- Modify: `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`

- [x] **Step 1: Write failing tests**

Add tests near the existing selection tests:

```tsx
it("opens a directory when clicking the empty area of its row", async () => {
  renderWindow()

  await waitForExpectation(() => {
    expect(document.body.textContent).toContain("brief.md")
  })

  const row = document.querySelector<HTMLElement>('[data-raw-path="客户"]')
  if (!row) throw new Error("Directory row missing")

  await act(async () => {
    row.click()
    await Promise.resolve()
  })

  expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenLastCalledWith({
    projectId: "project-1",
    directoryPath: "客户",
  })
})

it("does not open a directory when clicking its selection checkbox", async () => {
  renderWindow()

  await waitForExpectation(() => {
    expect(document.body.textContent).toContain("brief.md")
  })

  await act(async () => {
    buttonByLabel("选择 客户").click()
    await Promise.resolve()
  })

  expect(document.body.textContent).toContain("已选择 1 项")
  expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenLastCalledWith({
    projectId: "project-1",
    directoryPath: "",
  })
})

it("does not open a directory when clicking its row action button", async () => {
  renderWindow()

  await waitForExpectation(() => {
    expect(document.body.textContent).toContain("brief.md")
  })

  await act(async () => {
    buttonByLabel("更多 客户").click()
    await Promise.resolve()
  })

  expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenLastCalledWith({
    projectId: "project-1",
    directoryPath: "",
  })
})
```

- [x] **Step 2: Run the tests and verify failure**

Run:

```bash
pnpm --dir desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx --testNamePattern "opens a directory when clicking the empty area|does not open a directory when clicking its selection checkbox|does not open a directory when clicking its row action button"
```

Expected: the empty-area row click test fails because the current row has no row-level directory click handler.

### Task 2: Implement Lightweight Row Treatment

**Files:**
- Modify: `desktop/src/modules/knowledge-base/source-manager-window.tsx`

- [x] **Step 1: Update source rows**

Change `SourceEntryList` so the list uses a stacked layout, directory rows have a row click handler, and child controls stop propagation:

```tsx
<div role="list" aria-label="资料列表" className="flex flex-col gap-1">
  {entries.map((entry) => {
    const selected = selectedPaths.has(entry.relativePath)
    const isDirectory = entry.kind === "directory"
    return (
      <div
        key={entry.relativePath}
        role="listitem"
        className={cn(
          "grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-muted",
          isDirectory && "cursor-pointer",
          internalDropTarget === entry.relativePath && "bg-muted",
        )}
        onClick={isDirectory ? () => onOpenDirectory(entry.relativePath) : undefined}
      >
        <div onClick={(event) => event.stopPropagation()}>
          <Checkbox
            aria-label={`选择 ${entry.name}`}
            checked={selected}
            onCheckedChange={(checked) => onToggleSelected(entry.relativePath, checked === true)}
          />
        </div>
        {/* existing icon/text block */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label={`更多 ${entry.name}`}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          {/* existing menu content */}
        </DropdownMenu>
      </div>
    )
  })}
</div>
```

Preserve all existing drag/drop handlers and menu item callbacks.

- [x] **Step 2: Run the focused tests**

Run:

```bash
pnpm --dir desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx --testNamePattern "opens a directory when clicking the empty area|does not open a directory when clicking its selection checkbox|does not open a directory when clicking its row action button|moves one unselected entry when dragged to a folder row"
```

Expected: all selected tests pass.

### Task 3: Release Notes and Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [x] **Step 1: Add release note**

Under `## 功能优化`, add:

```markdown
- 知识库资料列表去掉了行分隔线，文件夹行现在可以点击空白区域进入，并扩大了右侧操作按钮的可点击范围。
```

- [x] **Step 2: Run the full source manager test file**

Run:

```bash
pnpm --dir desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: the full source manager test file passes.

- [x] **Step 3: Review diff**

Run:

```bash
git diff -- desktop/src/modules/knowledge-base/source-manager-window.tsx desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx RELEASE_NOTES_PENDING.md
```

Expected: the diff only contains the planned row treatment, tests, and release note.
