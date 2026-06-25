# IDE Management Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the local IDE directory view out of Settings and into the IDE Management system app behind a top-level `内容 / 目录` tab.

**Architecture:** `EditorScanModule` becomes the owner of both IDE content scanning and IDE directory inspection. The app-level tab uses the existing `SystemAppWindowShell`, while directory loading and actions move into `desktop/src/modules/editor-scan/` so Settings no longer owns any IDE directory UI.

**Tech Stack:** Electron 41 preload bridge, React 19, TypeScript 6, shadcn/ui Tabs/Button/Skeleton/Empty primitives, Vitest with React DOM and server-render tests.

---

## File Structure

- Modify `desktop/src/modules/editor-scan/index.tsx`: add the App-level `内容 / 目录` tab, wrap current scan view as the `内容` view, and render directory view when selected.
- Create `desktop/src/modules/editor-scan/hooks/use-editor-directories.ts`: move directory bridge loading, create, open, retry, and notification logic out of Settings.
- Create `desktop/src/modules/editor-scan/components/editor-directories-view.tsx`: render the current selected IDE directory rows only.
- Modify `desktop/src/modules/settings/data.ts`: remove the `tools` category and unused `Blocks` icon import.
- Modify `desktop/src/modules/settings/types.ts`: remove `"tools"` from `SettingsCategoryId`.
- Modify `desktop/src/modules/settings/index.tsx`: remove `ToolsPanel` import and `activeCategory === "tools"` render branch.
- Delete `desktop/src/modules/settings/components/tools-panel.tsx`.
- Delete or leave unused only if imports remain blocked by tests: `desktop/src/modules/settings/components/editor-directories-panel.tsx`. Preferred result is delete, because directory UI moves to `editor-scan`.
- Modify `desktop/src/modules/settings/__tests__/settings-categories.test.ts`: assert `tools` and `本机IDE` are gone.
- Modify `desktop/src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx`: cover App-level tabs and directory view switching.
- Create `desktop/src/modules/editor-scan/__tests__/editor-directories-view.test.tsx`: cover current-IDE filtering and directory row actions.
- Modify `RELEASE_NOTES_PENDING.md`: add one user-facing line about IDE directory management moving into IDE Management.

---

### Task 1: Add App-Level View State To IDE Management

**Files:**
- Modify: `desktop/src/modules/editor-scan/index.tsx`
- Test: `desktop/src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx`

- [ ] **Step 1: Write failing tests for the app-level tabs**

Replace `desktop/src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx` with a jsdom test that can click the tab. Keep existing dialog mocks.

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EditorScanModule } from "../index"

const refresh = vi.fn()

vi.mock("../hooks/use-editor-scan", () => ({
  useEditorScan: () => ({
    data: {
      global: [
        {
          editorId: "cursor",
          editorLabel: "Cursor",
          status: "detected",
          rulesSupported: false,
          rules: [],
          skills: [],
          duplicateSkillNames: [],
        },
      ],
      projects: [],
    },
    loading: false,
    error: null,
    refresh,
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    success: vi.fn(),
    error: vi.fn(),
    promise: vi.fn(),
  }),
}))

vi.mock("../components/scan-item-detail-dialog", () => ({
  ScanItemDetailDialog: () => null,
}))

vi.mock("../components/editor-bulk-skill-copy-dialog", () => ({
  EditorBulkSkillCopyDialog: () => null,
}))

vi.mock("../components/editor-bulk-skill-trash-dialog", () => ({
  EditorBulkSkillTrashDialog: () => null,
}))

describe("EditorScanModule", () => {
  const roots: Root[] = []

  beforeEach(() => {
    document.body.innerHTML = ""
    refresh.mockReset()
  })

  afterEach(() => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })

  it("renders content and directory app tabs", async () => {
    await renderEditorScanModule(roots)

    expect(screenText()).toContain("内容")
    expect(screenText()).toContain("目录")
    expect(screenText()).toContain("Cursor")
    expect(screenText()).toContain("未检测到 Cursor 的 skill 或规则")
  })

  it("switches to the selected IDE directory placeholder", async () => {
    await renderEditorScanModule(roots)

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[role="tab"][value="directories"]')?.click()
      await Promise.resolve()
    })

    expect(screenText()).toContain("cursor")
  })
})

