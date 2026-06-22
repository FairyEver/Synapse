# System App Header Slot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move system app tabs and actions into the embedded Apps module header while preserving standalone system app window behavior.

**Architecture:** Add an embedded-only header slot context under `desktop/src/modules/apps/components/`. `EmbeddedSystemAppShell` provides the context and renders registered slot content in its centered header. `SystemAppWindowShell` keeps the current public API, registers its tabs/actions when embedded, and renders its existing toolbar when standalone.

**Tech Stack:** React 19, TypeScript, shadcn/Radix tabs, lucide icons, Vitest jsdom tests, pnpm workspace scripts.

---

## File Structure

- Create: `desktop/src/modules/apps/components/system-app-header-slot.tsx`
  - Defines the slot data type, provider, and hooks.
  - Owns no visual markup except the provider wrapper.
- Modify: `desktop/src/modules/apps/components/embedded-system-app-shell.tsx`
  - Provides the slot context.
  - Renders left app identity, centered app tabs, and right app actions plus open-in-window.
- Modify: `desktop/src/modules/apps/components/system-app-window-shell.tsx`
  - Keeps standalone toolbar fallback.
  - Registers tabs/actions into the embedded context when present.
- Create: `desktop/src/modules/apps/components/__tests__/embedded-system-app-shell.test.tsx`
  - Covers slot rendering, action order, and cleanup through the provider.
- Modify: `desktop/src/modules/apps/components/__tests__/system-app-window-shell.test.tsx`
  - Adds embedded behavior tests and preserves standalone behavior tests.
- Modify: `desktop/src/modules/apps/__tests__/app-launcher.test.tsx`
  - Updates the mocked embedded app to register slot content.
  - Verifies returning to the launcher clears slot UI.
- Modify: `desktop/src/modules/git/__tests__/git-module-list.test.tsx`
  - Adds an embedded Git render to prove real Git tabs/actions move to the embedded shell.
  - Keeps existing standalone Git toolbar assertions.
- Modify: `RELEASE_NOTES_PENDING.md`
  - Adds a short user-facing note about the cleaner embedded app header.

---

### Task 1: Add Header Slot Context

**Files:**
- Create: `desktop/src/modules/apps/components/system-app-header-slot.tsx`

- [ ] **Step 1: Write the failing context test through the embedded shell test file**

Create `desktop/src/modules/apps/components/__tests__/embedded-system-app-shell.test.tsx` with this initial test. It imports a hook that does not exist yet, so the test should fail before implementation.

```tsx
/**
 * @vitest-environment jsdom
 */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EmbeddedSystemAppShell } from "../embedded-system-app-shell"
import { useSystemAppHeaderSlot } from "../system-app-header-slot"

function SlotWriter() {
  const slot = useSystemAppHeaderSlot()

  React.useEffect(() => {
    slot.setSlot({
      tabs: [
        { id: "one", label: "一" },
        { id: "two", label: "二" },
      ],
      value: "one",
      onValueChange: vi.fn(),
      actions: <button type="button">右侧操作</button>,
    })
    return () => slot.setSlot(null)
  }, [slot])

  return <div>内容</div>
}

describe("EmbeddedSystemAppShell", () => {
  const roots: Root[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => {
        root.unmount()
      })
    }
    document.body.innerHTML = ""
  })

  it("will expose embedded system app header slots", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <EmbeddedSystemAppShell
          appName="资源仓库"
          onBack={vi.fn()}
          onOpenWindow={vi.fn()}
        >
          <SlotWriter />
        </EmbeddedSystemAppShell>,
      )
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("内容")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/apps/components/__tests__/embedded-system-app-shell.test.tsx
```

Expected: FAIL because `../system-app-header-slot` does not exist.

- [ ] **Step 3: Implement the context file**

