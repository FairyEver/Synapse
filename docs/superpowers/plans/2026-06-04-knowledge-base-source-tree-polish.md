# Knowledge Base Source Tree Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Knowledge Base source manager left folder tree compact, precise about leaf folders, and able to rename/delete folders from a tree context menu.

**Architecture:** Keep the change inside the existing renderer source manager module. Extend the renderer tree cache with a checked-directory set, preload one level of root child folders through the existing `listRawDirectory` bridge method, and reuse the existing rename/trash mutation flows for tree context actions.

**Tech Stack:** React 19, TypeScript, shadcn/Radix UI, lucide-react, Vitest jsdom, existing Synapse preload bridge.

---

## File Structure

- Modify `desktop/src/modules/knowledge-base/source-manager-window.tsx`
  - Add `ContextMenu` imports.
  - Add checked-directory tracking and one-level root folder preloading.
  - Replace the loose recursive tree renderer with a compact depth-aware renderer.
  - Add tree-folder context menu actions for rename and delete.
- Modify `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`
  - Add focused tests for one-level preload, leaf arrow hiding, and tree context menu actions.
  - Add small DOM helpers for context menu interaction.
- Modify `RELEASE_NOTES_PENDING.md`
  - Add one user-facing optimization note.

No Electron service, IPC, preload, shared type, raw manager, manifest, wiki, Agent, Scheduler, or Workflow files should change.

## Task 1: Tests For Tree Preload And Leaf Arrows

**Files:**
- Modify: `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`

- [ ] **Step 1: Add focused tests before the existing tree tests**

Add these tests near `opens folders from the left file tree`:

```tsx
  it("preloads one root child level for the folder tree", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenCalledWith({
        projectId: "project-1",
        directoryPath: "2026",
      })
      expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenCalledWith({
        projectId: "project-1",
        directoryPath: "客户",
      })
    })
  })

  it("hides expand actions for checked folders without child folders", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenCalledWith({
        projectId: "project-1",
        directoryPath: "客户",
      })
    })

    expect(document.querySelector('[aria-label="展开 2026"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="展开 客户"]')).toBeNull()
  })
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: FAIL. The preload test should fail because `客户` is not listed until opened/expanded, and the leaf-arrow test should fail because the current tree renders `展开 客户`.

- [ ] **Step 3: Commit the failing tests**

```bash
git add desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
git commit -m "test: cover knowledge base source tree preload"
```

## Task 2: Implement One-Level Preload And Compact Arrow Rules

**Files:**
- Modify: `desktop/src/modules/knowledge-base/source-manager-window.tsx`

- [ ] **Step 1: Update local tree types and add helpers**

Change the tree renderer type and add depth/arrow helpers near the existing local helpers:

```tsx
type TreeRenderer = (items: SynapseKnowledgeBaseRawEntry[], depth?: number) => ReactNode
```

Add:

```tsx
const TREE_DEPTH_PADDING = [
  "pl-0",
  "pl-3",
  "pl-6",
  "pl-9",
  "pl-12",
  "pl-14",
] as const

function treeDepthPadding(depth: number): string {
  return TREE_DEPTH_PADDING[Math.min(depth, TREE_DEPTH_PADDING.length - 1)]
}

function shouldShowTreeDisclosure(
  entry: SynapseKnowledgeBaseRawEntry,
  tree: DirectoryTree,
  checkedDirectories: Set<string>,
  loadingDirectories: Set<string>,
): boolean {
  if (loadingDirectories.has(entry.relativePath)) return true
  if ((tree[entry.relativePath] ?? []).length > 0) return true
  return !checkedDirectories.has(entry.relativePath)
}
```

- [ ] **Step 2: Track checked tree directories**

Inside `KnowledgeBaseSourceManagerWindow`, add state and ref next to existing tree state:

```tsx
  const [checkedTreeDirectories, setCheckedTreeDirectories] = useState<Set<string>>(() => new Set())
  const checkedTreeDirectoriesRef = useRef<Set<string>>(new Set())
```

Add a setter helper after `setTreeDirectoryLoading`:

```tsx
  const markTreeDirectoryChecked = useCallback((directoryPath: string) => {
    const next = new Set(checkedTreeDirectoriesRef.current)
    next.add(directoryPath)
    checkedTreeDirectoriesRef.current = next
    setCheckedTreeDirectories(next)
  }, [])
```

- [ ] **Step 3: Mark listed directories checked**

In `refreshDirectory`, after updating `directoryTree`, mark the current directory checked:

```tsx
      setDirectoryTree((previous) => ({
        ...previous,
        [currentDirectory]: directoriesOnly(result.entries),
      }))
      markTreeDirectoryChecked(currentDirectory)
