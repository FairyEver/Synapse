# Cron Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact Cron input editor to the task scheduler form while keeping the stored value as a five-field cron expression string.

**Architecture:** Add renderer-only pure cron utilities plus module-local `CronInput` and `CronEditorDialog` components. `TaskFormDialog` keeps its existing form state and replaces only the Cron field body. The editor dialog edits draft state and applies changes only when the user clicks `应用`.

**Tech Stack:** Electron renderer, React 19, TypeScript, shadcn/Radix UI components, Tailwind token classes, Vitest with node environment and `renderToStaticMarkup`.

---

## File Map

- Create `desktop/src/modules/task-scheduler/cron-utils.ts`: five-field cron parsing, validation, template generation, template inference, and next-run preview.
- Create `desktop/src/modules/task-scheduler/__tests__/cron-utils.test.ts`: pure utility tests.
- Create `desktop/src/modules/task-scheduler/components/cron-editor-dialog.tsx`: compact dialog with `常用` and `高级` tabs.
- Create `desktop/src/modules/task-scheduler/components/cron-input.tsx`: `InputGroup` wrapper with embedded `编辑` button and editor dialog.
- Create `desktop/src/modules/task-scheduler/__tests__/cron-input.test.tsx`: static render tests for the input-group shape and dialog markup.
- Modify `desktop/src/modules/task-scheduler/components/task-form-dialog.tsx`: replace the Cron `Input` with `CronInput`.
- Modify `desktop/src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx`: assert the Cron field uses `InputGroup`, matching the working-directory field style.

## Task 1: Add Cron Utility Tests

**Files:**
- Create: `desktop/src/modules/task-scheduler/__tests__/cron-utils.test.ts`
- Create during Task 2: `desktop/src/modules/task-scheduler/cron-utils.ts`

- [ ] **Step 1: Write failing utility tests**

Create `desktop/src/modules/task-scheduler/__tests__/cron-utils.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  buildCronExpression,
  getCronEditorInitialTab,
  inferCronTemplate,
  listNextCronRuns,
  parseCronExpression,
  validateCronExpression,
  type CronTemplateDraft,
} from "../cron-utils"

describe("cron-utils", () => {
  it("builds expressions from common templates", () => {
    const cases: Array<[CronTemplateDraft, string]> = [
      [{ kind: "every_minutes", everyMinutes: 15, minute: 0, hour: 9, dayOfMonth: 1, weekday: 1 }, "*/15 * * * *"],
      [{ kind: "hourly", everyMinutes: 15, minute: 5, hour: 9, dayOfMonth: 1, weekday: 1 }, "5 * * * *"],
      [{ kind: "daily", everyMinutes: 15, minute: 30, hour: 9, dayOfMonth: 1, weekday: 1 }, "30 9 * * *"],
      [{ kind: "weekly", everyMinutes: 15, minute: 0, hour: 10, dayOfMonth: 1, weekday: 2 }, "0 10 * * 2"],
      [{ kind: "monthly", everyMinutes: 15, minute: 45, hour: 8, dayOfMonth: 12, weekday: 1 }, "45 8 12 * *"],
      [{ kind: "weekdays", everyMinutes: 15, minute: 15, hour: 18, dayOfMonth: 1, weekday: 1 }, "15 18 * * 1-5"],
    ]

    for (const [draft, expected] of cases) {
      expect(buildCronExpression(draft)).toBe(expected)
    }
  })

  it("parses supported five-field cron syntax", () => {
    const parsed = parseCronExpression("*/20 9-17 * jan,mar mon-fri")

    expect([...parsed.minute]).toEqual([0, 20, 40])
    expect([...parsed.hour]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
    expect([...parsed.month]).toEqual([1, 3])
    expect([...parsed.weekday]).toEqual([1, 2, 3, 4, 5])
  })

  it("normalizes weekday 7 to Sunday", () => {
    expect([...parseCronExpression("0 9 * * 7").weekday]).toEqual([0])
  })

  it("rejects unsupported or invalid expressions", () => {
    expect(() => parseCronExpression("0 9 * *")).toThrow(/5 段/)
    expect(() => parseCronExpression("0 24 * * *")).toThrow(/小时/)
    expect(() => parseCronExpression("0 9 20-10 * *")).toThrow(/日期/)
    expect(validateCronExpression("bad")).toEqual({
      ok: false,
      message: "Cron 必须包含 5 段",
    })
  })

  it("lists five ascending future runs", () => {
    const runs = listNextCronRuns("*/30 * * * *", new Date("2026-04-29T10:01:00"), 5)

    expect(runs.map((run) => run.toISOString())).toEqual([
      new Date("2026-04-29T10:30:00").toISOString(),
      new Date("2026-04-29T11:00:00").toISOString(),
      new Date("2026-04-29T11:30:00").toISOString(),
      new Date("2026-04-29T12:00:00").toISOString(),
      new Date("2026-04-29T12:30:00").toISOString(),
    ])
  })

  it("infers templates and initial tab from existing values", () => {
    expect(inferCronTemplate("0 9 * * 1-5")).toMatchObject({
      kind: "weekdays",
      hour: 9,
      minute: 0,
    })
    expect(getCronEditorInitialTab("0 9 * * 1-5")).toBe("common")
    expect(getCronEditorInitialTab("0 9 1,15 * *")).toBe("advanced")
    expect(getCronEditorInitialTab("bad")).toBe("advanced")
  })
})
```

