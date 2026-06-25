# Terminal Group Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace terminal groups' single implicit startup command with explicit named commands that launch new terminal sessions from a dedicated group action menu.

**Architecture:** Keep the feature inside `desktop/app-capabilities/terminal`. Extend the shared schema, normalize legacy `startupCommand` into `settings.commands`, add service methods for command lifecycle and launch, expose them through IPC/preload/MCP, then update the renderer to show clean-terminal, command-launch, and group-management actions separately.

**Tech Stack:** Electron 41, React 19, TypeScript 6, Vitest, zod, shadcn/Radix UI, lucide-react, node-pty.

---

## File Map

- Modify `desktop/app-capabilities/terminal/shared/schema.ts`: define `TerminalGroupCommand`, command input schemas, and legacy-compatible settings schema.
- Modify `desktop/app-capabilities/terminal/shared/capability.ts`: add terminal command capability ids and MCP tool names.
- Modify `desktop/app-capabilities/terminal/main/service.ts`: normalize groups on load, add command lifecycle methods, add command launch, and make `createSession` clean.
- Modify `desktop/app-capabilities/terminal/main/ipc.ts`: register command lifecycle and command launch IPC channels.
- Modify `desktop/app-capabilities/terminal/main/dispatcher.ts`: dispatch MCP command lifecycle and command launch actions with permission/audit checks.
- Modify `desktop/electron/preload.ts`: add terminal IPC channel constants and bridge methods.
- Modify `desktop/src/types/terminal.ts`: re-export command input/output types.
- Modify `desktop/src/types/bridge.ts`: add terminal bridge method types.
- Modify `desktop/app-capabilities/terminal/renderer/index.tsx`: remove startup command from group settings, add command launch dropdown and command management dialogs.
- Modify `desktop/app-capabilities/terminal/main/__tests__/service.test.ts`: cover migration, clean session creation, command CRUD, command launch.
- Modify `desktop/app-capabilities/terminal/main/__tests__/ipc.test.ts`: cover channels and handlers.
- Modify `desktop/app-capabilities/terminal/main/__tests__/dispatcher.test.ts`: cover MCP dispatch and permission/audit checks.
- Modify `desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx`: cover UI and bridge calls.
- Modify `RELEASE_NOTES_PENDING.md`: add user-facing release note.

---

### Task 1: Shared Schema And Legacy Normalization Contract

**Files:**
- Modify: `desktop/app-capabilities/terminal/shared/schema.ts`
- Test: `desktop/app-capabilities/terminal/main/__tests__/service.test.ts`

- [ ] **Step 1: Add failing service tests for legacy migration and clean sessions**

Add these tests near the existing group settings/startup command tests in `desktop/app-capabilities/terminal/main/__tests__/service.test.ts`:

```ts
  it("migrates legacy startup command into a named group command", async () => {
    const group = createGroup({
      updatedAt: "2026-06-24T00:02:00.000Z",
      settings: {
        defaultCwd: tempDir,
        startupCommand: "nvm use\npnpm dev",
      },
    })
    const store = createMemoryStore({ groups: [group], sessions: [], output: [] })
    const service = await createStartedService(store)

    const [migrated] = service.listGroups()

    expect(migrated.settings).toMatchObject({
      defaultCwd: tempDir,
      commands: [
        expect.objectContaining({
          name: "启动命令",
          command: "nvm use\npnpm dev",
          createdAt: "2026-06-24T00:02:00.000Z",
          updatedAt: "2026-06-24T00:02:00.000Z",
        }),
      ],
    })
    expect(migrated.settings).not.toHaveProperty("startupCommand")
    expect(store.state.groups[0]?.settings).not.toHaveProperty("startupCommand")
  })

  it("does not overwrite explicit commands when legacy startup command is also present", async () => {
    const existingCommand = {
      id: "cmd-dev",
      name: "dev",
      command: "pnpm dev",
      createdAt: "2026-06-24T00:01:00.000Z",
      updatedAt: "2026-06-24T00:01:00.000Z",
    }
    const group = createGroup({
      settings: {
        startupCommand: "pnpm old",
        commands: [existingCommand],
      },
    })
    const store = createMemoryStore({ groups: [group], sessions: [], output: [] })
    const service = await createStartedService(store)

    expect(service.listGroups()[0]?.settings).toEqual({
      commands: [existingCommand],
    })
    expect(store.state.groups[0]?.settings).toEqual({
      commands: [existingCommand],
    })
  })

  it("creates clean sessions without running migrated commands", async () => {
    const group = createGroup({
      settings: {
        startupCommand: "pnpm dev",
      },
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

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/main/__tests__/service.test.ts
```

Expected: FAIL because `commands` is not in the schema, legacy `startupCommand` is still persisted, and `createSession` still schedules startup commands.

- [ ] **Step 3: Extend shared schema**

In `desktop/app-capabilities/terminal/shared/schema.ts`, replace the current `terminalGroupSettingsSchema` block with:

```ts
export const terminalGroupCommandSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  command: z.string().min(1).max(64 * 1024),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()

export const terminalGroupSettingsSchema = z.object({
  defaultCwd: z.string().min(1).optional(),
  commands: z.array(terminalGroupCommandSchema).optional(),
  startupCommand: z.string().min(1).max(64 * 1024).optional(),
}).strict()
```

Add command input schemas after `terminalUpdateGroupSettingsInputSchema`:

```ts
export const terminalCreateGroupCommandInputSchema = z.object({
  groupId: z.string().min(1),
  name: z.string().min(1).max(80),
  command: z.string().min(1).max(64 * 1024),
}).strict()

export const terminalUpdateGroupCommandInputSchema = z.object({
  groupId: z.string().min(1),
  commandId: z.string().min(1),
  name: z.string().min(1).max(80),
  command: z.string().min(1).max(64 * 1024),
}).strict()

export const terminalDeleteGroupCommandInputSchema = z.object({
  groupId: z.string().min(1),
  commandId: z.string().min(1),
}).strict()

export const terminalLaunchGroupCommandInputSchema = z.object({
  groupId: z.string().min(1),
  commandId: z.string().min(1),
  cols: z.number().int().positive().max(500).optional(),
  rows: z.number().int().positive().max(200).optional(),
}).strict()
```

Add exported types at the bottom:

