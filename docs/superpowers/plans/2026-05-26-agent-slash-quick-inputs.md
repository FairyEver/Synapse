# Agent Slash Quick Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show saved user quick inputs at the top of the Agent composer `/` menu and insert them into the draft without sending.

**Architecture:** Treat the composer slash menu as an input completion menu with three candidate kinds: quick inputs, skills, and commands. Convert `config.global.quickInputs` into slash candidates in renderer code, combine them before existing command candidates, and keep all runtime command routing unchanged.

**Tech Stack:** Electron renderer, React, TypeScript, shadcn/Radix UI primitives, Vitest jsdom tests.

---

## File Structure

- `desktop/src/modules/agent/slash-menu.ts`: owns slash candidate types, conversion helpers, filtering, grouping, and fragment replacement.
- `desktop/src/modules/agent/components/agent-slash-menu.tsx`: renders grouped slash candidates and item icons.
- `desktop/src/modules/agent/index.tsx`: combines quick input candidates with existing skill and command candidates.
- `desktop/src/modules/agent/__tests__/slash-menu.test.ts`: unit tests for quick input conversion, grouping, filtering, and insertion.
- `desktop/src/modules/agent/__tests__/agent-slash-menu.test.tsx`: component tests for the new `片段` group.
- `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`: composer interaction tests proving quick input slash selection inserts without submit or direct send.
- `RELEASE_NOTES_PENDING.md`: user-facing release note under `功能优化`.

## Task 1: Quick Input Slash Utilities

**Files:**
- Modify: `desktop/src/modules/agent/slash-menu.ts`
- Test: `desktop/src/modules/agent/__tests__/slash-menu.test.ts`

- [ ] **Step 1: Add failing quick input utility tests**

In `desktop/src/modules/agent/__tests__/slash-menu.test.ts`, update the import to include `toQuickInputSlashCandidates`:

```ts
import {
  filterAgentSlashCandidates,
  findAgentSlashFragment,
  groupAgentSlashCandidates,
  replaceAgentSlashFragment,
  toAgentSlashCandidates,
  toQuickInputSlashCandidates,
  type AgentSlashCandidate,
} from "../slash-menu"
```

Append these tests inside `describe("agent slash menu utilities", () => { ... })`:

```ts
  it("converts quick inputs into slash candidates", () => {
    expect(toQuickInputSlashCandidates([
      {
        id: "quick-1",
        content: "\n  日报模板  \n整理今天完成的工作",
        directSend: true,
      },
      {
        id: "quick-2",
        content: "  /发版总结  \n列出用户可感知变化",
        directSend: false,
      },
      {
        id: "quick-empty",
        content: "   \n\t",
        directSend: false,
      },
    ])).toEqual([
      {
        name: "日报模板",
        description: "整理今天完成的工作",
        kind: "quickInput",
        insertText: "\n  日报模板  \n整理今天完成的工作",
      },
      {
        name: "发版总结",
        description: "列出用户可感知变化",
        kind: "quickInput",
        insertText: "  /发版总结  \n列出用户可感知变化",
      },
    ])
  })

  it("groups quick inputs before skills and commands", () => {
    const quickInput = toQuickInputSlashCandidates([
      { id: "quick-1", content: "日报模板\n整理今天完成的工作", directSend: false },
    ])[0]

    expect(groupAgentSlashCandidates([quickInput, ...candidates])).toEqual([
      {
        kind: "quickInput",
        label: "片段",
        items: [quickInput],
      },
      {
        kind: "skill",
        label: "Skills",
        items: [candidates[0], candidates[1]],
      },
      {
        kind: "command",
        label: "Commands",
        items: [candidates[2], candidates[3]],
      },
    ])
  })

  it("filters quick inputs by slash fragment text", () => {
    const quickInputs = toQuickInputSlashCandidates([
      { id: "quick-1", content: "日报模板\n整理今天完成的工作", directSend: false },
      { id: "quick-2", content: "发版总结\n写用户得到什么", directSend: false },
    ])

    expect(filterAgentSlashCandidates(quickInputs, "发版").map((item) => item.name))
      .toEqual(["发版总结"])
  })

  it("replaces a slash fragment with full quick input content", () => {
    const quickInput = toQuickInputSlashCandidates([
      { id: "quick-1", content: "日报模板\n整理今天完成的工作", directSend: true },
    ])[0]
    const fragment = findAgentSlashFragment("请 /日报", 5)
    expect(fragment).not.toBeNull()

    expect(replaceAgentSlashFragment(
      "请 /日报",
      fragment!,
      quickInput.name,
      quickInput.insertText,
    )).toEqual({
      value: "请 日报模板\n整理今天完成的工作",
      cursor: 15,
    })
  })
```

