# Terminal Toolbar Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact toolbar above each active terminal pane with built-in actions for interrupt, local clear, and common shell launch commands.

**Architecture:** Keep the feature inside `desktop/app-capabilities/terminal/renderer`. Add a small renderer-only toolbar action registry, then wire the registry into `TerminalModule` using existing xterm refs and `terminalBridge.writeSession`; no main-process, schema, DataRepository, or MCP changes are needed.

**Tech Stack:** Electron 41, React 19, TypeScript 6, Vitest, jsdom, xterm, shadcn/Radix UI, Tailwind token classes.

---

## File Map

- Create `desktop/app-capabilities/terminal/renderer/terminal-toolbar-actions.ts`: renderer-owned built-in toolbar action definitions, platform filtering, payload resolution, and availability helpers.
- Create `desktop/app-capabilities/terminal/renderer/__tests__/terminal-toolbar-actions.test.ts`: pure tests for platform filtering, payload resolution, and session-status availability.
- Modify `desktop/app-capabilities/terminal/renderer/index.tsx`: render the toolbar, keep a ref to the active xterm instance, execute toolbar actions, and preserve existing xterm lifecycle.
- Modify `desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx`: add xterm `clear` mock support and cover toolbar rendering, writes, disabled states, local clear, and rejected writes.
- Modify `RELEASE_NOTES_PENDING.md`: add a user-facing release note for terminal toolbar actions.

## Task 1: Toolbar Action Registry

**Files:**
- Create: `desktop/app-capabilities/terminal/renderer/terminal-toolbar-actions.ts`
- Create: `desktop/app-capabilities/terminal/renderer/__tests__/terminal-toolbar-actions.test.ts`

- [ ] **Step 1: Write the registry tests**

Create `desktop/app-capabilities/terminal/renderer/__tests__/terminal-toolbar-actions.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  TERMINAL_TOOLBAR_ACTIONS,
  getTerminalToolbarActions,
  isTerminalToolbarActionEnabled,
  resolveTerminalToolbarPayload,
} from "../terminal-toolbar-actions"

describe("terminal toolbar actions", () => {
  it("exposes the built-in actions in stable display order", () => {
    expect(TERMINAL_TOOLBAR_ACTIONS.map((action) => action.id)).toEqual([
      "interrupt",
      "clear",
      "claude",
      "codex",
      "vscode",
    ])
    expect(TERMINAL_TOOLBAR_ACTIONS.map((action) => action.label)).toEqual([
      "Ctrl+C",
      "Clear",
      "Claude",
      "Codex",
      "code .",
    ])
  })

  it("keeps only actions supported on the current renderer platform", () => {
    expect(getTerminalToolbarActions("darwin").map((action) => action.id)).toEqual([
      "interrupt",
      "clear",
      "claude",
      "codex",
      "vscode",
    ])
    expect(getTerminalToolbarActions("sunos").map((action) => action.id)).toEqual([])
  })

  it("resolves terminal sequences and shell commands for the active platform", () => {
    const interrupt = TERMINAL_TOOLBAR_ACTIONS.find((action) => action.id === "interrupt")
    const claude = TERMINAL_TOOLBAR_ACTIONS.find((action) => action.id === "claude")

    expect(interrupt ? resolveTerminalToolbarPayload(interrupt, "win32") : null).toBe("\x03")
    expect(claude ? resolveTerminalToolbarPayload(claude, "darwin") : null).toBe("claude")
  })

  it("treats running-only actions as disabled for non-running sessions", () => {
    const interrupt = TERMINAL_TOOLBAR_ACTIONS.find((action) => action.id === "interrupt")
    const clear = TERMINAL_TOOLBAR_ACTIONS.find((action) => action.id === "clear")
    if (!interrupt || !clear) throw new Error("Missing toolbar actions")

    expect(isTerminalToolbarActionEnabled(interrupt, "running")).toBe(true)
    expect(isTerminalToolbarActionEnabled(interrupt, "lost")).toBe(false)
    expect(isTerminalToolbarActionEnabled(interrupt, "exited")).toBe(false)
    expect(isTerminalToolbarActionEnabled(interrupt, "killed")).toBe(false)
    expect(isTerminalToolbarActionEnabled(interrupt, "failed")).toBe(false)
    expect(isTerminalToolbarActionEnabled(clear, "lost")).toBe(true)
  })
})
```

- [ ] **Step 2: Run the registry tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/renderer/__tests__/terminal-toolbar-actions.test.ts
```

Expected: FAIL with an import error because `terminal-toolbar-actions.ts` does not exist yet.

- [ ] **Step 3: Implement the registry**

Create `desktop/app-capabilities/terminal/renderer/terminal-toolbar-actions.ts`:

```ts
import type { SynapseTerminalSession } from "../../../src/types/terminal"