```ts
export type TerminalGroupCommand = z.infer<typeof terminalGroupCommandSchema>
export type TerminalCreateGroupCommandInput = z.infer<typeof terminalCreateGroupCommandInputSchema>
export type TerminalUpdateGroupCommandInput = z.infer<typeof terminalUpdateGroupCommandInputSchema>
export type TerminalDeleteGroupCommandInput = z.infer<typeof terminalDeleteGroupCommandInputSchema>
export type TerminalLaunchGroupCommandInput = z.infer<typeof terminalLaunchGroupCommandInputSchema>
```

- [ ] **Step 4: Implement group settings normalization in the service**

In `desktop/app-capabilities/terminal/main/service.ts`, import the new command types:

```ts
  TerminalCreateGroupCommandInput,
  TerminalDeleteGroupCommandInput,
  TerminalGroupCommand,
  TerminalLaunchGroupCommandInput,
  TerminalUpdateGroupCommandInput,
```

Add helpers near `ensureDefaultGroup`:

```ts
function normalizeCommandText(command: string): string {
  return command.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
}

function normalizeGroupCommandInput(input: { name: string; command: string }): { name: string; command: string } {
  const name = input.name.trim()
  if (!name) throw new Error("Terminal command name is required")
  if (name.length > 80) throw new Error("Terminal command name is too long")
  const command = normalizeCommandText(input.command)
  if (!command) throw new Error("Terminal command is required")
  if (Buffer.byteLength(command) > 64 * 1024) throw new Error("Terminal command is too long")
  return { name, command }
}

function normalizeGroupSettings(group: TerminalGroup): TerminalGroupSettings | undefined {
  const settings = group.settings
  if (!settings) return undefined
  const next: TerminalGroupSettings = {}
  const defaultCwd = settings.defaultCwd?.trim()
  if (defaultCwd) next.defaultCwd = defaultCwd

  if (settings.commands?.length) {
    next.commands = settings.commands.map((command) => ({
      ...command,
      ...normalizeGroupCommandInput(command),
    }))
  } else if (settings.startupCommand) {
    const command = normalizeCommandText(settings.startupCommand)
    if (command) {
      next.commands = [{
        id: randomUUID(),
        name: "启动命令",
        command,
        createdAt: group.updatedAt,
        updatedAt: group.updatedAt,
      }]
    }
  }

  return next.defaultCwd || next.commands?.length ? next : undefined
}
```

Then change the `start()` group load loop from:

```ts
for (const group of state.groups) groups.set(group.id, group)
```

to:

```ts
for (const group of state.groups) {
  const normalizedSettings = normalizeGroupSettings(group)
  groups.set(group.id, normalizedSettings ? { ...group, settings: normalizedSettings } : omitGroupSettings(group))
}
```

Add this helper near the normalization helpers:

```ts
function omitGroupSettings(group: TerminalGroup): TerminalGroup {
  const next = { ...group }
  delete next.settings
  return next
}
```

- [ ] **Step 5: Make `createSession` clean**

In `createSession`, delete these lines:

```ts
const startupCommand = group.settings?.startupCommand
```

and:

```ts
if (startupCommand) {
  pendingStartupCommands.set(session.id, startupCommand)
}
```

Keep `pendingStartupCommands` and `runStartupCommand` until the renderer startup-ready path is removed in Task 6. They will no longer be populated by clean sessions.

- [ ] **Step 6: Run service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/main/__tests__/service.test.ts
```

Expected: PASS after updating older expectations that asserted `settings.startupCommand`.

- [ ] **Step 7: Commit**

```bash
git add desktop/app-capabilities/terminal/shared/schema.ts desktop/app-capabilities/terminal/main/service.ts desktop/app-capabilities/terminal/main/__tests__/service.test.ts
git commit -m "feat(terminal): normalize group commands"
```

---

### Task 2: Command Lifecycle And Launch Service

**Files:**
- Modify: `desktop/app-capabilities/terminal/main/service.ts`
- Test: `desktop/app-capabilities/terminal/main/__tests__/service.test.ts`

- [ ] **Step 1: Add failing service tests for command CRUD and command launch**

Add these tests near the other group action tests:

```ts
  it("creates updates and deletes terminal group commands", async () => {
    const group = createGroup({ name: "前端项目" })
    const store = createMemoryStore({ groups: [group], sessions: [], output: [] })
    const service = await createStartedService(store)

    const created = await service.createGroupCommand({
      groupId: group.id,
      name: "  dev  ",
      command: "pnpm dev\r\n",
    })
    expect(created).toMatchObject({
      name: "dev",
      command: "pnpm dev",
    })

    const updated = await service.updateGroupCommand({
      groupId: group.id,
      commandId: created.id,
      name: "  test  ",
      command: "pnpm test",
    })
    expect(updated).toMatchObject({
      id: created.id,
      name: "test",
      command: "pnpm test",
    })

    expect(service.listGroups()[0]?.settings?.commands).toEqual([updated])

    await service.deleteGroupCommand({
      groupId: group.id,
      commandId: created.id,
    })

    expect(service.listGroups()[0]?.settings).toBeUndefined()
    expect(store.state.groups[0]?.settings).toBeUndefined()
  })

  it("launches a group command in a new focused session shape", async () => {
    const command = {
      id: "cmd-dev",
      name: "dev",
      command: "nvm use\npnpm dev",
      createdAt: "2026-06-24T00:01:00.000Z",
      updatedAt: "2026-06-24T00:01:00.000Z",
    }
    const group = createGroup({
      settings: {
        defaultCwd: tempDir,
        commands: [command],
      },
    })
    const pty = new FakePty()
    const spawnInputs: Array<{ cwd: string; cols: number; rows: number }> = []
    const service = await createStartedService(
      createMemoryStore({ groups: [group], sessions: [], output: [] }),
      { ptys: [pty], spawnInputs },
    )

    const session = await service.launchGroupCommand({
      groupId: group.id,
      commandId: command.id,
      cols: 120,
      rows: 40,
    })

    expect(session).toMatchObject({
      groupId: group.id,
      title: "dev",
      cwd: tempDir,
      cols: 120,
      rows: 40,
      status: "running",
    })
    expect(spawnInputs).toEqual([expect.objectContaining({ cwd: tempDir, cols: 120, rows: 40 })])
    expect(pty.write).toHaveBeenCalledWith("nvm use\npnpm dev\n")
  })

  it("rejects launching an unknown group command", async () => {
    const group = createGroup({
      settings: {
        commands: [{
          id: "cmd-dev",
          name: "dev",
          command: "pnpm dev",
          createdAt: "2026-06-24T00:01:00.000Z",
          updatedAt: "2026-06-24T00:01:00.000Z",
        }],
      },
    })
    const pty = new FakePty()
    const service = await createStartedService(
      createMemoryStore({ groups: [group], sessions: [], output: [] }),
      { ptys: [pty] },
    )

    await expect(service.launchGroupCommand({
      groupId: group.id,
      commandId: "missing",
    })).rejects.toThrow("Terminal command not found")

    expect(pty.write).not.toHaveBeenCalled()
    expect(service.listSessions()).toEqual([])
  })
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/main/__tests__/service.test.ts
```

Expected: FAIL because command lifecycle and launch methods do not exist.

- [ ] **Step 3: Implement service helpers**

In `desktop/app-capabilities/terminal/main/service.ts`, add:

```ts
function getGroupCommandOrThrow(group: TerminalGroup, commandId: string): TerminalGroupCommand {
  const command = group.settings?.commands?.find((item) => item.id === commandId)
  if (!command) throw new Error("Terminal command not found")
  return command
}