Create `desktop/src/modules/apps/components/system-app-header-slot.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

type SystemAppHeaderSlotTab = {
  readonly id: string
  readonly label: string
  readonly disabled?: boolean
}

type SystemAppHeaderSlotState = {
  readonly tabs?: readonly SystemAppHeaderSlotTab[]
  readonly value?: string
  readonly onValueChange?: (value: string) => void
  readonly actions?: ReactNode
}

type SystemAppHeaderSlotContextValue = {
  readonly slot: SystemAppHeaderSlotState | null
  readonly setSlot: (slot: SystemAppHeaderSlotState | null) => void
}

const SystemAppHeaderSlotContext = createContext<SystemAppHeaderSlotContextValue | null>(null)

function SystemAppHeaderSlotProvider({ children }: { readonly children: ReactNode }) {
  const [slot, setSlotState] = useState<SystemAppHeaderSlotState | null>(null)
  const setSlot = useCallback((nextSlot: SystemAppHeaderSlotState | null) => {
    setSlotState(nextSlot)
  }, [])
  const value = useMemo(
    () => ({ slot, setSlot }),
    [setSlot, slot],
  )

  return (
    <SystemAppHeaderSlotContext.Provider value={value}>
      {children}
    </SystemAppHeaderSlotContext.Provider>
  )
}

function useOptionalSystemAppHeaderSlot(): SystemAppHeaderSlotContextValue | null {
  return useContext(SystemAppHeaderSlotContext)
}

function useSystemAppHeaderSlot(): SystemAppHeaderSlotContextValue {
  const context = useOptionalSystemAppHeaderSlot()
  if (!context) {
    throw new Error("System app header slot is not available.")
  }
  return context
}

export {
  SystemAppHeaderSlotProvider,
  useOptionalSystemAppHeaderSlot,
  useSystemAppHeaderSlot,
}
export type {
  SystemAppHeaderSlotState,
  SystemAppHeaderSlotTab,
}
```

- [ ] **Step 4: Run the test to verify the module resolves**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/apps/components/__tests__/embedded-system-app-shell.test.tsx
```

Expected: FAIL because `EmbeddedSystemAppShell` does not provide the slot context yet.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/apps/components/system-app-header-slot.tsx desktop/src/modules/apps/components/__tests__/embedded-system-app-shell.test.tsx
git commit -m "test: cover embedded system app header slot"
```

---

### Task 2: Render Slot Content In EmbeddedSystemAppShell

**Files:**
- Modify: `desktop/src/modules/apps/components/embedded-system-app-shell.tsx`
- Modify: `desktop/src/modules/apps/components/__tests__/embedded-system-app-shell.test.tsx`

- [ ] **Step 1: Complete the embedded shell tests**

Replace `desktop/src/modules/apps/components/__tests__/embedded-system-app-shell.test.tsx` with:

```tsx
/**
 * @vitest-environment jsdom
 */
import React, { useEffect } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EmbeddedSystemAppShell } from "../embedded-system-app-shell"
import { useSystemAppHeaderSlot } from "../system-app-header-slot"

function SlotWriter({
  actions = <button type="button">右侧操作</button>,
}: {
  readonly actions?: React.ReactNode
}) {
  const slot = useSystemAppHeaderSlot()

  useEffect(() => {
    slot.setSlot({
      tabs: [
        { id: "one", label: "一" },
        { id: "two", label: "二" },
      ],
      value: "one",
      onValueChange: vi.fn(),
      actions,
    })
    return () => slot.setSlot(null)
  }, [actions, slot])

  return <div>内容</div>
}

describe("EmbeddedSystemAppShell", () => {
  const roots: Root[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => {
        root.unmount()
      })
    }
    document.body.innerHTML = ""
  })

  it("renders registered app tabs in the centered embedded header", async () => {
    await renderEmbeddedShell(roots, <SlotWriter />)

    const header = document.querySelector("[data-embedded-system-app-header]")
    const tabs = document.querySelector("[data-embedded-system-app-tabs]")
    expect(header?.className).toContain("grid-cols-[minmax(0,1fr)_minmax(0,max-content)_minmax(0,1fr)]")
    expect(tabs?.textContent).toContain("一")
    expect(tabs?.textContent).toContain("二")
    expect(tabs?.parentElement).toBe(header)
  })

  it("renders registered app actions before the open window action", async () => {
    await renderEmbeddedShell(roots, <SlotWriter />)

    const actions = document.querySelector("[data-embedded-system-app-actions]")
    expect(actions?.textContent).toContain("右侧操作")
    expect(actions?.querySelector("button[aria-label='新窗口打开']")).toBeTruthy()
    const buttons = Array.from(actions?.querySelectorAll("button") ?? [])
    expect(buttons[0]?.textContent).toContain("右侧操作")
    expect(buttons.at(-1)?.getAttribute("aria-label")).toBe("新窗口打开")
  })

  it("keeps only the open window action when no slot is registered", async () => {
    await renderEmbeddedShell(roots, <div>内容</div>)

    expect(document.querySelector("[data-embedded-system-app-tabs]")).toBeNull()
    expect(document.querySelector("[data-embedded-system-app-actions] button[aria-label='新窗口打开']")).toBeTruthy()
  })
})

async function renderEmbeddedShell(roots: Root[], children: React.ReactNode): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <EmbeddedSystemAppShell
        appName="资源仓库"
        onBack={vi.fn()}
        onOpenWindow={vi.fn()}
      >
        {children}
      </EmbeddedSystemAppShell>,
    )
    await Promise.resolve()
  })
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/apps/components/__tests__/embedded-system-app-shell.test.tsx
```