```

Add `markTreeDirectoryChecked` to the `refreshDirectory` dependency list.

In `refreshTreeDirectories`, after results are stored, mark each successful directory checked:

```tsx
      setDirectoryTree((previous) => {
        const next = { ...previous }
        for (const [directoryPath, childDirectories] of results) {
          next[directoryPath] = childDirectories
        }
        return next
      })
      for (const [directoryPath] of results) {
        markTreeDirectoryChecked(directoryPath)
      }
```

Add `markTreeDirectoryChecked` to the `refreshTreeDirectories` dependency list.

In `loadTreeDirectory`, after storing the directory children, mark that directory checked:

```tsx
      setDirectoryTree((previous) => ({
        ...previous,
        [directoryPath]: directoriesOnly(result.entries),
      }))
      markTreeDirectoryChecked(directoryPath)
```

Add `markTreeDirectoryChecked` to the `loadTreeDirectory` dependency list.

- [ ] **Step 4: Preload one root child level**

Add this effect after the existing `useEffect(() => { void refreshDirectory() }, [refreshDirectory])`:

```tsx
  useEffect(() => {
    if (!payload || !bridge) return
    const rootDirectories = directoryTree[""] ?? []
    const pathsToPreload = rootDirectories
      .map((entry) => entry.relativePath)
      .filter((directoryPath) =>
        !hasDirectoryCache(directoryTree, directoryPath)
        && !checkedTreeDirectoriesRef.current.has(directoryPath)
        && !loadingDirectoriesRef.current.has(directoryPath)
      )
    if (pathsToPreload.length === 0) return
    void refreshTreeDirectories(pathsToPreload)
  }, [bridge, directoryTree, payload, refreshTreeDirectories])
```

- [ ] **Step 5: Compact the tree renderer and hide leaf arrows**

Replace `renderTreeItems` with this shape:

```tsx
  const renderTreeItems = useCallback((items: SynapseKnowledgeBaseRawEntry[], depth = 1) => (
    <div className="flex flex-col gap-0.5">
      {items.map((entry) => {
        const isExpanded = expandedDirectories.has(entry.relativePath)
        const isLoadingDirectory = loadingDirectories.has(entry.relativePath)
        const childItems = directoryTree[entry.relativePath] ?? []
        const showDisclosure = shouldShowTreeDisclosure(
          entry,
          directoryTree,
          checkedTreeDirectories,
          loadingDirectories,
        )
        return (
          <div key={entry.relativePath} className="flex flex-col gap-0.5">
            <div className={cn("flex items-center gap-1", treeDepthPadding(depth))}>
              {showDisclosure ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => toggleTreeDirectory(entry.relativePath)}
                  aria-label={`${isExpanded ? "折叠" : "展开"} ${entry.name}`}
                >
                  {isExpanded ? <ChevronDown /> : <ChevronRight />}
                </Button>
              ) : (
                <span className="size-7 shrink-0" aria-hidden="true" />
              )}
              <Button
                type="button"
                variant={currentDirectory === entry.relativePath ? "secondary" : "ghost"}
                size="sm"
                className="h-7 min-w-0 flex-1 justify-start"
                data-raw-drop-target={entry.relativePath}
                onClick={() => openTreeDirectory(entry.relativePath)}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  markInternalRawDropTarget(event.dataTransfer)
                  if (internalDragPaths.length > 0) {
                    setInternalDropTarget(entry.relativePath)
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void dropInternalDrag(entry.relativePath, event)
                }}
                aria-label={`打开树文件夹 ${entry.name}`}
              >
                <Folder data-icon="inline-start" />
                <span className="truncate">{entry.name}</span>
              </Button>
            </div>
            {isExpanded && isLoadingDirectory ? (
              <div className={cn("px-2 py-1 text-xs text-muted-foreground", treeDepthPadding(depth + 1))}>读取中</div>
            ) : null}
            {isExpanded && childItems.length > 0 ? renderTreeItems(childItems, depth + 1) : null}
          </div>
        )
      })}
    </div>
  ), [
    checkedTreeDirectories,
    currentDirectory,
    directoryTree,
    dropInternalDrag,
    expandedDirectories,
    internalDragPaths.length,
    loadingDirectories,
    openTreeDirectory,
    toggleTreeDirectory,
  ])
```

Keep `renderMoveTreeItems` unchanged in this task; the move dialog is not part of the approved left-tree polish.

- [ ] **Step 6: Run the focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: PASS for the new preload/leaf tests and existing source manager tests.

- [ ] **Step 7: Commit implementation**

```bash
git add desktop/src/modules/knowledge-base/source-manager-window.tsx
git commit -m "fix: polish knowledge base source tree disclosure"
```

## Task 3: Tree Context Menu Tests And Implementation

**Files:**
- Modify: `desktop/src/modules/knowledge-base/source-manager-window.tsx`
- Modify: `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`

- [ ] **Step 1: Add test helpers**

Add these helpers below `buttonByText`:

```tsx
function openContextMenuOnButton(label: string): void {
  buttonByLabel(label).dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
  }))
}