- [ ] **Step 2: Run the utility test and confirm it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- src/modules/task-scheduler/__tests__/cron-utils.test.ts
```

Expected: FAIL because `../cron-utils` does not exist.

## Task 2: Implement Cron Utilities

**Files:**
- Create: `desktop/src/modules/task-scheduler/cron-utils.ts`
- Test: `desktop/src/modules/task-scheduler/__tests__/cron-utils.test.ts`

- [ ] **Step 1: Create utility exports and five-field parser**

Create `desktop/src/modules/task-scheduler/cron-utils.ts` with these exports and behavior:

```ts
export type CronTemplateKind =
  | "every_minutes"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "weekdays"

export type CronEditorTab = "common" | "advanced"

export type CronTemplateDraft = {
  kind: CronTemplateKind
  everyMinutes: number
  minute: number
  hour: number
  dayOfMonth: number
  weekday: number
}

export type ParsedCronExpression = {
  readonly minute: ReadonlySet<number>
  readonly hour: ReadonlySet<number>
  readonly day: ReadonlySet<number>
  readonly month: ReadonlySet<number>
  readonly weekday: ReadonlySet<number>
}

export type CronValidationResult =
  | { ok: true }
  | { ok: false; message: string }
```

Implementation notes:

- Copy the backend-supported syntax from `desktop/electron/services/task-scheduler/cron-expression.ts`.
- Keep the renderer messages short and Chinese-facing:
  - field count: `Cron 必须包含 5 段`
  - invalid minute: `分钟不合法`
  - invalid hour: `小时不合法`
  - invalid day: `日期不合法`
  - invalid month: `月份不合法`
  - invalid weekday: `星期不合法`
- Sort generated sets before comparing in tests.
- Use local `Date` methods, matching the scheduler's current local-time behavior.

- [ ] **Step 2: Add template generation and inference**

Add these functions to `cron-utils.ts`:

```ts
const DEFAULT_CRON_TEMPLATE_DRAFT: CronTemplateDraft = {
  kind: "daily",
  everyMinutes: 15,
  minute: 0,
  hour: 9,
  dayOfMonth: 1,
  weekday: 1,
}

export function createDefaultCronTemplateDraft(): CronTemplateDraft {
  return { ...DEFAULT_CRON_TEMPLATE_DRAFT }
}

export function buildCronExpression(draft: CronTemplateDraft): string {
  switch (draft.kind) {
    case "every_minutes":
      return `*/${draft.everyMinutes} * * * *`
    case "hourly":
      return `${draft.minute} * * * *`
    case "daily":
      return `${draft.minute} ${draft.hour} * * *`
    case "weekly":
      return `${draft.minute} ${draft.hour} * * ${draft.weekday}`
    case "monthly":
      return `${draft.minute} ${draft.hour} ${draft.dayOfMonth} * *`
    case "weekdays":
      return `${draft.minute} ${draft.hour} * * 1-5`
  }
}

