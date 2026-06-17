# Agent Create Session Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users name a new Agent conversation inside the provider/model selection dialog while keeping the shared dialog's default behavior unchanged.

**Architecture:** Add an optional, generic confirm-input extension to `ProviderModelSelectDialog`; Agent sidebar supplies the initial value and consumes the submitted value. The Agent chat creation hook accepts an optional name and falls back to the existing `新会话 HH:mm` name when no name is supplied.

**Tech Stack:** Electron renderer, React 19, TypeScript, shadcn/ui `Button` and `Input`, Tailwind token classes, Vitest/jsdom.

---

## File Structure

- Modify `desktop/src/components/provider-model-select-dialog.tsx`
  - Adds `confirmInput` prop and optional select metadata.
  - Renders a generic footer input only when configured.
  - Keeps existing provider/model selection logic unchanged.

- Modify `desktop/src/components/__tests__/provider-model-select-dialog.test.tsx`
  - Covers default behavior and optional confirm-input behavior.

- Create `desktop/src/modules/agent/create-session-name.ts`
  - Pure formatter for Agent create-session default names.
  - No React and no bridge calls.

- Create `desktop/src/modules/agent/__tests__/create-session-name.test.ts`
  - Covers morning, afternoon, noon, midnight, and minute padding.

- Modify `desktop/src/modules/agent/components/agent-session-sidebar.tsx`
  - Stores target project plus generated default name when opening the dialog.
  - Passes `confirmInput` to the shared dialog.
  - Sends the returned name to `onCreateSession`.

- Modify `desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx`
  - Covers default input value and edited name submission.

- Modify `desktop/src/modules/agent/hooks/use-agent-chat.ts`
  - Adds optional `name` argument to the public `createSession` type.

- Modify `desktop/src/modules/agent/hooks/use-chat-connection.ts`
  - Adds optional `name` argument to `createSession`.
  - Uses supplied trimmed name or the existing fallback.

- Modify `desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx`
  - Covers forwarding the explicit session name and preserving fallback behavior.

- Modify `desktop/src/modules/agent/index.tsx`
  - Passes `name` from sidebar creation callback into `chat.createSession`.

- Modify `RELEASE_NOTES_PENDING.md`
  - Adds a short user-facing note under `## 功能优化`.

---

### Task 1: Shared Dialog Confirm Input

**Files:**
- Modify: `desktop/src/components/provider-model-select-dialog.tsx`
- Test: `desktop/src/components/__tests__/provider-model-select-dialog.test.tsx`

- [ ] **Step 1: Write failing tests for default and confirm-input behavior**

Append these tests inside the existing `describe("ProviderModelSelectDialog", () => { ... })` block in `desktop/src/components/__tests__/provider-model-select-dialog.test.tsx`:

```tsx
  it("keeps the default footer without confirm input", async () => {
    bridge.agent.listProviders.mockResolvedValue([
      provider({ id: "anthropic", name: "Claude Official", active: true, model: "claude-main", sonnetModel: "claude-sonnet" }),
    ])
    const { root, ...props } = renderDialog()

    await act(async () => {
      root.render(<ProviderModelSelectDialog {...props} />)
      await Promise.resolve()
    })

    expect(document.querySelector("input[aria-label='会话名称']")).toBeNull()

    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "确认")
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(props.onSelect).toHaveBeenCalledWith({
      providerId: "anthropic",
      modelTier: "sonnet",
      providerName: "Claude Official",
      modelName: "claude-sonnet",
    })
  })

  it("returns trimmed confirm input metadata when configured", async () => {
    bridge.agent.listProviders.mockResolvedValue([
      provider({ id: "anthropic", name: "Claude Official", active: true, model: "claude-main", sonnetModel: "claude-sonnet" }),
    ])
    const { root, ...props } = renderDialog({
      confirmInput: {
        initialValue: "24日下午1:30",
        ariaLabel: "会话名称",
      },
    })

    await act(async () => {
      root.render(<ProviderModelSelectDialog {...props} />)
      await Promise.resolve()
    })

    const input = document.querySelector<HTMLInputElement>("input[aria-label='会话名称']")
    expect(input?.value).toBe("24日下午1:30")

    await act(async () => {
      if (!input) return
      input.value = "  需求复盘  "
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "确认")
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(props.onSelect).toHaveBeenCalledWith({
      providerId: "anthropic",
      modelTier: "sonnet",
      providerName: "Claude Official",
      modelName: "claude-sonnet",
    }, {
      confirmInputValue: "需求复盘",
    })
  })

  it("disables confirm when configured confirm input is blank", async () => {
    bridge.agent.listProviders.mockResolvedValue([
      provider({ id: "anthropic", name: "Claude Official", active: true, model: "claude-main", sonnetModel: "claude-sonnet" }),
    ])
    const { root, ...props } = renderDialog({
      confirmInput: {
        initialValue: "24日下午1:30",
        ariaLabel: "会话名称",
      },
    })

    await act(async () => {
      root.render(<ProviderModelSelectDialog {...props} />)
      await Promise.resolve()
    })

    const input = document.querySelector<HTMLInputElement>("input[aria-label='会话名称']")
    await act(async () => {
      if (!input) return
      input.value = "   "
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "确认")
    expect(confirmButton?.disabled).toBe(true)
  })

  it("submits confirm input with Enter", async () => {
    bridge.agent.listProviders.mockResolvedValue([
      provider({ id: "anthropic", name: "Claude Official", active: true, model: "claude-main", sonnetModel: "claude-sonnet" }),
    ])
    const { root, ...props } = renderDialog({
      confirmInput: {
        initialValue: "24日下午1:30",
        ariaLabel: "会话名称",
      },
    })

    await act(async () => {
      root.render(<ProviderModelSelectDialog {...props} />)
      await Promise.resolve()
    })

    const input = document.querySelector<HTMLInputElement>("input[aria-label='会话名称']")
    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })

    expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "anthropic",
      modelTier: "sonnet",
    }), {
      confirmInputValue: "24日下午1:30",
    })
  })
```

- [ ] **Step 2: Run the focused shared-dialog test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/components/__tests__/provider-model-select-dialog.test.tsx
```

Expected: FAIL because `confirmInput` is not a recognized prop, no input renders, and `onSelect` does not receive metadata.

- [ ] **Step 3: Implement the shared dialog API and footer input**

In `desktop/src/components/provider-model-select-dialog.tsx`, add the `Input` import:

```tsx
import { Input } from "@/components/ui/input"
```

Replace the props type block with:

```tsx
type ProviderModelSelectDialogConfirmInput = {
  readonly initialValue: string
  readonly placeholder?: string
  readonly ariaLabel: string
}

type ProviderModelSelectDialogSelectMeta = {
  readonly confirmInputValue?: string
}

type ProviderModelSelectDialogProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSelect: (
    selection: ProviderModelSelection,
    meta?: ProviderModelSelectDialogSelectMeta,
  ) => void | Promise<void>
  readonly defaultSelection?: ProviderModelSelection
  readonly excludeProviderIds?: readonly string[]
  readonly confirmInput?: ProviderModelSelectDialogConfirmInput
}
```

Include `confirmInput` in the component parameters:

```tsx
function ProviderModelSelectDialog({
  open,
  onOpenChange,
  onSelect,
  defaultSelection,
  excludeProviderIds = EMPTY_EXCLUDED_PROVIDERS,
  confirmInput,
}: ProviderModelSelectDialogProps) {
```

Add state near the other `useState` calls:

```tsx
  const [confirmInputValue, setConfirmInputValue] = useState(confirmInput?.initialValue ?? "")
```

Add this effect after the existing load effect:

```tsx
  useEffect(() => {
    if (!open) return
    setConfirmInputValue(confirmInput?.initialValue ?? "")
  }, [confirmInput?.initialValue, open])
```

Replace the `canConfirm` computation with:

```tsx
  const confirmInputTrimmedValue = confirmInput ? confirmInputValue.trim() : undefined
  const confirmInputValid = !confirmInput || Boolean(confirmInputTrimmedValue)
  const canConfirm = selectedProviderAvailable
    && selectedTier !== undefined
    && confirmInputValid
    && !loading
    && !error
    && !saving
```

In `handleConfirm`, replace the `onSelect` call with:

```tsx
      await onSelect(
        { providerId: selectedProviderId, modelTier: selectedTier, providerName, modelName },
        confirmInput ? { confirmInputValue: confirmInputTrimmedValue } : undefined,
      )
```

Add `confirmInput`, `confirmInputTrimmedValue` to the `handleConfirm` dependency array.

Replace the `DialogFooter` with:

```tsx
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          {confirmInput ? (
            <Input
              aria-label={confirmInput.ariaLabel}
              value={confirmInputValue}
              placeholder={confirmInput.placeholder}
              disabled={saving}
              onChange={(event) => setConfirmInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return
                event.preventDefault()
                void handleConfirm()
              }}
            />
          ) : null}
          <Button
            type="button"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            {saving ? "正在保存..." : "确认"}
          </Button>
        </DialogFooter>
