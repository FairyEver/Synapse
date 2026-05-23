# Knowledge Base Composer Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Knowledge Base composer dropdown and complete `/wiki ...` slash menu candidates that only appear for Knowledge Base projects.

**Architecture:** The Knowledge Base project contribution publishes UI-visible command metadata in addition to the real `/wiki` command. The renderer derives both slash candidates and composer actions from the published command list; all execution remains ordinary text messages routed through `/wiki`.

**Tech Stack:** Electron main process, React, TypeScript, shadcn/Radix UI, Vitest, jsdom.

---

## File Structure

- Modify: `desktop/electron/services/agent-runtime/command-registry.ts`
  - Add optional UI metadata types to `PublishedAgentCommand`.
- Modify: `desktop/electron/services/agent-runtime/project-contributions.ts`
  - Add `publishedCommands` to project contributions and merge it.
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
  - Include contribution-published UI entries in `listPublishedCommands`.
- Modify: `desktop/electron/services/knowledge-base/agent-contribution.ts`
  - Publish Knowledge Base UI command entries for `wiki ingest`, `wiki query`, `wiki hot`, `wiki save`, `wiki lint`, and `wiki status`.
- Modify: `desktop/electron/modules/agent/ipc-tools.ts`
  - Extend IPC response schema to pass optional `ui` metadata.
- Modify: `desktop/electron/services/bridge-adapter/bridge-adapter-service.ts`
  - Preserve `ui` metadata in bridge capability snapshots.
- Modify: `desktop/src/types/agent.ts`
  - Mirror optional command UI metadata in renderer types.
- Modify: `desktop/src/modules/agent/slash-menu.ts`
  - Carry `insertText` through slash candidates and use it for replacement.
- Modify: `desktop/src/modules/agent/index.tsx`
  - Derive Knowledge Base actions from command metadata and wire send/insert callbacks.
- Create: `desktop/src/modules/agent/components/knowledge-base-action-menu.tsx`
  - Render the compact left-side Knowledge Base action dropdown.
- Modify: `desktop/src/modules/agent/components/agent-composer.tsx`
  - Accept Knowledge Base actions and callbacks; render the action menu in `leadingActions`.
- Test: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts`
- Test: `desktop/src/modules/agent/__tests__/slash-menu.test.ts`
- Test: `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`

---

### Task 1: Publish Knowledge Base Command UI Metadata

**Files:**
- Modify: `desktop/electron/services/agent-runtime/command-registry.ts`
- Modify: `desktop/electron/services/agent-runtime/project-contributions.ts`
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- Modify: `desktop/electron/services/knowledge-base/agent-contribution.ts`
- Modify: `desktop/electron/modules/agent/ipc-tools.ts`
- Modify: `desktop/electron/services/bridge-adapter/bridge-adapter-service.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts`

- [ ] **Step 1: Add failing contribution tests**

Add these tests inside `describe("knowledge base Agent contribution", () => { ... })` in `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`:

```ts
  it("publishes knowledge base composer actions for knowledge base projects", async () => {
    const projectPath = await tempDir()
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })

    expect(contribution?.publishedCommands).toEqual([
      {
        name: "wiki ingest",
        description: "汲取来源",
        source: "custom",
        kind: "prompt",
        adminOnly: false,
        ui: {
          group: "knowledge-base",
          label: "汲取来源",
          action: "send",
          insertText: "/wiki ingest",
        },
      },
      {
        name: "wiki query",
        description: "查询知识库",
        source: "custom",
        kind: "prompt",
        adminOnly: false,
        ui: {
          group: "knowledge-base",
          label: "查询知识库",
          action: "insert",
          insertText: "/wiki query ",
        },
      },
      {
        name: "wiki hot",
        description: "刷新热点",
        source: "custom",
        kind: "prompt",
        adminOnly: false,
        ui: {
          group: "knowledge-base",
          label: "刷新热点",
          action: "send",
          insertText: "/wiki hot",
        },
      },
      {
        name: "wiki save",
        description: "保存记录",
        source: "custom",
        kind: "prompt",
        adminOnly: false,
        ui: {
          group: "knowledge-base",
          label: "保存记录",
          action: "send",
          insertText: "/wiki save",
        },
      },
      {
        name: "wiki lint",
        description: "检查知识库",
        source: "custom",
        kind: "prompt",
        adminOnly: false,
        ui: {
          group: "knowledge-base",
          label: "检查知识库",
          action: "send",
          insertText: "/wiki lint",
        },
      },
      {
        name: "wiki status",
        description: "查看状态",
        source: "custom",
        kind: "prompt",
        adminOnly: false,
        ui: {
          group: "knowledge-base",
          label: "查看状态",
          action: "send",
          insertText: "/wiki status",
        },
      },
    ])
  })

  it("does not publish knowledge base composer actions for ordinary projects", async () => {
    const projectPath = await tempDir()
    const contribution = await createKnowledgeBaseAgentContribution({
      project: { id: "project-1", name: "Plain", path: projectPath },
    })

    expect(contribution).toBeNull()
  })
