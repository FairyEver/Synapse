# Knowledge Base Slash Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete `知识库` group to the existing Agent `/` menu while keeping the bottom Knowledge Base menu as a curated shortcut set.

**Architecture:** Create one renderer Knowledge Base capability catalog in `desktop/src/modules/agent/knowledge-base-commands.ts`. Convert that catalog into full `/` menu candidates and curated bottom-menu actions, then update slash-menu grouping to render `知识库` between `片段` and `Skills`. Add a runtime alignment test so the UI catalog does not drift from managed Knowledge Base passthrough support.

**Tech Stack:** Electron, React, TypeScript, Vitest, shadcn/Radix UI, Tailwind token classes.

---

## File Structure

- `desktop/src/modules/agent/knowledge-base-commands.ts`
  - Owns the Knowledge Base capability catalog.
  - Exports helpers to convert the catalog into slash candidates and composer quick actions.
- `desktop/src/modules/agent/slash-menu.ts`
  - Adds `knowledgeBase` candidate kind and `知识库` grouping.
- `desktop/src/modules/agent/components/agent-slash-menu.tsx`
  - Adds a neutral icon branch for Knowledge Base candidates.
- `desktop/src/modules/agent/index.tsx`
  - Wires catalog helpers into `slashCandidates` and `knowledgeBaseActions`.
- `desktop/src/modules/agent/__tests__/slash-menu.test.ts`
  - Covers catalog conversion, grouping order, filtering, and quick subset derivation.
- `desktop/src/modules/agent/__tests__/agent-slash-menu.test.tsx`
  - Covers rendered `知识库` group and two-line candidate display.
- `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`
  - Covers insert-only behavior for Knowledge Base slash candidates and curated bottom menu behavior.
- `desktop/electron/services/agent-runtime/index.ts`
  - Exports managed Knowledge Base native slash names for test alignment.
- `desktop/electron/services/agent-runtime/__tests__/index.test.ts`
  - Verifies all UI catalog names are runtime-supported for managed Knowledge Base renderer sessions.
- `RELEASE_NOTES_PENDING.md`
  - Records the user-visible `/` menu improvement.

## Task 1: Knowledge Base Catalog And Conversion Helpers

**Files:**
- Modify: `desktop/src/modules/agent/knowledge-base-commands.ts`
- Modify: `desktop/src/modules/agent/__tests__/slash-menu.test.ts`

- [ ] **Step 1: Replace the slash-menu test import**

In `desktop/src/modules/agent/__tests__/slash-menu.test.ts`, update the Knowledge Base import near the top:

```ts
import {
  KNOWLEDGE_BASE_AGENT_CAPABILITIES,
  knowledgeBaseStaticCommands,
  toKnowledgeBaseComposerActions,
  toKnowledgeBaseSlashCandidates,
} from "../knowledge-base-commands"
```

- [ ] **Step 2: Add failing catalog conversion tests**

In `desktop/src/modules/agent/__tests__/slash-menu.test.ts`, replace the existing test named `converts knowledge base static commands into slash candidates` with these tests:

