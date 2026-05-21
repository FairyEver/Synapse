# Agent Slash Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated slash insertion menu for the Agent composer that inserts `/<name>` for available skills and commands.

**Architecture:** Keep the runtime data source unchanged: `AgentModule` passes the existing published command list into `AgentComposer`. Add pure slash-menu utilities for fragment detection, filtering, grouping, and replacement. Add a small `AgentSlashMenu` renderer and wire it into the composer keyboard flow without changing backend command execution.

**Tech Stack:** Electron renderer, React, TypeScript, Tailwind CSS token classes, existing shadcn/Radix UI primitives, Vitest with jsdom.

---

## File Structure

- Create `desktop/src/modules/agent/slash-menu.ts`: pure utilities and types for slash candidates, active fragment detection, filtering, grouping, and replacement.
- Create `desktop/src/modules/agent/components/agent-slash-menu.tsx`: dedicated Agent composer menu UI, grouped as `Skills` and `Commands`.
- Modify `desktop/src/modules/agent/components/agent-composer.tsx`: accept slash candidates, compute active fragment, render menu, route keyboard events.
- Modify `desktop/src/modules/agent/index.tsx`: derive slash candidates from `mergedCommands` and pass them to `AgentComposer`.
- Create `desktop/src/modules/agent/__tests__/slash-menu.test.ts`: fast unit tests for pure slash behavior.
- Create `desktop/src/modules/agent/__tests__/agent-slash-menu.test.tsx`: component tests for grouped rendering and selection.
- Modify `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`: integration tests for keyboard selection and normal submit behavior.

## Task 1: Slash Menu Utilities

**Files:**
- Create: `desktop/src/modules/agent/slash-menu.ts`
- Test: `desktop/src/modules/agent/__tests__/slash-menu.test.ts`

- [ ] **Step 1: Write the failing utility tests**

Create `desktop/src/modules/agent/__tests__/slash-menu.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  filterAgentSlashCandidates,
  findAgentSlashFragment,
  groupAgentSlashCandidates,
  replaceAgentSlashFragment,
  type AgentSlashCandidate,
} from "../slash-menu"

const candidates: AgentSlashCandidate[] = [
  {
    name: "review-code",
    description: "Review code changes",
    kind: "skill",
    source: "skill",
  },
  {
    name: "openai-docs",
    description: "Use OpenAI docs",
    kind: "skill",
    source: "skill",
  },
  {
    name: "status",
    description: "Show agent status",
    kind: "command",
    source: "builtin",
  },
  {
    name: "model",
    description: "Switch model",
    kind: "command",
    source: "builtin",
  },
]

describe("agent slash menu utilities", () => {
  it("detects a slash fragment at the cursor in the middle of a draft", () => {
    expect(findAgentSlashFragment("Please review /rev in this implementation", 18)).toEqual({
      start: 14,
      end: 18,
      query: "rev",
    })
  })

  it("detects an empty slash fragment immediately after slash", () => {
    expect(findAgentSlashFragment("Please / review", 8)).toEqual({
      start: 7,
      end: 8,
      query: "",
    })
  })

  it("returns null when the cursor is outside a slash token", () => {
    expect(findAgentSlashFragment("Please /review later", 6)).toBeNull()
    expect(findAgentSlashFragment("Please /review later", 21)).toBeNull()
  })

  it("stops the active fragment at whitespace", () => {
    expect(findAgentSlashFragment("Run /status now", 11)).toEqual({
      start: 4,
      end: 11,
      query: "status",
    })
    expect(findAgentSlashFragment("Run /status now", 13)).toBeNull()
  })

  it("replaces only the active slash fragment", () => {
    const fragment = findAgentSlashFragment("Please review /rev in this implementation", 18)
    expect(fragment).not.toBeNull()
    expect(replaceAgentSlashFragment(
      "Please review /rev in this implementation",
      fragment!,
      "review-code",
    )).toEqual({
      value: "Please review /review-code in this implementation",
      cursor: 26,
    })
  })

  it("filters candidates by name and description", () => {
    expect(filterAgentSlashCandidates(candidates, "rev").map((item) => item.name))
      .toEqual(["review-code"])
    expect(filterAgentSlashCandidates(candidates, "docs").map((item) => item.name))
      .toEqual(["openai-docs"])
  })

  it("shows all candidates for an empty query", () => {
    expect(filterAgentSlashCandidates(candidates, "").map((item) => item.name))
      .toEqual(["review-code", "openai-docs", "status", "model"])
  })

  it("groups skills before commands", () => {
    expect(groupAgentSlashCandidates(candidates)).toEqual([
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
})
```