export type TerminalToolbarPlatform = "darwin" | "win32" | "linux"
export type TerminalToolbarAvailability = "running-session" | "any-session"

type PlatformPayload = string | Partial<Record<TerminalToolbarPlatform, string>>

type TerminalToolbarActionBase = {
  readonly id: string
  readonly label: string
  readonly ariaLabel: string
  readonly platforms: readonly TerminalToolbarPlatform[]
  readonly availability: TerminalToolbarAvailability
}

export type TerminalToolbarAction =
  | (TerminalToolbarActionBase & {
      readonly kind: "terminal-sequence"
      readonly sequence: PlatformPayload
    })
  | (TerminalToolbarActionBase & {
      readonly kind: "xterm-local"
      readonly operation: "clear"
    })
  | (TerminalToolbarActionBase & {
      readonly kind: "shell-command"
      readonly command: PlatformPayload
    })

const ALL_PLATFORMS = ["darwin", "win32", "linux"] as const

export const TERMINAL_TOOLBAR_ACTIONS: readonly TerminalToolbarAction[] = [
  {
    id: "interrupt",
    label: "Ctrl+C",
    ariaLabel: "中断当前进程",
    platforms: ALL_PLATFORMS,
    availability: "running-session",
    kind: "terminal-sequence",
    sequence: "\x03",
  },
  {
    id: "clear",
    label: "Clear",
    ariaLabel: "清空终端显示",
    platforms: ALL_PLATFORMS,
    availability: "any-session",
    kind: "xterm-local",
    operation: "clear",
  },
  {
    id: "claude",
    label: "Claude",
    ariaLabel: "运行 claude",
    platforms: ALL_PLATFORMS,
    availability: "running-session",
    kind: "shell-command",
    command: "claude",
  },
  {
    id: "codex",
    label: "Codex",
    ariaLabel: "运行 codex",
    platforms: ALL_PLATFORMS,
    availability: "running-session",
    kind: "shell-command",
    command: "codex",
  },
  {
    id: "vscode",
    label: "code .",
    ariaLabel: "用 VS Code 打开当前目录",
    platforms: ALL_PLATFORMS,
    availability: "running-session",
    kind: "shell-command",
    command: "code .",
  },
] as const

export function getTerminalToolbarActions(platform: string | undefined): readonly TerminalToolbarAction[] {
  const normalized = normalizeTerminalToolbarPlatform(platform)
  if (!normalized) return []
  return TERMINAL_TOOLBAR_ACTIONS.filter((action) => action.platforms.includes(normalized))
}

export function resolveTerminalToolbarPayload(
  action: Extract<TerminalToolbarAction, { kind: "terminal-sequence" | "shell-command" }>,
  platform: string | undefined,
): string | undefined {
  const normalized = normalizeTerminalToolbarPlatform(platform)
  const payload = action.kind === "terminal-sequence" ? action.sequence : action.command
  if (typeof payload === "string") return payload
  return normalized ? payload[normalized] : undefined
}

export function isTerminalToolbarActionEnabled(
  action: TerminalToolbarAction,
  status: SynapseTerminalSession["status"] | null | undefined,
): boolean {
  if (action.availability === "any-session") return Boolean(status)
  return status === "running"
}

function normalizeTerminalToolbarPlatform(platform: string | undefined): TerminalToolbarPlatform | undefined {
  if (platform === "darwin" || platform === "win32" || platform === "linux") return platform
  return undefined
}
```

- [ ] **Step 4: Run the registry tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/renderer/__tests__/terminal-toolbar-actions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the registry**

Run:

```bash
git add desktop/app-capabilities/terminal/renderer/terminal-toolbar-actions.ts desktop/app-capabilities/terminal/renderer/__tests__/terminal-toolbar-actions.test.ts
git commit -m "feat(terminal): add toolbar action registry"
```

Expected: commit succeeds.

## Task 2: Renderer Toolbar Behavior

**Files:**
- Modify: `desktop/app-capabilities/terminal/renderer/index.tsx`
- Modify: `desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx`

- [ ] **Step 1: Extend the xterm test mock with local clear support**

In `desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx`, extend the `xtermState.instances` type with `clear`:

```ts
  instances: [] as Array<{
    open: ReturnType<typeof vi.fn>
    write: ReturnType<typeof vi.fn>
    clear: ReturnType<typeof vi.fn>
    loadAddon: ReturnType<typeof vi.fn>
    onData: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    cols: number
    rows: number
    emitInput: (data: string) => void
    inputDispose: ReturnType<typeof vi.fn>
    inputListener: ((data: string) => void) | null
  }>,
