# Workflow Prompt Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the workflow prompt textarea with a compact CodeMirror prompt editor that inserts variables via `@` and Claude Code global Skills via `/`.

**Architecture:** Keep `desktop/workflow-nodes/prompt-editor.tsx` as the shared UI entry point for prompt-like fields. Move completion data shaping into a small pure helper so behavior can be tested without driving CodeMirror in jsdom. Use the existing `editorScan.scanAll()` bridge to load Claude Code global Skill names and CodeMirror's official autocomplete extension for the popup.

**Tech Stack:** React, TypeScript, shadcn/ui, Tailwind token classes, `@uiw/react-codemirror`, `@codemirror/autocomplete`, Vitest.

---

## File Structure

- Modify `desktop/package.json`: declare `@codemirror/autocomplete` as a direct dependency because the app imports it directly.
- Create `desktop/workflow-nodes/prompt-shortcuts.ts`: pure helpers for variable and Skill options, trigger matching, and insert text.
- Create `desktop/workflow-nodes/__tests__/prompt-shortcuts.test.ts`: focused tests for insertion text, filtering, de-duplication, and Claude Code scan filtering.
- Modify `desktop/workflow-nodes/prompt-editor.tsx`: replace `Textarea` with CodeMirror, load Skill names, wire completions and shortcut buttons.
- Optionally modify `pnpm-lock.yaml`: only the importer dependency entry should change because the package is already present in the lock.

## Task 1: Pure Shortcut Helpers

**Files:**
- Create: `desktop/workflow-nodes/prompt-shortcuts.ts`
- Create: `desktop/workflow-nodes/__tests__/prompt-shortcuts.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Create `desktop/workflow-nodes/__tests__/prompt-shortcuts.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  buildPromptShortcutOptions,
  completionTextForPromptShortcut,
  extractClaudeCodeGlobalSkillNames,
  matchPromptShortcutTrigger,
} from "../prompt-shortcuts"
import type { EditorScanResult } from "@/types/editor-scan"