```

Add this test to `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts`, inside `describe("AgentRuntimeService", () => { ... })`:

```ts
  it("includes registered contribution UI commands in published commands", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const registeredPromptCommands = vi.fn(async () => [
      {
        name: "wiki",
        description: "Knowledge base command",
        buildPrompt: () => "expanded wiki prompt",
      },
    ])
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => new ScriptedSession([
        { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
      ], "sdk-1"),
      registeredPromptCommands,
      publishedProjectCommands: async () => [{
        name: "wiki ingest",
        description: "汲取来源",
        source: "custom",
        kind: "prompt",
        adminOnly: false,
        ui: {
          group: "knowledge-base",
          label: "汲取来源",
          action: "send",
          insertText: "/wiki ingest",
        },
      }],
    })

    await expect(service.listPublishedCommands()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "wiki" }),
        expect.objectContaining({
          name: "wiki ingest",
          ui: {
            group: "knowledge-base",
            label: "汲取来源",
            action: "send",
            insertText: "/wiki ingest",
          },
        }),
      ]),
    )
  })
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts \
  electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts
```

Expected: FAIL because `publishedCommands`, command UI metadata, and `publishedProjectCommands` do not exist yet.

- [ ] **Step 3: Add command UI metadata types**

In `desktop/electron/services/agent-runtime/command-registry.ts`, replace the current `PublishedAgentCommand` type section with:

```ts
export type PublishedCommandSource = "builtin" | "custom" | "skill" | "agent-native"
export type PublishedCommandKind = "builtin" | "prompt" | "exec" | "skill" | "agent-native"

export interface PublishedAgentCommandUi {
  readonly group?: "knowledge-base"
  readonly label?: string
  readonly action?: "send" | "insert"
  readonly insertText?: string
}

export interface PublishedAgentCommand {
  readonly name: string
  readonly description?: string
  readonly source: PublishedCommandSource
  readonly kind: PublishedCommandKind
  readonly adminOnly: boolean
  readonly allowedPlatforms?: readonly string[]
  readonly ui?: PublishedAgentCommandUi
}
```

In `desktop/electron/services/agent-runtime/project-contributions.ts`, update imports:

```ts
import type { PublishedAgentCommand } from "./command-registry"
import type { RegisteredPromptCommand } from "./command-router"
import type { AgentMessage } from "./types"
```

Then update `AgentProjectContribution` and merge:

```ts
export type AgentProjectContribution = {
  readonly commands: readonly RegisteredPromptCommand[]
  readonly publishedCommands?: readonly PublishedAgentCommand[]
  readonly sdkPlugins?: readonly AgentSdkPluginSpec[]
  prepareMessage?(
    message: AgentMessage,
    context: AgentProjectMessageContext,
  ): AgentMessage | Promise<AgentMessage>
}