```

In the xterm mock implementation, add the `clear` function next to `write`:

```ts
      clear: vi.fn(),
```

- [ ] **Step 2: Add failing renderer tests for toolbar behavior**

In `desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx`, add these tests near the existing active terminal surface tests:

```ts
  it("renders a compact toolbar above the active terminal surface", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()

    const toolbar = document.body.querySelector("[data-terminal-toolbar]")
    const terminalRegion = document.querySelector("[aria-label='终端输出与输入']")
    expect(toolbar).toBeTruthy()
    expect(toolbar?.classList.contains("overflow-x-auto")).toBe(true)
    expect(toolbar?.classList.contains("whitespace-nowrap")).toBe(true)
    if (!toolbar || !terminalRegion) throw new Error("Missing terminal toolbar or region")
    expect(toolbar.compareDocumentPosition(terminalRegion)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(document.body.textContent).toContain("Ctrl+C")
    expect(document.body.textContent).toContain("Clear")
    expect(document.body.textContent).toContain("Claude")
    expect(document.body.textContent).toContain("Codex")
    expect(document.body.textContent).toContain("code .")
  })

  it("does not render the toolbar in the empty terminal state", async () => {
    await renderModule()

    expect(document.body.querySelector("[data-terminal-toolbar]")).toBeNull()
    expect(document.body.textContent).toContain("新建终端")
  })

  it("writes interrupt and shell launcher actions into the running terminal", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()
    await clickButton("Ctrl+C")
    await clickButton("Claude")
    await clickButton("Codex")
    await clickButton("code .")

    expect(terminalBridge.writeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      data: "\x03",
    })
    expect(terminalBridge.writeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      data: "claude\r",
    })
    expect(terminalBridge.writeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      data: "codex\r",
    })
    expect(terminalBridge.writeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      data: "code .\r",
    })
  })

  it("keeps running-only toolbar actions disabled for a lost session while allowing local clear", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({
      id: "session-1",
      groupId: "group-1",
      title: "开发终端",
      status: "lost",
    })]

    await renderModule()

    expect(buttonForText("Ctrl+C")?.disabled).toBe(true)
    expect(buttonForText("Claude")?.disabled).toBe(true)
    expect(buttonForText("Codex")?.disabled).toBe(true)
    expect(buttonForText("code .")?.disabled).toBe(true)
    expect(buttonForText("Clear")?.disabled).toBe(false)

    await clickButton("Clear")

    expect(xtermState.instances[0]?.clear).toHaveBeenCalled()
    expect(terminalBridge.writeSession).not.toHaveBeenCalled()
  })

  it("shows a user-visible error when a toolbar write fails", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    terminalBridge.writeSession.mockRejectedValueOnce(new Error("write failed"))

    await renderModule()
    await clickButton("Ctrl+C")

    expect(toastState.error).toHaveBeenCalledWith("写入终端失败")
  })
```

Add this helper near `clickButton`:

```ts
function buttonForText(text: string, root: ParentNode = document.body): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll("button"))
    .find((item) => item.textContent === text)
}
```

Then simplify `clickButton` to reuse it:

```ts
async function clickButton(text: string, root: ParentNode = document.body): Promise<void> {
  const button = buttonForText(text, root)
  await act(async () => {
    button?.click()
    await Promise.resolve()
  })
}
```

- [ ] **Step 3: Run the renderer tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx
```

Expected: FAIL because the toolbar is not rendered and no action handlers exist.

- [ ] **Step 4: Import the registry and platform helper**

In `desktop/app-capabilities/terminal/renderer/index.tsx`, add imports:

```ts
import { getRendererPlatform } from "../../../src/lib/runtime-platform"
import {
  getTerminalToolbarActions,
  isTerminalToolbarActionEnabled,
  resolveTerminalToolbarPayload,
  type TerminalToolbarAction,
} from "./terminal-toolbar-actions"
```

- [ ] **Step 5: Add xterm instance state and toolbar action list**

In `TerminalModule`, add a ref beside `terminalContainerRef`:

```ts
  const terminalContainerRef = useRef<HTMLDivElement | null>(null)
  const xtermRef = useRef<Terminal | null>(null)
```

Add platform and toolbar actions after `activeSessionRunning`:

```ts
  const rendererPlatform = getRendererPlatform()
  const toolbarActions = useMemo(
    () => getTerminalToolbarActions(rendererPlatform),
    [rendererPlatform],
  )
```

- [ ] **Step 6: Add the toolbar executor**