async function renderEditorScanModule(roots: Root[]): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<EditorScanModule />)
    await Promise.resolve()
  })
}

function screenText(): string {
  return document.body.textContent ?? ""
}
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx
```

Expected: FAIL because the `目录` tab does not exist yet.

- [ ] **Step 3: Add the App-level tab state and shell wrapper**

In `desktop/src/modules/editor-scan/index.tsx`, import `SystemAppWindowShell`, add the top-level tab type, and wrap the existing layout.

```tsx
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { EditorDirectoriesView } from "./components/editor-directories-view"

type AppViewTab = "content" | "directories"
type ContentTab = "skill" | "rule"
type ScopeTab = "global" | "project"
```

Inside `EditorScanModule`, add state:

```tsx
const [appViewTab, setAppViewTab] = useState<AppViewTab>("content")
```

Create the actions node from the existing refresh button:

```tsx
const headerActions = (
  <Button
    variant="ghost"
    size="icon"
    className="size-7"
    onClick={() => void handleRefresh()}
    disabled={loading}
    title="刷新"
  >
    {loading ? (
      <LoaderCircle className="size-4 animate-spin" />
    ) : (
      <RotateCcw className="size-4" />
    )}
  </Button>
)
```

Change the return shape to:

```tsx
return (
  <SystemAppWindowShell
    tabs={[
      { id: "content", label: "内容" },
      { id: "directories", label: "目录" },
    ]}
    value={appViewTab}
    onValueChange={setAppViewTab}
    actions={headerActions}
  >
    <SidebarContentLayout sidebar={sidebar} contentScrollable={false} contentClassName="bg-surface">
      {/* existing module content goes here */}
    </SidebarContentLayout>
    <ScanItemDetailDialog
      item={detailItem}
      onChanged={refresh}
      open={detailOpen}
      onOpenChange={setDetailOpen}
    />
    <EditorBulkSkillCopyDialog
      items={selectedSkills}
      onCopied={async () => {
        await refresh()
        clearSkillSelection()
      }}
      open={bulkCopyOpen}
      onOpenChange={setBulkCopyOpen}
    />
    <EditorBulkSkillTrashDialog
      items={selectedSkills}
      onTrashed={async (trashedKeys) => {
        removeSelectedSkills(trashedKeys)
        await refresh()
      }}
      open={bulkTrashOpen}
      onOpenChange={setBulkTrashOpen}
    />
  </SystemAppWindowShell>
)
```

Within the content column, keep the existing `h2`, `Skill / Rule`, and `全局 / 项目` controls only for `appViewTab === "content"`. Remove the old inline refresh button from the content row so refresh lives in the system app header only.

- [ ] **Step 4: Add a temporary directory component import target**

Create `desktop/src/modules/editor-scan/components/editor-directories-view.tsx` with a minimal component so Task 1 can compile before Task 2 fills it in.

```tsx
import type { SynapseEditorId } from "@/types/editor"

type EditorDirectoriesViewProps = {
  readonly selectedEditorId: SynapseEditorId
}

function EditorDirectoriesView({ selectedEditorId }: EditorDirectoriesViewProps) {
  return (
    <div className="p-2 text-sm text-muted-foreground">
      {selectedEditorId}
    </div>
  )
}

export { EditorDirectoriesView }
```

- [ ] **Step 5: Run the focused test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add desktop/src/modules/editor-scan/index.tsx desktop/src/modules/editor-scan/components/editor-directories-view.tsx desktop/src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx
git commit -m "feat: add IDE management view tabs"
```

---

### Task 2: Move Directory Loading Into IDE Management