export function mergeAgentProjectContributions(
  contributions: readonly AgentProjectContribution[],
): AgentProjectContribution {
  return {
    commands: contributions.flatMap((contribution) => contribution.commands),
    publishedCommands: contributions.flatMap((contribution) => contribution.publishedCommands ?? []),
    sdkPlugins: contributions.flatMap((contribution) => contribution.sdkPlugins ?? []),
    async prepareMessage(message, context) {
      let next = message
      for (const contribution of contributions) {
        next = await Promise.resolve(contribution.prepareMessage?.(next, context) ?? next)
      }
      return next
    },
  }
}
```

- [ ] **Step 4: Include project-published commands in runtime listing**

In `desktop/electron/services/agent-runtime/agent-runtime-service.ts`, add a dependency beside `registeredPromptCommands`:

```ts
  readonly publishedProjectCommands?: RegisteredPublishedCommandSource
```

Add this exported type near the other command source types in the same file:

```ts
type RegisteredPublishedCommandSource =
  | readonly PublishedAgentCommand[]
  | (() => readonly PublishedAgentCommand[] | Promise<readonly PublishedAgentCommand[]>)
```

Add a resolver near `resolveRegisteredPromptCommands` or beside local helper functions:

```ts
async function resolvePublishedProjectCommands(
  source: RegisteredPublishedCommandSource | undefined,
): Promise<readonly PublishedAgentCommand[]> {
  if (!source) return []
  return typeof source === "function" ? await source() : source
}
```

Update `listPublishedCommands`:

```ts
  async listPublishedCommands(platform = "local-renderer"): Promise<readonly PublishedAgentCommand[]> {
    const custom = (await this.deps.customCommands?.listPublished() ?? [])
      .filter((command) => !command.allowedPlatforms
        || command.allowedPlatforms.some((allowed) => allowed.toLowerCase() === platform.toLowerCase()))
    const skills = await this.deps.skills?.listPublished() ?? []
    const registeredPromptCommands = await resolveRegisteredPromptCommands(this.deps.registeredPromptCommands)
    const registered = registeredPromptCommands.map((command) => ({
      name: command.name,
      description: command.description,
      source: "custom" as const,
      kind: "prompt" as const,
      adminOnly: false,
    }))
    const projectPublished = await resolvePublishedProjectCommands(this.deps.publishedProjectCommands)
    const native = (this.deps.agentNativeSlashAllowlist ?? []).map((name) => ({
      name,
      source: "agent-native" as const,
      kind: "agent-native" as const,
      adminOnly: false,
      allowedPlatforms: ["local-renderer"],
    }))
    return [...BUILTIN_COMMANDS, ...registered, ...projectPublished, ...custom, ...skills, ...native]
  }
```

In `desktop/electron/services/agent-runtime/index.ts`, pass the contribution field into `AgentRuntimeService`:

```ts
        publishedProjectCommands: async () =>
          (await resolveAgentProjectContribution(ctx.projectId)).publishedCommands ?? [],
```

- [ ] **Step 5: Publish Knowledge Base UI actions**

In `desktop/electron/services/knowledge-base/agent-contribution.ts`, add this constant near the top after the input type:

```ts
const KNOWLEDGE_BASE_PUBLISHED_COMMANDS = [
  knowledgeBaseAction("wiki ingest", "汲取来源", "send", "/wiki ingest"),
  knowledgeBaseAction("wiki query", "查询知识库", "insert", "/wiki query "),
  knowledgeBaseAction("wiki hot", "刷新热点", "send", "/wiki hot"),
  knowledgeBaseAction("wiki save", "保存记录", "send", "/wiki save"),
  knowledgeBaseAction("wiki lint", "检查知识库", "send", "/wiki lint"),
  knowledgeBaseAction("wiki status", "查看状态", "send", "/wiki status"),
] as const
```

Add this helper near the bottom of the file:

```ts
function knowledgeBaseAction(
  name: string,
  label: string,
  action: "send" | "insert",
  insertText: string,
) {
  return {
    name,
    description: label,
    source: "custom" as const,
    kind: "prompt" as const,
    adminOnly: false,
    ui: {
      group: "knowledge-base" as const,
      label,
      action,
      insertText,
    },
  }
}
```

Then add `publishedCommands` in the returned contribution:

```ts
  return {
    sdkPlugins: [{
      type: "local",
      path: resolveKnowledgeBasePluginPath(),
    }],
    publishedCommands: KNOWLEDGE_BASE_PUBLISHED_COMMANDS,
    commands: [{
      name: "wiki",
      buildPrompt: (args) => buildKnowledgeBaseCommandPrompt(input.project.path, args),
    }],
    async prepareMessage(message, context) {
      if (!context.isNewLiveSession) {
        return message
      }
      const hotCache = await readOptional(hotCachePath)
      return prependBootstrap(message, bootstrap, hotCache)
    },
  }
