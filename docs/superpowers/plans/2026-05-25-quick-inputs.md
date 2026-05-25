# Quick Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add global user-maintained quick inputs in Settings and expose them as an insert-only menu in the Agent composer.

**Architecture:** Store quick inputs in existing global app config as an ordered `quickInputs` array. Settings owns list maintenance through a focused `QuickInputsPanel`; Agent composer receives the global list and inserts selected content into the draft. Knowledge Base actions remain separate and render after the new global quick-input menu.

**Tech Stack:** Electron, React, TypeScript, Tailwind CSS, shadcn/Radix UI, Vitest, jsdom.

---

## File Structure

- Modify `desktop/src/types/config.ts`: add `SynapseQuickInput`, add `quickInputs` to global config and patch types.
- Modify `desktop/src/constants/defaults.ts`: add `DEFAULT_QUICK_INPUTS` and include it in `DEFAULT_GLOBAL_CONFIG`.
- Modify `desktop/src/lib/config.ts`: normalize quick inputs and preserve multi-line content.
- Modify `desktop/src/lib/__tests__/config.test.ts`: cover defaults, sanitization, filtering, and patches.
- Modify `desktop/src/modules/settings/types.ts`: add `quick-inputs` category id.
- Modify `desktop/src/modules/settings/data.ts`: add the Settings sidebar category.
- Create `desktop/src/modules/settings/quick-inputs.ts`: pure helpers for ids, previews, validation, and list mutation.
- Create `desktop/src/modules/settings/components/quick-inputs-panel.tsx`: Settings UI for add, edit, delete, and pin-to-top.
- Create `desktop/src/modules/settings/components/__tests__/quick-inputs-panel.test.tsx`: component behavior tests.
- Modify `desktop/src/modules/settings/__tests__/settings-categories.test.ts`: expected category order includes `quick-inputs`.
- Modify `desktop/src/modules/settings/index.tsx`: render `QuickInputsPanel` and save through `updateConfig`.
- Create `desktop/src/modules/agent/composer-insert.ts`: pure helper for cursor-based text insertion.
- Create `desktop/src/modules/agent/components/quick-input-menu.tsx`: dropdown menu for quick inputs.
- Modify `desktop/src/modules/agent/components/agent-composer.tsx`: accept quick inputs, render the menu first, and use shared insertion helper.
- Modify `desktop/src/modules/agent/index.tsx`: pass `config.global.quickInputs` to `AgentComposer`.
- Modify `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`: cover menu visibility, ordering, insertion, and Knowledge Base coexistence.

## Task 1: Config Model And Normalization

**Files:**
- Modify: `desktop/src/types/config.ts`
- Modify: `desktop/src/constants/defaults.ts`
- Modify: `desktop/src/lib/config.ts`
- Test: `desktop/src/lib/__tests__/config.test.ts`

- [ ] **Step 1: Write failing config tests**

Append this block to `desktop/src/lib/__tests__/config.test.ts`:

```ts
describe("Synapse quick inputs config", () => {
  it("defaults quick inputs to an empty list", () => {
    expect(createDefaultConfig().global.quickInputs).toEqual([])
  })

  it("preserves valid multi-line quick input content", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [],
        quickInputs: [
          { id: "quick-1", content: "第一行\n第二行" },
        ],
      },
    })

    expect(config.global.quickInputs).toEqual([
      { id: "quick-1", content: "第一行\n第二行" },
    ])
  })

  it("filters malformed and blank quick inputs", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [],
        quickInputs: [
          { id: "quick-1", content: "有效内容" },
          { id: "quick-2", content: "   " },
          { id: "", content: "缺少 ID" },
          { id: "quick-3", content: 123 },
          "invalid",
          { id: "quick-1", content: "重复 ID" },
        ],
      },
    })

    expect(config.global.quickInputs).toEqual([
      { id: "quick-1", content: "有效内容" },
    ])
  })

  it("applies quick input patches without changing existing projects", () => {
    const current = applySynapseConfigPatch(createDefaultConfig(), {
      global: {
        projects: [{
          id: "project-1",
          name: "Project",
          path: "/Users/example/project",
        }],
      },
    })
    const next = applySynapseConfigPatch(current, {
      global: {
        quickInputs: [{ id: "quick-1", content: "复用这段话" }],
      },
    })

    expect(next.global.projects).toEqual(current.global.projects)
    expect(next.global.quickInputs).toEqual([
      { id: "quick-1", content: "复用这段话" },
    ])
  })
})
```