function withGroupCommands(group: TerminalGroup, commands: TerminalGroupCommand[]): TerminalGroup {
  const settings: TerminalGroupSettings = {
    ...(group.settings?.defaultCwd ? { defaultCwd: group.settings.defaultCwd } : {}),
    ...(commands.length ? { commands } : {}),
  }
  const updated: TerminalGroup = {
    ...group,
    updatedAt: now(),
  }
  if (settings.defaultCwd || settings.commands?.length) {
    updated.settings = settings
  } else {
    delete updated.settings
  }
  return updated
}

function writeStartupCommand(sessionId: string, command: string): void {
  const runtime = getRunningRuntime(sessionId)
  startupEchoFilters.set(sessionId, createStartupEchoFilter(command))
  runtime.pty.write(appendTerminalNewline(command))
}
```

- [ ] **Step 4: Implement service methods**

Add these methods in the returned service object near `updateGroupSettings`:

```ts
async createGroupCommand(input: TerminalCreateGroupCommandInput): Promise<TerminalGroupCommand> {
  const group = getGroupOrThrow(input.groupId)
  const normalized = normalizeGroupCommandInput(input)
  const timestamp = now()
  const command: TerminalGroupCommand = {
    id: randomUUID(),
    name: normalized.name,
    command: normalized.command,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const updated = withGroupCommands(group, [...(group.settings?.commands ?? []), command])
  groups.set(group.id, updated)
  await flushPersist()
  return command
},
async updateGroupCommand(input: TerminalUpdateGroupCommandInput): Promise<TerminalGroupCommand> {
  const group = getGroupOrThrow(input.groupId)
  getGroupCommandOrThrow(group, input.commandId)
  const normalized = normalizeGroupCommandInput(input)
  const updatedCommand = {
    ...getGroupCommandOrThrow(group, input.commandId),
    name: normalized.name,
    command: normalized.command,
    updatedAt: now(),
  }
  const updated = withGroupCommands(
    group,
    (group.settings?.commands ?? []).map((command) =>
      command.id === input.commandId ? updatedCommand : command),
  )
  groups.set(group.id, updated)
  await flushPersist()
  return updatedCommand
},
async deleteGroupCommand(input: TerminalDeleteGroupCommandInput): Promise<void> {
  const group = getGroupOrThrow(input.groupId)
  getGroupCommandOrThrow(group, input.commandId)
  const updated = withGroupCommands(
    group,
    (group.settings?.commands ?? []).filter((command) => command.id !== input.commandId),
  )
  groups.set(group.id, updated)
  await flushPersist()
},
async launchGroupCommand(input: TerminalLaunchGroupCommandInput): Promise<TerminalSession> {
  const group = getGroupOrThrow(input.groupId)
  const command = getGroupCommandOrThrow(group, input.commandId)
  const session = await this.createSession({
    groupId: group.id,
    title: command.name,
    cols: input.cols,
    rows: input.rows,
  })
  writeStartupCommand(session.id, command.command)
  return session
},
```

If `this.createSession` is not type-safe in the object literal, extract the existing create-session body into an inner `async function createSessionRecord(input: TerminalCreateSessionInput)` and call that function from both methods.

- [ ] **Step 5: Refactor existing `runPendingStartupCommand` to reuse `writeStartupCommand`**

Replace:

```ts
startupEchoFilters.set(sessionId, createStartupEchoFilter(command))
runtime.pty.write(appendTerminalNewline(command))
```

with:

```ts
writeStartupCommand(sessionId, command)
```

- [ ] **Step 6: Run service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/main/__tests__/service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/app-capabilities/terminal/main/service.ts desktop/app-capabilities/terminal/main/__tests__/service.test.ts
git commit -m "feat(terminal): add group command service"
```

---

### Task 3: IPC, Preload, And Bridge Types

**Files:**
- Modify: `desktop/app-capabilities/terminal/main/ipc.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/terminal.ts`
- Modify: `desktop/src/types/bridge.ts`
- Test: `desktop/app-capabilities/terminal/main/__tests__/ipc.test.ts`

- [ ] **Step 1: Add failing IPC tests**

In `desktop/app-capabilities/terminal/main/__tests__/ipc.test.ts`, update the channel test with:

```ts
    expect(terminalIpcModule.methods.createGroupCommand.channel).toBe("synapse:terminal:group-command:create")
    expect(terminalIpcModule.methods.updateGroupCommand.channel).toBe("synapse:terminal:group-command:update")
    expect(terminalIpcModule.methods.deleteGroupCommand.channel).toBe("synapse:terminal:group-command:delete")
    expect(terminalIpcModule.methods.launchGroupCommand.channel).toBe("synapse:terminal:group-command:launch")
```

Add a handler test:

```ts
  it("manages and launches terminal group commands through IPC", async () => {
    const service = createService()
    const ctx = createContext(service)

    await terminalIpcModule.methods.createGroupCommand.handler(ctx, {
      groupId: "group-1",
      name: "dev",
      command: "pnpm dev",
    })
    await terminalIpcModule.methods.updateGroupCommand.handler(ctx, {
      groupId: "group-1",
      commandId: "cmd-1",
      name: "test",
      command: "pnpm test",
    })
    await terminalIpcModule.methods.launchGroupCommand.handler(ctx, {
      groupId: "group-1",
      commandId: "cmd-1",
      cols: 120,
      rows: 40,
    })
    await terminalIpcModule.methods.deleteGroupCommand.handler(ctx, {
      groupId: "group-1",
      commandId: "cmd-1",
    })

    expect(service.createGroupCommand).toHaveBeenCalledWith({
      groupId: "group-1",
      name: "dev",
      command: "pnpm dev",
    })
    expect(service.updateGroupCommand).toHaveBeenCalledWith({
      groupId: "group-1",
      commandId: "cmd-1",
      name: "test",
      command: "pnpm test",
    })
    expect(service.launchGroupCommand).toHaveBeenCalledWith({
      groupId: "group-1",
      commandId: "cmd-1",
      cols: 120,
      rows: 40,
    })
    expect(service.deleteGroupCommand).toHaveBeenCalledWith({
      groupId: "group-1",
      commandId: "cmd-1",
    })
  })
```

Update the local `createService()` fake in that test file to include:

```ts
createGroupCommand: vi.fn(async () => ({
  id: "cmd-1",
  name: "dev",
  command: "pnpm dev",
  createdAt: "2026-06-24T00:00:00.000Z",
  updatedAt: "2026-06-24T00:00:00.000Z",
})),
updateGroupCommand: vi.fn(async () => ({
  id: "cmd-1",
  name: "test",
  command: "pnpm test",
  createdAt: "2026-06-24T00:00:00.000Z",
  updatedAt: "2026-06-24T00:01:00.000Z",
})),
deleteGroupCommand: vi.fn(async () => undefined),
launchGroupCommand: vi.fn(async () => createSession({ id: "session-command", title: "test" })),
```

- [ ] **Step 2: Run IPC test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/main/__tests__/ipc.test.ts
```

Expected: FAIL because IPC methods do not exist.

- [ ] **Step 3: Register IPC methods**

In `desktop/app-capabilities/terminal/main/ipc.ts`, import command schemas:

```ts
  terminalCreateGroupCommandInputSchema,
  terminalDeleteGroupCommandInputSchema,
  terminalLaunchGroupCommandInputSchema,
  terminalGroupCommandSchema,
  terminalUpdateGroupCommandInputSchema,
```

Add methods after `updateGroupSettings`:

```ts
    createGroupCommand: {
      channel: "synapse:terminal:group-command:create",
      kind: "invoke",
      request: terminalCreateGroupCommandInputSchema,
      response: terminalGroupCommandSchema,
      handler: (ctx, request: z.infer<typeof terminalCreateGroupCommandInputSchema>) =>
        resolveTerminalService(ctx).createGroupCommand(request),
    },
    updateGroupCommand: {
      channel: "synapse:terminal:group-command:update",
      kind: "invoke",
      request: terminalUpdateGroupCommandInputSchema,
      response: terminalGroupCommandSchema,
      handler: (ctx, request: z.infer<typeof terminalUpdateGroupCommandInputSchema>) =>
        resolveTerminalService(ctx).updateGroupCommand(request),
    },
    deleteGroupCommand: {
      channel: "synapse:terminal:group-command:delete",
      kind: "invoke",
      request: terminalDeleteGroupCommandInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof terminalDeleteGroupCommandInputSchema>) =>
        resolveTerminalService(ctx).deleteGroupCommand(request),
    },
    launchGroupCommand: {
      channel: "synapse:terminal:group-command:launch",
      kind: "invoke",
      request: terminalLaunchGroupCommandInputSchema,
      response: terminalSessionSchema,
      handler: (ctx, request: z.infer<typeof terminalLaunchGroupCommandInputSchema>) =>
        resolveTerminalService(ctx).launchGroupCommand(request),
    },