Expected: FAIL because `EmbeddedSystemAppShell` does not provide or render registered slot content.

- [ ] **Step 3: Update EmbeddedSystemAppShell**

Modify `desktop/src/modules/apps/components/embedded-system-app-shell.tsx`:

```tsx
import { ArrowLeft, ExternalLink } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { SystemAppHeaderSlotProvider, useSystemAppHeaderSlot } from "./system-app-header-slot"
```

Keep the existing props type, then split the component into a provider wrapper and an inner component:

```tsx
function EmbeddedSystemAppShell(props: EmbeddedSystemAppShellProps) {
  return (
    <SystemAppHeaderSlotProvider>
      <EmbeddedSystemAppShellInner {...props} />
    </SystemAppHeaderSlotProvider>
  )
}

function EmbeddedSystemAppShellInner({
  appName,
  children,
  onBack,
  onOpenWindow,
}: EmbeddedSystemAppShellProps) {
  const { slot } = useSystemAppHeaderSlot()
  const hasTabs = Boolean(slot?.tabs?.length && slot.value && slot.onValueChange)

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div
        data-embedded-system-app-header
        className="grid min-h-10 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,max-content)_minmax(0,1fr)] items-center gap-2 border-b bg-background px-3"
      >
        <div data-embedded-system-app-left className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="返回应用列表"
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
          <h2 className="truncate text-sm font-semibold">{appName}</h2>
        </div>
        {hasTabs ? (
          <div data-embedded-system-app-tabs className="min-w-0 justify-self-center">
            <Tabs value={slot?.value} onValueChange={(next) => slot?.onValueChange?.(next)}>
              <TabsList>
                {slot?.tabs?.map((tab) => (
                  <TabsTrigger key={tab.id} value={tab.id} disabled={tab.disabled}>
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        ) : (
          <div className="min-w-0" aria-hidden="true" />
        )}
        <div data-embedded-system-app-actions className="min-w-0 justify-self-end">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {slot?.actions}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label="新窗口打开"
                    onClick={onOpenWindow}
                  >
                    <ExternalLink />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>新窗口打开</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {children}
      </div>
    </div>
  )
}
```

Remove the old flex header markup from this file.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/apps/components/__tests__/embedded-system-app-shell.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/apps/components/embedded-system-app-shell.tsx desktop/src/modules/apps/components/__tests__/embedded-system-app-shell.test.tsx
git commit -m "feat: render embedded system app header slots"
```

---

### Task 3: Register Slots From SystemAppWindowShell

**Files:**
- Modify: `desktop/src/modules/apps/components/system-app-window-shell.tsx`
- Modify: `desktop/src/modules/apps/components/__tests__/system-app-window-shell.test.tsx`

- [ ] **Step 1: Add failing embedded behavior tests**

Append these tests to `desktop/src/modules/apps/components/__tests__/system-app-window-shell.test.tsx`:

```tsx
import { EmbeddedSystemAppShell } from "../embedded-system-app-shell"
```

Add tests inside the existing `describe("SystemAppWindowShell", () => { ... })` block:

```tsx
  it("registers tabs and actions with the embedded header instead of rendering its own toolbar", async () => {
    const onValueChange = vi.fn()

    await renderShell(roots, (
      <EmbeddedSystemAppShell appName="资源仓库" onBack={vi.fn()} onOpenWindow={vi.fn()}>
        <SystemAppWindowShell
          tabs={tabs}
          value="one"
          onValueChange={onValueChange}
          actions={<button type="button">右侧操作</button>}
        >
          <div>内容</div>
        </SystemAppWindowShell>
      </EmbeddedSystemAppShell>
    ))

    expect(document.querySelector("[data-system-app-window-toolbar]")).toBeNull()
    expect(document.querySelector("[data-embedded-system-app-tabs]")?.textContent).toContain("一")
    expect(document.querySelector("[data-embedded-system-app-actions]")?.textContent).toContain("右侧操作")
    expect(document.body.textContent).toContain("内容")
  })

  it("clears the embedded header slot when the system app shell unmounts", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <EmbeddedSystemAppShell appName="资源仓库" onBack={vi.fn()} onOpenWindow={vi.fn()}>
          <SystemAppWindowShell
            tabs={tabs}
            value="one"
            onValueChange={vi.fn()}
            actions={<button type="button">右侧操作</button>}
          >
            <div>内容</div>
          </SystemAppWindowShell>
        </EmbeddedSystemAppShell>,
      )
      await Promise.resolve()
    })

    expect(document.querySelector("[data-embedded-system-app-tabs]")?.textContent).toContain("一")

    await act(async () => {
      root.render(
        <EmbeddedSystemAppShell appName="资源仓库" onBack={vi.fn()} onOpenWindow={vi.fn()}>
          <div>应用列表</div>
        </EmbeddedSystemAppShell>,
      )
      await Promise.resolve()
    })

    expect(document.querySelector("[data-embedded-system-app-tabs]")).toBeNull()
    expect(document.body.textContent).toContain("应用列表")
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/apps/components/__tests__/system-app-window-shell.test.tsx
```

Expected: FAIL because `SystemAppWindowShell` still renders its own toolbar in embedded mode.

- [ ] **Step 3: Update SystemAppWindowShell**

Modify `desktop/src/modules/apps/components/system-app-window-shell.tsx`:

```tsx
import { useEffect, useMemo, type ReactNode } from "react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  useOptionalSystemAppHeaderSlot,
  type SystemAppHeaderSlotState,
  type SystemAppHeaderSlotTab,
} from "./system-app-header-slot"

