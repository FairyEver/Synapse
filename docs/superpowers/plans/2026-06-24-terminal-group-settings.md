# Terminal Group Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add terminal group settings for default working directory and automatic multi-line startup commands for newly created grouped terminal sessions.

**Architecture:** Extend the terminal capability package contract first, then make the main service own cwd resolution and startup command injection after `node-pty` spawn. Surface the setting through IPC, MCP, and the renderer group menu, and update the built-in Synapse App MCP skill documentation so agents can use the new capability.

**Tech Stack:** Electron 41, React 19, TypeScript 6, zod, node-pty, xterm, shadcn/Radix UI, Vitest, pnpm.

---

## File Map

- `desktop/app-capabilities/terminal/shared/schema.ts` defines terminal group/session zod schemas and typed inputs.
- `desktop/app-capabilities/terminal/shared/capability.ts` defines terminal capability ids and MCP tool names.
- `desktop/app-capabilities/terminal/main/service.ts` owns terminal group/session state, cwd validation, pty spawn, and pty writes.
- `desktop/app-capabilities/terminal/main/store.ts` validates persisted terminal state.
- `desktop/app-capabilities/terminal/main/ipc.ts` exposes terminal IPC methods and response schemas.
- `desktop/app-capabilities/terminal/main/dispatcher.ts` dispatches terminal MCP capability actions.
- `desktop/synapse-capabilities/shared/app-domain.ts` registers App MCP tools and schemas.
- `desktop/src/types/terminal.ts` re-exports terminal shared types for renderer bridge usage.
- `desktop/app-capabilities/terminal/renderer/index.tsx` renders terminal groups, group menus, dialogs, and xterm surface.
- `desktop/resources/templates/skills/synapse-skill/files/app/index.md` and `api-reference.md` document App MCP tools for built-in agent usage.
- `RELEASE_NOTES_PENDING.md` records the user-visible feature.

## Task 1: Extend Shared Terminal Contracts

**Files:**
- Modify: `desktop/app-capabilities/terminal/shared/schema.ts`
- Modify: `desktop/app-capabilities/terminal/shared/capability.ts`
- Test later through service, IPC, and app-domain tests in later tasks.

- [ ] **Step 1: Add schemas for group settings**

In `desktop/app-capabilities/terminal/shared/schema.ts`, add these definitions above `terminalGroupSchema`:

```ts
export const terminalGroupSettingsSchema = z.object({
  defaultCwd: z.string().min(1).optional(),
  startupCommand: z.string().min(1).max(64 * 1024).optional(),
}).strict()

export const terminalUpdateGroupSettingsInputSchema = z.object({
  groupId: z.string().min(1),
  name: z.string().min(1).max(80),
  settings: terminalGroupSettingsSchema.optional(),
}).strict()
```

- [ ] **Step 2: Add optional settings to group schema**

Change `terminalGroupSchema` to include `settings`:

```ts
export const terminalGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  sortOrder: z.number().int(),
  settings: terminalGroupSettingsSchema.optional(),
})
```

- [ ] **Step 3: Export the new input and settings types**

Add these exports near the existing terminal type exports:

```ts
export type TerminalGroupSettings = z.infer<typeof terminalGroupSettingsSchema>
export type TerminalUpdateGroupSettingsInput = z.infer<typeof terminalUpdateGroupSettingsInputSchema>
```

- [ ] **Step 4: Add capability id and MCP tool name**

In `desktop/app-capabilities/terminal/shared/capability.ts`, add the capability id after group rename:

```ts
export const TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID =
  "app.terminal.group.updateSettings" as CapabilityId
```

Add the tool name to `TERMINAL_MCP_TOOL_NAMES` after `groupRename`:

```ts
groupUpdateSettings: "app_terminal_group_updateSettings",
```