```

- [ ] **Step 6: Preserve UI metadata through IPC and bridge snapshots**

In `desktop/electron/modules/agent/ipc-tools.ts`, add schema support:

```ts
const publishedCommandUiSchema = z.object({
  group: z.enum(["knowledge-base"]).optional(),
  label: z.string().optional(),
  action: z.enum(["send", "insert"]).optional(),
  insertText: z.string().optional(),
})

const publishedCommandSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  source: z.enum(["builtin", "custom", "skill", "agent-native"]),
  kind: z.enum(["builtin", "prompt", "exec", "skill", "agent-native"]),
  adminOnly: z.boolean(),
  allowedPlatforms: z.array(z.string()).optional(),
  ui: publishedCommandUiSchema.optional(),
})
```

In `desktop/electron/services/bridge-adapter/bridge-adapter-service.ts`, preserve `ui` in `commandsForProject`:

```ts
      return (await agent.listPublishedCommands(platform)).map((command) => ({
        name: command.name,
        description: command.description,
        source: command.source,
        kind: command.kind,
        admin_only: command.adminOnly,
        allowed_platforms: command.allowedPlatforms,
        ui: command.ui,
      }))
```

- [ ] **Step 7: Run main-process tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts \
  electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add \
  desktop/electron/services/agent-runtime/command-registry.ts \
  desktop/electron/services/agent-runtime/project-contributions.ts \
  desktop/electron/services/agent-runtime/agent-runtime-service.ts \
  desktop/electron/services/agent-runtime/index.ts \
  desktop/electron/services/knowledge-base/agent-contribution.ts \
  desktop/electron/modules/agent/ipc-tools.ts \
  desktop/electron/services/bridge-adapter/bridge-adapter-service.ts \
  desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts \
  desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts
git commit -m "feat(kb): publish composer command actions"
```

---

### Task 2: Carry Insert Text Through Slash Candidates

**Files:**
- Modify: `desktop/src/types/agent.ts`
- Modify: `desktop/src/modules/agent/slash-menu.ts`
- Test: `desktop/src/modules/agent/__tests__/slash-menu.test.ts`

- [ ] **Step 1: Add failing slash utility tests**

Add these tests inside `describe("agent slash menu utilities", () => { ... })` in `desktop/src/modules/agent/__tests__/slash-menu.test.ts`:

```ts
  it("keeps command names with spaces for wiki subcommands", () => {
    const items = filterAgentSlashCandidates([
      {
        name: "wiki ingest",
        description: "汲取来源",
        kind: "command",
        source: "custom",
        insertText: "/wiki ingest",
      },
      {
        name: "wiki query",
        description: "查询知识库",
        kind: "command",
        source: "custom",
        insertText: "/wiki query ",
      },
    ], "wiki")

    expect(items.map((item) => item.name)).toEqual(["wiki ingest", "wiki query"])
  })

  it("uses insertText when replacing slash fragments", () => {
    const fragment = findAgentSlashFragment("Ask /wiki", 9)
    expect(fragment).not.toBeNull()

    expect(replaceAgentSlashFragment(
      "Ask /wiki",
      fragment!,
      "wiki query",
      "/wiki query ",
    )).toEqual({
      value: "Ask /wiki query ",
      cursor: 16,
    })
  })
```