**Files:**
- Create: `desktop/src/modules/editor-scan/hooks/use-editor-directories.ts`
- Modify: `desktop/src/modules/editor-scan/components/editor-directories-view.tsx`
- Test: `desktop/src/modules/editor-scan/__tests__/editor-directories-view.test.tsx`

- [ ] **Step 1: Write failing component tests for directory rows**

Create `desktop/src/modules/editor-scan/__tests__/editor-directories-view.test.tsx`.

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EditorDirectoriesView } from "../components/editor-directories-view"

const mocks = vi.hoisted(() => ({
  handleOpen: vi.fn(),
  handleCreate: vi.fn(),
  reload: vi.fn(),
  state: {
    directories: [
      {
        editorId: "cursor",
        label: "Cursor",
        rulesPath: null,
        rulesExists: false,
        skillsPath: "/Users/liyang/.cursor/skills",
        skillsExists: true,
      },
      {
        editorId: "codex",
        label: "Codex",
        rulesPath: "/Users/liyang/.codex",
        rulesExists: true,
        skillsPath: "/Users/liyang/.agents/skills",
        skillsExists: false,
      },
    ],
    isLoading: false,
    error: null as string | null,
  },
}))

vi.mock("../hooks/use-editor-directories", () => ({
  useEditorDirectories: () => ({
    ...mocks.state,
    handleOpen: mocks.handleOpen,
    handleCreate: mocks.handleCreate,
    reload: mocks.reload,
  }),
}))

describe("EditorDirectoriesView", () => {
  const roots: Root[] = []

  beforeEach(() => {
    document.body.innerHTML = ""
    mocks.handleOpen.mockReset()
    mocks.handleCreate.mockReset()
    mocks.reload.mockReset()
    mocks.state.isLoading = false
    mocks.state.error = null
  })

  afterEach(() => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })

  it("shows only the selected IDE directories", async () => {
    await renderDirectoryView(roots, "codex")

    expect(screenText()).toContain("Codex")
    expect(screenText()).toContain("/Users/liyang/.codex")
    expect(screenText()).toContain("/Users/liyang/.agents/skills")
    expect(screenText()).not.toContain("/Users/liyang/.cursor/skills")
  })

  it("opens existing directories", async () => {
    await renderDirectoryView(roots, "codex")

    await act(async () => {
      buttonByText("打开")?.click()
      await Promise.resolve()
    })

    expect(mocks.handleOpen).toHaveBeenCalledWith("/Users/liyang/.codex")
  })

  it("creates missing directories", async () => {
    await renderDirectoryView(roots, "codex")

    await act(async () => {
      buttonByText("创建并打开")?.click()
      await Promise.resolve()
    })

    expect(mocks.handleCreate).toHaveBeenCalledWith("/Users/liyang/.agents/skills")
  })

  it("shows unsupported rows without actions", async () => {
    await renderDirectoryView(roots, "cursor")

    expect(screenText()).toContain("全局规则")
    expect(screenText()).toContain("不支持")
    expect(document.body.textContent?.match(/打开/g)?.length ?? 0).toBe(1)
  })

  it("shows a retry action on load errors", async () => {
    mocks.state.error = "加载编辑器目录失败"
    await renderDirectoryView(roots, "cursor")

    expect(screenText()).toContain("加载编辑器目录失败")
    await act(async () => {
      buttonByText("重试")?.click()
      await Promise.resolve()
    })
    expect(mocks.reload).toHaveBeenCalled()
  })
})

async function renderDirectoryView(roots: Root[], selectedEditorId: "cursor" | "codex"): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<EditorDirectoriesView selectedEditorId={selectedEditorId} />)
    await Promise.resolve()
  })
}

function buttonByText(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button"))
    .find((button) => button.textContent?.includes(label))
}

function screenText(): string {
  return document.body.textContent ?? ""
}
```

- [ ] **Step 2: Run the directory view test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/__tests__/editor-directories-view.test.tsx
```

Expected: FAIL because `use-editor-directories` does not exist and the temporary component does not render rows.