function menuItemByText(text: string): HTMLElement {
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!item) throw new Error(`Menu item not found: ${text}`)
  return item
}
```

- [ ] **Step 2: Add failing context menu tests**

Add these tests near the tree tests:

```tsx
  it("renames folders from the left file tree context menu", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).toContain("客户")
    })

    await act(async () => {
      openContextMenuOnButton("打开树文件夹 客户")
      await Promise.resolve()
    })
    await act(async () => {
      menuItemByText("重命名").click()
      await Promise.resolve()
    })

    const input = document.querySelector<HTMLInputElement>('input[placeholder="新名称"]')
    expect(input).not.toBeNull()
    act(() => {
      changeInput(input!, "客户资料")
    })
    await act(async () => {
      buttonByLabel("确认重命名").click()
      await Promise.resolve()
    })

    expect(bridgeMocks.knowledgeBase.renameRawEntry).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePath: "客户",
      newName: "客户资料",
    })
  })

  it("deletes folders from the left file tree context menu", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).toContain("客户")
    })

    await act(async () => {
      openContextMenuOnButton("打开树文件夹 客户")
      await Promise.resolve()
    })
    await act(async () => {
      menuItemByText("删除").click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("移到废纸篓？")

    await act(async () => {
      buttonByLabel("确认移到废纸篓").click()
      await Promise.resolve()
    })

    expect(bridgeMocks.knowledgeBase.trashRawEntries).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePaths: ["客户"],
    })
  })
```

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: FAIL because tree rows are not wrapped in `ContextMenu` yet.

- [ ] **Step 4: Import context menu primitives**

In `source-manager-window.tsx`, add:

```tsx
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
```

- [ ] **Step 5: Add tree menu callbacks to sidebar props**

Extend `SourceManagerSidebarProps`:

```tsx
type SourceManagerSidebarProps = {
  currentDirectory: string
  rootItems: SynapseKnowledgeBaseRawEntry[]
  renderTreeItems: TreeRenderer
  onOpenRoot: () => void
}
```

No root menu callback is needed. The root `资料` button stays outside tree context menus.

- [ ] **Step 6: Wrap tree folder rows in a context menu**

In `renderTreeItems`, replace the folder `Button` with a `ContextMenu` wrapper:

```tsx
              <ContextMenu data-track="knowledge-base-source-tree-folder-menu">
                <ContextMenuTrigger asChild>
                  <Button
                    type="button"
                    variant={currentDirectory === entry.relativePath ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 min-w-0 flex-1 justify-start"
                    data-raw-drop-target={entry.relativePath}
                    onClick={() => openTreeDirectory(entry.relativePath)}
                    onDragOver={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      markInternalRawDropTarget(event.dataTransfer)
                      if (internalDragPaths.length > 0) {
                        setInternalDropTarget(entry.relativePath)
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      void dropInternalDrag(entry.relativePath, event)
                    }}
                    aria-label={`打开树文件夹 ${entry.name}`}
                  >
                    <Folder data-icon="inline-start" />
                    <span className="truncate">{entry.name}</span>
                  </Button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => openRenameDialog(entry)}>
                    <Pencil />
                    重命名
                  </ContextMenuItem>
                  <ContextMenuItem variant="destructive" onSelect={() => setTrashPaths([entry.relativePath])}>
                    <Trash2 />
                    删除
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
```

Add `openRenameDialog` and `setTrashPaths` to the `renderTreeItems` dependency list.

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit tests and implementation**

```bash
git add desktop/src/modules/knowledge-base/source-manager-window.tsx desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
git commit -m "feat: add source tree folder context actions"
```

## Task 4: Release Notes And Final Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Under `## 功能优化`, add:

```markdown
- 知识库资料管理的左侧文件夹树更紧凑，空文件夹不再显示展开箭头，并支持右键重命名和删除文件夹。
```

- [ ] **Step 2: Run focused renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Commit release note**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note knowledge base source tree polish"
```

## Self-Review

- Spec coverage: compact tree, one-level preload, leaf arrow hiding, tree rename/delete, no Electron/API changes, sparse copy, and release notes are covered by Tasks 1-4.
- Placeholder scan: no placeholders or deferred edge handling remain in this plan.
- Type consistency: all snippets use existing `SynapseKnowledgeBaseRawEntry`, `DirectoryTree`, `listRawDirectory`, `renameRawEntry`, and `trashRawEntries` names from the current module and tests.