describe("prompt shortcuts", () => {
  it("builds variable options from non-empty variable names", () => {
    const options = buildPromptShortcutOptions({
      variables: [
        { name: "AAA输出", source: { type: "node_output", node: "node-1" } },
        { name: " ", source: { type: "static", value: "ignored" } },
      ],
      skillNames: [],
    })

    expect(options.variables).toEqual([{ label: "AAA输出", apply: "{{AAA输出}}" }])
  })

  it("builds unique Skill options with the skill prefix insertion", () => {
    const options = buildPromptShortcutOptions({
      variables: [],
      skillNames: ["review-code", "review-code", "systematic-debugging", ""],
    })

    expect(options.skills).toEqual([
      { label: "review-code", apply: "skill: review-code" },
      { label: "systematic-debugging", apply: "skill: systematic-debugging" },
    ])
  })

  it("extracts only Claude Code global Skill names from editor scan results", () => {
    const scan: EditorScanResult = {
      global: [
        {
          editorId: "claude-code",
          editorLabel: "Claude Code",
          status: "detected",
          duplicateSkillNames: [],
          rulesSupported: true,
          rules: [],
          skills: [
            { name: "review-code", path: "/a", source: "external", synapseContentId: null, preview: "", fileCount: 1, trash: { mode: "path" } },
          ],
        },
        {
          editorId: "codex",
          editorLabel: "Codex",
          status: "detected",
          duplicateSkillNames: [],
          rulesSupported: true,
          rules: [],
          skills: [
            { name: "codex-only", path: "/b", source: "external", synapseContentId: null, preview: "", fileCount: 1, trash: { mode: "path" } },
          ],
        },
      ],
      projects: [],
    }

    expect(extractClaudeCodeGlobalSkillNames(scan)).toEqual(["review-code"])
  })

  it("matches shortcut triggers directly before the cursor", () => {
    expect(matchPromptShortcutTrigger("hello @AA", 9)).toEqual({ kind: "variable", from: 6, text: "@AA" })
    expect(matchPromptShortcutTrigger("run /review", 11)).toEqual({ kind: "skill", from: 4, text: "/review" })
    expect(matchPromptShortcutTrigger("https://example.com/a", 21)).toBeNull()
  })

  it("returns insertion text for each shortcut kind", () => {
    expect(completionTextForPromptShortcut("variable", "AAA输出")).toBe("{{AAA输出}}")
    expect(completionTextForPromptShortcut("skill", "review-code")).toBe("skill: review-code")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/workflow-nodes/__tests__/prompt-shortcuts.test.ts
```

Expected: FAIL because `desktop/workflow-nodes/prompt-shortcuts.ts` does not exist.

- [ ] **Step 3: Implement the pure helpers**

Create `desktop/workflow-nodes/prompt-shortcuts.ts`:

```ts
import type { EditorScanResult } from "@/types/editor-scan"
import type { VariableBinding } from "./schemas/variable-binding"

export type PromptShortcutKind = "variable" | "skill"

export interface PromptShortcutOption {
  label: string
  apply: string
}

export interface PromptShortcutTriggerMatch {
  kind: PromptShortcutKind
  from: number
  text: string
}

export function completionTextForPromptShortcut(kind: PromptShortcutKind, label: string): string {
  return kind === "variable" ? `{{${label}}}` : `skill: ${label}`
}

export function buildPromptShortcutOptions({
  variables,
  skillNames,
}: {
  variables: readonly VariableBinding[]
  skillNames: readonly string[]
}): { variables: PromptShortcutOption[]; skills: PromptShortcutOption[] } {
  const variableNames = uniqueNonEmpty(variables.map((variable) => variable.name))
  const uniqueSkillNames = uniqueNonEmpty(skillNames)
  return {
    variables: variableNames.map((label) => ({ label, apply: completionTextForPromptShortcut("variable", label) })),
    skills: uniqueSkillNames.map((label) => ({ label, apply: completionTextForPromptShortcut("skill", label) })),
  }
}

export function extractClaudeCodeGlobalSkillNames(scan: EditorScanResult | null | undefined): string[] {
  const claudeCodeGlobal = scan?.global.find((entry) => entry.editorId === "claude-code")
  return uniqueNonEmpty(claudeCodeGlobal?.skills.map((skill) => skill.name) ?? [])
}

export function matchPromptShortcutTrigger(doc: string, pos: number): PromptShortcutTriggerMatch | null {
  const beforeCursor = doc.slice(0, pos)
  const match = /(^|\s)([@/][^\s@/]*)$/.exec(beforeCursor)
  if (!match) return null
  const text = match[2]
  return {
    kind: text.startsWith("@") ? "variable" : "skill",
    from: pos - text.length,
    text,
  }
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/workflow-nodes/__tests__/prompt-shortcuts.test.ts
```

Expected: PASS.

## Task 2: CodeMirror Prompt Editor Integration

**Files:**
- Modify: `desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `desktop/workflow-nodes/prompt-editor.tsx`

- [ ] **Step 1: Declare the direct CodeMirror autocomplete dependency**

Add this dependency to `desktop/package.json` under `dependencies` near the other CodeMirror packages:

```json
"@codemirror/autocomplete": "^6.20.2",
```

Then run:

```bash
pnpm install --lockfile-only
```

Expected: `desktop/package.json` has the direct dependency and `pnpm-lock.yaml` updates only the `@synapse/desktop` importer entry for `@codemirror/autocomplete`.

- [ ] **Step 2: Replace the textarea editor with CodeMirror and completions**

Modify `desktop/workflow-nodes/prompt-editor.tsx` to:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from "@uiw/react-codemirror"
import { autocompletion, startCompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete"
import { Button } from "@/components/ui/button"
import { createRendererLogger } from "@/app-shell/logging"
import type { VariableBinding } from "./schemas/variable-binding"
import {
  buildPromptShortcutOptions,
  extractClaudeCodeGlobalSkillNames,
  matchPromptShortcutTrigger,
} from "./prompt-shortcuts"

const logger = createRendererLogger("workflow.prompt-editor")

interface PromptEditorProps {
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  variables: VariableBinding[]
  placeholder?: string
  rows?: number
}

function useClaudeCodeGlobalSkillNames(): string[] {
  const [skillNames, setSkillNames] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const scan = await window.synapse?.editorScan.scanAll()
        if (!cancelled) setSkillNames(extractClaudeCodeGlobalSkillNames(scan))
      } catch (error) {
        logger.warn("Failed to load Claude Code global skills.", { error })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return skillNames
}

export function PromptEditor({ value, onChange, onBlur, variables, placeholder, rows = 8 }: PromptEditorProps) {
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const skillNames = useClaudeCodeGlobalSkillNames()
  const options = useMemo(() => buildPromptShortcutOptions({ variables, skillNames }), [variables, skillNames])
  const minHeight = `${Math.max(rows, 3) * 20}px`

  const completionSource = useCallback((context: CompletionContext): CompletionResult | null => {
    const match = matchPromptShortcutTrigger(context.state.doc.toString(), context.pos)
    if (!match) return null
    const sourceOptions = match.kind === "variable" ? options.variables : options.skills
    if (sourceOptions.length === 0) return null
    return {
      from: match.from,
      options: sourceOptions.map((option) => ({
        label: option.label,
        type: match.kind === "variable" ? "variable" : "keyword",
        apply: option.apply,
      })),
      validFor: match.kind === "variable" ? /^@[^\s@/]*$/ : /^\/[^\s@/]*$/,
    }
  }, [options])

  const extensions = useMemo(() => [
    autocompletion({ override: [completionSource] }),
    EditorView.lineWrapping,
  ], [completionSource])

  const insertTrigger = (trigger: "@" | "/") => {
    const view = editorRef.current?.view
    if (!view) return
    const selection = view.state.selection.main
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: trigger },
      selection: { anchor: selection.from + trigger.length },
    })
    view.focus()
    requestAnimationFrame(() => startCompletion(view))
  }

  return (
    <div className="grid gap-0">
      <div className="rounded-t-md border border-b-0 bg-background overflow-hidden focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
        <CodeMirror
          ref={editorRef}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          minHeight={minHeight}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            syntaxHighlighting: false,
            autocompletion: false,
            bracketMatching: false,
            closeBrackets: false,
            highlightActiveLine: false,
            searchKeymap: false,
          }}
          extensions={extensions}
          theme="none"
        />
      </div>
      <div className="flex items-center gap-1.5 border rounded-b-md px-2 py-1.5 bg-muted/30">
        <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onMouseDown={(event) => event.preventDefault()} onClick={() => insertTrigger("@")}>
          @ 变量
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onMouseDown={(event) => event.preventDefault()} onClick={() => insertTrigger("/")}>
          / Skill
        </Button>
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{value.length}字</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run typecheck to catch integration errors**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS. If it fails because CodeMirror setup options differ, adjust only `desktop/workflow-nodes/prompt-editor.tsx`.

## Task 3: Verification

**Files:**
- Review: `desktop/workflow-nodes/prompt-editor.tsx`
- Review: `desktop/workflow-nodes/prompt-shortcuts.ts`

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/workflow-nodes/__tests__/prompt-shortcuts.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run workflow-related tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/workflow-nodes desktop/src/modules/workflow
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
git diff -- desktop/workflow-nodes/prompt-editor.tsx desktop/workflow-nodes/prompt-shortcuts.ts desktop/workflow-nodes/__tests__/prompt-shortcuts.test.ts desktop/package.json pnpm-lock.yaml
```

Expected: Diff only covers prompt shortcut behavior and direct dependency declaration.