export function inferCronTemplate(expr: string): CronTemplateDraft | null {
  const parts = expr.trim().split(/\s+/).filter(Boolean)
  if (parts.length !== 5) return null
  const [minute, hour, day, month, weekday] = parts
  const base = createDefaultCronTemplateDraft()

  const everyMinutes = minute?.match(/^\*\/([1-9]\d*)$/)
  if (everyMinutes && hour === "*" && day === "*" && month === "*" && weekday === "*") {
    return { ...base, kind: "every_minutes", everyMinutes: Number(everyMinutes[1]) }
  }
  if (isPlainNumber(minute) && hour === "*" && day === "*" && month === "*" && weekday === "*") {
    return { ...base, kind: "hourly", minute: Number(minute) }
  }
  if (isPlainNumber(minute) && isPlainNumber(hour) && day === "*" && month === "*" && weekday === "*") {
    return { ...base, kind: "daily", minute: Number(minute), hour: Number(hour) }
  }
  if (isPlainNumber(minute) && isPlainNumber(hour) && day === "*" && month === "*" && isPlainNumber(weekday)) {
    return { ...base, kind: "weekly", minute: Number(minute), hour: Number(hour), weekday: Number(weekday) }
  }
  if (isPlainNumber(minute) && isPlainNumber(hour) && isPlainNumber(day) && month === "*" && weekday === "*") {
    return { ...base, kind: "monthly", minute: Number(minute), hour: Number(hour), dayOfMonth: Number(day) }
  }
  if (isPlainNumber(minute) && isPlainNumber(hour) && day === "*" && month === "*" && weekday === "1-5") {
    return { ...base, kind: "weekdays", minute: Number(minute), hour: Number(hour) }
  }
  return null
}

function isPlainNumber(value: string | undefined): value is string {
  return value !== undefined && /^\d+$/.test(value)
}
```

- [ ] **Step 3: Add validation, preview, and initial-tab helpers**

Add:

```ts
export function validateCronExpression(expr: string): CronValidationResult {
  try {
    parseCronExpression(expr)
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Cron 不合法",
    }
  }
}

export function listNextCronRuns(expr: string, from = new Date(), count = 5): Date[] {
  const runs: Date[] = []
  let cursor = new Date(from)
  for (let index = 0; index < count; index += 1) {
    const next = nextCronRun(expr, cursor)
    runs.push(next)
    cursor = next
  }
  return runs
}

export function getCronEditorInitialTab(expr: string): CronEditorTab {
  const validation = validateCronExpression(expr)
  if (!validation.ok) return "advanced"
  return inferCronTemplate(expr) ? "common" : "advanced"
}
```

Keep `nextCronRun` private unless tests need it. It should scan minute by minute up to five years, matching the backend implementation.

- [ ] **Step 4: Run utility tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- src/modules/task-scheduler/__tests__/cron-utils.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit utility work**

```bash
git add desktop/src/modules/task-scheduler/cron-utils.ts desktop/src/modules/task-scheduler/__tests__/cron-utils.test.ts
git commit -m "feat: add cron editor utilities"
```

## Task 3: Add Cron Input And Dialog Static Tests

**Files:**
- Create: `desktop/src/modules/task-scheduler/__tests__/cron-input.test.tsx`
- Create during Task 4: `desktop/src/modules/task-scheduler/components/cron-input.tsx`
- Create during Task 5: `desktop/src/modules/task-scheduler/components/cron-editor-dialog.tsx`

- [ ] **Step 1: Write failing static render tests**

Create `desktop/src/modules/task-scheduler/__tests__/cron-input.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { CronInput } from "../components/cron-input"
import { CronEditorDialog } from "../components/cron-editor-dialog"

describe("CronInput", () => {
  it("renders as an input group with an embedded edit button", () => {
    const html = renderToStaticMarkup(
      <CronInput
        id="task-form-cron"
        value="0 9 * * *"
        onChange={vi.fn()}
      />,
    )

    expect(html).toContain('data-slot="input-group"')
    expect(html).toContain('id="task-form-cron"')
    expect(html).toContain('data-align="inline-end"')
    expect(html).toContain(">编辑</button>")
  })
})