- [ ] **Step 2: Run config tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/config.test.ts
```

Expected: tests fail because `global.quickInputs` and `SynapseQuickInput` do not exist yet.

- [ ] **Step 3: Add config types**

In `desktop/src/types/config.ts`, add the type before `SynapseGlobalConfig`:

```ts
export type SynapseQuickInput = {
  id: string
  content: string
}
```

Then add `quickInputs` to `SynapseGlobalConfig`:

```ts
export type SynapseGlobalConfig = {
  themeMode: SynapseThemeMode
  projects: SynapseProjectConfig[]
  favorites: SynapseFavorites
  recentlyViewed: SynapseRecentlyViewed
  contentSortOrder: SynapseContentSortOrder
  quickInputs: SynapseQuickInput[]
}
```

Update `SynapseConfigPatch.global`:

```ts
global?: Partial<SynapseGlobalConfig> & {
  projects?: SynapseProjectConfig[]
  quickInputs?: SynapseQuickInput[]
}
```

- [ ] **Step 4: Add default config value**

In `desktop/src/constants/defaults.ts`, import `SynapseQuickInput` from `../types/config`, then add:

```ts
export const DEFAULT_QUICK_INPUTS = [] as const satisfies SynapseQuickInput[]
```

Add the field to `DEFAULT_GLOBAL_CONFIG`:

```ts
export const DEFAULT_GLOBAL_CONFIG: SynapseGlobalConfig = {
  themeMode: DEFAULT_THEME_MODE,
  projects: [],
  favorites: DEFAULT_FAVORITES,
  recentlyViewed: DEFAULT_RECENTLY_VIEWED,
  contentSortOrder: DEFAULT_CONTENT_SORT_ORDER,
  quickInputs: DEFAULT_QUICK_INPUTS,
}
```

- [ ] **Step 5: Implement quick-input normalization**

In `desktop/src/lib/config.ts`, import `DEFAULT_QUICK_INPUTS` from constants and `SynapseQuickInput` from config types.

Add this helper after `normalizeRecentlyViewed`:

```ts
function normalizeQuickInput(value: unknown): SynapseQuickInput | null {
  if (!isRecord(value)) {
    return null
  }

  const id = asTrimmedString(value.id)
  const content = typeof value.content === "string" ? value.content : ""

  if (!id || content.trim().length === 0) {
    return null
  }

  return {
    id,
    content,
  }
}

function normalizeQuickInputs(value: unknown): SynapseQuickInput[] {
  if (!Array.isArray(value)) {
    return structuredClone(DEFAULT_QUICK_INPUTS)
  }

  return dedupeByKey(
    value.map(normalizeQuickInput).filter(isDefined),
    (item) => item.id,
  )
}
```

Add `quickInputs` to `normalizeGlobalConfig`:

```ts
return {
  themeMode: normalizeThemeMode(value.themeMode, DEFAULT_THEME_MODE),
  projects: normalizeProjects(value.projects),
  favorites: normalizeFavorites(value.favorites),
  recentlyViewed: normalizeRecentlyViewed(value.recentlyViewed),
  contentSortOrder: isSynapseContentSortOrder(value.contentSortOrder)
    ? value.contentSortOrder
    : DEFAULT_CONTENT_SORT_ORDER,
  quickInputs: normalizeQuickInputs(value.quickInputs),
}
```

- [ ] **Step 6: Run config tests and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/config.test.ts
```

Expected: all tests in `config.test.ts` pass.

Commit:

```bash
git add desktop/src/types/config.ts desktop/src/constants/defaults.ts desktop/src/lib/config.ts desktop/src/lib/__tests__/config.test.ts
git commit -m "feat(settings): add quick input config"
```

## Task 2: Settings Category And Quick Inputs Panel

**Files:**
- Modify: `desktop/src/modules/settings/types.ts`
- Modify: `desktop/src/modules/settings/data.ts`
- Modify: `desktop/src/modules/settings/index.tsx`
- Create: `desktop/src/modules/settings/quick-inputs.ts`
- Create: `desktop/src/modules/settings/components/quick-inputs-panel.tsx`
- Test: `desktop/src/modules/settings/__tests__/settings-categories.test.ts`
- Test: `desktop/src/modules/settings/components/__tests__/quick-inputs-panel.test.tsx`