```

- [ ] **Step 4: Update terminal renderer types**

In `desktop/src/types/terminal.ts`, import:

```ts
  TerminalCreateGroupCommandInput,
  TerminalDeleteGroupCommandInput,
  TerminalGroupCommand,
  TerminalLaunchGroupCommandInput,
  TerminalUpdateGroupCommandInput,
```

Add exports:

```ts
export type SynapseTerminalGroupCommand = TerminalGroupCommand
export type SynapseTerminalCreateGroupCommandInput = TerminalCreateGroupCommandInput
export type SynapseTerminalUpdateGroupCommandInput = TerminalUpdateGroupCommandInput
export type SynapseTerminalDeleteGroupCommandInput = TerminalDeleteGroupCommandInput
export type SynapseTerminalLaunchGroupCommandInput = TerminalLaunchGroupCommandInput
```

- [ ] **Step 5: Update bridge types**

In `desktop/src/types/bridge.ts`, import the new Synapse terminal types from `./terminal`, then add methods inside `terminal`:

```ts
    createGroupCommand: (input: SynapseTerminalCreateGroupCommandInput) => Promise<SynapseTerminalGroupCommand>
    updateGroupCommand: (input: SynapseTerminalUpdateGroupCommandInput) => Promise<SynapseTerminalGroupCommand>
    deleteGroupCommand: (input: SynapseTerminalDeleteGroupCommandInput) => Promise<void>
    launchGroupCommand: (input: SynapseTerminalLaunchGroupCommandInput) => Promise<SynapseTerminalSession>
```

- [ ] **Step 6: Update preload channels and bridge implementation**

In `desktop/electron/preload.ts`, add channel names in `IPC_CHANNELS.terminal`:

```ts
    "createGroupCommand": "synapse:terminal:group-command:create",
    "updateGroupCommand": "synapse:terminal:group-command:update",
    "deleteGroupCommand": "synapse:terminal:group-command:delete",
    "launchGroupCommand": "synapse:terminal:group-command:launch",
```

Add bridge methods next to `updateGroupSettings`:

```ts
    createGroupCommand: (input) => invoke(IPC_CHANNELS.terminal.createGroupCommand)(input),
    updateGroupCommand: (input) => invoke(IPC_CHANNELS.terminal.updateGroupCommand)(input),
    deleteGroupCommand: (input) => invoke(IPC_CHANNELS.terminal.deleteGroupCommand)(input),
    launchGroupCommand: (input) => invoke(IPC_CHANNELS.terminal.launchGroupCommand)(input),
```

- [ ] **Step 7: Run IPC and type checks for touched surface**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/main/__tests__/ipc.test.ts
pnpm --filter @synapse/desktop run typecheck
```