- [ ] **Step 2: Run slash utility tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/slash-menu.test.ts
```

Expected: FAIL because `insertText` is not part of `AgentSlashCandidate` and `replaceAgentSlashFragment` does not accept an override.

- [ ] **Step 3: Mirror UI metadata in renderer types**

In `desktop/src/types/agent.ts`, add:

```ts
export interface SynapseAgentPublishedCommandUi {
  readonly group?: "knowledge-base"
  readonly label?: string
  readonly action?: "send" | "insert"
  readonly insertText?: string
}
```

Then update `SynapseAgentPublishedCommand`:

```ts
export interface SynapseAgentPublishedCommand {
  readonly name: string
  readonly description?: string
  readonly source: "builtin" | "custom" | "skill" | "agent-native"
  readonly kind: "builtin" | "prompt" | "exec" | "skill" | "agent-native"
  readonly adminOnly: boolean
  readonly allowedPlatforms?: string[]
  readonly ui?: SynapseAgentPublishedCommandUi
}
```

- [ ] **Step 4: Update slash candidate conversion and replacement**

In `desktop/src/modules/agent/slash-menu.ts`, update `AgentSlashCandidate`:

```ts
export type AgentSlashCandidate = {
  readonly name: string
  readonly description?: string
  readonly kind: AgentSlashCandidateKind
  readonly source: SynapseAgentPublishedCommand["source"]
  readonly insertText?: string
}
```

Update `toAgentSlashCandidates`:

```ts
export function toAgentSlashCandidates(
  commands: readonly SynapseAgentPublishedCommand[],
): AgentSlashCandidate[] {
  return commands
    .filter((command) => command.name.trim().length > 0)
    .map((command) => ({
      name: command.name.replace(/^\/+/, ""),
      description: command.description,
      kind: command.kind === "skill" || command.source === "skill" ? "skill" : "command",
      source: command.source,
      insertText: command.ui?.insertText,
    }))
}
```

Update `replaceAgentSlashFragment`:

```ts
export function replaceAgentSlashFragment(
  value: string,
  fragment: AgentSlashFragment,
  name: string,
  insertText?: string,
): { readonly value: string; readonly cursor: number } {
  const insertion = insertText ?? `/${name.replace(/^\/+/, "")}`
  const nextValue = `${value.slice(0, fragment.start)}${insertion}${value.slice(fragment.end)}`
  return {
    value: nextValue,
    cursor: fragment.start + insertion.length,
  }
}
```

- [ ] **Step 5: Use insertText when selecting slash candidates**

In `desktop/src/modules/agent/components/agent-composer.tsx`, update `insertSlashCandidate`:

```ts
  const insertSlashCandidate = (
    candidate: AgentSlashCandidate,
    fragment: AgentSlashFragment,
  ) => {
    const next = replaceAgentSlashFragment(draft, fragment, candidate.name, candidate.insertText)
    onDraftChange(next.value)
    setSlashMenuDismissed(true)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(next.cursor, next.cursor)
      setSelectionStart(next.cursor)
    })
  }
```

- [ ] **Step 6: Run slash tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/modules/agent/__tests__/slash-menu.test.ts \
  src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add \
  desktop/src/types/agent.ts \
  desktop/src/modules/agent/slash-menu.ts \
  desktop/src/modules/agent/components/agent-composer.tsx \
  desktop/src/modules/agent/__tests__/slash-menu.test.ts
git commit -m "feat(agent): support slash command insert text"
```

---

### Task 3: Add the Knowledge Base Composer Action Menu

**Files:**
- Create: `desktop/src/modules/agent/components/knowledge-base-action-menu.tsx`
- Modify: `desktop/src/modules/agent/components/agent-composer.tsx`
- Test: `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`

- [ ] **Step 1: Add failing composer action tests**

Add these tests inside `describe("AgentComposer", () => { ... })` in `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`:

```tsx
  it("does not render the knowledge base action button without actions", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft=""
        disabled={false}
        canSend={false}
        sending={false}
        cancelPhase="idle"
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )

    expect(html).not.toContain("知识库")
  })

  it("sends direct knowledge base actions from the composer menu", async () => {
    const onSendCommand = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft=""
          disabled={false}
          canSend={false}
          sending={false}
          cancelPhase="idle"
          knowledgeBaseActions={[{
            label: "汲取来源",
            action: "send",
            commandText: "/wiki ingest",
          }]}
          onKnowledgeBaseCommand={onSendCommand}
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    clickButton(container, "知识库")
    const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find((node) => node.textContent === "汲取来源") as HTMLElement
    expect(item).toBeTruthy()

    await act(async () => {
      item.click()
    })

    expect(onSendCommand).toHaveBeenCalledWith("/wiki ingest")
  })

  it("inserts query command and focuses the composer textarea", async () => {
    const onDraftChange = vi.fn()
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
          knowledgeBaseActions={[{
            label: "查询知识库",
            action: "insert",
            commandText: "/wiki query ",
          }]}
          onKnowledgeBaseCommand={vi.fn()}
          onDraftChange={onDraftChange}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    clickButton(container, "知识库")
    const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find((node) => node.textContent === "查询知识库") as HTMLElement
    expect(item).toBeTruthy()

    await act(async () => {
      item.click()
    })

    expect(onDraftChange).toHaveBeenCalledWith("请 /wiki query ")
    expect(document.activeElement?.tagName).toBe("TEXTAREA")
  })
```