- [ ] **Step 1: Update the failing category test**

In `desktop/src/modules/settings/__tests__/settings-categories.test.ts`, update the expected ids:

```ts
expect(ids).toEqual([
  "general",
  "repositories",
  "projects",
  "quick-inputs",
  "tools",
  "claude-code",
  "variables",
  "services",
  "troubleshooting",
  "about",
  "admin",
])
```

Add:

```ts
it("includes quick inputs as a top-level settings category", () => {
  const quickInputs = settingsCategories.find((category) => category.id === "quick-inputs")

  expect(quickInputs?.label).toBe("快速输入")
})
```

- [ ] **Step 2: Add failing panel tests**

Create `desktop/src/modules/settings/components/__tests__/quick-inputs-panel.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { QuickInputsPanel } from "../quick-inputs-panel"
import type { SynapseQuickInput } from "@/types/config"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("QuickInputsPanel", () => {
  it("renders the empty state", async () => {
    const container = await renderPanel([])

    expect(container.textContent).toContain("还没有快速输入")
  })

  it("adds a multi-line quick input", async () => {
    const onSave = vi.fn(async () => true)
    const container = await renderPanel([], onSave)

    clickButton(container, "新增")
    setTextareaValue("第一行\n第二行")
    clickDialogButton("添加")

    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({ content: "第一行\n第二行" }),
    ])
  })

  it("blocks blank content", async () => {
    const onSave = vi.fn(async () => true)
    const container = await renderPanel([], onSave)

    clickButton(container, "新增")
    setTextareaValue("   ")
    clickDialogButton("添加")

    expect(onSave).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("内容不能为空。")
  })

  it("edits an existing quick input", async () => {
    const onSave = vi.fn(async () => true)
    const container = await renderPanel([{ id: "quick-1", content: "旧内容" }], onSave)

    clickButton(container, "编辑快速输入")
    setTextareaValue("新内容")
    clickDialogButton("保存")

    expect(onSave).toHaveBeenCalledWith([{ id: "quick-1", content: "新内容" }])
  })

  it("pins an item to the top", async () => {
    const onSave = vi.fn(async () => true)
    const container = await renderPanel([
      { id: "quick-1", content: "第一条" },
      { id: "quick-2", content: "第二条" },
    ], onSave)

    const pinButtons = container.querySelectorAll('button[aria-label="置顶快速输入"]')
    await act(async () => {
      pinButtons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onSave).toHaveBeenCalledWith([
      { id: "quick-2", content: "第二条" },
      { id: "quick-1", content: "第一条" },
    ])
  })

  it("deletes an existing quick input after confirmation", async () => {
    const onSave = vi.fn(async () => true)
    const container = await renderPanel([{ id: "quick-1", content: "待删除" }], onSave)

    clickButton(container, "删除快速输入")
    clickDialogButton("删除")

    expect(onSave).toHaveBeenCalledWith([])
  })
})

async function renderPanel(items: SynapseQuickInput[], onSave = vi.fn(async () => true)) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<QuickInputsPanel quickInputs={items} onSave={onSave} />)
  })

  return container
}

function clickButton(container: HTMLElement, label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    ?? Array.from(container.querySelectorAll("button")).find((item) => item.textContent === label)
  expect(button).toBeTruthy()
  act(() => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

function clickDialogButton(label: string) {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.textContent === label)
  expect(button).toBeTruthy()
  act(() => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

function setTextareaValue(value: string) {
  const textarea = document.body.querySelector<HTMLTextAreaElement>("textarea")
  expect(textarea).toBeTruthy()
  act(() => {
    textarea!.value = value
    textarea!.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
```