Expected: IPC test PASS and typecheck PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/app-capabilities/terminal/main/ipc.ts desktop/electron/preload.ts desktop/src/types/terminal.ts desktop/src/types/bridge.ts desktop/app-capabilities/terminal/main/__tests__/ipc.test.ts
git commit -m "feat(terminal): expose group command ipc"
```

---

### Task 4: MCP Capability Dispatcher

**Files:**
- Modify: `desktop/app-capabilities/terminal/shared/capability.ts`
- Modify: `desktop/app-capabilities/terminal/main/dispatcher.ts`
- Test: `desktop/app-capabilities/terminal/main/__tests__/dispatcher.test.ts`

- [ ] **Step 1: Add failing dispatcher tests**

In `desktop/app-capabilities/terminal/main/__tests__/dispatcher.test.ts`, import new constants:

```ts
  TERMINAL_GROUP_COMMAND_CREATE_CAPABILITY_ID,
  TERMINAL_GROUP_COMMAND_DELETE_CAPABILITY_ID,
  TERMINAL_GROUP_COMMAND_LAUNCH_CAPABILITY_ID,
  TERMINAL_GROUP_COMMAND_UPDATE_CAPABILITY_ID,
```

Add tests:

```ts
  it("dispatches group command create with permission and audit metadata", async () => {
    const created = createCommand()
    const createGroupCommand = vi.fn(async () => created)
    const permissionGuard = vi.fn(async () => undefined)
    const auditSink = vi.fn(async () => undefined)
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { createGroupCommand } as never,
      permissionGuard,
      auditSink,
    })

    const result = await dispatcher.dispatch(TERMINAL_GROUP_COMMAND_CREATE_CAPABILITY_ID, {
      groupId: "g1",
      name: "dev",
      command: "pnpm dev",
    }, { source: "mcp-http" })

    expect(createGroupCommand).toHaveBeenCalledWith({
      groupId: "g1",
      name: "dev",
      command: "pnpm dev",
    })
    expect(permissionGuard).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "g1",
      boundary: "terminal.mcp.createGroupCommand",
    }))
    expect(auditSink).toHaveBeenCalled()
    expect(result).toEqual({ ok: true, data: created, affected: 1 })
  })

  it("dispatches group command launch through the shell permission boundary", async () => {
    const launched = createSession({ id: "session-command", title: "dev" })
    const launchGroupCommand = vi.fn(async () => launched)
    const permissionGuard = vi.fn(async () => undefined)
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { launchGroupCommand } as never,
      permissionGuard,
    })

    const result = await dispatcher.dispatch(TERMINAL_GROUP_COMMAND_LAUNCH_CAPABILITY_ID, {
      groupId: "g1",
      commandId: "cmd-dev",
      cols: 100,
      rows: 30,
    }, { source: "mcp-http" })

    expect(launchGroupCommand).toHaveBeenCalledWith({
      groupId: "g1",
      commandId: "cmd-dev",
      cols: 100,
      rows: 30,
    })
    expect(permissionGuard).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "cmd-dev",
      boundary: "terminal.mcp.launchGroupCommand",
    }))
    expect(result).toEqual({ ok: true, data: launched, affected: 1 })
  })
```

Add helper at the bottom:

```ts
function createCommand(overrides = {}) {
  return {
    id: "cmd-1",
    name: "dev",
    command: "pnpm dev",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    ...overrides,
  }
}
```

- [ ] **Step 2: Run dispatcher tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/main/__tests__/dispatcher.test.ts
```

Expected: FAIL because capability constants and dispatcher cases do not exist.

- [ ] **Step 3: Add capability constants**

In `desktop/app-capabilities/terminal/shared/capability.ts`, add:

```ts
export const TERMINAL_GROUP_COMMAND_CREATE_CAPABILITY_ID =
  "app.terminal.groupCommand.create" as CapabilityId
export const TERMINAL_GROUP_COMMAND_UPDATE_CAPABILITY_ID =
  "app.terminal.groupCommand.update" as CapabilityId
export const TERMINAL_GROUP_COMMAND_DELETE_CAPABILITY_ID =
  "app.terminal.groupCommand.delete" as CapabilityId
export const TERMINAL_GROUP_COMMAND_LAUNCH_CAPABILITY_ID =
  "app.terminal.groupCommand.launch" as CapabilityId
```

Add tool names:

```ts
  groupCommandCreate: "app_terminal_groupCommand_create",
  groupCommandUpdate: "app_terminal_groupCommand_update",
  groupCommandDelete: "app_terminal_groupCommand_delete",
  groupCommandLaunch: "app_terminal_groupCommand_launch",
```

- [ ] **Step 4: Add dispatcher schema imports and cases**

In `desktop/app-capabilities/terminal/main/dispatcher.ts`, import the constants and schemas:

```ts
  TERMINAL_GROUP_COMMAND_CREATE_CAPABILITY_ID,
  TERMINAL_GROUP_COMMAND_DELETE_CAPABILITY_ID,
  TERMINAL_GROUP_COMMAND_LAUNCH_CAPABILITY_ID,
  TERMINAL_GROUP_COMMAND_UPDATE_CAPABILITY_ID,
```

```ts
  terminalCreateGroupCommandInputSchema,
  terminalDeleteGroupCommandInputSchema,
  terminalLaunchGroupCommandInputSchema,
  terminalUpdateGroupCommandInputSchema,
```

Add cases before group delete:

```ts
      if (action === TERMINAL_GROUP_COMMAND_CREATE_CAPABILITY_ID) {
        const parsed = terminalCreateGroupCommandInputSchema.parse(params)
        await authorizeTerminalControl(deps, context, {
          capabilityAction: TERMINAL_GROUP_COMMAND_CREATE_CAPABILITY_ID,
          resource: parsed.groupId,
          boundary: "terminal.mcp.createGroupCommand",
          groupId: parsed.groupId,
          byteCount: Buffer.byteLength(parsed.command),
        })
        return { ok: true, data: await deps.service.createGroupCommand(parsed), affected: 1 }
      }
      if (action === TERMINAL_GROUP_COMMAND_UPDATE_CAPABILITY_ID) {
        const parsed = terminalUpdateGroupCommandInputSchema.parse(params)
        await authorizeTerminalControl(deps, context, {
          capabilityAction: TERMINAL_GROUP_COMMAND_UPDATE_CAPABILITY_ID,
          resource: parsed.commandId,
          boundary: "terminal.mcp.updateGroupCommand",
          groupId: parsed.groupId,
          commandId: parsed.commandId,
          byteCount: Buffer.byteLength(parsed.command),
        })
        return { ok: true, data: await deps.service.updateGroupCommand(parsed), affected: 1 }
      }
      if (action === TERMINAL_GROUP_COMMAND_DELETE_CAPABILITY_ID) {
        const parsed = terminalDeleteGroupCommandInputSchema.parse(params)
        await authorizeTerminalControl(deps, context, {
          capabilityAction: TERMINAL_GROUP_COMMAND_DELETE_CAPABILITY_ID,
          resource: parsed.commandId,
          boundary: "terminal.mcp.deleteGroupCommand",
          groupId: parsed.groupId,
          commandId: parsed.commandId,
        })
        await deps.service.deleteGroupCommand(parsed)
        return { ok: true, data: { ok: true }, affected: 1 }
      }
      if (action === TERMINAL_GROUP_COMMAND_LAUNCH_CAPABILITY_ID) {
        const parsed = terminalLaunchGroupCommandInputSchema.parse(params)
        await authorizeTerminalControl(deps, context, {
          capabilityAction: TERMINAL_GROUP_COMMAND_LAUNCH_CAPABILITY_ID,
          resource: parsed.commandId,
          boundary: "terminal.mcp.launchGroupCommand",
          groupId: parsed.groupId,
          commandId: parsed.commandId,
        })
        return { ok: true, data: await deps.service.launchGroupCommand(parsed), affected: 1 }
      }
```

- [ ] **Step 5: Run dispatcher tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/main/__tests__/dispatcher.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/app-capabilities/terminal/shared/capability.ts desktop/app-capabilities/terminal/main/dispatcher.ts desktop/app-capabilities/terminal/main/__tests__/dispatcher.test.ts
git commit -m "feat(terminal): expose group command mcp actions"
```

---

### Task 5: Renderer Tests For Command UI

**Files:**
- Modify: `desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx`

- [ ] **Step 1: Extend renderer bridge mock**

In the hoisted `terminalBridge`, add:

```ts
  createGroupCommand: vi.fn(async ({ groupId, name, command }: {
    groupId: string
    name: string
    command: string
  }) => {
    const group = bridgeState.groups.find((item) => item.id === groupId)
    if (!group) throw new Error("Group not found")
    const nextCommand = {
      id: `cmd-${(group.settings?.commands?.length ?? 0) + 1}`,
      name: name.trim(),
      command: command.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim(),
      createdAt: "2026-06-24T00:03:00.000Z",
      updatedAt: "2026-06-24T00:03:00.000Z",
    }
    const updated = {
      ...group,
      settings: {
        ...(group.settings?.defaultCwd ? { defaultCwd: group.settings.defaultCwd } : {}),
        commands: [...(group.settings?.commands ?? []), nextCommand],
      },
    }
    bridgeState.groups = bridgeState.groups.map((item) => item.id === groupId ? updated : item)
    return nextCommand
  }),
  updateGroupCommand: vi.fn(async ({ groupId, commandId, name, command }: {
    groupId: string
    commandId: string
    name: string
    command: string
  }) => {
    const group = bridgeState.groups.find((item) => item.id === groupId)
    if (!group) throw new Error("Group not found")
    const updatedCommand = {
      id: commandId,
      name: name.trim(),
      command: command.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim(),
      createdAt: "2026-06-24T00:03:00.000Z",
      updatedAt: "2026-06-24T00:04:00.000Z",
    }
    const updated = {
      ...group,
      settings: {
        ...(group.settings?.defaultCwd ? { defaultCwd: group.settings.defaultCwd } : {}),
        commands: (group.settings?.commands ?? []).map((item) => item.id === commandId ? updatedCommand : item),
      },
    }
    bridgeState.groups = bridgeState.groups.map((item) => item.id === groupId ? updated : item)
    return updatedCommand
  }),
  deleteGroupCommand: vi.fn(async ({ groupId, commandId }: { groupId: string; commandId: string }) => {
    const group = bridgeState.groups.find((item) => item.id === groupId)
    if (!group) throw new Error("Group not found")
    const commands = (group.settings?.commands ?? []).filter((item) => item.id !== commandId)
    const settings = group.settings?.defaultCwd || commands.length
      ? {
          ...(group.settings?.defaultCwd ? { defaultCwd: group.settings.defaultCwd } : {}),
          ...(commands.length ? { commands } : {}),
        }
      : undefined
    bridgeState.groups = bridgeState.groups.map((item) => item.id === groupId ? { ...group, settings } : item)
  }),
  launchGroupCommand: vi.fn(async ({ groupId, commandId, cols, rows }: {
    groupId: string
    commandId: string
    cols?: number
    rows?: number
  }) => {
    const group = bridgeState.groups.find((item) => item.id === groupId)
    const command = group?.settings?.commands?.find((item) => item.id === commandId)
    if (!command) throw new Error("Command not found")
    return createSession({
      id: `session-${bridgeState.sessions.length + 1}`,
      groupId,
      title: command.name,
      cols: cols ?? 80,
      rows: rows ?? 24,
    })
  }),