describe("CronEditorDialog", () => {
  it("renders compact common and advanced editor surfaces", () => {
    const html = renderToStaticMarkup(
      <CronEditorDialog
        open
        value="0 9 * * *"
        onApply={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    )

    expect(html).toContain("编辑 Cron")
    expect(html).toContain("常用")
    expect(html).toContain("高级")
    expect(html).toContain("未来 5 次")
    expect(html).toContain("应用")
    expect(html).toContain("sm:max-w-[560px]")
  })

  it("opens invalid expressions on the advanced tab", () => {
    const html = renderToStaticMarkup(
      <CronEditorDialog
        open
        value="bad"
        onApply={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    )

    expect(html).toContain('data-state="active"')
    expect(html).toContain("Cron 必须包含 5 段")
  })
})
```

- [ ] **Step 2: Run component tests and confirm they fail**

Run:

```bash
pnpm --filter @synapse/desktop test -- src/modules/task-scheduler/__tests__/cron-input.test.tsx
```

Expected: FAIL because the components do not exist.

## Task 4: Implement CronInput

**Files:**
- Create: `desktop/src/modules/task-scheduler/components/cron-input.tsx`
- Test: `desktop/src/modules/task-scheduler/__tests__/cron-input.test.tsx`

- [ ] **Step 1: Create the controlled input wrapper**

Create `desktop/src/modules/task-scheduler/components/cron-input.tsx`:

```tsx
import { useState } from "react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { CronEditorDialog } from "./cron-editor-dialog"

type CronInputProps = {
  disabled?: boolean
  id: string
  value: string
  onChange: (value: string) => void
}

function CronInput({ disabled, id, value, onChange }: CronInputProps) {
  const [editorOpen, setEditorOpen] = useState(false)

  return (
    <>
      <InputGroup>
        <InputGroupInput
          id={id}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            type="button"
            disabled={disabled}
            onClick={() => setEditorOpen(true)}
          >
            编辑
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <CronEditorDialog
        open={editorOpen}
        value={value}
        onApply={onChange}
        onOpenChange={setEditorOpen}
      />
    </>
  )
}

export { CronInput }
export type { CronInputProps }
```

- [ ] **Step 2: Run the component test**

Run:

```bash
pnpm --filter @synapse/desktop test -- src/modules/task-scheduler/__tests__/cron-input.test.tsx
```

Expected: still FAIL because `CronEditorDialog` does not exist.

## Task 5: Implement CronEditorDialog

**Files:**
- Create: `desktop/src/modules/task-scheduler/components/cron-editor-dialog.tsx`
- Test: `desktop/src/modules/task-scheduler/__tests__/cron-input.test.tsx`

- [ ] **Step 1: Create the compact dialog shell**

Create `desktop/src/modules/task-scheduler/components/cron-editor-dialog.tsx` with these imports and props:

```tsx
import { useEffect, useMemo, useState, type FormEvent } from "react"

import { FormDialog } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDateTime } from "@/lib/date-time"
import {
  buildCronExpression,
  createDefaultCronTemplateDraft,
  getCronEditorInitialTab,
  inferCronTemplate,
  listNextCronRuns,
  validateCronExpression,
  type CronEditorTab,
  type CronTemplateDraft,
  type CronTemplateKind,
} from "../cron-utils"
```

Props:

```ts
type CronEditorDialogProps = {
  open: boolean
  value: string
  onApply: (value: string) => void
  onOpenChange: (open: boolean) => void
}
```

- [ ] **Step 2: Implement draft state reset and submit behavior**

Use this state behavior:

```tsx
const matchedTemplate = inferCronTemplate(value)
const [draft, setDraft] = useState(value)
const [template, setTemplate] = useState<CronTemplateDraft>(
  matchedTemplate ?? createDefaultCronTemplateDraft(),
)
const [activeTab, setActiveTab] = useState<CronEditorTab>(() => getCronEditorInitialTab(value))

useEffect(() => {
  if (!open) return
  const nextTemplate = inferCronTemplate(value)
  setDraft(value)
  setTemplate(nextTemplate ?? createDefaultCronTemplateDraft())
  setActiveTab(getCronEditorInitialTab(value))
}, [open, value])

function handleSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault()
  const validation = validateCronExpression(draft)
  if (!validation.ok) return
  onApply(draft)
  onOpenChange(false)
}
```

- [ ] **Step 3: Implement common template updates**

Use a single helper so template changes always update the draft:

```tsx
function updateTemplate(patch: Partial<CronTemplateDraft>) {
  setTemplate((current) => {
    const next = { ...current, ...patch }
    setDraft(buildCronExpression(next))
    return next
  })
}
```

Render compact fields:

- Template kind: `Select`
- Every N minutes: `Input type="number" min={1} max={59}`
- Minute: `Input type="number" min={0} max={59}`
- Hour: `Input type="number" min={0} max={23}`
- Day of month: `Input type="number" min={1} max={31}`
- Weekday: `Select` with values `0` through `6`, labels `周日` through `周六`

- [ ] **Step 4: Implement advanced raw expression field and preview**

Compute validation and preview:

```tsx
const validation = validateCronExpression(draft)
const previewRuns = useMemo(() => {
  if (!validation.ok) return []
  return listNextCronRuns(draft, new Date(), 5)
}, [draft, validation.ok])
```

Render:

- In `高级`, an `Input` labeled `表达式`.
- Under the tabs, a compact preview section titled `未来 5 次`.
- If invalid, render `FieldError` with the validation message.
- Disable `应用` when invalid.

Use `formatDateTime(run.toISOString())` for preview rows.

- [ ] **Step 5: Keep the modal compact**

`FormDialog` call must include:

```tsx
contentClassName="sm:max-w-[560px]"
bodyClassName="overflow-y-auto"
```

Use one `FieldGroup` with `gap-2`, not a sidebar and not nested cards.

- [ ] **Step 6: Run component tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- src/modules/task-scheduler/__tests__/cron-input.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit component work**

```bash
git add desktop/src/modules/task-scheduler/components/cron-input.tsx desktop/src/modules/task-scheduler/components/cron-editor-dialog.tsx desktop/src/modules/task-scheduler/__tests__/cron-input.test.tsx
git commit -m "feat: add cron editor components"
```

## Task 6: Wire CronInput Into Task Form

**Files:**
- Modify: `desktop/src/modules/task-scheduler/components/task-form-dialog.tsx`
- Modify: `desktop/src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx`

- [ ] **Step 1: Update the task form import**

In `desktop/src/modules/task-scheduler/components/task-form-dialog.tsx`, add:

```ts
import { CronInput } from "./cron-input"
```

Keep existing `InputGroup` imports because the working-directory field still uses them.

- [ ] **Step 2: Replace only the Cron field body**

Replace the current Cron `Input` block:

```tsx
<Input
  id="task-form-cron"
  value={form.cronExpr}
  onChange={(event) => updateField("cronExpr", event.target.value)}