type SystemAppWindowTab<T extends string = string> = SystemAppHeaderSlotTab & {
  readonly id: T
}
```

Inside `SystemAppWindowShell`, after `const hasTabs = tabs !== undefined`, add:

```tsx
  const embeddedHeaderSlot = useOptionalSystemAppHeaderSlot()
  const slotState = useMemo<SystemAppHeaderSlotState>(() => ({
    tabs: hasTabs ? tabs : undefined,
    value: hasTabs ? value : undefined,
    onValueChange: hasTabs ? (nextValue: string) => onValueChange(nextValue as T) : undefined,
    actions,
  }), [actions, hasTabs, onValueChange, tabs, value])

  useEffect(() => {
    if (!embeddedHeaderSlot) return undefined
    embeddedHeaderSlot.setSlot(slotState)
    return () => {
      embeddedHeaderSlot.setSlot(null)
    }
  }, [embeddedHeaderSlot, slotState])

  if (embeddedHeaderSlot) {
    return (
      <div className="h-full min-h-0 min-w-0 bg-surface">
        {children}
      </div>
    )
  }
```

Keep the existing standalone toolbar return unchanged below this embedded branch.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/apps/components/__tests__/system-app-window-shell.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/apps/components/system-app-window-shell.tsx desktop/src/modules/apps/components/__tests__/system-app-window-shell.test.tsx
git commit -m "feat: register system app header slots"
```

---

### Task 4: Cover AppsModule Embedded Slot Cleanup

**Files:**
- Modify: `desktop/src/modules/apps/__tests__/app-launcher.test.tsx`

- [ ] **Step 1: Update the mocked SystemAppContent to register slot content**

Replace the existing `vi.mock("../components/system-app-content", () => ({ ... }))` block in `desktop/src/modules/apps/__tests__/app-launcher.test.tsx` with:

```tsx
vi.mock("../components/system-app-content", async () => {
  const React = await import("react")
  const { useSystemAppHeaderSlot } = await import("../components/system-app-header-slot")

  return {
    SystemAppContent: ({
      appId,
      onContentOpenRequest,
    }: {
      appId: SynapseSystemAppId
      onContentOpenRequest?: (request: ContentOpenRequest) => void
    }) => {
      const slot = useSystemAppHeaderSlot()

      React.useEffect(() => {
        slot.setSlot({
          tabs: [
            { id: "one", label: `${appId} 一` },
            { id: "two", label: `${appId} 二` },
          ],
          value: "one",
          onValueChange: vi.fn(),
          actions: <button type="button">{appId} 操作</button>,
        })
        return () => slot.setSlot(null)
      }, [appId, slot])

      return (
        <div>
          <span data-testid="system-app-content">{appId} 内容</span>
          <button
            type="button"
            onClick={() => onContentOpenRequest?.({
              kind: "detail",
              requestId: "request-1",
              contentType: "skill",
              contentId: "skill-1",
            })}
          >
            触发内容请求
          </button>
        </div>
      )
    },
  }
})
```