```

Clear these mocks in the existing `beforeEach`.

- [ ] **Step 2: Add failing renderer tests**

Add tests near existing group settings tests:

```ts
  it("shows group command launch and management actions", async () => {
    bridgeState.groups = [createGroup({
      id: "group-1",
      name: "前端项目",
      settings: {
        commands: [{
          id: "cmd-dev",
          name: "dev",
          command: "pnpm dev",
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
        }],
      },
    })]

    await renderModule()
    await clickCommandMenu("前端项目")

    expect(document.body.textContent).toContain("dev")
    expect(document.body.textContent).toContain("管理命令")
  })

  it("launches a named command as a new terminal session", async () => {
    bridgeState.groups = [createGroup({
      id: "group-1",
      name: "前端项目",
      settings: {
        commands: [{
          id: "cmd-dev",
          name: "dev",
          command: "pnpm dev",
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
        }],
      },
    })]

    await renderModule()
    await clickCommandMenu("前端项目")
    await clickMenuItem("dev")

    expect(terminalBridge.launchGroupCommand).toHaveBeenCalledWith({
      groupId: "group-1",
      commandId: "cmd-dev",
      cols: 80,
      rows: 24,
    })
    expect(document.body.textContent).toContain("dev")
  })

  it("keeps group settings focused on name and default directory", async () => {
    bridgeState.groups = [createGroup({
      id: "group-1",
      name: "前端项目",
      settings: {
        defaultCwd: "/repo/web",
        commands: [{
          id: "cmd-dev",
          name: "dev",
          command: "pnpm dev",
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
        }],
      },
    })]

    await renderModule()
    await clickGroupMenu("前端项目")
    await clickMenuItem("设置")

    expect(document.body.textContent).toContain("分组设置")
    expect(document.body.textContent).toContain("默认目录")
    expect(document.body.textContent).not.toContain("启动命令")
  })

  it("adds edits and deletes commands from command management", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "前端项目" })]

    await renderModule()
    await clickGroupMenu("前端项目")
    await clickMenuItem("命令")
    await clickButton("新增命令")
    await changeInput("命令名称", "dev")
    await changeTextarea("命令内容", "pnpm dev")
    await clickButton("保存")

    expect(terminalBridge.createGroupCommand).toHaveBeenCalledWith({
      groupId: "group-1",
      name: "dev",
      command: "pnpm dev",
    })

    await clickButtonByAriaLabel("编辑命令：dev")
    await changeInput("命令名称", "test")
    await changeTextarea("命令内容", "pnpm test")
    await clickButton("保存")

    expect(terminalBridge.updateGroupCommand).toHaveBeenCalledWith({
      groupId: "group-1",
      commandId: "cmd-1",
      name: "test",
      command: "pnpm test",
    })

    await clickButtonByAriaLabel("删除命令：test")

    expect(terminalBridge.deleteGroupCommand).toHaveBeenCalledWith({
      groupId: "group-1",
      commandId: "cmd-1",
    })
  })
```

Add helpers:

```ts
async function clickCommandMenu(name: string): Promise<void> {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.getAttribute("aria-label") === `以命令启动：${name}`)
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
      ctrlKey: false,
    }))
    button?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }))
    button?.click()
    await Promise.resolve()
  })
}

async function clickButtonByAriaLabel(label: string): Promise<void> {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.getAttribute("aria-label") === label)
  await act(async () => {
    button?.click()
    await Promise.resolve()
  })
}
```

- [ ] **Step 3: Run renderer tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx
```

Expected: FAIL because renderer UI and bridge calls do not exist.

- [ ] **Step 4: Keep renderer tests uncommitted until Task 6 passes**

Do not commit this failing-test state. Continue directly to Task 6 and commit the renderer test plus implementation together after the tests pass.

---

### Task 6: Renderer Command UI

**Files:**
- Modify: `desktop/app-capabilities/terminal/renderer/index.tsx`
- Test: `desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx`

- [ ] **Step 1: Update imports and state**

In `desktop/app-capabilities/terminal/renderer/index.tsx`, add `Code2` to lucide imports:

```ts
import { CircleDot, Code2, Folder, FolderOpen, Link2Off, MoreHorizontal, Pencil, Plus, Settings, Terminal as TerminalIcon, Trash2 } from "lucide-react"
```

Import `SynapseTerminalGroupCommand`:

```ts
  SynapseTerminalGroupCommand,
```

Remove:

```ts
const [groupSettingsStartupCommand, setGroupSettingsStartupCommand] = useState("")
```

Add command dialog state:

```ts
  const [commandManagerTarget, setCommandManagerTarget] = useState<SynapseTerminalGroup | null>(null)
  const [commandEditTarget, setCommandEditTarget] = useState<SynapseTerminalGroupCommand | null>(null)
  const [commandName, setCommandName] = useState("")
  const [commandText, setCommandText] = useState("")
  const [commandSaving, setCommandSaving] = useState(false)
  const [commandDeletingId, setCommandDeletingId] = useState<string | null>(null)
```

- [ ] **Step 2: Remove startup command from group settings logic**

Change `openGroupSettingsDialog` to stop setting startup command:

```ts
  const openGroupSettingsDialog = useCallback((group: SynapseTerminalGroup) => {
    setGroupSettingsTarget(group)
    setGroupSettingsName(group.name)
    setGroupSettingsDefaultCwd(group.settings?.defaultCwd ?? "")
  }, [])
```

Change `resetGroupSettingsDialog` to stop clearing startup command.

Change `saveGroupSettings` to only persist default cwd:

```ts
    const defaultCwd = groupSettingsDefaultCwd.trim()
    setGroupSettingsSaving(true)
    try {
      const group = await terminalBridge.updateGroupSettings({
        groupId: groupSettingsTarget.id,
        name,
        settings: {
          ...(defaultCwd ? { defaultCwd } : {}),
          ...(groupSettingsTarget.settings?.commands?.length ? { commands: groupSettingsTarget.settings.commands } : {}),
        },
      })
```

Remove `groupSettingsStartupCommand` from the dependency array.

- [ ] **Step 3: Add command helpers**

Add callbacks near other group callbacks:

```ts
  const openCommandManager = useCallback((group: SynapseTerminalGroup) => {
    setCommandManagerTarget(group)
    setCommandEditTarget(null)
    setCommandName("")
    setCommandText("")
  }, [])

  const openCreateCommandDialog = useCallback(() => {
    setCommandEditTarget(null)
    setCommandName("")
    setCommandText("")
  }, [])

  const openEditCommandDialog = useCallback((command: SynapseTerminalGroupCommand) => {
    setCommandEditTarget(command)
    setCommandName(command.name)
    setCommandText(command.command)
  }, [])

  const closeCommandForm = useCallback(() => {
    setCommandEditTarget(null)
    setCommandName("")
    setCommandText("")
  }, [])

  const saveCommand = useCallback(async () => {
    if (!commandManagerTarget) return
    const name = commandName.trim()
    const command = commandText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
    if (!name || !command) return
    setCommandSaving(true)
    try {
      if (commandEditTarget) {
        await terminalBridge.updateGroupCommand({
          groupId: commandManagerTarget.id,
          commandId: commandEditTarget.id,
          name,
          command,
        })
      } else {
        await terminalBridge.createGroupCommand({
          groupId: commandManagerTarget.id,
          name,
          command,
        })
      }
      const nextGroups = await terminalBridge.listGroups()
      setGroups(nextGroups)
      const nextTarget = nextGroups.find((group) => group.id === commandManagerTarget.id) ?? null
      setCommandManagerTarget(nextTarget)
      closeCommandForm()
    } catch (error) {
      logger.error("Failed to save terminal command.", error)
      toast.error("保存命令失败")
    } finally {
      setCommandSaving(false)
    }
  }, [closeCommandForm, commandEditTarget, commandManagerTarget, commandName, commandText, terminalBridge])

  const deleteCommand = useCallback(async (command: SynapseTerminalGroupCommand) => {
    if (!commandManagerTarget) return
    setCommandDeletingId(command.id)
    try {
      await terminalBridge.deleteGroupCommand({
        groupId: commandManagerTarget.id,
        commandId: command.id,
      })
      const nextGroups = await terminalBridge.listGroups()
      setGroups(nextGroups)
      setCommandManagerTarget(nextGroups.find((group) => group.id === commandManagerTarget.id) ?? null)
      if (commandEditTarget?.id === command.id) closeCommandForm()
    } catch (error) {
      logger.error("Failed to delete terminal command.", error)
      toast.error("删除命令失败")
    } finally {
      setCommandDeletingId((current) => current === command.id ? null : current)
    }
  }, [closeCommandForm, commandEditTarget, commandManagerTarget, terminalBridge])

  const launchCommand = useCallback(async (group: SynapseTerminalGroup, command: SynapseTerminalGroupCommand) => {
    try {
      const session = await terminalBridge.launchGroupCommand({
        groupId: group.id,
        commandId: command.id,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
      })
      setSessions((current) => mergeSession(current, session))
      setActiveSessionId(session.id)
      setTerminalReadError(null)
      const nextGroups = await terminalBridge.listGroups()
      setGroups(nextGroups)
    } catch (error) {
      logger.error("Failed to launch terminal command.", error)
      toast.error("启动命令失败")
    }
  }, [terminalBridge])
```