- [ ] **Step 3: Run settings tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/settings/__tests__/settings-categories.test.ts src/modules/settings/components/__tests__/quick-inputs-panel.test.tsx
```

Expected: tests fail because `quick-inputs` and `QuickInputsPanel` do not exist yet.

- [ ] **Step 4: Add settings category type and data**

In `desktop/src/modules/settings/types.ts`, add `"quick-inputs"` to `SettingsCategoryId`:

```ts
type SettingsCategoryId = "general" | "repositories" | "projects" | "quick-inputs" | "tools" | "claude-code" | "variables" | "services" | "troubleshooting" | "about" | "admin"
```

In `desktop/src/modules/settings/data.ts`, import `TextCursorInput`:

```ts
import {
  Activity,
  Bot,
  Blocks,
  Braces,
  FolderGit2,
  FolderOpen,
  Info,
  Server,
  Settings2,
  Shield,
  TextCursorInput,
} from "lucide-react"
```

Add this category after `projects`:

```ts
{
  id: "quick-inputs",
  icon: TextCursorInput,
  label: "快速输入",
  description: "常用输入片段。",
},
```

- [ ] **Step 5: Create pure settings helpers**

Create `desktop/src/modules/settings/quick-inputs.ts`:

```ts
import type { SynapseQuickInput } from "@/types/config"

function createQuickInputId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return `quick-input-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function quickInputPreview(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?? content.trim()
}

function createQuickInput(content: string): SynapseQuickInput {
  return {
    id: createQuickInputId(),
    content,
  }
}

function updateQuickInput(
  items: readonly SynapseQuickInput[],
  id: string,
  content: string,
): SynapseQuickInput[] {
  return items.map((item) => item.id === id ? { ...item, content } : item)
}

function deleteQuickInput(
  items: readonly SynapseQuickInput[],
  id: string,
): SynapseQuickInput[] {
  return items.filter((item) => item.id !== id)
}

function pinQuickInputToTop(
  items: readonly SynapseQuickInput[],
  id: string,
): SynapseQuickInput[] {
  const target = items.find((item) => item.id === id)
  if (!target) return [...items]

  return [
    target,
    ...items.filter((item) => item.id !== id),
  ]
}

export {
  createQuickInput,
  deleteQuickInput,
  pinQuickInputToTop,
  quickInputPreview,
  updateQuickInput,
}
```

- [ ] **Step 6: Create QuickInputsPanel**

Create `desktop/src/modules/settings/components/quick-inputs-panel.tsx`:

```tsx
import { useCallback, useState } from "react"
import { ArrowUpToLine, Pencil, Plus, Trash2 } from "lucide-react"

import { FormDialog } from "@/components/form-dialog"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { SynapseQuickInput } from "@/types/config"
import {
  createQuickInput,
  deleteQuickInput,
  pinQuickInputToTop,
  quickInputPreview,
  updateQuickInput,
} from "../quick-inputs"

type QuickInputsPanelProps = {
  readonly quickInputs: readonly SynapseQuickInput[]
  readonly onSave: (quickInputs: SynapseQuickInput[]) => Promise<boolean>
}

type DialogMode =
  | { type: "add" }
  | { type: "edit"; item: SynapseQuickInput }
  | null

function QuickInputsPanel({ quickInputs, onSave }: QuickInputsPanelProps) {
  const [dialogMode, setDialogMode] = useState<DialogMode>(null)
  const [content, setContent] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingItem, setDeletingItem] = useState<SynapseQuickInput | null>(null)
  const [saving, setSaving] = useState(false)

  const openAddDialog = useCallback(() => {
    setDialogMode({ type: "add" })
    setContent("")
    setFormError(null)
  }, [])

  const openEditDialog = useCallback((item: SynapseQuickInput) => {
    setDialogMode({ type: "edit", item })
    setContent(item.content)
    setFormError(null)
  }, [])

  const saveDialog = useCallback(async () => {
    if (!dialogMode || saving) return
    if (content.trim().length === 0) {
      setFormError("内容不能为空。")
      return
    }

    const nextItems = dialogMode.type === "add"
      ? [...quickInputs, createQuickInput(content)]
      : updateQuickInput(quickInputs, dialogMode.item.id, content)

    setSaving(true)
    try {
      const saved = await onSave(nextItems)
      if (saved) {
        setDialogMode(null)
        setContent("")
      }
    } finally {
      setSaving(false)
    }
  }, [content, dialogMode, onSave, quickInputs, saving])

  const pinItem = useCallback(async (item: SynapseQuickInput) => {
    if (saving) return
    setSaving(true)
    try {
      await onSave(pinQuickInputToTop(quickInputs, item.id))
    } finally {
      setSaving(false)
    }
  }, [onSave, quickInputs, saving])

  const deleteItem = useCallback(async () => {
    if (!deletingItem || saving) return
    setSaving(true)
    try {
      const saved = await onSave(deleteQuickInput(quickInputs, deletingItem.id))
      if (saved) {
        setDeletingItem(null)
      }
    } finally {
      setSaving(false)
    }
  }, [deletingItem, onSave, quickInputs, saving])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">快速输入</h2>
        <Button type="button" variant="outline" size="sm" onClick={openAddDialog}>
          <Plus className="size-3.5" />
          新增
        </Button>
      </div>

      {quickInputs.length > 0 ? (
        <div className="flex flex-col gap-2">
          {quickInputs.map((item, index) => (
            <div key={item.id} className="flex min-w-0 items-center gap-2 rounded-lg bg-background px-3.5 py-3">
              <p className="min-w-0 flex-1 truncate text-sm">{quickInputPreview(item.content)}</p>
              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="编辑快速输入"
                  onClick={() => openEditDialog(item)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="置顶快速输入"
                  disabled={index === 0 || saving}
                  onClick={() => void pinItem(item)}
                >
                  <ArrowUpToLine className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="删除快速输入"
                  onClick={() => setDeletingItem(item)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">还没有快速输入</p>
      )}

      <Dialog
        open={dialogMode !== null}
        onOpenChange={(open) => {
          if (!open) setDialogMode(null)
        }}
      >
        <FormDialog
          title={dialogMode?.type === "edit" ? "编辑快速输入" : "新增快速输入"}
          footer={<Button type="submit" disabled={saving}>{saving ? "保存中..." : dialogMode?.type === "edit" ? "保存" : "添加"}</Button>}
          onSubmit={(event) => {
            event.preventDefault()
            void saveDialog()
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="quick-input-content">内容</Label>
            <Textarea
              id="quick-input-content"
              value={content}
              onChange={(event) => {
                setContent(event.target.value)
                setFormError(null)
              }}
            />
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </div>
        </FormDialog>
      </Dialog>

      <AlertDialog
        open={deletingItem !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingItem(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除快速输入</AlertDialogTitle>
            <AlertDialogDescription>确定删除这条快速输入吗？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>取消</AlertDialogCancel>
            <Button variant="destructive" disabled={saving} onClick={() => void deleteItem()}>
              {saving ? "正在删除..." : "删除"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { QuickInputsPanel }
```