- [ ] **Step 5: Run focused type/schema tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- app-capabilities/terminal/main/__tests__/store.test.ts
```

Expected now: tests may fail until later tasks update fixtures and store behavior, but TypeScript syntax should compile far enough for Vitest to report test results rather than parse errors.

## Task 2: Add Main Service Settings Behavior

**Files:**
- Modify: `desktop/app-capabilities/terminal/main/service.ts`
- Modify: `desktop/app-capabilities/terminal/main/__tests__/service.test.ts`
- Modify: `desktop/app-capabilities/terminal/main/__tests__/store.test.ts`

- [ ] **Step 1: Write service tests for settings persistence and cwd priority**

In `desktop/app-capabilities/terminal/main/__tests__/service.test.ts`, add tests in `describe("TerminalService", () => { ... })`:

```ts
it("updates terminal group settings and persists the update", async () => {
  const group = createGroup({ name: "默认分组" })
  const store = createMemoryStore({ groups: [group], sessions: [], output: [] })
  const service = await createStartedService(store)

  const updated = await service.updateGroupSettings({
    groupId: group.id,
    name: "  构建  ",
    settings: {
      defaultCwd: tempDir,
      startupCommand: "nvm use\npnpm dev",
    },
  })

  expect(updated).toMatchObject({
    id: group.id,
    name: "构建",
    settings: {
      defaultCwd: tempDir,
      startupCommand: "nvm use\npnpm dev",
    },
  })
  expect(store.state.groups).toEqual([expect.objectContaining({
    id: group.id,
    name: "构建",
    settings: {
      defaultCwd: tempDir,
      startupCommand: "nvm use\npnpm dev",
    },
  })])
})

it("uses explicit cwd before group default cwd", async () => {
  const explicitDir = await mkdtemp(path.join(os.tmpdir(), "synapse-terminal-explicit-"))
  const group = createGroup({
    settings: {
      defaultCwd: tempDir,
    },
  })
  const pty = new FakePty()
  const spawnPty = vi.fn(() => pty)
  const service = await createStartedService(
    createMemoryStore({ groups: [group], sessions: [], output: [] }),
    { spawnPty },
  )

  const session = await service.createSession({ groupId: group.id, cwd: explicitDir })

  expect(session.cwd).toBe(explicitDir)
  expect(spawnPty).toHaveBeenCalledWith(expect.objectContaining({ cwd: explicitDir }))
  await rm(explicitDir, { recursive: true, force: true })
})

it("uses group default cwd when create session has no explicit cwd", async () => {
  const group = createGroup({
    settings: {
      defaultCwd: tempDir,
    },
  })
  const pty = new FakePty()
  const spawnPty = vi.fn(() => pty)
  const service = await createStartedService(
    createMemoryStore({ groups: [group], sessions: [], output: [] }),
    { spawnPty },
  )

  const session = await service.createSession({ groupId: group.id })

  expect(session.cwd).toBe(tempDir)
  expect(spawnPty).toHaveBeenCalledWith(expect.objectContaining({ cwd: tempDir }))
})
```

- [ ] **Step 2: Write service tests for invalid cwd and startup command**

Add these tests:

```ts
it("rejects invalid group default cwd before spawning a pty", async () => {
  const group = createGroup({
    settings: {
      defaultCwd: path.join(tempDir, "missing"),
      startupCommand: "pnpm dev",
    },
  })
  const spawnPty = vi.fn(() => new FakePty())
  const service = await createStartedService(
    createMemoryStore({ groups: [group], sessions: [], output: [] }),
    { spawnPty },
  )

  await expect(service.createSession({ groupId: group.id }))
    .rejects.toThrow("Terminal cwd must be an existing absolute path")

  expect(spawnPty).not.toHaveBeenCalled()
  expect(service.listSessions()).toEqual([])
})

it("writes group startup command after spawning the pty", async () => {
  const group = createGroup({
    settings: {
      startupCommand: "nvm use\npnpm dev",
    },
  })
  const pty = new FakePty()
  const service = await createStartedService(
    createMemoryStore({ groups: [group], sessions: [], output: [] }),
    { ptys: [pty] },
  )

  await service.createSession({ groupId: group.id })

  expect(pty.write).toHaveBeenCalledWith("nvm use\npnpm dev\n")
})