- [ ] **Step 2: Run composer tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: FAIL because `knowledgeBaseActions`, callbacks, and the menu component do not exist.

- [ ] **Step 3: Create the Knowledge Base action menu component**

Create `desktop/src/modules/agent/components/knowledge-base-action-menu.tsx`:

```tsx
import { BookOpen, ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type KnowledgeBaseComposerAction = {
  readonly label: string
  readonly action: "send" | "insert"
  readonly commandText: string
}

type KnowledgeBaseActionMenuProps = {
  readonly actions: readonly KnowledgeBaseComposerAction[]
  readonly disabled?: boolean
  readonly onSend: (commandText: string) => void
  readonly onInsert: (commandText: string) => void
}

export function KnowledgeBaseActionMenu({
  actions,
  disabled,
  onSend,
  onInsert,
}: KnowledgeBaseActionMenuProps) {
  if (actions.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="agent-composer__knowledge-base-trigger rounded-lg px-2.5 text-muted-foreground"
          aria-label="知识库"
          data-track="agent-knowledge-base-actions"
          disabled={disabled}
        >
          <BookOpen />
          <span>知识库</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {actions.map((item) => (
          <DropdownMenuItem
            key={`${item.action}:${item.commandText}`}
            onSelect={() => {
              if (item.action === "insert") {
                onInsert(item.commandText)
                return
              }
              onSend(item.commandText)
            }}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 4: Wire the menu into AgentComposer**

In `desktop/src/modules/agent/components/agent-composer.tsx`, add the import:

```tsx
import {
  KnowledgeBaseActionMenu,
  type KnowledgeBaseComposerAction,
} from "./knowledge-base-action-menu"
```

Add props:

```ts
  knowledgeBaseActions = [],
  onKnowledgeBaseCommand,
```

Add prop types:

```ts
  readonly knowledgeBaseActions?: readonly KnowledgeBaseComposerAction[]
  readonly onKnowledgeBaseCommand?: (commandText: string) => void
```

Add helper:

```ts
  const insertKnowledgeBaseCommand = (commandText: string) => {
    const el = textareaRef.current
    const start = el?.selectionStart ?? draft.length
    const end = el?.selectionEnd ?? draft.length
    const prefix = draft.slice(0, start)
    const suffix = draft.slice(end)
    const needsLeadingSpace = prefix.length > 0 && !/\s$/.test(prefix)
    const insertion = `${needsLeadingSpace ? " " : ""}${commandText}`
    const nextValue = `${prefix}${insertion}${suffix}`
    const cursor = prefix.length + insertion.length
    onDraftChange(nextValue)
    requestAnimationFrame(() => {
      const nextEl = textareaRef.current
      if (!nextEl) return
      nextEl.focus()
      nextEl.setSelectionRange(cursor, cursor)
      setSelectionStart(cursor)
    })
  }
```

Replace `leadingActions={null}` with:

```tsx
          leadingActions={(
            <KnowledgeBaseActionMenu
              actions={knowledgeBaseActions}
              disabled={disabled || sending}
              onSend={(commandText) => onKnowledgeBaseCommand?.(commandText)}
              onInsert={insertKnowledgeBaseCommand}
            />
          )}