- [ ] **Step 3: Create the hook in `editor-scan`**

Create `desktop/src/modules/editor-scan/hooks/use-editor-directories.ts`.

```ts
import { useCallback, useEffect, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { getSynapseBridge, requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseEditorGlobalDirectory } from "@/types/editor"

const logger = createRendererLogger("editor-scan.directories")

function useEditorDirectories() {
  const [directories, setDirectories] = useState<SynapseEditorGlobalDirectory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { promise } = useAppNotifications()

  const loadDirectories = useCallback(() => {
    setIsLoading(true)
    setError(null)
    const bridge = getSynapseBridge()
    if (!bridge) {
      setDirectories([])
      setIsLoading(false)
      return
    }
    bridge.editor.getGlobalDirectories()
      .then(setDirectories)
      .catch((err) => {
        logger.error("Failed to load editor global directories.", err)
        setError("加载编辑器目录失败")
      })
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    loadDirectories()
  }, [loadDirectories])

  const handleOpen = useCallback((dirPath: string) => {
    logger.info("Opening editor directory.", { dirName: dirPath.split(/[/\\]/).pop() ?? dirPath })
    window.synapse?.shell.showItemInFolder(dirPath).catch(() => {})
  }, [])

  const handleCreate = useCallback(
    async (dirPath: string) => {
      logger.info("Creating editor directory.", { dirName: dirPath.split(/[/\\]/).pop() ?? dirPath })
      await promise(
        async () => {
          await requireSynapseBridge().editor.createDirectory(dirPath)
          loadDirectories()
        },
        {
          loading: "正在创建目录...",
          success: () => "目录已创建。",
          error: (err) => (err instanceof Error ? err.message : "创建目录失败。"),
        },
      )
    },
    [loadDirectories, promise],
  )

  return { directories, isLoading, error, handleOpen, handleCreate, reload: loadDirectories }
}

export { useEditorDirectories }
```

- [ ] **Step 4: Implement the selected-IDE directory view**

Replace `desktop/src/modules/editor-scan/components/editor-directories-view.tsx` with:

```tsx
import { FolderPlus, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { getEditorLabel } from "@/lib/editor-registry"
import type { SynapseEditorId } from "@/types/editor"
import { useEditorDirectories } from "../hooks/use-editor-directories"

type EditorDirectoriesViewProps = {
  readonly selectedEditorId: SynapseEditorId
}

type DirectoryRowProps = {
  readonly label: string
  readonly dirPath: string | null
  readonly exists: boolean
  readonly onOpen: (dirPath: string) => void
  readonly onCreate: (dirPath: string) => void
}

function EditorDirectoriesView({ selectedEditorId }: EditorDirectoriesViewProps) {
  const { directories, isLoading, error, handleOpen, handleCreate, reload } = useEditorDirectories()

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <p>{error}</p>
        <Button variant="outline" size="sm" onClick={reload}>重试</Button>
      </div>
    )
  }

  const directory = directories.find((entry) => entry.editorId === selectedEditorId)

  if (!directory) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        未检测到编辑器目录
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-2">
      <div className="flex shrink-0 items-center gap-2 px-1 py-2">
        <h2 className="text-lg font-semibold">{directory.label || getEditorLabel(selectedEditorId)}</h2>
      </div>
      <div className="flex flex-col overflow-hidden rounded-lg border bg-background">
        <DirectoryRow
          label="全局规则"
          dirPath={directory.rulesPath}
          exists={directory.rulesExists}
          onOpen={handleOpen}
          onCreate={handleCreate}
        />
        <DirectoryRow
          label="全局技能"
          dirPath={directory.skillsPath}
          exists={directory.skillsExists}
          onOpen={handleOpen}
          onCreate={handleCreate}
        />
      </div>
    </div>
  )
}

function DirectoryRow({ label, dirPath, exists, onOpen, onCreate }: DirectoryRowProps) {
  if (!dirPath) {
    return (
      <div className="grid min-h-10 grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">不支持</span>
        <span aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="grid min-h-10 grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0">
      <span className="font-medium">{label}</span>
      <span className="min-w-0 truncate text-muted-foreground" title={dirPath}>
        {dirPath}
      </span>
      {exists ? (
        <Button variant="outline" size="sm" onClick={() => onOpen(dirPath)}>
          打开
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => onCreate(dirPath)}>
          <FolderPlus data-icon="inline-start" />
          创建并打开
        </Button>
      )}
    </div>
  )
}

export { EditorDirectoriesView }
```