- [ ] **Step 2: Run the utility test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/slash-menu.test.ts
```

Expected: FAIL because `../slash-menu` does not exist.

- [ ] **Step 3: Implement the utility module**

Create `desktop/src/modules/agent/slash-menu.ts`:

```ts
import type { SynapseAgentPublishedCommand } from "@/types/agent"

export type AgentSlashCandidateKind = "skill" | "command"

export type AgentSlashCandidate = {
  readonly name: string
  readonly description?: string
  readonly kind: AgentSlashCandidateKind
  readonly source: SynapseAgentPublishedCommand["source"]
}

export type AgentSlashFragment = {
  readonly start: number
  readonly end: number
  readonly query: string
}

export type AgentSlashGroup = {
  readonly kind: AgentSlashCandidateKind
  readonly label: "Skills" | "Commands"
  readonly items: readonly AgentSlashCandidate[]
}

const FRAGMENT_BOUNDARY = /\s/

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
    }))
}

export function findAgentSlashFragment(value: string, cursor: number): AgentSlashFragment | null {
  const safeCursor = Math.max(0, Math.min(cursor, value.length))
  let start = safeCursor
  while (start > 0 && !FRAGMENT_BOUNDARY.test(value[start - 1] ?? "")) {
    start -= 1
  }

  const slashIndex = value.lastIndexOf("/", safeCursor - 1)
  if (slashIndex < start) return null
  if (slashIndex > 0 && !FRAGMENT_BOUNDARY.test(value[slashIndex - 1] ?? "")) return null

  let end = slashIndex + 1
  while (end < value.length && !FRAGMENT_BOUNDARY.test(value[end] ?? "")) {
    end += 1
  }
  if (safeCursor < slashIndex + 1 || safeCursor > end) return null

  return {
    start: slashIndex,
    end,
    query: value.slice(slashIndex + 1, safeCursor),
  }
}

export function replaceAgentSlashFragment(
  value: string,
  fragment: AgentSlashFragment,
  name: string,
): { readonly value: string; readonly cursor: number } {
  const insertion = `/${name.replace(/^\/+/, "")}`
  const nextValue = `${value.slice(0, fragment.start)}${insertion}${value.slice(fragment.end)}`
  return {
    value: nextValue,
    cursor: fragment.start + insertion.length,
  }
}

export function filterAgentSlashCandidates(
  candidates: readonly AgentSlashCandidate[],
  query: string,
): AgentSlashCandidate[] {
  const normalized = query.trim().replace(/^\/+/, "").toLowerCase()
  if (!normalized) return [...candidates]
  return candidates.filter((candidate) => {
    const name = candidate.name.toLowerCase()
    const description = candidate.description?.toLowerCase() ?? ""
    return name.includes(normalized) || description.includes(normalized)
  })
}

export function groupAgentSlashCandidates(
  candidates: readonly AgentSlashCandidate[],
): AgentSlashGroup[] {
  const skills = candidates.filter((candidate) => candidate.kind === "skill")
  const commands = candidates.filter((candidate) => candidate.kind === "command")
  return [
    skills.length > 0 ? { kind: "skill", label: "Skills" as const, items: skills } : null,
    commands.length > 0 ? { kind: "command", label: "Commands" as const, items: commands } : null,
  ].filter((group): group is AgentSlashGroup => group !== null)
}
```

- [ ] **Step 4: Run the utility test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/slash-menu.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add desktop/src/modules/agent/slash-menu.ts desktop/src/modules/agent/__tests__/slash-menu.test.ts
git commit -m "feat: add agent slash menu utilities"
```

## Task 2: Dedicated Slash Menu Component