```ts
  it("converts the full knowledge base catalog into slash candidates", () => {
    expect(toKnowledgeBaseSlashCandidates().map((item) => ({
      name: item.name,
      description: item.description,
      kind: item.kind,
      insertText: item.insertText,
    }))).toEqual([
      {
        name: "autoresearch",
        description: "围绕主题研究并写入知识库",
        kind: "knowledgeBase",
        insertText: "/autoresearch ",
      },
      {
        name: "canvas",
        description: "创建或更新知识库画布",
        kind: "knowledgeBase",
        insertText: "/canvas ",
      },
      {
        name: "defuddle",
        description: "清理网页正文后用于入库",
        kind: "knowledgeBase",
        insertText: "/defuddle ",
      },
      {
        name: "obsidian-bases",
        description: "创建或编辑 Obsidian Bases",
        kind: "knowledgeBase",
        insertText: "/obsidian-bases ",
      },
      {
        name: "obsidian-markdown",
        description: "按 Obsidian 语法编写页面",
        kind: "knowledgeBase",
        insertText: "/obsidian-markdown ",
      },
      {
        name: "save",
        description: "保存当前对话或关键结论",
        kind: "knowledgeBase",
        insertText: "/save ",
      },
      {
        name: "wiki",
        description: "管理知识库结构与热缓存",
        kind: "knowledgeBase",
        insertText: "/wiki ",
      },
      {
        name: "wiki-fold",
        description: "折叠整理知识库日志",
        kind: "knowledgeBase",
        insertText: "/wiki-fold ",
      },
      {
        name: "wiki-ingest",
        description: "汲取资料，整理 .raw 中的新内容",
        kind: "knowledgeBase",
        insertText: "/wiki-ingest ",
      },
      {
        name: "wiki-lint",
        description: "检查链接、索引、孤立页面和结构问题",
        kind: "knowledgeBase",
        insertText: "/wiki-lint ",
      },
      {
        name: "wiki-query",
        description: "查询知识库并基于已有页面回答",
        kind: "knowledgeBase",
        insertText: "/wiki-query ",
      },
    ])
  })

  it("derives curated knowledge base composer actions from the same catalog", () => {
    expect(toKnowledgeBaseComposerActions().map((item) => ({
      label: item.label,
      action: item.action,
      commandText: item.commandText,
    }))).toEqual([
      { label: "汲取资料", action: "send", commandText: "/wiki-ingest " },
      { label: "查询知识库", action: "insert", commandText: "/wiki-query " },
      { label: "保存对话", action: "insert", commandText: "/save " },
      { label: "研究主题", action: "insert", commandText: "/autoresearch " },
      { label: "检查知识库", action: "send", commandText: "/wiki-lint " },
    ])
  })

  it("keeps the legacy knowledge base command helper backed by the catalog", () => {
    expect(knowledgeBaseStaticCommands().map((item) => item.name))
      .toEqual(KNOWLEDGE_BASE_AGENT_CAPABILITIES.map((item) => item.name))
  })
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/slash-menu.test.ts
```

Expected: FAIL because `toKnowledgeBaseSlashCandidates`, `toKnowledgeBaseComposerActions`, and `knowledgeBase` candidate kind do not exist yet.

- [ ] **Step 4: Implement the catalog and conversion helpers**

Replace `desktop/src/modules/agent/knowledge-base-commands.ts` with:

```ts
import type { KnowledgeBaseComposerAction } from "./components/knowledge-base-action-menu"
import type { AgentSlashCandidate } from "./slash-menu"
import type { SynapseAgentPublishedCommand } from "@/types/agent"

export type KnowledgeBaseAgentCapability = {
  readonly name: string
  readonly description: string
  readonly slashText?: string
  readonly quickAction?: {
    readonly label: string
    readonly action: "send" | "insert"
    readonly insertText?: string
  }
}

export const KNOWLEDGE_BASE_AGENT_CAPABILITIES: readonly KnowledgeBaseAgentCapability[] = [
  knowledgeBaseCapability("autoresearch", "围绕主题研究并写入知识库", {
    label: "研究主题",
    action: "insert",
  }),
  knowledgeBaseCapability("canvas", "创建或更新知识库画布"),
  knowledgeBaseCapability("defuddle", "清理网页正文后用于入库"),
  knowledgeBaseCapability("obsidian-bases", "创建或编辑 Obsidian Bases"),
  knowledgeBaseCapability("obsidian-markdown", "按 Obsidian 语法编写页面"),
  knowledgeBaseCapability("save", "保存当前对话或关键结论", {
    label: "保存对话",
    action: "insert",
  }),
  knowledgeBaseCapability("wiki", "管理知识库结构与热缓存"),
  knowledgeBaseCapability("wiki-fold", "折叠整理知识库日志"),
  knowledgeBaseCapability("wiki-ingest", "汲取资料，整理 .raw 中的新内容", {
    label: "汲取资料",
    action: "send",
  }),
  knowledgeBaseCapability("wiki-lint", "检查链接、索引、孤立页面和结构问题", {
    label: "检查知识库",
    action: "send",
  }),
  knowledgeBaseCapability("wiki-query", "查询知识库并基于已有页面回答", {
    label: "查询知识库",
    action: "insert",
  }),
]

export function toKnowledgeBaseSlashCandidates(
  capabilities: readonly KnowledgeBaseAgentCapability[] = KNOWLEDGE_BASE_AGENT_CAPABILITIES,
): AgentSlashCandidate[] {
  return capabilities.flatMap((item) => {
    const name = item.name.trim().replace(/^\/+/, "")
    const description = item.description.trim()
    const insertText = knowledgeBaseSlashText(item)
    if (!name || !description || !insertText.trim()) return []
    return [{
      name,
      description,
      kind: "knowledgeBase" as const,
      insertText,
    }]
  })
}

export function toKnowledgeBaseComposerActions(
  capabilities: readonly KnowledgeBaseAgentCapability[] = KNOWLEDGE_BASE_AGENT_CAPABILITIES,
): KnowledgeBaseComposerAction[] {
  return capabilities.flatMap((item) => {
    if (!item.quickAction) return []
    const label = item.quickAction.label.trim()
    const commandText = (item.quickAction.insertText ?? knowledgeBaseSlashText(item)).trimEnd()
    if (!label || !commandText) return []
    return [{
      label,
      description: item.description,
      action: item.quickAction.action,
      commandText: `${commandText} `,
    }]
  })
}

export function knowledgeBaseStaticCommands(): SynapseAgentPublishedCommand[] {
  return KNOWLEDGE_BASE_AGENT_CAPABILITIES.map((item) => ({
    name: item.name,
    description: item.description,
    source: "builtin",
    kind: "prompt",
    adminOnly: false,
    ui: item.quickAction
      ? {
          group: "knowledge-base",
          label: item.quickAction.label,
          action: item.quickAction.action,
          insertText: item.quickAction.insertText ?? knowledgeBaseSlashText(item),
        }
      : {
          group: "knowledge-base",
          insertText: knowledgeBaseSlashText(item),
        },
  }))
}

function knowledgeBaseCapability(
  name: string,
  description: string,
  quickAction?: KnowledgeBaseAgentCapability["quickAction"],
): KnowledgeBaseAgentCapability {
  return {
    name,
    description,
    slashText: `/${name} `,
    quickAction,
  }
}

function knowledgeBaseSlashText(item: KnowledgeBaseAgentCapability): string {
  return item.slashText ?? `/${item.name.replace(/^\/+/, "")} `
}
```

- [ ] **Step 5: Run tests to verify remaining expected failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/slash-menu.test.ts
```

Expected: FAIL only where `knowledgeBase` is not yet accepted by `AgentSlashCandidateKind` and grouping does not yet include `知识库`.

- [ ] **Step 6: Commit Task 1**

```bash
git add desktop/src/modules/agent/knowledge-base-commands.ts desktop/src/modules/agent/__tests__/slash-menu.test.ts
git commit -m "feat(agent): add knowledge base capability catalog"
```

## Task 2: Slash Menu Knowledge Base Group

**Files:**
- Modify: `desktop/src/modules/agent/slash-menu.ts`
- Modify: `desktop/src/modules/agent/components/agent-slash-menu.tsx`
- Modify: `desktop/src/modules/agent/__tests__/slash-menu.test.ts`
- Modify: `desktop/src/modules/agent/__tests__/agent-slash-menu.test.tsx`

- [ ] **Step 1: Add failing group-order utility test**

In `desktop/src/modules/agent/__tests__/slash-menu.test.ts`, add this test after `groups quick inputs before skills and commands`:

```ts
  it("groups knowledge base candidates after quick inputs and before skills", () => {
    const quickInput = toQuickInputSlashCandidates([
      { id: "quick-1", content: "日报模板\n整理今天完成的工作", directSend: false },
    ])[0]
    const knowledgeBase = toKnowledgeBaseSlashCandidates([
      {
        name: "wiki-query",
        description: "查询知识库并基于已有页面回答",
        slashText: "/wiki-query ",
      },
    ])[0]

    expect(groupAgentSlashCandidates([candidates[0], candidates[2], knowledgeBase, quickInput]))
      .toEqual([
        {
          kind: "quickInput",
          label: "片段",
          items: [quickInput],
        },
        {
          kind: "knowledgeBase",
          label: "知识库",
          items: [knowledgeBase],
        },
        {
          kind: "skill",
          label: "Skills",
          items: [candidates[0]],
        },
        {
          kind: "command",
          label: "Commands",
          items: [candidates[2]],
        },
      ])
  })