```

At the bottom, export the new types:

```tsx
export { ProviderModelSelectDialog }
export type {
  ProviderModelSelectDialogConfirmInput,
  ProviderModelSelectDialogProps,
  ProviderModelSelectDialogSelectMeta,
}
```

- [ ] **Step 4: Run the focused shared-dialog test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/components/__tests__/provider-model-select-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit shared dialog changes**

Run:

```bash
git add desktop/src/components/provider-model-select-dialog.tsx desktop/src/components/__tests__/provider-model-select-dialog.test.tsx
git commit -m "feat(agent): add provider dialog confirm input"
```

---

### Task 2: Agent Default Create-Session Name

**Files:**
- Create: `desktop/src/modules/agent/create-session-name.ts`
- Create: `desktop/src/modules/agent/__tests__/create-session-name.test.ts`

- [ ] **Step 1: Write the failing formatter tests**

Create `desktop/src/modules/agent/__tests__/create-session-name.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { formatCreateSessionName } from "../create-session-name"

describe("formatCreateSessionName", () => {
  it("formats afternoon names without zero-padding the hour", () => {
    expect(formatCreateSessionName(new Date(2026, 5, 24, 13, 30))).toBe("24日下午1:30")
  })

  it("formats morning names and pads minutes", () => {
    expect(formatCreateSessionName(new Date(2026, 5, 3, 9, 5))).toBe("3日上午9:05")
  })

  it("formats noon as afternoon 12", () => {
    expect(formatCreateSessionName(new Date(2026, 5, 24, 12, 0))).toBe("24日下午12:00")
  })

  it("formats midnight as morning 12", () => {
    expect(formatCreateSessionName(new Date(2026, 5, 24, 0, 7))).toBe("24日上午12:07")
  })
})
```

- [ ] **Step 2: Run the formatter test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/create-session-name.test.ts
```

Expected: FAIL because `desktop/src/modules/agent/create-session-name.ts` does not exist.

- [ ] **Step 3: Implement the formatter**

Create `desktop/src/modules/agent/create-session-name.ts`:

```ts
function formatCreateSessionName(date: Date): string {
  const day = date.getDate()
  const hour24 = date.getHours()
  const minute = String(date.getMinutes()).padStart(2, "0")
  const period = hour24 < 12 ? "上午" : "下午"
  const hour12 = hour24 % 12 || 12
  return `${day}日${period}${hour12}:${minute}`
}

export { formatCreateSessionName }
```

- [ ] **Step 4: Run the formatter test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/create-session-name.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit formatter changes**

Run:

```bash
git add desktop/src/modules/agent/create-session-name.ts desktop/src/modules/agent/__tests__/create-session-name.test.ts
git commit -m "feat(agent): format create session names"
```

---