- [ ] **Step 2: Add assertions for embedded header slot rendering and cleanup**

In the `"opens the clicked app in the current window"` test, after the existing content assertions, add:

```tsx
    expect(document.querySelector("[data-embedded-system-app-tabs]")?.textContent).toContain("usage-monitor 一")
    expect(document.querySelector("[data-embedded-system-app-actions]")?.textContent).toContain("usage-monitor 操作")
    expect(document.querySelector("[data-system-app-window-toolbar]")).toBeNull()
```

In the `"returns from an embedded app to the launcher"` test, after returning, add:

```tsx
    expect(document.querySelector("[data-embedded-system-app-tabs]")).toBeNull()
    expect(document.body.textContent).not.toContain("usage-monitor 操作")
```

- [ ] **Step 3: Run the AppsModule tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/apps/__tests__/app-launcher.test.tsx
```

Expected: PASS after Tasks 2 and 3 are implemented. If the async mock has a TypeScript import issue, keep the same behavior but move the mocked component into a local function inside the async factory.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/apps/__tests__/app-launcher.test.tsx
git commit -m "test: cover embedded app header slot cleanup"
```

---

### Task 5: Cover Real Git Embedded Header Behavior

**Files:**
- Modify: `desktop/src/modules/git/__tests__/git-module-list.test.tsx`

- [ ] **Step 1: Add an embedded Git test**

Import the embedded shell:

```tsx
import { EmbeddedSystemAppShell } from "@/modules/apps/components/embedded-system-app-shell"
```

Add this test near the existing `"uses centered system app tabs and repository actions"` test:

```tsx
  it("moves Git tabs and repository actions into the embedded app header", async () => {
    await renderEmbeddedGitModule(roots)

    expect(document.querySelector("[data-system-app-window-toolbar]")).toBeNull()
    expect(document.querySelector("[data-embedded-system-app-tabs]")?.textContent).toContain("仓库")
    expect(document.querySelector("[data-embedded-system-app-tabs]")?.textContent).toContain("环境")
    expect(document.querySelector("[data-embedded-system-app-actions]")?.textContent).toContain("添加本地仓库")
    expect(document.querySelector("[data-embedded-system-app-actions]")?.textContent).toContain("克隆仓库")
    expect(document.querySelector("[data-embedded-system-app-actions] button[aria-label='新窗口打开']")).toBeTruthy()
  })
```

Add this helper near the existing `renderGitModule` helper:

```tsx
async function renderEmbeddedGitModule(roots: Root[]): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <EmbeddedSystemAppShell
        appName="Git"
        onBack={vi.fn()}
        onOpenWindow={vi.fn()}
      >
        <GitModule />
      </EmbeddedSystemAppShell>,
    )
    await Promise.resolve()
  })
}
```

- [ ] **Step 2: Run the Git module tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/git/__tests__/git-module-list.test.tsx
```

Expected: PASS. The existing standalone test should still find `[data-system-app-window-toolbar]`, and the new embedded test should not.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/git/__tests__/git-module-list.test.tsx
git commit -m "test: cover embedded git header slots"
```

---

### Task 6: Add Release Note

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Read the current release notes format**

Run:

```bash
sed -n '1,120p' RELEASE_NOTES_PENDING.md
```

Expected: shows the current pending release note sections.

- [ ] **Step 2: Add a user-facing note**

Add this note under the most appropriate existing section, or create a short UI/体验 section if the file already uses grouped sections:

```md
- 应用中心内打开系统应用时，应用内的标签和操作会合并到顶部应用栏，减少重复标题栏占用。
```

- [ ] **Step 3: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note embedded app header cleanup"
```

---

### Task 7: Final Verification

**Files:**
- No code changes unless verification reveals a defect.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- \
  desktop/src/modules/apps/components/__tests__/embedded-system-app-shell.test.tsx \
  desktop/src/modules/apps/components/__tests__/system-app-window-shell.test.tsx \
  desktop/src/modules/apps/__tests__/app-launcher.test.tsx \
  desktop/src/modules/git/__tests__/git-module-list.test.tsx
```

Expected: PASS for all targeted tests.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: no uncommitted changes after the task commits, or only intentional changes if the executor chooses one final squashed commit instead of per-task commits.

- [ ] **Step 4: Final implementation note**

Report:

```text
Implemented embedded system app header slots. Embedded system apps now render their tabs/actions in the Apps module shell header, while standalone system app windows retain their toolbar. Targeted tests and typecheck passed.
```