```

- [ ] **Step 2: Add failing slash menu rendering test**

In `desktop/src/modules/agent/__tests__/agent-slash-menu.test.tsx`, add a Knowledge Base candidate to the local `candidates` array after the quick input:

```ts
  {
    name: "wiki-query",
    description: "查询知识库并基于已有页面回答",
    kind: "knowledgeBase",
    insertText: "/wiki-query ",
  },
```

Then replace `renders quick inputs before skills and commands` with:

```ts
  it("renders quick inputs, knowledge base, skills, and commands in order", () => {
    const html = renderToStaticMarkup(
      <AgentSlashMenu
        candidates={candidates}
        highlightedIndex={0}
        onHighlight={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(html).toContain("片段")
    expect(html).toContain("知识库")
    expect(html).toContain("Skills")
    expect(html).toContain("Commands")
    expect(html.indexOf("片段")).toBeLessThan(html.indexOf("知识库"))
    expect(html.indexOf("知识库")).toBeLessThan(html.indexOf("Skills"))
    expect(html.indexOf("Skills")).toBeLessThan(html.indexOf("Commands"))
    expect(html).toContain("/日报模板")
    expect(html).toContain("整理今天完成的工作")
    expect(html).toContain("/wiki-query")
    expect(html).toContain("查询知识库并基于已有页面回答")
    expect(html).toContain("/review-code")
    expect(html).toContain("Review code changes")
    expect(html).toContain("/status")
    expect(html).toContain("Show agent status")
  })
```

Update `selects a clicked item` in the same file because `/status` shifts from index 2 to index 3:

```ts
    expect(onSelect).toHaveBeenCalledWith(candidates[3])
```

- [ ] **Step 3: Run focused tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/slash-menu.test.ts src/modules/agent/__tests__/agent-slash-menu.test.tsx
```

Expected: FAIL because `knowledgeBase` grouping and icon support do not exist yet.

- [ ] **Step 4: Update slash menu types and grouping**

In `desktop/src/modules/agent/slash-menu.ts`, update the type definitions and grouping function:

```ts
export type AgentSlashCandidateKind = "quickInput" | "knowledgeBase" | "skill" | "command"
```

```ts
export type AgentSlashGroup = {
  readonly kind: AgentSlashCandidateKind
  readonly label: "片段" | "知识库" | "Skills" | "Commands"
  readonly items: readonly AgentSlashCandidate[]
}
```

Replace `groupAgentSlashCandidates` with:

```ts
export function groupAgentSlashCandidates(
  candidates: readonly AgentSlashCandidate[],
): AgentSlashGroup[] {
  const quickInputs = candidates.filter((candidate) => candidate.kind === "quickInput")
  const knowledgeBase = candidates.filter((candidate) => candidate.kind === "knowledgeBase")
  const skills = candidates.filter((candidate) => candidate.kind === "skill")
  const commands = candidates.filter((candidate) => candidate.kind === "command")
  const groups: AgentSlashGroup[] = []
  if (quickInputs.length > 0) {
    groups.push({ kind: "quickInput", label: "片段", items: quickInputs })
  }
  if (knowledgeBase.length > 0) {
    groups.push({ kind: "knowledgeBase", label: "知识库", items: knowledgeBase })
  }
  if (skills.length > 0) {
    groups.push({ kind: "skill", label: "Skills", items: skills })
  }
  if (commands.length > 0) {
    groups.push({ kind: "command", label: "Commands", items: commands })
  }
  return groups
}
```

- [ ] **Step 5: Add neutral Knowledge Base icon branch**

In `desktop/src/modules/agent/components/agent-slash-menu.tsx`, update the icon import:

```ts
import { BookOpen, Command, TextCursorInput } from "lucide-react"
```

Update `AgentSlashCandidateIcon`:

```tsx
function AgentSlashCandidateIcon({ kind }: { readonly kind: AgentSlashCandidate["kind"] }) {
  if (kind === "quickInput") {
    return <TextCursorInput className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
  }
  if (kind === "knowledgeBase") {
    return <BookOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
  }
  return <Command className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/slash-menu.test.ts src/modules/agent/__tests__/agent-slash-menu.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add desktop/src/modules/agent/slash-menu.ts desktop/src/modules/agent/components/agent-slash-menu.tsx desktop/src/modules/agent/__tests__/slash-menu.test.ts desktop/src/modules/agent/__tests__/agent-slash-menu.test.tsx
git commit -m "feat(agent): group knowledge base slash candidates"
```

## Task 3: Wire Catalog Into Agent Composer

**Files:**
- Modify: `desktop/src/modules/agent/index.tsx`
- Modify: `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`

- [ ] **Step 1: Update AgentModule imports**

In `desktop/src/modules/agent/index.tsx`, remove the local `KnowledgeBaseComposerAction` import and replace the Knowledge Base command import:

```ts
import {
  toKnowledgeBaseComposerActions,
  toKnowledgeBaseSlashCandidates,
} from "./knowledge-base-commands"
```

- [ ] **Step 2: Remove local composer action mapper**

Delete the local `toKnowledgeBaseComposerActions` function from `desktop/src/modules/agent/index.tsx`.

- [ ] **Step 3: Add Knowledge Base slash candidates only for managed KB projects**

Replace the current `mergedCommands`, `slashCandidates`, and `knowledgeBaseActions` block in `desktop/src/modules/agent/index.tsx` with:

```ts
  const mergedCommands = useMemo(() => {
    const defCommands = selectedAgentDefinition?.commands ?? []
    const runtimeCommands = chat.commands ?? []
    const seen = new Set<string>()
    const result: SynapseAgentPublishedCommand[] = []
    for (const cmd of [...defCommands, ...runtimeCommands]) {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name)
        result.push(cmd as unknown as SynapseAgentPublishedCommand)
      }
    }
    return result
  }, [selectedAgentDefinition?.commands, chat.commands])
  const knowledgeBaseSlashCandidates = useMemo(
    () => canManageKnowledgeSources ? toKnowledgeBaseSlashCandidates() : [],
    [canManageKnowledgeSources],
  )
  const slashCandidates = useMemo(
    () => [
      ...toQuickInputSlashCandidates(config.global.quickInputs),
      ...knowledgeBaseSlashCandidates,
      ...toAgentSlashCandidates(mergedCommands),
    ],
    [config.global.quickInputs, knowledgeBaseSlashCandidates, mergedCommands],
  )
  const knowledgeBaseActions = useMemo(
    () => canManageKnowledgeSources ? toKnowledgeBaseComposerActions() : [],
    [canManageKnowledgeSources],
  )
```

- [ ] **Step 4: Add failing composer slash insertion test**

In `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`, add this test near existing slash menu tests:

```tsx
  it("inserts knowledge base slash candidates without submitting", async () => {
    const onDraftChange = vi.fn()
    const onSubmit = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft="/wiki-q"
          disabled={false}
          canSend={true}
          sending={false}
          cancelPhase="idle"
          slashCandidates={[{
            name: "wiki-query",
            description: "查询知识库并基于已有页面回答",
            kind: "knowledgeBase",
            insertText: "/wiki-query ",
          }]}
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
    textarea!.setSelectionRange(7, 7)
    textarea!.dispatchEvent(new Event("select", { bubbles: true }))
    expect(container.textContent).toContain("知识库")
    expect(container.textContent).toContain("/wiki-query")
    expect(container.textContent).toContain("查询知识库并基于已有页面回答")

    await act(async () => {
      textarea!.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }))
    })

    expect(onDraftChange).toHaveBeenCalledWith("/wiki-query ")
    expect(onSubmit).not.toHaveBeenCalled()
  })
```

- [ ] **Step 5: Update existing Knowledge Base action test labels**

In `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`, keep existing direct component tests but use catalog-aligned copy for any new assertions:

```tsx
knowledgeBaseActions={[{
  label: "汲取资料",
  description: "汲取资料，整理 .raw 中的新内容",
  action: "send",
  commandText: "/wiki-ingest ",
}]}
```

Expected direct-send assertion:

```ts
expect(onSendCommand).toHaveBeenCalledWith("/wiki-ingest ")
```

Do not rewrite unrelated permission, quick input, or cancel tests.

- [ ] **Step 6: Run composer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: PASS after Task 2 and the AgentModule wiring changes. If an existing test still asserts old `/wiki ingest` text, update only that assertion to the new catalog text that the test itself passes in.

- [ ] **Step 7: Run all focused renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/modules/agent/__tests__/slash-menu.test.ts \
  src/modules/agent/__tests__/agent-slash-menu.test.tsx \
  src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add desktop/src/modules/agent/index.tsx desktop/src/modules/agent/__tests__/agent-composer.test.tsx
git commit -m "feat(agent): show knowledge base catalog in slash menu"
```

## Task 4: Runtime Alignment And Release Notes

**Files:**
- Modify: `desktop/electron/services/agent-runtime/index.ts`
- Modify: `desktop/electron/services/agent-runtime/__tests__/index.test.ts`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Export the managed Knowledge Base native slash names**

In `desktop/electron/services/agent-runtime/index.ts`, change:

```ts
const MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_COMMANDS = new Set([
```

to:

```ts
export const MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_COMMANDS = new Set([
```

- [ ] **Step 2: Add failing runtime coverage test**

In `desktop/electron/services/agent-runtime/__tests__/index.test.ts`, import the catalog and exported allowlist:

```ts
import {
  createAgentRuntimeProjectService,
  MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_COMMANDS,
  AgentRuntimeService,
} from "../index"
import { KNOWLEDGE_BASE_AGENT_CAPABILITIES } from "../../../../src/modules/agent/knowledge-base-commands"
```

If the file already imports these symbols differently, merge the imports instead of duplicating them.

Add this test near `passes managed knowledge base slash commands through to the SDK for renderer sessions`:

```ts
  it("covers every knowledge base UI catalog item in native slash passthrough", () => {
    expect(KNOWLEDGE_BASE_AGENT_CAPABILITIES.map((item) => item.name).sort())
      .toEqual([...MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_COMMANDS].sort())
  })
```

- [ ] **Step 3: Run runtime test to verify current alignment**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/index.test.ts
```

Expected: PASS if the catalog matches the current allowlist. If it fails only because `wiki-ingest`, `wiki-query`, or other catalog names are missing from the allowlist, add the missing names to `MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_COMMANDS` and rerun. Do not change command routing behavior.

- [ ] **Step 4: Update release notes**

Add this entry under `## 功能优化` in `RELEASE_NOTES_PENDING.md`, above the existing Agent slash quick-input note:

```md
- 知识库项目的 Agent `/` 菜单新增独立“知识库”分组，完整展示知识库专用指令，并保留底部知识库按钮作为精选快捷入口。
```

- [ ] **Step 5: Run focused verification**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/modules/agent/__tests__/slash-menu.test.ts \
  src/modules/agent/__tests__/agent-slash-menu.test.tsx \
  src/modules/agent/__tests__/agent-composer.test.tsx \
  electron/services/agent-runtime/__tests__/index.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add desktop/electron/services/agent-runtime/index.ts desktop/electron/services/agent-runtime/__tests__/index.test.ts RELEASE_NOTES_PENDING.md
git commit -m "test(agent): align knowledge base slash catalog"
```

## Task 5: Final Verification

**Files:**
- No planned source changes unless verification exposes a focused issue.

- [ ] **Step 1: Run all focused tests again**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/modules/agent/__tests__/slash-menu.test.ts \
  src/modules/agent/__tests__/agent-slash-menu.test.tsx \
  src/modules/agent/__tests__/agent-composer.test.tsx \
  electron/services/agent-runtime/__tests__/index.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run hard constraints again**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: only intended files are changed or committed. No unrelated files should appear.

- [ ] **Step 4: Commit any verification fixes**

If Step 1 or Step 2 required focused fixes, commit them:

```bash
git add <focused-files>
git commit -m "fix(agent): polish knowledge base slash catalog"
```

If no fixes were needed, do not create an empty commit.