```

- [ ] **Step 5: Run composer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add \
  desktop/src/modules/agent/components/knowledge-base-action-menu.tsx \
  desktop/src/modules/agent/components/agent-composer.tsx \
  desktop/src/modules/agent/__tests__/agent-composer.test.tsx
git commit -m "feat(agent): add knowledge base composer actions"
```

---

### Task 4: Derive Actions and Send Commands from AgentModule

**Files:**
- Modify: `desktop/src/modules/agent/index.tsx`
- Test: `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`

- [ ] **Step 1: Add pure action derivation helper in AgentModule**

In `desktop/src/modules/agent/index.tsx`, import the action type:

```tsx
import type { KnowledgeBaseComposerAction } from "./components/knowledge-base-action-menu"
```

Add this helper near `mergedCommands`:

```tsx
function toKnowledgeBaseComposerActions(
  commands: readonly SynapseAgentPublishedCommand[],
): KnowledgeBaseComposerAction[] {
  return commands
    .filter((command) => command.ui?.group === "knowledge-base")
    .map((command) => {
      const commandText = command.ui?.insertText ?? `/${command.name.replace(/^\/+/, "")}`
      const label = command.ui?.label ?? command.description ?? command.name
      const action = command.ui?.action ?? "insert"
      return { label, action, commandText }
    })
    .filter((action) => action.label.trim().length > 0 && action.commandText.trim().length > 0)
}
```

- [ ] **Step 2: Wire action derivation**

In `AgentModule`, add:

```tsx
  const knowledgeBaseActions = useMemo(
    () => toKnowledgeBaseComposerActions(mergedCommands),
    [mergedCommands],
  )
```

- [ ] **Step 3: Add the direct command send handler**

Add this handler near `handleInputKeyDown` and `handleSubmit`:

```tsx
  const sendComposerCommand = (commandText: string) => {
    const content = commandText.trim()
    const projectId = chat.selectedProjectId ?? chat.activeProjectId
    if (!content || !projectId || chat.sending) return
    void chat.send(content)
  }
```

- [ ] **Step 4: Pass actions and handlers to AgentComposer**

Update the `AgentComposer` call:

```tsx
            <AgentComposer
              draft={draft}
              disabled={!chat.activeProjectId}
              canSend={Boolean(draft.trim() && chat.activeProjectId)}
              sending={chat.sending}
              cancelPhase={chat.cancelPhase}
              permissionMode={selectedPermissionMode}
              onPermissionModeChange={(mode) => chat.setPermissionMode(mode)}
              onCreatePermissionModeSession={(mode) => {
                const projectId = chat.selectedProjectId ?? chat.activeProjectId
                if (!projectId) return
                void chat.createSession(projectId, selectedSession?.providerId, mode)
              }}
              onDraftChange={setDraft}
              slashCandidates={slashCandidates}
              knowledgeBaseActions={knowledgeBaseActions}
              onKnowledgeBaseCommand={sendComposerCommand}
              onInputKeyDown={handleInputKeyDown}
              onSubmit={handleSubmit}
              onCancelTurn={() => void chat.cancelTurn()}
              onForceKillTurn={() => void chat.forceKillTurn()}
              pendingMessages={selectedPendingMessages}
              onRemovePendingMessage={handleRemovePendingMessage}
              onRetryPendingMessage={handleRetryPendingMessage}
            />
```

- [ ] **Step 5: Run focused renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/modules/agent/__tests__/slash-menu.test.ts \
  src/modules/agent/__tests__/agent-slash-menu.test.tsx \
  src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add desktop/src/modules/agent/index.tsx
git commit -m "feat(agent): wire knowledge base command actions"
```

---

### Task 5: Full Verification

**Files:**
- Verify only; no new source files expected.

- [ ] **Step 1: Run knowledge-base and Agent renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts \
  electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts \
  electron/services/agent-runtime/__tests__/command-router.test.ts \
  electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts \
  src/modules/agent/__tests__/slash-menu.test.ts \
  src/modules/agent/__tests__/agent-slash-menu.test.tsx \
  src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git diff --stat HEAD~4..HEAD
git status --short
```

Expected:

- Diff is limited to Agent command metadata, Knowledge Base contribution, Agent composer slash/action UI, and related tests.
- `git status --short` is clean after the final task commits.