/>
```

with:

```tsx
<CronInput
  id="task-form-cron"
  value={form.cronExpr}
  disabled={busy}
  onChange={(value) => updateField("cronExpr", value)}
/>
```

- [ ] **Step 3: Add task form static assertion**

In `desktop/src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx`, add a test near the existing working-directory input-group test:

```ts
it("renders cron as an input group with an inline editor action", () => {
  const html = renderDialog()

  expect(html).toMatch(
    /<label[^>]*for="task-form-cron"[^>]*>Cron<\/label>[\s\S]*data-slot="input-group"[\s\S]*id="task-form-cron"[\s\S]*data-align="inline-end"[\s\S]*>编辑<\/button>/,
  )
})
```

- [ ] **Step 4: Run task scheduler renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- src/modules/task-scheduler/__tests__/cron-utils.test.ts src/modules/task-scheduler/__tests__/cron-input.test.tsx src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit task form integration**

```bash
git add desktop/src/modules/task-scheduler/components/task-form-dialog.tsx desktop/src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx
git commit -m "feat: wire cron editor into task form"
```

## Task 7: Verification

**Files:**
- No new source files unless verification exposes a defect in the files above.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- src/modules/task-scheduler/__tests__/cron-utils.test.ts src/modules/task-scheduler/__tests__/cron-input.test.tsx src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS. This change should not touch Electron runtime boundaries.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Inspect diff for UI rule violations**

Run:

```bash
git diff --check
rg -n "style=\\{|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|gradient|shadow-\\[|bg-\\[|text-\\[" desktop/src/modules/task-scheduler
```

Expected:

- `git diff --check` reports no whitespace errors.
- `rg` returns no matches introduced by this feature.

- [ ] **Step 5: Commit verification fixes if needed**

If verification required edits, commit only those edits:

```bash
git add desktop/src/modules/task-scheduler
git commit -m "fix: polish cron editor verification issues"
```

If no edits were needed, do not create an empty commit.