In `TerminalModule`, add this callback before the xterm `useEffect`:

```ts
  const runToolbarAction = useCallback(async (action: TerminalToolbarAction) => {
    if (!activeSession) return
    if (!isTerminalToolbarActionEnabled(action, activeSession.status)) return

    if (action.kind === "xterm-local") {
      if (action.operation === "clear") {
        xtermRef.current?.clear()
      }
      return
    }

    const payload = resolveTerminalToolbarPayload(action, rendererPlatform)
    if (!payload) return

    const data = action.kind === "shell-command" ? `${payload}\r` : payload
    try {
      await terminalBridge.writeSession({
        sessionId: activeSession.id,
        data,
      })
    } catch (error) {
      logger.error("Failed to run terminal toolbar action.", error)
      toast.error("写入终端失败")
    }
  }, [activeSession, rendererPlatform, terminalBridge])
```

- [ ] **Step 7: Store and clear the active xterm ref**

In the xterm `useEffect`, after `const xterm = new Terminal(...)`, set:

```ts
    xtermRef.current = xterm
```

In the effect cleanup, before or after `xterm.dispose()`, add:

```ts
      if (xtermRef.current === xterm) {
        xtermRef.current = null
      }
```

- [ ] **Step 8: Render the toolbar above the xterm region**

Inside the active-session branch, between the `terminalReadError` block and the terminal container `<div>`, add:

```tsx
              {toolbarActions.length ? (
                <div
                  data-terminal-toolbar
                  className="flex shrink-0 items-center gap-1 overflow-x-auto border-b bg-background px-2 py-1 whitespace-nowrap"
                >
                  {toolbarActions.map((action) => (
                    <Button
                      key={action.id}
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={action.ariaLabel}
                      disabled={!isTerminalToolbarActionEnabled(action, terminalSessionStatus)}
                      onClick={() => { void runToolbarAction(action) }}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              ) : null}
```

- [ ] **Step 9: Run the renderer tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Run the registry tests again**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/renderer/__tests__/terminal-toolbar-actions.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit renderer toolbar behavior**

Run:

```bash
git add desktop/app-capabilities/terminal/renderer/index.tsx desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx
git commit -m "feat(terminal): add active pane toolbar"
```

Expected: commit succeeds.

## Task 3: Release Note And Final Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`
- Read: `desktop/app-capabilities/terminal/renderer/index.tsx`
- Read: `desktop/app-capabilities/terminal/renderer/terminal-toolbar-actions.ts`

- [ ] **Step 1: Add the release note**

Open `RELEASE_NOTES_PENDING.md` and add this user-facing bullet under the current pending release section:

```md
- 终端会话顶部新增常用操作栏，可以直接中断当前进程、清空显示，并快速输入 Claude、Codex 和 `code .` 等常用命令。
```

- [ ] **Step 2: Scan for forbidden UI styling**

Run:

```bash
rg -n "style=\\{\\{|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|bg-\\[|text-\\[|from-|to-|gradient|shadow" desktop/app-capabilities/terminal/renderer/index.tsx desktop/app-capabilities/terminal/renderer/terminal-toolbar-actions.ts
```

Expected: no new toolbar-related forbidden custom styling. Existing unrelated matches should be inspected and left unchanged.

- [ ] **Step 3: Run focused terminal renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/renderer/__tests__/terminal-toolbar-actions.test.ts desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run typecheck for the desktop package**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS. If this package does not expose `typecheck`, run `pnpm --filter @synapse/desktop exec tsc --noEmit` and record the exact result.

- [ ] **Step 5: Commit release note and verification cleanup**

Run:

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note terminal toolbar actions"
```

Expected: commit succeeds.

## Self-Review

Spec coverage:

- Top toolbar placement is implemented in Task 2 Step 8.
- Built-in code-level registry is implemented in Task 1.
- Platform filtering uses `window.synapse.platform` through `getRendererPlatform()` in Task 2.
- `Ctrl+C`, `Clear`, `Claude`, `Codex`, and `code .` are covered by Task 1 tests and Task 2 renderer tests.
- Running-only disabled behavior and local clear behavior are covered by Task 2 tests.
- No main-process, schema, DataRepository, or MCP changes are included.
- Release notes are covered by Task 3.

Type consistency:

- The registry exports `TerminalToolbarAction`, `getTerminalToolbarActions`, `resolveTerminalToolbarPayload`, and `isTerminalToolbarActionEnabled`.
- The renderer uses existing `SynapseTerminalSession["status"]`, `Terminal` from xterm, `terminalBridge.writeSession`, and `getRendererPlatform()`.
- Shell command submission uses `\r`, matching current xterm user input behavior.