- [ ] **Step 4: Add command launch button in group header**

Between `+` and `...`, add:

```tsx
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`以命令启动：${group.name}`}
                          >
                            <Code2 className="size-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {group.settings?.commands?.map((command) => (
                            <DropdownMenuItem key={command.id} onClick={() => { void launchCommand(group, command) }}>
                              <TerminalIcon />
                              {command.name}
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuItem onClick={() => openCommandManager(group)}>
                            <Settings />
                            管理命令
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
```

In the `...` menu, add:

```tsx
                          <DropdownMenuItem onClick={() => openCommandManager(group)}>
                            <Code2 />
                            命令
                          </DropdownMenuItem>
```

- [ ] **Step 5: Remove startup command textarea from group settings dialog**

Delete the `启动命令` label and `Textarea` block from the group settings dialog.

Update the sr-only description:

```tsx
              设置分组名称和默认目录。
```

- [ ] **Step 6: Add command management dialog**

Add after the group settings dialog:

```tsx
      <Dialog open={commandManagerTarget !== null} onOpenChange={(open) => {
        if (!open) {
          setCommandManagerTarget(null)
          closeCommandForm()
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>命令</DialogTitle>
            <DialogDescription className="sr-only">
              管理终端分组命令。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {commandManagerTarget?.settings?.commands?.length ? (
              <div className="grid gap-2">
                {commandManagerTarget.settings.commands.map((command) => (
                  <div key={command.id} className="grid gap-1 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-sm font-medium">{command.name}</div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`编辑命令：${command.name}`}
                          onClick={() => openEditCommandDialog(command)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`删除命令：${command.name}`}
                          disabled={commandDeletingId === command.id}
                          onClick={() => { void deleteCommand(command) }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{command.command}</div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="grid gap-3">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">名称</span>
                <Input
                  aria-label="命令名称"
                  value={commandName}
                  onChange={(event) => setCommandName(event.target.value)}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">命令内容</span>
                <Textarea
                  aria-label="命令内容"
                  value={commandText}
                  onChange={(event) => setCommandText(event.target.value)}
                  rows={5}
                />
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={commandSaving}
              onClick={() => {
                if (commandName || commandText || commandEditTarget) {
                  closeCommandForm()
                } else {
                  setCommandManagerTarget(null)
                }
              }}
            >
              关闭
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={commandSaving}
              onClick={openCreateCommandDialog}
            >
              新增命令
            </Button>
            <Button
              type="button"
              disabled={commandSaving || !commandName.trim() || !commandText.trim()}
              onClick={() => { void saveCommand() }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

If `line-clamp-2` is unavailable in Tailwind v4 config, replace it with `max-h-10 overflow-hidden whitespace-pre-wrap text-xs text-muted-foreground`.

- [ ] **Step 7: Remove renderer startup-ready bridge call**

Delete the effect block that calls:

```ts
terminalBridge.runStartupCommand({ sessionId: terminalSessionId })
```

The terminal renderer should no longer call `runStartupCommand`.

- [ ] **Step 8: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx
```

Expected: PASS after adjusting snapshots/assertions that expected `启动命令` in group settings or `runStartupCommand` calls.

- [ ] **Step 9: Commit**

```bash
git add desktop/app-capabilities/terminal/renderer/index.tsx desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx
git commit -m "feat(terminal): add group command launcher ui"
```

---

### Task 7: Release Note And Full Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add one bullet under the current pending section in `RELEASE_NOTES_PENDING.md`:

```md
- 终端分组支持配置多个命名命令；`+` 会新建干净终端，命令可从分组旁的专用菜单启动。
```

- [ ] **Step 2: Run focused terminal tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/app-capabilities/terminal/main/__tests__/service.test.ts \
  desktop/app-capabilities/terminal/main/__tests__/ipc.test.ts \
  desktop/app-capabilities/terminal/main/__tests__/dispatcher.test.ts \
  desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run IPC codegen check**

Run:

```bash
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: PASS. If it reports generated IPC drift, run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Then include generated IPC files in the commit.

- [ ] **Step 5: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note terminal group commands"
```

---

## Final Self-Review Checklist

- [ ] `+` creates a clean terminal and does not run migrated or configured commands.
- [ ] Command launch always creates a new session and focuses it.
- [ ] Commands are bound to terminal groups, not projects.
- [ ] Command model has only `id`, `name`, `command`, `createdAt`, and `updatedAt`.
- [ ] Existing `startupCommand` is migrated to one command named `启动命令`.
- [ ] Group settings UI only contains name and default directory.
- [ ] Command management supports add, edit, and delete.
- [ ] No custom colors, inline styles, gradients, nested cards, or explanatory UI copy were added.
- [ ] Terminal MCP/IPC/preload/bridge surfaces are aligned.
- [ ] `RELEASE_NOTES_PENDING.md` has a user-facing note.