- [ ] **Step 7: Render the panel from SettingsModule**

In `desktop/src/modules/settings/index.tsx`, import the panel:

```ts
import { QuickInputsPanel } from "@/modules/settings/components/quick-inputs-panel"
```

Add this handler near `handleSaveProjects`:

```ts
const handleSaveQuickInputs = useCallback(
  async (quickInputs: typeof config.global.quickInputs) => {
    logger.info("Saving quick inputs from settings.", {
      quickInputCount: quickInputs.length,
    })
    return applyPatch({
      global: {
        quickInputs,
      },
    })
  },
  [applyPatch],
)
```

Render the panel after the projects panel block:

```tsx
{isReady && activeCategory === "quick-inputs" ? (
  <QuickInputsPanel
    quickInputs={config.global.quickInputs}
    onSave={handleSaveQuickInputs}
  />
) : null}
```

- [ ] **Step 8: Run settings tests and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/settings/__tests__/settings-categories.test.ts src/modules/settings/components/__tests__/quick-inputs-panel.test.tsx
```

Expected: both test files pass.

Commit:

```bash
git add desktop/src/modules/settings/types.ts desktop/src/modules/settings/data.ts desktop/src/modules/settings/index.tsx desktop/src/modules/settings/quick-inputs.ts desktop/src/modules/settings/components/quick-inputs-panel.tsx desktop/src/modules/settings/__tests__/settings-categories.test.ts desktop/src/modules/settings/components/__tests__/quick-inputs-panel.test.tsx
git commit -m "feat(settings): manage quick inputs"
```

## Task 3: Agent Composer Quick Input Menu

**Files:**
- Create: `desktop/src/modules/agent/composer-insert.ts`
- Create: `desktop/src/modules/agent/components/quick-input-menu.tsx`
- Modify: `desktop/src/modules/agent/components/agent-composer.tsx`
- Modify: `desktop/src/modules/agent/index.tsx`
- Test: `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`

- [ ] **Step 1: Add failing composer tests**

In `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`, add these tests before the Knowledge Base action tests:

```tsx
  it("does not render the quick input menu when no quick inputs exist", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft=""
        disabled={false}
        canSend={false}
        sending={false}
        cancelPhase="idle"
        quickInputs={[]}
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )

    expect(html).not.toContain("快速输入")
  })

  it("renders the quick input menu before knowledge base actions", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft=""
        disabled={false}
        canSend={false}
        sending={false}
        cancelPhase="idle"
        quickInputs={[{ id: "quick-1", content: "常用输入" }]}
        knowledgeBaseActions={[{
          label: "查询知识库",
          description: "插入查询指令，继续输入要检索的问题。",
          action: "insert",
          commandText: "/wiki query ",
        }]}
        onKnowledgeBaseCommand={vi.fn()}
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )

    expect(html.indexOf("快速输入")).toBeGreaterThan(-1)
    expect(html.indexOf("知识库")).toBeGreaterThan(html.indexOf("快速输入"))
  })

  it("inserts a quick input at the current cursor position without sending", async () => {
    const onDraftChange = vi.fn()
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault())
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft="请 "
          disabled={false}
          canSend={true}
          sending={false}
          cancelPhase="idle"
          quickInputs={[{ id: "quick-1", content: "整理这段内容\n保留关键结论" }]}
          onDraftChange={onDraftChange}
          onInputKeyDown={vi.fn()}
          onSubmit={onSubmit}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea).not.toBeNull()
    textarea!.focus()
    textarea!.setSelectionRange(2, 2)
    openQuickInputMenu(container)
    const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find((node) => node.textContent === "整理这段内容") as HTMLElement
    expect(item).toBeTruthy()

    await act(async () => {
      item.click()
      await wait(0)
    })

    expect(onDraftChange).toHaveBeenCalledWith("请 整理这段内容\n保留关键结论")
    expect(onSubmit).not.toHaveBeenCalled()
    expect(document.activeElement?.tagName).toBe("TEXTAREA")
  })