- [ ] **Step 5: Wire `EditorScanModule` to render the directory view**

In `desktop/src/modules/editor-scan/index.tsx`, render:

```tsx
{appViewTab === "content" ? (
  <>
    {/* existing content header and renderContent() */}
  </>
) : (
  <EditorDirectoriesView selectedEditorId={selectedEditorId} />
)}
```

Keep the left sidebar outside this conditional so it remains visible for both tabs.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/__tests__/editor-directories-view.test.tsx src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add desktop/src/modules/editor-scan/hooks/use-editor-directories.ts desktop/src/modules/editor-scan/components/editor-directories-view.tsx desktop/src/modules/editor-scan/__tests__/editor-directories-view.test.tsx desktop/src/modules/editor-scan/index.tsx desktop/src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx
git commit -m "feat: move IDE directories into IDE management"
```

---

### Task 3: Remove Settings > 本机IDE

**Files:**
- Modify: `desktop/src/modules/settings/data.ts`
- Modify: `desktop/src/modules/settings/types.ts`
- Modify: `desktop/src/modules/settings/index.tsx`
- Delete: `desktop/src/modules/settings/components/tools-panel.tsx`
- Delete: `desktop/src/modules/settings/components/editor-directories-panel.tsx`
- Test: `desktop/src/modules/settings/__tests__/settings-categories.test.ts`

- [ ] **Step 1: Update failing settings category tests**

Modify `desktop/src/modules/settings/__tests__/settings-categories.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { settingsCategories } from "@/modules/settings/data"

describe("settingsCategories", () => {
  it("has the expected category structure without local IDE settings", () => {
    const ids = settingsCategories.map((c) => c.id)

    expect(ids).toEqual([
      "account",
      "general",
      "repositories",
      "projects",
      "quick-inputs",
      "claude-code",
      "variables",
      "troubleshooting",
      "about",
      "admin",
    ])
  })

  it("keeps migrated data services and IDE directories out of settings", () => {
    const ids = settingsCategories.map((c) => c.id)

    expect(ids).not.toContain("services")
    expect(ids).not.toContain("database")
    expect(ids).not.toContain("mcp")
    expect(ids).not.toContain("tools")
  })

  it("has separate repositories and projects categories", () => {
    const ids = settingsCategories.map((c) => c.id)

    expect(ids).toContain("repositories")
    expect(ids).toContain("projects")
  })

  it("uses clear user-facing category names", () => {
    const labels = new Map(settingsCategories.map((category) => [category.id, category.label]))

    expect(labels.get("account")).toBe("账号")
    expect(labels.get("general")).toBe("基础设置")
    expect(labels.get("repositories")).toBe("资源仓库")
    expect(labels.get("projects")).toBe("项目和知识库")
    expect(labels.get("quick-inputs")).toBe("提示词片段")
    expect(labels.get("tools")).toBeUndefined()
    expect(labels.get("claude-code")).toBe("模型与供应商")
    expect(labels.get("variables")).toBe("私人令牌")
    expect(labels.get("troubleshooting")).toBe("诊断日志")
    expect(labels.get("about")).toBe("关于 Synapse")
    expect(labels.get("admin")).toBe("仓库维护")
  })
})
```

- [ ] **Step 2: Run settings category test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/settings/__tests__/settings-categories.test.ts
```

Expected: FAIL because `tools` still exists.

- [ ] **Step 3: Remove the category and type**

In `desktop/src/modules/settings/data.ts`, remove the `Blocks` import and this category block:

```ts
{
  id: "tools",
  icon: Blocks,
  label: "本机IDE",
  description: "编辑器目录与集成。",
},
```

In `desktop/src/modules/settings/types.ts`, change:

```ts
type SettingsCategoryId = "account" | "general" | "repositories" | "projects" | "quick-inputs" | "claude-code" | "variables" | "troubleshooting" | "about" | "admin"
```

- [ ] **Step 4: Remove the settings panel render path**

In `desktop/src/modules/settings/index.tsx`, remove:

```ts
import { ToolsPanel } from "@/modules/settings/components/tools-panel"
```

Remove this render branch:

```tsx
{isReady && activeCategory === "tools" ? <ToolsPanel /> : null}
```

- [ ] **Step 5: Delete the old settings-owned directory UI files**

Run:

```bash
git rm desktop/src/modules/settings/components/tools-panel.tsx desktop/src/modules/settings/components/editor-directories-panel.tsx
```

- [ ] **Step 6: Run settings and type checks for this area**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/settings/__tests__/settings-categories.test.ts
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add desktop/src/modules/settings/data.ts desktop/src/modules/settings/types.ts desktop/src/modules/settings/index.tsx desktop/src/modules/settings/__tests__/settings-categories.test.ts
git commit -m "refactor: remove local IDE settings category"
```

---

### Task 4: Preserve Existing Content Behavior

**Files:**
- Modify: `desktop/src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx`
- Optional modify if needed: `desktop/src/modules/editor-scan/index.tsx`

- [ ] **Step 1: Add regression tests for existing content controls**

Append these tests to `desktop/src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx`:

```tsx
it("keeps Skill and Rule filters inside the content view", async () => {
  await renderEditorScanModule(roots)

  expect(document.querySelector('[role="tab"][value="skill"]')).not.toBeNull()
  expect(document.querySelector('[role="tab"][value="rule"]')).not.toBeNull()
  expect(document.querySelector('[role="tab"][value="global"]')).not.toBeNull()
  expect(document.querySelector('[role="tab"][value="project"]')).not.toBeNull()
})

it("hides content filters in the directory view", async () => {
  await renderEditorScanModule(roots)

  await act(async () => {
    document.querySelector<HTMLButtonElement>('[role="tab"][value="directories"]')?.click()
    await Promise.resolve()
  })

  expect(document.querySelector('[role="tab"][value="skill"]')).toBeNull()
  expect(document.querySelector('[role="tab"][value="rule"]')).toBeNull()
  expect(document.querySelector('[role="tab"][value="global"]')).toBeNull()
  expect(document.querySelector('[role="tab"][value="project"]')).toBeNull()
})
```

- [ ] **Step 2: Run the regression test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx
```

Expected: PASS. If it fails because the content filters still render in `目录`, move the content header into the `appViewTab === "content"` branch.

- [ ] **Step 3: Run the existing editor-scan tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan
```

Expected: PASS.

- [ ] **Step 4: Commit Task 4**

```bash
git add desktop/src/modules/editor-scan/index.tsx desktop/src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx
git commit -m "test: cover IDE management tab behavior"
```

---

### Task 5: Release Notes And Full Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add a concise user-facing bullet near the top pending section in `RELEASE_NOTES_PENDING.md`:

```md
- IDE 管理新增“目录”视图，原“设置 > 本机IDE”入口已移除，查看和创建本机 IDE 全局目录现在统一在 IDE 管理中完成。
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan src/modules/settings/__tests__/settings-categories.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Inspect final diff for scope**

Run:

```bash
git diff --stat
git diff -- desktop/src/modules/editor-scan desktop/src/modules/settings RELEASE_NOTES_PENDING.md
```

Expected: Diff only touches IDE management, settings category removal, tests, and release notes.

- [ ] **Step 5: Commit final verification note**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note IDE directory management move"
```

If `RELEASE_NOTES_PENDING.md` was already committed together with an earlier task, skip this commit and keep the verification results in the final response.