### Task 3: Sidebar Name Input Integration

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-session-sidebar.tsx`
- Modify: `desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx`

- [ ] **Step 1: Write failing sidebar integration tests**

In `desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx`, add this import:

```ts
import * as createSessionName from "../create-session-name"
```

Append this test inside `describe("AgentSessionSidebar", () => { ... })`:

```tsx
  it("lets users edit the generated name before creating a session", async () => {
    vi.spyOn(createSessionName, "formatCreateSessionName").mockReturnValue("24日下午1:30")
    const onCreateSession = vi.fn()
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([
            {
              id: "anthropic",
              name: "Anthropic",
              category: "official",
              apiKeyField: "ANTHROPIC_API_KEY",
              active: true,
              readonly: true,
              model: "claude-sonnet-4-5",
              sonnetModel: "claude-sonnet-4-5",
              createdAt: "2026-05-13T00:00:00.000Z",
              updatedAt: "2026-05-13T00:00:00.000Z",
            },
          ]),
        },
      },
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentSessionSidebar
          sessions={[]}
          archivedSessions={[]}
          projects={[{ id: "project-1", name: "Test Project", path: "/tmp/test" }]}
          selectedProjectId="project-1"
          selectedConversationId={undefined}
          sourceFilter="user"
          unreadByConversationId={{}}
          sendingConversationIds={new Set()}
          onCreateSession={onCreateSession}
          onSourceFilterChange={vi.fn()}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onDeleteOthers={vi.fn()}
          onRename={vi.fn()}
        />,
      )
    })

    await act(async () => {
      document.querySelector<HTMLButtonElement>("button[title='新建会话']")?.click()
      await Promise.resolve()
    })

    const input = document.querySelector<HTMLInputElement>("input[aria-label='会话名称']")
    expect(input?.value).toBe("24日下午1:30")

    await act(async () => {
      if (!input) return
      input.value = "需求复盘"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "确认")
    await act(async () => {
      confirmButton?.click()
    })

    expect(onCreateSession).toHaveBeenCalledWith("project-1", {
      providerId: "anthropic",
      providerName: "Anthropic",
      modelTier: "sonnet",
      modelName: "claude-sonnet-4-5",
    }, "需求复盘")
  })
```

- [ ] **Step 2: Run the sidebar test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-session-sidebar.test.tsx
```

Expected: FAIL because `AgentSessionSidebar` does not pass `confirmInput` or the returned name.

- [ ] **Step 3: Implement sidebar integration**

In `desktop/src/modules/agent/components/agent-session-sidebar.tsx`, add:

```tsx
import { formatCreateSessionName } from "../create-session-name"
```

Replace:

```tsx
  const [createProject, setCreateProject] = useState<ProjectOption | null>(null)
```

with:

```tsx
  const [createTarget, setCreateTarget] = useState<{
    readonly project: ProjectOption
    readonly initialName: string
  } | null>(null)
```

Replace each `createProject` usage with `createTarget`. The `ProjectGroup` creation handler becomes:

```tsx
            onCreateSession={() => setCreateTarget({
              project,
              initialName: formatCreateSessionName(new Date()),
            })}
```

Replace the `ProviderModelSelectDialog` block with:

```tsx
      <ProviderModelSelectDialog
        open={createTarget !== null}
        onOpenChange={(open) => { if (!open) setCreateTarget(null) }}
        defaultSelection={config.agent.defaultProviderModel ?? undefined}
        confirmInput={createTarget ? {
          initialValue: createTarget.initialName,
          ariaLabel: "会话名称",
        } : undefined}
        onSelect={async (selection, meta) => {
          if (!createTarget) return
          await onCreateSession(createTarget.project.id, selection, meta?.confirmInputValue)
          setCreateTarget(null)
        }}
      />
```

Update the prop type:

```tsx
  onCreateSession: (
    projectId: string,
    selection: ProviderModelSelection,
    name?: string,
  ) => void | Promise<void>
```

- [ ] **Step 4: Run the sidebar test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-session-sidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit sidebar integration**

Run:

```bash
git add desktop/src/modules/agent/components/agent-session-sidebar.tsx desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx
git commit -m "feat(agent): collect new session name"
```

---

### Task 4: Chat Creation Name Plumbing

**Files:**
- Modify: `desktop/src/modules/agent/hooks/use-agent-chat.ts`
- Modify: `desktop/src/modules/agent/hooks/use-chat-connection.ts`
- Modify: `desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx`
- Modify: `desktop/src/modules/agent/index.tsx`

- [ ] **Step 1: Write failing hook tests for explicit and fallback names**

In `desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx`, append this test near the existing `createSession` tests:

```tsx
  it("creates an Agent session with an explicit name", async () => {
    let chat: ReturnType<typeof useAgentChat> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <HookProbe onChange={(next) => {
          chat = next
        }}
        />,
      )
    })
    await waitFor(() => chat?.selectedConversationId === session.id)

    await act(async () => {
      await chat?.createSession("project-1", "provider-1", "bypassPermissions", "opus", "需求复盘")
    })

    expect((window as unknown as {
      synapse: {
        agent: {
          createSession: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent.createSession).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      providerId: "provider-1",
      mode: "bypassPermissions",
      modelTier: "opus",
      name: "需求复盘",
    }))
  })
```

Append this fallback test after it:

```tsx
  it("keeps the existing fallback name when no explicit name is supplied", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 24, 13, 30))
    try {
      let chat: ReturnType<typeof useAgentChat> | undefined
      const container = document.createElement("div")
      document.body.appendChild(container)
      const root = createRoot(container)
      roots.push(root)

      await act(async () => {
        root.render(
          <HookProbe onChange={(next) => {
            chat = next
          }}
          />,
        )
      })
      await waitFor(() => chat?.selectedConversationId === session.id)

      await act(async () => {
        await chat?.createSession("project-1", "provider-1", "bypassPermissions", "opus")
      })

      expect((window as unknown as {
        synapse: {
          agent: {
            createSession: ReturnType<typeof vi.fn>
          }
        }
      }).synapse.agent.createSession).toHaveBeenCalledWith(expect.objectContaining({
        name: "新会话 13:30",
      }))
    } finally {
      vi.useRealTimers()
    }
  })
```

- [ ] **Step 2: Run the hook tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx
```

Expected: FAIL because `createSession` does not accept or forward the explicit name.

- [ ] **Step 3: Update hook types and implementation**

In `desktop/src/modules/agent/hooks/use-agent-chat.ts`, change the `createSession` type to:

```ts
  createSession: (
    projectId: string,
    providerId?: string,
    mode?: SynapseAgentPermissionMode,
    modelTier?: string,
    name?: string,
  ) => Promise<void>
```

In `desktop/src/modules/agent/hooks/use-chat-connection.ts`, change the `ChatConnectionResult` `createSession` type to the same signature.

Change the callback signature:

```ts
  const createSession = useCallback(async (
    projectId: string,
    providerId?: string,
    mode?: SynapseAgentPermissionMode,
    modelTier?: string,
    name?: string,
  ) => {
```

Before `bridge.agent.createSession`, add:

```ts
    const sessionName = name?.trim() || `新会话 ${formatSessionNameTime(new Date())}`
```

Replace the existing `name` property in the create request with:

```ts
        name: sessionName,
```

In `desktop/src/modules/agent/index.tsx`, change the sidebar callback to accept `name`:

```tsx
      onCreateSession={async (projectId, selection, name) => {
        if (sourceFilter !== "user") setSourceFilter("user")
        await chat.createSession(projectId, selection.providerId, undefined, selection.modelTier, name)
      }}
```

- [ ] **Step 4: Run the hook tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run the sidebar test again**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-session-sidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit name plumbing**

Run:

```bash
git add desktop/src/modules/agent/hooks/use-agent-chat.ts desktop/src/modules/agent/hooks/use-chat-connection.ts desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx desktop/src/modules/agent/index.tsx
git commit -m "feat(agent): pass new session name"
```

---

### Task 5: Release Note and Final Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Under `## 功能优化` in `RELEASE_NOTES_PENDING.md`, add:

```md
- Agent 新建会话时可以在选择供应商和模型的弹窗里直接修改会话名称，默认名称会按当前日期时间生成。
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/components/__tests__/provider-model-select-dialog.test.tsx \
  src/modules/agent/__tests__/create-session-name.test.ts \
  src/modules/agent/__tests__/agent-session-sidebar.test.tsx \
  src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit release note and verification-ready state**

Run:

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs(agent): note create session naming"
```

---

## Self-Review

- Spec coverage: The plan covers shared component extension, external default-name generation, blank input disabling, Agent sidebar integration, optional `createSession` name plumbing, fallback preservation, tests, and release notes.
- Placeholder scan: No placeholder markers or unspecified implementation steps are present.
- Type consistency: The plan consistently uses `confirmInput`, `ProviderModelSelectDialogSelectMeta`, `confirmInputValue`, `formatCreateSessionName`, and the optional fifth `createSession` argument `name`.