it("does not write an empty startup command", async () => {
  const group = createGroup({
    settings: {},
  })
  const pty = new FakePty()
  const service = await createStartedService(
    createMemoryStore({ groups: [group], sessions: [], output: [] }),
    { ptys: [pty] },
  )

  await service.createSession({ groupId: group.id })

  expect(pty.write).not.toHaveBeenCalled()
})
```

- [ ] **Step 3: Update test helpers for new optional group settings**

In `createGroup` in the service test file, allow the optional settings field by relying on the existing `Partial<TerminalGroup>` override:

```ts
function createGroup(overrides: Partial<TerminalGroup> = {}): TerminalGroup {
  const timestamp = "2026-06-24T00:00:00.000Z"
  return {
    id: "g1",
    name: "Default",
    createdAt: timestamp,
    updatedAt: timestamp,
    sortOrder: 0,
    ...overrides,
  }
}
```

No `settings` default is required.

- [ ] **Step 4: Implement settings normalization helpers**

In `desktop/app-capabilities/terminal/main/service.ts`, add imports and helpers near `resolveCwd`:

```ts
import type {
  TerminalGroupSettings,
  TerminalUpdateGroupSettingsInput,
} from "../shared/schema"
```

The file already imports multiple terminal types from `../shared/schema`; merge these names into that existing import.

Add helpers:

```ts
function normalizeGroupSettings(settings: TerminalGroupSettings | undefined): TerminalGroupSettings | undefined {
  const defaultCwd = settings?.defaultCwd?.trim()
  const startupCommand = normalizeStartupCommand(settings?.startupCommand)
  const normalized: TerminalGroupSettings = {
    ...(defaultCwd ? { defaultCwd: validateAbsoluteCwdInput(defaultCwd) } : {}),
    ...(startupCommand ? { startupCommand } : {}),
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function normalizeStartupCommand(command: string | undefined): string | undefined {
  const normalized = command?.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
  return normalized || undefined
}

function validateAbsoluteCwdInput(cwd: string): string {
  if (!path.isAbsolute(cwd)) {
    throw new Error("Terminal cwd must be an absolute path")
  }
  return cwd
}

function appendTerminalNewline(command: string): string {
  return command.endsWith("\n") ? command : `${command}\n`
}
```

- [ ] **Step 5: Implement service `updateGroupSettings`**

Inside the returned service object, add the method after `renameGroup`:

```ts
async updateGroupSettings(input: TerminalUpdateGroupSettingsInput): Promise<TerminalGroup> {
  const group = getGroupOrThrow(input.groupId)
  const name = input.name.trim()
  if (!name) throw new Error("Terminal group name is required")
  if (name.length > 80) throw new Error("Terminal group name is too long")
  const settings = normalizeGroupSettings(input.settings)
  const updated: TerminalGroup = {
    ...group,
    name,
    ...(settings ? { settings } : { settings: undefined }),
    updatedAt: now(),
  }
  groups.set(group.id, updated)
  await flushPersist()
  return updated
}
```

- [ ] **Step 6: Update `createSession` cwd resolution and startup write**

Change cwd resolution in `createSession` to:

```ts
const cwd = resolveCwd(input.cwd ?? group.settings?.defaultCwd ?? (deps.resolveDefaultCwd?.() ?? defaultCwd()))
```

After `attachRuntime(session, child, buffer)` and before `await flushPersist()`, add:

```ts
if (group.settings?.startupCommand) {
  child.write(appendTerminalNewline(group.settings.startupCommand))
}
```

- [ ] **Step 7: Add store test for old groups without settings**

In `desktop/app-capabilities/terminal/main/__tests__/store.test.ts`, add:

```ts
it("loads legacy groups without settings", async () => {
  await writeFile(path.join(tempDir, "terminal-state.json"), JSON.stringify({
    groups: [{
      id: "g1",
      name: "Legacy",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
      sortOrder: 0,
    }],
    sessions: [],
    output: [],
  }))

  await expect(createTerminalStore({ baseDir: tempDir }).loadState()).resolves.toEqual({
    groups: [expect.objectContaining({ id: "g1", name: "Legacy" })],
    sessions: [],
    output: [],
  })
})
```

- [ ] **Step 8: Run main tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- app-capabilities/terminal/main/__tests__/service.test.ts app-capabilities/terminal/main/__tests__/store.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit main service changes**

Run:

```bash
git add desktop/app-capabilities/terminal/shared/schema.ts desktop/app-capabilities/terminal/main/service.ts desktop/app-capabilities/terminal/main/__tests__/service.test.ts desktop/app-capabilities/terminal/main/__tests__/store.test.ts
git commit -m "feat(terminal): add group startup settings"
```

## Task 3: Wire IPC And MCP Capability Contracts

**Files:**
- Modify: `desktop/app-capabilities/terminal/main/ipc.ts`
- Modify: `desktop/app-capabilities/terminal/main/dispatcher.ts`
- Modify: `desktop/app-capabilities/terminal/main/__tests__/ipc.test.ts`
- Modify: `desktop/app-capabilities/terminal/main/__tests__/dispatcher.test.ts`
- Modify: `desktop/synapse-capabilities/shared/app-domain.ts`
- Modify: `desktop/synapse-capabilities/shared/app-domain.test.ts`
- Modify: `desktop/tests/unit/synapse-capabilities.test.ts`

- [ ] **Step 1: Add IPC tests**

In `desktop/app-capabilities/terminal/main/__tests__/ipc.test.ts`, update the channel test:

```ts
expect(terminalIpcModule.methods.updateGroupSettings.channel).toBe("synapse:terminal:group:update-settings")
```

In the handler delegation test, add:

```ts
await terminalIpcModule.methods.updateGroupSettings.handler(ctx, {
  groupId: "g1",
  name: "Build",
  settings: {
    defaultCwd: "/tmp",
    startupCommand: "pnpm dev",
  },
})
expect(service.updateGroupSettings).toHaveBeenCalledWith({
  groupId: "g1",
  name: "Build",
  settings: {
    defaultCwd: "/tmp",
    startupCommand: "pnpm dev",
  },
})
```

Add `updateGroupSettings: vi.fn(async (input) => createGroup({ id: input.groupId, name: input.name, settings: input.settings }))` to the fake service returned by `createService()`.

- [ ] **Step 2: Implement IPC method**

In `desktop/app-capabilities/terminal/main/ipc.ts`, import `terminalUpdateGroupSettingsInputSchema`.

Add the method after `renameGroup`:

```ts
updateGroupSettings: {
  channel: "synapse:terminal:group:update-settings",
  kind: "invoke",
  request: terminalUpdateGroupSettingsInputSchema,
  response: terminalGroupSchema,
  handler: (ctx, request: z.infer<typeof terminalUpdateGroupSettingsInputSchema>) =>
    resolveTerminalService(ctx).updateGroupSettings(request),
},
```

- [ ] **Step 3: Add dispatcher test**

In `desktop/app-capabilities/terminal/main/__tests__/dispatcher.test.ts`, import `TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID`.

Add:

```ts
it("dispatches group settings update with parsed input", async () => {
  const updated = createGroup({
    name: "构建",
    settings: {
      defaultCwd: "/tmp",
      startupCommand: "pnpm dev",
    },
  })
  const updateGroupSettings = vi.fn(async () => updated)
  const dispatcher = createTerminalCapabilityDispatcher({
    service: { updateGroupSettings } as never,
  })

  const result = await dispatcher.dispatch(TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID, {
    groupId: "g1",
    name: "  构建  ",
    settings: {
      defaultCwd: "/tmp",
      startupCommand: "pnpm dev",
    },
  }, { source: "mcp-http" })

  expect(updateGroupSettings).toHaveBeenCalledWith({
    groupId: "g1",
    name: "  构建  ",
    settings: {
      defaultCwd: "/tmp",
      startupCommand: "pnpm dev",
    },
  })
  expect(result).toEqual({ ok: true, data: updated, affected: 1 })
})
```

- [ ] **Step 4: Implement dispatcher branch**

In `desktop/app-capabilities/terminal/main/dispatcher.ts`, import `TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID` and `terminalUpdateGroupSettingsInputSchema`.

Add after the rename branch:

```ts
if (action === TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID) {
  return {
    ok: true,
    data: await deps.service.updateGroupSettings(terminalUpdateGroupSettingsInputSchema.parse(params)),
    affected: 1,
  }
}
```

- [ ] **Step 5: Add app-domain tests**

In `desktop/synapse-capabilities/shared/app-domain.test.ts`, import `TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID`.

Add:

```ts
it("maps terminal group settings MCP tool to its capability", () => {
  expect(TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID).toBe("app.terminal.group.updateSettings")
  expect(APP_MCP_TOOL_ACTIONS[TERMINAL_MCP_TOOL_NAMES.groupUpdateSettings]).toBe(
    TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID,
  )
})

it("defines terminal group settings MCP schema", () => {
  const tools = new Map(buildAppTools().map((tool) => [tool.name, tool]))

  expect(tools.get(TERMINAL_MCP_TOOL_NAMES.groupUpdateSettings)?.inputSchema).toMatchObject({
    type: "object",
    properties: {
      groupId: expect.objectContaining({ type: "string", minLength: 1 }),
      name: expect.objectContaining({ type: "string", minLength: 1, maxLength: 80 }),
      settings: expect.objectContaining({
        type: "object",
        properties: {
          defaultCwd: expect.objectContaining({ type: "string", minLength: 1 }),
          startupCommand: expect.objectContaining({ type: "string", minLength: 1 }),
        },
      }),
    },
    required: ["groupId", "name"],
  })
})
```

- [ ] **Step 6: Implement app-domain mapping and MCP schema**

In `desktop/synapse-capabilities/shared/app-domain.ts`, import `TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID`.

Add a capability definition after group rename:

```ts
{
  id: TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID,
  title: "Update terminal group settings",
  description: "Update a terminal group's name, default working directory, and startup command.",
  mutates: true,
},
```

Add tool mapping:

```ts
[TERMINAL_MCP_TOOL_NAMES.groupUpdateSettings]: TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID,
```

Add a tool definition after `groupRename`:

```ts
{
  name: TERMINAL_MCP_TOOL_NAMES.groupUpdateSettings,
  description: "Update a terminal group's name, default working directory, and startup command for future sessions.",
  inputSchema: {
    type: "object",
    properties: {
      groupId: stringField("Terminal group id.", { minLength: 1 }),
      name: stringField("Group name. Leading and trailing whitespace is trimmed.", { minLength: 1, maxLength: 80 }),
      settings: {
        type: "object",
        properties: {
          defaultCwd: stringField("Optional absolute working directory for future sessions in this group.", { minLength: 1 }),
          startupCommand: stringField("Optional multi-line command text to run automatically in future sessions.", { minLength: 1, maxLength: 64 * 1024 }),
        },
        additionalProperties: false,
      },
    },
    required: ["groupId", "name"],
  },
},
```

- [ ] **Step 7: Update unit capability expectations**

In `desktop/tests/unit/synapse-capabilities.test.ts`, update assertions that mention terminal group tools:

```ts
expect(APP_MCP_TOOL_ACTIONS.app_terminal_group_updateSettings).toBe("app.terminal.group.updateSettings")
```

Keep the existing `Object.values(TERMINAL_MCP_TOOL_NAMES)` assertion so the new tool is covered automatically.

- [ ] **Step 8: Run IPC/MCP tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- app-capabilities/terminal/main/__tests__/ipc.test.ts app-capabilities/terminal/main/__tests__/dispatcher.test.ts synapse-capabilities/shared/app-domain.test.ts tests/unit/synapse-capabilities.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit IPC/MCP wiring**

Run:

```bash
git add desktop/app-capabilities/terminal/shared/capability.ts desktop/app-capabilities/terminal/main/ipc.ts desktop/app-capabilities/terminal/main/dispatcher.ts desktop/app-capabilities/terminal/main/__tests__/ipc.test.ts desktop/app-capabilities/terminal/main/__tests__/dispatcher.test.ts desktop/synapse-capabilities/shared/app-domain.ts desktop/synapse-capabilities/shared/app-domain.test.ts desktop/tests/unit/synapse-capabilities.test.ts
git commit -m "feat(terminal): expose group settings capability"
```

## Task 4: Add Renderer Group Settings Dialog

**Files:**
- Modify: `desktop/src/types/terminal.ts`
- Modify: `desktop/app-capabilities/terminal/renderer/index.tsx`
- Modify: `desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx`

- [ ] **Step 1: Re-export renderer input type**

In `desktop/src/types/terminal.ts`, import and export `TerminalUpdateGroupSettingsInput`:

```ts
  TerminalUpdateGroupSettingsInput,
```

Add:

```ts
export type SynapseTerminalUpdateGroupSettingsInput = TerminalUpdateGroupSettingsInput
```

- [ ] **Step 2: Update renderer bridge test double**

In `desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx`, add to imports:

```ts
  SynapseTerminalUpdateGroupSettingsInput,
```

Add a bridge method after `renameGroup`:

```ts
updateGroupSettings: vi.fn(async ({ groupId, name, settings }: SynapseTerminalUpdateGroupSettingsInput) => {
  const group = {
    ...bridgeState.groups.find((item) => item.id === groupId),
    id: groupId,
    name: name.trim(),
    settings,
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:03:00.000Z",
    sortOrder: 0,
  } as SynapseTerminalGroup
  bridgeState.groups = bridgeState.groups.map((item) => item.id === groupId ? group : item)
  return group
}),
```

Clear it in `beforeEach`:

```ts
terminalBridge.updateGroupSettings.mockClear()
```

- [ ] **Step 3: Add renderer test for settings dialog**

Add a test near the group rename test:

```ts
it("updates terminal group settings from the group menu", async () => {
  bridgeState.groups = [createGroup({
    id: "group-build",
    name: "构建",
    settings: {
      defaultCwd: "/repo/old",
      startupCommand: "pnpm test",
    },
  })]
  bridgeState.sessions = []

  await renderModule()

  await clickGroupMenu("构建")
  await clickMenuItem("设置")
  await changeInput("分组名称", "开发")
  await changeInput("默认目录", "/repo/app")
  await changeTextarea("启动命令", "nvm use\npnpm dev")
  await clickButton("保存")

  expect(terminalBridge.updateGroupSettings).toHaveBeenCalledWith({
    groupId: "group-build",
    name: "开发",
    settings: {
      defaultCwd: "/repo/app",
      startupCommand: "nvm use\npnpm dev",
    },
  })
})
```

Add this textarea helper near the existing `changeInput` helper:

```ts
async function changeTextarea(label: string, value: string): Promise<void> {
  const textarea = document.body.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)
  await act(async () => {
    if (textarea) {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      valueSetter?.call(textarea, value)
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
      textarea.dispatchEvent(new Event("change", { bubbles: true }))
    }
    await Promise.resolve()
  })
}
```

- [ ] **Step 4: Add renderer test for grouped create failure**

Add:

```ts
it("shows an error when creating a terminal from a group fails", async () => {
  bridgeState.groups = [createGroup({ id: "group-build", name: "构建" })]
  bridgeState.sessions = []
  terminalBridge.createSession.mockRejectedValueOnce(new Error("Terminal cwd must be an existing absolute path"))

  await renderModule()

  await clickButtonByTitle("新建终端")

  expect(toastState.error).toHaveBeenCalledWith("新建终端失败")
})
```

- [ ] **Step 5: Implement renderer state and menu item**

In `desktop/app-capabilities/terminal/renderer/index.tsx`, import icons and components:

```ts
import { CircleDot, Folder, FolderOpen, Link2Off, MoreHorizontal, Pencil, Plus, Settings, Terminal as TerminalIcon, Trash2 } from "lucide-react"
import { Textarea } from "../../../src/components/ui/textarea"
```

Add state:

```ts
const [groupSettingsTarget, setGroupSettingsTarget] = useState<SynapseTerminalGroup | null>(null)
const [groupSettingsName, setGroupSettingsName] = useState("")
const [groupSettingsDefaultCwd, setGroupSettingsDefaultCwd] = useState("")
const [groupSettingsStartupCommand, setGroupSettingsStartupCommand] = useState("")
const [groupSettingsSaving, setGroupSettingsSaving] = useState(false)
```

Add opener:

```ts
const openGroupSettingsDialog = useCallback((group: SynapseTerminalGroup) => {
  setGroupSettingsTarget(group)
  setGroupSettingsName(group.name)
  setGroupSettingsDefaultCwd(group.settings?.defaultCwd ?? "")
  setGroupSettingsStartupCommand(group.settings?.startupCommand ?? "")
}, [])
```

Add menu item above rename:

```tsx
<DropdownMenuItem onClick={() => openGroupSettingsDialog(group)}>
  <Settings />
  设置
</DropdownMenuItem>
```

- [ ] **Step 6: Implement settings save handler**

Add:

```ts
const saveGroupSettings = useCallback(async () => {
  if (!groupSettingsTarget) return
  const name = groupSettingsName.trim()
  if (!name) return
  const defaultCwd = groupSettingsDefaultCwd.trim()
  const startupCommand = groupSettingsStartupCommand.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
  setGroupSettingsSaving(true)
  try {
    const group = await terminalBridge.updateGroupSettings({
      groupId: groupSettingsTarget.id,
      name,
      settings: {
        ...(defaultCwd ? { defaultCwd } : {}),
        ...(startupCommand ? { startupCommand } : {}),
      },
    })
    setGroups((current) => current.map((item) => item.id === group.id ? group : item))
    setGroupSettingsTarget(null)
    setGroupSettingsName("")
    setGroupSettingsDefaultCwd("")
    setGroupSettingsStartupCommand("")
  } catch (error) {
    logger.error("Failed to update terminal group settings.", error)
    toast.error("保存分组设置失败")
  } finally {
    setGroupSettingsSaving(false)
  }
}, [
  groupSettingsDefaultCwd,
  groupSettingsName,
  groupSettingsStartupCommand,
  groupSettingsTarget,
  terminalBridge,
])
```

- [ ] **Step 7: Add settings dialog markup**

Add a `Dialog` before the session rename dialog:

```tsx
<Dialog open={groupSettingsTarget !== null} onOpenChange={(open) => {
  if (!open) {
    setGroupSettingsTarget(null)
    setGroupSettingsName("")
    setGroupSettingsDefaultCwd("")
    setGroupSettingsStartupCommand("")
  }
}}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>分组设置</DialogTitle>
      <DialogDescription className="sr-only">
        设置分组名称、默认目录和启动命令。
      </DialogDescription>
    </DialogHeader>
    <div className="grid gap-3">
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">分组名称</span>
        <Input
          aria-label="分组名称"
          value={groupSettingsName}
          onChange={(event) => setGroupSettingsName(event.target.value)}
          autoFocus
        />
      </label>
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">默认目录</span>
        <Input
          aria-label="默认目录"
          value={groupSettingsDefaultCwd}
          onChange={(event) => setGroupSettingsDefaultCwd(event.target.value)}
        />
      </label>
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">启动命令</span>
        <Textarea
          aria-label="启动命令"
          value={groupSettingsStartupCommand}
          onChange={(event) => setGroupSettingsStartupCommand(event.target.value)}
          rows={5}
        />
      </label>
    </div>
    <DialogFooter>
      <Button
        type="button"
        variant="outline"
        disabled={groupSettingsSaving}
        onClick={() => {
          setGroupSettingsTarget(null)
          setGroupSettingsName("")
          setGroupSettingsDefaultCwd("")
          setGroupSettingsStartupCommand("")
        }}
      >
        取消
      </Button>
      <Button
        type="button"
        disabled={groupSettingsSaving || !groupSettingsName.trim()}
        onClick={() => { void saveGroupSettings() }}
      >
        保存
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Step 8: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit renderer changes**

Run:

```bash
git add desktop/src/types/terminal.ts desktop/app-capabilities/terminal/renderer/index.tsx desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx
git commit -m "feat(terminal): add group settings dialog"
```

## Task 5: Update Built-In Skill Documentation And Release Notes

**Files:**
- Modify: `desktop/resources/templates/skills/synapse-skill/files/app/index.md`
- Modify: `desktop/resources/templates/skills/synapse-skill/files/app/api-reference.md`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update built-in app skill usage guide**

In `desktop/resources/templates/skills/synapse-skill/files/app/index.md`, update the terminal rules bullet:

```md
- Use `app_terminal_group_create`, `app_terminal_group_updateSettings`, `app_terminal_group_rename`, and `app_terminal_group_delete` to organize sessions.
```

Add a focused rule after it:

```md
- Use `app_terminal_group_updateSettings` when future sessions in a group should start from a default directory or run startup commands.
```

- [ ] **Step 2: Update built-in app API reference**

In `desktop/resources/templates/skills/synapse-skill/files/app/api-reference.md`, add this section after `app_terminal_group_rename`:

```md
`app_terminal_group_updateSettings`

Update a terminal group's name, default working directory, and startup command for future sessions.

Input:

- `groupId` required: terminal group id.
- `name` required: group name. Leading and trailing whitespace is trimmed.
- `settings.defaultCwd` optional: absolute working directory for future sessions in this group.
- `settings.startupCommand` optional: multi-line command text to run automatically in future sessions.

Output:

- Terminal group.
```

- [ ] **Step 3: Add pending release note**

Add this bullet under `## 功能优化` in `RELEASE_NOTES_PENDING.md`, near the existing terminal application bullets:

```md
- 终端分组现在可以设置默认目录和启动命令，新建该分组下的终端时会自动进入目录并执行命令。
```

- [ ] **Step 4: Run doc-related checks**

Run:

```bash
pnpm --filter @synapse/desktop run test -- synapse-capabilities/shared/app-domain.test.ts tests/unit/synapse-capabilities.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit docs and release note**

Run:

```bash
git add desktop/resources/templates/skills/synapse-skill/files/app/index.md desktop/resources/templates/skills/synapse-skill/files/app/api-reference.md RELEASE_NOTES_PENDING.md
git commit -m "docs(terminal): document group settings tool"
```

## Task 6: Full Verification

**Files:**
- No code edits unless a verification failure points to a specific bug in files changed by earlier tasks.

- [ ] **Step 1: Regenerate/check IPC output**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: both commands complete successfully. If `generate:ipc` changes generated bridge files, include them in the final verification commit after reviewing the diff.

- [ ] **Step 2: Run terminal and capability focused tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- app-capabilities/terminal/main/__tests__/service.test.ts app-capabilities/terminal/main/__tests__/store.test.ts app-capabilities/terminal/main/__tests__/ipc.test.ts app-capabilities/terminal/main/__tests__/dispatcher.test.ts app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx synapse-capabilities/shared/app-domain.test.ts tests/unit/synapse-capabilities.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

Expected:

- `git diff --check` exits with no whitespace errors.
- Only terminal group settings, App MCP docs, generated IPC files if any, and release notes changed.

- [ ] **Step 5: Commit IPC generated file if it changed**

If `git status --short` shows `desktop/electron/generated/ipc-channels.generated.ts` changed after `generate:ipc`, run:

```bash
git add desktop/electron/generated/ipc-channels.generated.ts
git commit -m "chore(terminal): refresh ipc bindings"
```

If no generated files changed, do not create an empty commit.

## Self-Review

- Spec coverage: The plan covers group settings schema, default cwd priority, invalid cwd blocking, pty startup command writes, renderer settings UI, IPC/MCP exposure, built-in skill documentation, release notes, and focused/full verification.
- Placeholder scan: No placeholder markers or vague implementation steps remain. Steps that change code include concrete snippets and exact file paths.
- Type consistency: The plan uses `settings.defaultCwd`, `settings.startupCommand`, `updateGroupSettings`, `TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID`, and `groupUpdateSettings` consistently across schema, service, IPC, dispatcher, app-domain, renderer, and tests.