- [ ] **Step 2: Run the slash utility tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/slash-menu.test.ts
```

Expected: FAIL because `toQuickInputSlashCandidates` is not exported and `quickInput` is not a valid `AgentSlashCandidateKind`.

- [ ] **Step 3: Implement quick input candidate conversion**

In `desktop/src/modules/agent/slash-menu.ts`, replace the candidate type definitions and add the quick input converter near `toAgentSlashCandidates`:

```ts
import type { SynapseAgentPublishedCommand } from "@/types/agent"
import type { SynapseQuickInput } from "@/types/config"

export type AgentSlashCandidateKind = "quickInput" | "skill" | "command"

export type AgentSlashCandidate = {
  readonly name: string
  readonly description?: string
  readonly kind: AgentSlashCandidateKind
  readonly source?: SynapseAgentPublishedCommand["source"]
  readonly insertText?: string
}

export type AgentSlashFragment = {
  readonly start: number
  readonly end: number
  readonly query: string
}

export type AgentSlashGroup = {
  readonly kind: AgentSlashCandidateKind
  readonly label: "片段" | "Skills" | "Commands"
  readonly items: readonly AgentSlashCandidate[]
}

const FRAGMENT_BOUNDARY = /\s/

export function toQuickInputSlashCandidates(
  quickInputs: readonly SynapseQuickInput[],
): AgentSlashCandidate[] {
  return quickInputs.flatMap((item) => {
    const lines = item.content.split(/\r?\n/)
    const firstLine = lines.map((line) => line.trim()).find((line) => line.length > 0)
    if (!firstLine) return []

    const description = lines
      .slice(1)
      .map((line) => line.trim())
      .find((line) => line.length > 0)

    return [{
      name: firstLine.replace(/^\/+/, ""),
      description,
      kind: "quickInput" as const,
      insertText: item.content,
    }]
  })
}
```

Keep the existing `toAgentSlashCandidates`, `findAgentSlashFragment`, `replaceAgentSlashFragment`, and `filterAgentSlashCandidates` implementations after this block.

Update `groupAgentSlashCandidates` in the same file:

```ts
export function groupAgentSlashCandidates(
  candidates: readonly AgentSlashCandidate[],
): AgentSlashGroup[] {
  const quickInputs = candidates.filter((candidate) => candidate.kind === "quickInput")
  const skills = candidates.filter((candidate) => candidate.kind === "skill")
  const commands = candidates.filter((candidate) => candidate.kind === "command")
  const groups: AgentSlashGroup[] = []
  if (quickInputs.length > 0) {
    groups.push({ kind: "quickInput", label: "片段", items: quickInputs })
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

- [ ] **Step 4: Run slash utility tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/slash-menu.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit utility changes**

Run:

```bash
git add desktop/src/modules/agent/slash-menu.ts desktop/src/modules/agent/__tests__/slash-menu.test.ts
git commit -m "feat(agent): add quick input slash candidates"
```

## Task 2: Slash Menu Quick Input Group Rendering

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-slash-menu.tsx`
- Test: `desktop/src/modules/agent/__tests__/agent-slash-menu.test.tsx`

- [ ] **Step 1: Add failing menu rendering tests**

In `desktop/src/modules/agent/__tests__/agent-slash-menu.test.tsx`, add a quick input candidate to the local `candidates` array before the existing skill:

```ts
const candidates: AgentSlashCandidate[] = [
  {
    name: "日报模板",
    description: "整理今天完成的工作",
    kind: "quickInput",
    insertText: "日报模板\n整理今天完成的工作",
  },
  {
    name: "review-code",
    description: "Review code changes",
    kind: "skill",
    source: "skill",
  },
  {
    name: "status",
    description: "Show agent status",
    kind: "command",
    source: "builtin",
  },
]
```

Replace the existing `"renders skills and commands in separate groups"` test with:

```ts
  it("renders quick inputs before skills and commands", () => {
    const html = renderToStaticMarkup(
      <AgentSlashMenu
        candidates={candidates}
        highlightedIndex={0}
        onHighlight={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(html).toContain("片段")
    expect(html).toContain("Skills")
    expect(html).toContain("Commands")
    expect(html.indexOf("片段")).toBeLessThan(html.indexOf("Skills"))
    expect(html.indexOf("Skills")).toBeLessThan(html.indexOf("Commands"))
    expect(html).toContain("/日报模板")
    expect(html).toContain("整理今天完成的工作")
    expect(html).toContain("/review-code")
    expect(html).toContain("/status")
  })
```

Add this test after it:

```ts
  it("uses a text input icon for quick input items", () => {
    const html = renderToStaticMarkup(
      <AgentSlashMenu
        candidates={candidates}
        highlightedIndex={0}
        onHighlight={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(html).toContain("data-slash-candidate-kind=\"quickInput\"")
  })
```

- [ ] **Step 2: Run menu tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-slash-menu.test.tsx
```

Expected: FAIL until the component marks candidate kinds and renders a quick input group.

- [ ] **Step 3: Render quick input icons and candidate kind markers**

In `desktop/src/modules/agent/components/agent-slash-menu.tsx`, update the icon import:

```ts
import { Command, TextCursorInput } from "lucide-react"
```

Add this helper above `function AgentSlashMenu`:

```tsx
function AgentSlashCandidateIcon({ kind }: { readonly kind: AgentSlashCandidate["kind"] }) {
  if (kind === "quickInput") {
    return <TextCursorInput className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
  }
  return <Command className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
}
```

Replace the item icon inside the candidate button:

```tsx
<AgentSlashCandidateIcon kind={candidate.kind} />
```

Add a marker attribute to the same button:

```tsx
data-slash-candidate-kind={candidate.kind}
```

The final button opening should include the new attribute:

```tsx
<button
  ref={(node) => {
    itemRefs.current[index] = node
  }}
  key={`${candidate.kind}:${candidate.name}`}
  type="button"
  className={cn(
    "flex w-full min-w-0 items-start gap-2 overflow-hidden rounded-sm px-2 py-1.5 text-left text-sm",
    selected ? "bg-muted text-foreground" : "text-popover-foreground",
  )}
  role="option"
  aria-selected={selected}
  data-track="agent-slash-menu-item"
  data-slash-candidate-kind={candidate.kind}
  onMouseEnter={() => onHighlight(index)}
  onMouseDown={(event) => event.preventDefault()}
  onClick={() => onSelect(candidate)}
>
```

- [ ] **Step 4: Run menu tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-slash-menu.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit menu rendering changes**

Run:

```bash
git add desktop/src/modules/agent/components/agent-slash-menu.tsx desktop/src/modules/agent/__tests__/agent-slash-menu.test.tsx
git commit -m "feat(agent): show quick input slash group"
```

## Task 3: Wire Quick Inputs Into Agent Slash Candidates

**Files:**
- Modify: `desktop/src/modules/agent/index.tsx`
- Test: `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`

- [ ] **Step 1: Add failing composer slash quick input tests**

In `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`, add this test near the existing slash menu tests:

```tsx
  it("inserts a quick input from the slash menu without sending", async () => {
    const onDraftChange = vi.fn()
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault())
    const onQuickInputDirectSend = vi.fn()
    const onInputKeyDown = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft="请 /日报"
          disabled={false}
          canSend={true}
          sending={false}
          cancelPhase="idle"
          slashCandidates={[
            {
              name: "日报模板",
              description: "整理今天完成的工作",
              kind: "quickInput",
              insertText: "日报模板\n整理今天完成的工作",
            },
            {
              name: "review-code",
              description: "Review code changes",
              kind: "skill",
              source: "skill",
            },
          ]}
          onDraftChange={onDraftChange}
          onQuickInputDirectSend={onQuickInputDirectSend}
          onInputKeyDown={onInputKeyDown}
          onSubmit={onSubmit}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea).not.toBeNull()
    textarea!.setSelectionRange(5, 5)
    textarea!.dispatchEvent(new Event("select", { bubbles: true }))
    expect(container.textContent).toContain("片段")
    expect(container.textContent).toContain("/日报模板")

    await act(async () => {
      textarea!.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }))
    })

    expect(onDraftChange).toHaveBeenCalledWith("请 日报模板\n整理今天完成的工作")
    expect(onQuickInputDirectSend).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onInputKeyDown).not.toHaveBeenCalled()
  })
```

Add this static rendering test near the existing quick input menu ordering tests:

```tsx
  it("renders quick input slash candidates before skills and commands", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft="/"
        disabled={false}
        canSend={false}
        sending={false}
        cancelPhase="idle"
        slashCandidates={[
          {
            name: "日报模板",
            description: "整理今天完成的工作",
            kind: "quickInput",
            insertText: "日报模板\n整理今天完成的工作",
          },
          {
            name: "review-code",
            description: "Review code changes",
            kind: "skill",
            source: "skill",
          },
          {
            name: "status",
            description: "Show agent status",
            kind: "command",
            source: "builtin",
          },
        ]}
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )

    expect(html.indexOf("片段")).toBeGreaterThan(-1)
    expect(html.indexOf("Skills")).toBeGreaterThan(html.indexOf("片段"))
    expect(html.indexOf("Commands")).toBeGreaterThan(html.indexOf("Skills"))
  })
```

- [ ] **Step 2: Run composer tests to verify failure or confirm existing composer insertion path**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: PASS if Task 1 and Task 2 already made quick input candidates work through the existing composer insertion path. If it fails, the failure should be limited to slash candidate typing or group rendering.

- [ ] **Step 3: Wire config quick inputs into AgentModule slash candidates**

In `desktop/src/modules/agent/index.tsx`, update the slash-menu import:

```ts
import { toAgentSlashCandidates, toQuickInputSlashCandidates } from "./slash-menu"
```

Replace the current `slashCandidates` memo:

```ts
const slashCandidates = useMemo(
  () => toAgentSlashCandidates(mergedCommands),
  [mergedCommands],
)
```

with:

```ts
const slashCandidates = useMemo(
  () => [
    ...toQuickInputSlashCandidates(config.global.quickInputs),
    ...toAgentSlashCandidates(mergedCommands),
  ],
  [config.global.quickInputs, mergedCommands],
)
```

- [ ] **Step 4: Run focused Agent tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/modules/agent/__tests__/slash-menu.test.ts \
  src/modules/agent/__tests__/agent-slash-menu.test.tsx \
  src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Agent wiring changes**

Run:

```bash
git add desktop/src/modules/agent/index.tsx desktop/src/modules/agent/__tests__/agent-composer.test.tsx
git commit -m "feat(agent): include quick inputs in slash menu"
```

## Task 4: Release Notes And Final Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add pending release note**

In `RELEASE_NOTES_PENDING.md`, add this bullet under `## 功能优化`:

```md
- Agent 对话输入框的 `/` 菜单会优先显示已保存片段，选择后直接插入到当前输入内容中，底部片段菜单的直接发送能力保持不变。
```

- [ ] **Step 2: Run focused tests again**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/modules/agent/__tests__/slash-menu.test.ts \
  src/modules/agent/__tests__/agent-slash-menu.test.tsx \
  src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Check final diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only the intended Agent files and `RELEASE_NOTES_PENDING.md` are modified, aside from pre-existing unrelated local changes such as `auto/state/ui-config.json`.

- [ ] **Step 5: Commit release note**

Run:

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note slash quick inputs"
```

## Self-Review Notes

- Spec coverage: quick inputs appear in `/` menu, render before Skills and Commands, insert full content without sending, preserve bottom `片段` direct-send behavior, and avoid runtime command routing changes.
- Scope: one renderer feature path plus tests and release notes; no independent subsystem split needed.
- Type consistency: `AgentSlashCandidateKind` is `quickInput | skill | command`; the quick input converter returns candidates without `source`, and `source` becomes optional for non-runtime candidates.