**Files:**
- Create: `desktop/src/modules/agent/components/agent-slash-menu.tsx`
- Test: `desktop/src/modules/agent/__tests__/agent-slash-menu.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `desktop/src/modules/agent/__tests__/agent-slash-menu.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentSlashMenu } from "../components/agent-slash-menu"
import type { AgentSlashCandidate } from "../slash-menu"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const candidates: AgentSlashCandidate[] = [
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

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("AgentSlashMenu", () => {
  it("renders skills and commands in separate groups", () => {
    const html = renderToStaticMarkup(
      <AgentSlashMenu
        candidates={candidates}
        highlightedIndex={0}
        onHighlight={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(html).toContain("Skills")
    expect(html).toContain("Commands")
    expect(html).toContain("/review-code")
    expect(html).toContain("Review code changes")
    expect(html).toContain("/status")
    expect(html).toContain("Show agent status")
  })

  it("renders a short empty state", () => {
    const html = renderToStaticMarkup(
      <AgentSlashMenu
        candidates={[]}
        highlightedIndex={0}
        onHighlight={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(html).toContain("No matches")
  })

  it("selects a clicked item", async () => {
    const onSelect = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentSlashMenu
          candidates={candidates}
          highlightedIndex={0}
          onHighlight={vi.fn()}
          onSelect={onSelect}
        />,
      )
    })

    const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent?.includes("/status"))
    expect(button).toBeDefined()

    await act(async () => {
      button?.click()
    })

    expect(onSelect).toHaveBeenCalledWith(candidates[1])
  })
})
```

- [ ] **Step 2: Run the component test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-slash-menu.test.tsx
```

Expected: FAIL because `../components/agent-slash-menu` does not exist.

- [ ] **Step 3: Implement the menu component**

Create `desktop/src/modules/agent/components/agent-slash-menu.tsx`:

```tsx
import { Command } from "lucide-react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import {
  groupAgentSlashCandidates,
  type AgentSlashCandidate,
} from "../slash-menu"

type AgentSlashMenuProps = {
  readonly candidates: readonly AgentSlashCandidate[]
  readonly highlightedIndex: number
  readonly onHighlight: (index: number) => void
  readonly onSelect: (candidate: AgentSlashCandidate) => void
}

function AgentSlashMenu({
  candidates,
  highlightedIndex,
  onHighlight,
  onSelect,
}: AgentSlashMenuProps) {
  const groups = groupAgentSlashCandidates(candidates)
  let visibleIndex = 0

  return (
    <div
      className="absolute bottom-full left-2 z-20 mb-2 w-80 rounded-lg border border-border bg-popover p-1 text-popover-foreground"
      role="listbox"
      aria-label="Agent slash menu"
      data-track="agent-slash-menu"
    >
      {candidates.length === 0 ? (
        <div className="px-2 py-3 text-sm text-muted-foreground">No matches</div>
      ) : (
        <ScrollArea className="max-h-72">
          <div className="flex flex-col gap-1">
            {groups.map((group) => (
              <div key={group.kind} className="flex flex-col gap-1">
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  {group.label}
                </div>
                {group.items.map((candidate) => {
                  const index = visibleIndex
                  visibleIndex += 1
                  const selected = index === highlightedIndex
                  return (
                    <button
                      key={`${candidate.kind}:${candidate.name}`}
                      type="button"
                      className={cn(
                        "flex min-w-0 items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                        selected ? "bg-muted text-foreground" : "text-popover-foreground",
                      )}
                      role="option"
                      aria-selected={selected}
                      data-track="agent-slash-menu-item"
                      onMouseEnter={() => onHighlight(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onSelect(candidate)}
                    >
                      <Command className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">/{candidate.name}</span>
                        {candidate.description ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {candidate.description}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

export { AgentSlashMenu }
```

- [ ] **Step 4: Run the component test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-slash-menu.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add desktop/src/modules/agent/components/agent-slash-menu.tsx desktop/src/modules/agent/__tests__/agent-slash-menu.test.tsx
git commit -m "feat: add agent slash menu component"
```

## Task 3: Composer Integration

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-composer.tsx`
- Modify: `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`

- [ ] **Step 1: Add failing composer integration tests**

Append these tests inside the existing `describe("AgentComposer", () => { ... })` block in `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`:

```tsx
  it("opens the slash menu and inserts the highlighted item with Enter", async () => {
    const onDraftChange = vi.fn()
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault())
    const onInputKeyDown = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft="Please /rev now"
          disabled={false}
          canSend={true}
          sending={false}
          cancelPhase="idle"
          slashCandidates={[
            {
              name: "review-code",
              description: "Review code changes",
              kind: "skill",
              source: "skill",
            },
          ]}
          onDraftChange={onDraftChange}
          onInputKeyDown={onInputKeyDown}
          onSubmit={onSubmit}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea).not.toBeNull()
    textarea!.setSelectionRange(11, 11)

    await act(async () => {
      textarea!.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }))
    })

    expect(onDraftChange).toHaveBeenCalledWith("Please /review-code now")
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onInputKeyDown).not.toHaveBeenCalled()
  })

  it("closes the slash menu with Escape without changing the draft", async () => {
    const onDraftChange = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft="Run /status"
          disabled={false}
          canSend={true}
          sending={false}
          cancelPhase="idle"
          slashCandidates={[
            {
              name: "status",
              description: "Show agent status",
              kind: "command",
              source: "builtin",
            },
          ]}
          onDraftChange={onDraftChange}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain("/status")
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea).not.toBeNull()
    textarea!.setSelectionRange(11, 11)

    await act(async () => {
      textarea!.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }))
    })

    expect(onDraftChange).not.toHaveBeenCalled()
  })

  it("keeps normal Enter submission when no slash menu is active", async () => {
    const onInputKeyDown = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft="Send this message"
          disabled={false}
          canSend={true}
          sending={false}
          cancelPhase="idle"
          slashCandidates={[
            {
              name: "status",
              description: "Show agent status",
              kind: "command",
              source: "builtin",
            },
          ]}
          onDraftChange={vi.fn()}
          onInputKeyDown={onInputKeyDown}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea).not.toBeNull()

    await act(async () => {
      textarea!.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }))
    })

    expect(onInputKeyDown).toHaveBeenCalled()
  })

  it("closes the slash menu when clicking outside the composer", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const outside = document.createElement("button")
    outside.type = "button"
    outside.textContent = "outside"
    document.body.appendChild(outside)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft="Run /status"
          disabled={false}
          canSend={true}
          sending={false}
          cancelPhase="idle"
          slashCandidates={[
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
    })

    expect(container.textContent).toContain("/status")

    await act(async () => {
      outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    })

    expect(container.textContent).not.toContain("Show agent status")
  })
```

- [ ] **Step 2: Run the composer test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: FAIL because `AgentComposer` does not accept `slashCandidates` and does not route slash menu keys.

- [ ] **Step 3: Wire slash menu state into `AgentComposer`**

Modify imports in `desktop/src/modules/agent/components/agent-composer.tsx`:

```tsx
import { type FormEvent, type KeyboardEvent, useMemo, useRef, useEffect, useState } from "react"
import { AgentSlashMenu } from "./agent-slash-menu"
import {
  filterAgentSlashCandidates,
  findAgentSlashFragment,
  replaceAgentSlashFragment,
  type AgentSlashCandidate,
} from "../slash-menu"
```

Add props:

```tsx
  readonly slashCandidates?: readonly AgentSlashCandidate[]
```

Add state and derived values after existing local state:

```tsx
  const formRef = useRef<HTMLFormElement>(null)
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false)
  const [highlightedSlashIndex, setHighlightedSlashIndex] = useState(0)
  const [selectionStart, setSelectionStart] = useState(0)
  const activeSlashFragment = useMemo(
    () => findAgentSlashFragment(draft, selectionStart),
    [draft, selectionStart],
  )
  const visibleSlashCandidates = useMemo(
    () => activeSlashFragment
      ? filterAgentSlashCandidates(slashCandidates, activeSlashFragment.query)
      : [],
    [activeSlashFragment, slashCandidates],
  )
  const slashMenuOpen = Boolean(
    activeSlashFragment
      && !slashMenuDismissed
      && slashCandidates.length > 0,
  )
```

Default `slashCandidates` to an empty array in the `AgentComposer` destructuring:

```tsx
  slashCandidates = [],
```

Add helper handlers:

```tsx
  const updateSelectionStart = () => {
    const el = textareaRef.current
    if (!el) return
    setSelectionStart(el.selectionStart)
    setSlashMenuDismissed(false)
  }

  const selectSlashCandidate = (candidate: AgentSlashCandidate) => {
    if (!activeSlashFragment) return
    const next = replaceAgentSlashFragment(draft, activeSlashFragment, candidate.name)
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

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      onInputKeyDown(event)
      return
    }

    if (slashMenuOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setHighlightedSlashIndex((current) =>
          visibleSlashCandidates.length === 0 ? 0 : (current + 1) % visibleSlashCandidates.length)
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setHighlightedSlashIndex((current) =>
          visibleSlashCandidates.length === 0
            ? 0
            : (current - 1 + visibleSlashCandidates.length) % visibleSlashCandidates.length)
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setSlashMenuDismissed(true)
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const candidate = visibleSlashCandidates[highlightedSlashIndex]
        if (candidate) {
          event.preventDefault()
          selectSlashCandidate(candidate)
          return
        }
      }
    }

    onInputKeyDown(event)
  }
```

Reset highlight when candidates change:

```tsx
  useEffect(() => {
    setHighlightedSlashIndex(0)
  }, [activeSlashFragment?.query, visibleSlashCandidates.length])

  useEffect(() => {
    if (!slashMenuOpen) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && formRef.current?.contains(target)) return
      setSlashMenuDismissed(true)
    }
    document.addEventListener("pointerdown", handlePointerDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
    }
  }, [slashMenuOpen])
```

Update the textarea props:

```tsx
              onChange={(e) => {
                onDraftChange(e.target.value)
                setSelectionStart(e.target.selectionStart)
                setSlashMenuDismissed(false)
              }}
              onKeyDown={handleTextareaKeyDown}
              onClick={updateSelectionStart}
              onSelect={updateSelectionStart}
```

Add the form ref:

```tsx
        ref={formRef}
```

Render `AgentSlashMenu` inside `agent-composer__container`, before pending messages:

```tsx
          {slashMenuOpen ? (
            <AgentSlashMenu
              candidates={visibleSlashCandidates}
              highlightedIndex={highlightedSlashIndex}
              onHighlight={setHighlightedSlashIndex}
              onSelect={selectSlashCandidate}
            />
          ) : null}
```

- [ ] **Step 4: Run the composer test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add desktop/src/modules/agent/components/agent-composer.tsx desktop/src/modules/agent/__tests__/agent-composer.test.tsx
git commit -m "feat: wire slash menu into agent composer"
```

## Task 4: Agent Module Candidate Wiring

**Files:**
- Modify: `desktop/src/modules/agent/index.tsx`

- [ ] **Step 1: Add candidate conversion in `AgentModule`**

Modify imports in `desktop/src/modules/agent/index.tsx`:

```tsx
import { toAgentSlashCandidates } from "./slash-menu"
```

After `mergedCommands`, add:

```tsx
  const slashCandidates = useMemo(
    () => toAgentSlashCandidates(mergedCommands),
    [mergedCommands],
  )
```

Pass candidates into `AgentComposer`:

```tsx
              slashCandidates={slashCandidates}
```

- [ ] **Step 2: Run targeted tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/slash-menu.test.ts src/modules/agent/__tests__/agent-slash-menu.test.tsx src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit Task 4**

Run:

```bash
git add desktop/src/modules/agent/index.tsx
git commit -m "feat: provide agent slash menu candidates"
```

## Task 5: Final Verification

**Files:**
- No new files unless earlier verification reveals a scoped issue.

- [ ] **Step 1: Run all Agent module tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git diff --stat HEAD
git diff -- desktop/src/modules/agent/slash-menu.ts desktop/src/modules/agent/components/agent-slash-menu.tsx desktop/src/modules/agent/components/agent-composer.tsx desktop/src/modules/agent/index.tsx
```

Expected: only slash menu related changes are present.

## Self-Review

- Spec coverage: The plan covers dedicated composer menu, trigger anywhere, `/<name>` insertion, current fragment replacement, `Skills` and `Commands` grouping, runtime-published data, keyboard handling, click handling, and no immediate send.
- Placeholder scan: No deferred implementation markers are present.
- Type consistency: `AgentSlashCandidate`, `AgentSlashFragment`, `AgentSlashGroup`, and handler names are defined before use and reused consistently.