```

Add this helper near `openKnowledgeBaseMenu`:

```ts
function openQuickInputMenu(container: HTMLElement) {
  const trigger = container.querySelector('button[aria-label="快速输入"]')
  expect(trigger).toBeTruthy()
  act(() => {
    trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}
```

- [ ] **Step 2: Run composer tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: tests fail because `quickInputs`, `QuickInputMenu`, and the insertion behavior do not exist yet.

- [ ] **Step 3: Add shared composer insertion helper**

Create `desktop/src/modules/agent/composer-insert.ts`:

```ts
type ComposerInsertionInput = {
  readonly draft: string
  readonly selectionStart: number
  readonly selectionEnd: number
  readonly text: string
}

type ComposerInsertionResult = {
  readonly value: string
  readonly cursor: number
}

function insertTextAtComposerSelection({
  draft,
  selectionStart,
  selectionEnd,
  text,
}: ComposerInsertionInput): ComposerInsertionResult {
  const prefix = draft.slice(0, selectionStart)
  const suffix = draft.slice(selectionEnd)
  const needsLeadingSpace = prefix.length > 0 && !/\s$/.test(prefix)
  const insertion = `${needsLeadingSpace ? " " : ""}${text}`
  const value = `${prefix}${insertion}${suffix}`
  const cursor = prefix.length + insertion.length

  return { value, cursor }
}

export { insertTextAtComposerSelection }
```

- [ ] **Step 4: Create QuickInputMenu**

Create `desktop/src/modules/agent/components/quick-input-menu.tsx`:

```tsx
import { ChevronDown, TextCursorInput } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { SynapseQuickInput } from "@/types/config"

type QuickInputMenuProps = {
  readonly quickInputs: readonly SynapseQuickInput[]
  readonly disabled?: boolean
  readonly onInsert: (content: string) => void
}

function quickInputMenuLabel(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?? content.trim()
}

function QuickInputMenu({ quickInputs, disabled, onInsert }: QuickInputMenuProps) {
  if (quickInputs.length === 0) return null

  return (
    <DropdownMenu data-track="agent-quick-inputs">
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="agent-composer__quick-input-trigger rounded-lg px-2.5 text-muted-foreground"
          aria-label="快速输入"
          data-track="agent-quick-inputs"
          disabled={disabled}
        >
          <TextCursorInput />
          <span>快速输入</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onCloseAutoFocus={(event) => event.preventDefault()}>
        {quickInputs.map((item) => (
          <DropdownMenuItem key={item.id} onSelect={() => onInsert(item.content)}>
            <span className="max-w-80 truncate">{quickInputMenuLabel(item.content)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { QuickInputMenu }
```

- [ ] **Step 5: Wire quick inputs into AgentComposer**

In `desktop/src/modules/agent/components/agent-composer.tsx`, import:

```ts
import type { SynapseAgentPermissionMode } from "@/types/agent"
import type { SynapseQuickInput } from "@/types/config"
```

Import helper and menu:

```ts
import { insertTextAtComposerSelection } from "../composer-insert"
import { QuickInputMenu } from "./quick-input-menu"
```

Add prop default and type:

```ts
quickInputs = [],
```

```ts
readonly quickInputs?: readonly SynapseQuickInput[]
```

Replace the body of `insertKnowledgeBaseCommand` with the shared helper:

```ts
const insertComposerText = (text: string) => {
  const el = textareaRef.current
  const next = insertTextAtComposerSelection({
    draft,
    selectionStart: el?.selectionStart ?? draft.length,
    selectionEnd: el?.selectionEnd ?? draft.length,
    text,
  })
  onDraftChange(next.value)
  window.setTimeout(() => {
    const nextEl = textareaRef.current
    if (!nextEl) return
    nextEl.focus()
    nextEl.setSelectionRange(next.cursor, next.cursor)
    setSelectionStart(next.cursor)
  }, 0)
}

const insertKnowledgeBaseCommand = (commandText: string) => {
  insertComposerText(commandText)
}
```

Render `QuickInputMenu` before `KnowledgeBaseActionMenu`:

```tsx
leadingActions={(
  <>
    <QuickInputMenu
      quickInputs={quickInputs}
      disabled={disabled}
      onInsert={insertComposerText}
    />
    <KnowledgeBaseActionMenu
      actions={knowledgeBaseActions}
      disabled={disabled}
      onSend={(commandText) => onKnowledgeBaseCommand?.(commandText)}
      onInsert={insertKnowledgeBaseCommand}
    />
  </>
)}
```

- [ ] **Step 6: Pass config quick inputs from AgentModule**

In `desktop/src/modules/agent/index.tsx`, pass the prop:

```tsx
<AgentComposer
  draft={draft}
  disabled={!chat.activeProjectId}
  canSend={Boolean(draft.trim() && chat.activeProjectId)}
  sending={chat.sending}
  cancelPhase={chat.cancelPhase}
  permissionMode={selectedPermissionMode}
  quickInputs={config.global.quickInputs}
  onPermissionModeChange={(mode) => chat.setPermissionMode(mode)}
```

- [ ] **Step 7: Run composer tests and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: composer tests pass.

Commit:

```bash
git add desktop/src/modules/agent/composer-insert.ts desktop/src/modules/agent/components/quick-input-menu.tsx desktop/src/modules/agent/components/agent-composer.tsx desktop/src/modules/agent/index.tsx desktop/src/modules/agent/__tests__/agent-composer.test.tsx
git commit -m "feat(agent): insert quick inputs from composer"
```

## Task 4: Final Verification

**Files:**
- Verify only unless a previous task exposes a focused failure.

- [ ] **Step 1: Run focused test set**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/lib/__tests__/config.test.ts \
  src/modules/settings/__tests__/settings-categories.test.ts \
  src/modules/settings/components/__tests__/quick-inputs-panel.test.tsx \
  src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run TypeScript check**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: TypeScript check passes.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: hard-constraint check passes.

- [ ] **Step 4: Review the final diff**

Run:

```bash
git status --short
git diff --stat HEAD~3..HEAD
git diff HEAD~3..HEAD -- desktop/src/types/config.ts desktop/src/constants/defaults.ts desktop/src/lib/config.ts desktop/src/modules/settings desktop/src/modules/agent
```

Expected:

- Diff is limited to config quick-input support, Settings quick-input UI, Agent composer menu, and related tests.
- Existing unrelated worktree changes remain unstaged.
- No custom colors, inline styles, drag dependencies, Knowledge Base runtime changes, Scheduler changes, or Workflow changes are present.

- [ ] **Step 5: Commit verification note if implementation commits are complete**

If Tasks 1-3 are committed and no code changes are needed from verification, do not create a no-op commit. Record the commands and results in the final response.
