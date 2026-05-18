# Provider Preset Picker Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the provider preset `Select` in the create Provider form with a dedicated searchable picker dialog.

**Architecture:** Keep `ProviderFormDialog` as the owner of form-changing state and reset-confirmation behavior. Add one module-local picker component that owns only search/category/A-Z filter UI state and calls back with a selected preset value. Reuse existing shadcn/Radix primitives and the existing preset-to-form helpers.

**Tech Stack:** Electron renderer, React, TypeScript, shadcn/Radix UI, Tailwind token classes, Vitest/jsdom.

---

## File Structure

- Create `desktop/src/modules/settings/components/provider-preset-picker-dialog.tsx`
  - Owns picker dialog UI, filtering helpers, grouping, row rendering, and external link button behavior.
  - Depends on `SynapseAgentProviderPreset`, `SynapseAgentProviderCategory`, and `PROVIDER_CATEGORIES` labels passed from the parent.
- Modify `desktop/src/modules/settings/components/provider-panel.tsx`
  - Imports the picker component.
  - Replaces the create-mode direct `Select` for `供应商预设` with a readonly trigger button.
  - Keeps `selectedPresetValue`, `handlePresetSelect`, `pendingPresetSelection`, `applyPresetSelection`, and `cancelPresetSelection` in place.
- Modify `desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx`
  - Updates old Select-based tests to open the picker.
  - Adds focused coverage for search/category/A-Z filtering, grouping, external-link non-selection, and edit-mode absence.

## Task 1: Update Provider Panel Tests For Picker Flow

**Files:**
- Modify: `desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx`

- [ ] **Step 1: Add richer preset fixtures**

Add these helper presets below `templatedPreset()` so filtering can be tested without relying on production preset data:

```ts
function claudePreset() {
  return {
    name: "Claude Official",
    category: "official",
    websiteUrl: "https://www.anthropic.com/claude-code",
    baseUrl: "",
    apiKeyField: "ANTHROPIC_API_KEY",
    model: "claude-sonnet-4-5",
    templateValues: [],
  } as const
}

function deepSeekPreset() {
  return {
    name: "DeepSeek",
    category: "cn_official",
    websiteUrl: "https://platform.deepseek.com",
    baseUrl: "https://api.deepseek.com/anthropic",
    apiKeyField: "ANTHROPIC_AUTH_TOKEN",
    model: "DeepSeek-V3.2",
    templateValues: [],
  } as const
}
```

- [ ] **Step 2: Add test helpers for the dialog trigger and inputs**

Add these helpers near the existing test helpers:

```ts
function inputByPlaceholder(placeholder: string): HTMLInputElement {
  const input = Array.from(document.body.querySelectorAll<HTMLInputElement>("input"))
    .find((candidate) => candidate.placeholder === placeholder)
  if (!input) throw new Error(`Input not found for placeholder: ${placeholder}`)
  return input
}

function buttonContainingText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(text))
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button containing text not found: ${text}`)
  }
  return button
}

function linkButtonByLabel(label: string): HTMLButtonElement {
  const button = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`Button not found for aria-label: ${label}`)
  return button
}
```

- [ ] **Step 3: Update preset application test to use the picker trigger**

In `applies a selected preset to the create form and saves through createProvider`, replace the old `clickByText(document.body, "自定义")` / `clickByText(document.body, "PackyCode")` sequence with:

```ts
await act(async () => {
  buttonContainingText(document.body, "自定义").click()
  await Promise.resolve()
})

expect(document.body.textContent).toContain("选择供应商预设")
expect(document.body.textContent).toContain("PackyCode")

await act(async () => {
  clickByText(document.body, "PackyCode")
  await Promise.resolve()
})
```

Expected failing result before implementation:

```bash
pnpm --filter @synapse/desktop test -- provider-panel.test.tsx
```

Expected: FAIL because `选择供应商预设` does not exist and the old shadcn Select content is gone from the test path.

- [ ] **Step 4: Update template-parameter and cancel tests to use the picker trigger**

In `updates preset-derived fields when template parameters change`, replace the old preset selection sequence with:

```ts
await act(async () => {
  buttonContainingText(document.body, "自定义").click()
  await Promise.resolve()
})
await act(async () => {
  clickByText(document.body, "KAT-Coder")
  await Promise.resolve()
})
```

In `leaves create form unchanged when preset reset confirmation is canceled`, replace the old preset selection sequence with:

```ts
await act(async () => {
  buttonContainingText(document.body, "自定义").click()
  await Promise.resolve()
})
await act(async () => {
  clickByText(document.body, "PackyCode")
  await Promise.resolve()
})
```

- [ ] **Step 5: Add filtering/grouping/external-link tests**

Add these tests inside `describe("ProviderPanel presets", () => { ... })`:

```ts
it("filters preset picker results by search, category, and initial", async () => {
  const listProviders = vi.fn().mockResolvedValue([])
  const listProviderPresets = vi.fn().mockResolvedValue([
    packyPreset(),
    claudePreset(),
    deepSeekPreset(),
  ])
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: {
      agent: {
        listProviders,
        listProviderPresets,
      },
    },
  })

  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<ProviderPanel />)
    await Promise.resolve()
    await Promise.resolve()
  })
  await act(async () => {
    buttonByText(container, "添加").click()
    await Promise.resolve()
    await Promise.resolve()
  })
  await act(async () => {
    buttonContainingText(document.body, "自定义").click()
    await Promise.resolve()
  })

  expect(document.body.textContent).toContain("官方")
  expect(document.body.textContent).toContain("国内官方")
  expect(document.body.textContent).toContain("第三方")

  await act(async () => {
    clickByText(document.body, "国内官方")
    await Promise.resolve()
  })
  expect(document.body.textContent).toContain("DeepSeek")
  expect(document.body.textContent).not.toContain("PackyCode")

  await act(async () => {
    clickByText(document.body, "全部")
    await Promise.resolve()
  })
  await act(async () => {
    clickByText(document.body, "P")
    await Promise.resolve()
  })
  expect(document.body.textContent).toContain("PackyCode")
  expect(document.body.textContent).not.toContain("Claude Official")

  await act(async () => {
    clickByText(document.body, "P")
    await Promise.resolve()
  })
  expect(document.body.textContent).toContain("Claude Official")

  await act(async () => {
    setInputValue(inputByPlaceholder("搜索名称、模型或地址"), "deepseek.com")
    inputByPlaceholder("搜索名称、模型或地址").dispatchEvent(new Event("input", { bubbles: true }))
  })
  expect(document.body.textContent).toContain("DeepSeek")
  expect(document.body.textContent).not.toContain("PackyCode")
})

it("does not select a preset when opening its external link", async () => {
  const open = vi.fn()
  vi.spyOn(window, "open").mockImplementation(open)
  const listProviders = vi.fn().mockResolvedValue([])
  const listProviderPresets = vi.fn().mockResolvedValue([packyPreset()])
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: {
      agent: {
        listProviders,
        listProviderPresets,
      },
    },
  })

  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<ProviderPanel />)
    await Promise.resolve()
    await Promise.resolve()
  })
  await act(async () => {
    buttonByText(container, "添加").click()
    await Promise.resolve()
    await Promise.resolve()
  })
  await act(async () => {
    buttonContainingText(document.body, "自定义").click()
    await Promise.resolve()
  })
  await act(async () => {
    linkButtonByLabel("打开 PackyCode 链接").click()
    await Promise.resolve()
  })

  expect(open).toHaveBeenCalledWith("https://www.packyapi.com/register?aff=cc-switch", "_blank", "noopener,noreferrer")
  expect(document.body.textContent).toContain("选择供应商预设")
  expect(document.body.textContent).not.toContain("重置表单")
})
```

- [ ] **Step 6: Run the focused test and confirm it fails for the expected reason**

Run:

```bash
pnpm --filter @synapse/desktop test -- provider-panel.test.tsx
```

Expected: FAIL with missing picker dialog text or missing controls. If it fails because of a syntax error in the test, fix the test before moving on.

- [ ] **Step 7: Commit the failing tests**

```bash
git add desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx
git commit -m "test: cover provider preset picker dialog"
```

## Task 2: Build ProviderPresetPickerDialog

**Files:**
- Create: `desktop/src/modules/settings/components/provider-preset-picker-dialog.tsx`

- [ ] **Step 1: Create the component file with filtering helpers**

Create `desktop/src/modules/settings/components/provider-preset-picker-dialog.tsx` with this structure:

```tsx
import { ExternalLinkIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import type {
  SynapseAgentProviderCategory,
  SynapseAgentProviderPreset,
} from "@/types/bridge"

type ProviderCategoryOption = {
  readonly value: SynapseAgentProviderCategory
  readonly label: string
}

type ProviderPresetOption = {
  readonly value: string
  readonly preset: SynapseAgentProviderPreset
}

type ProviderPresetPickerDialogProps = {
  readonly open: boolean
  readonly options: readonly ProviderPresetOption[]
  readonly categories: readonly ProviderCategoryOption[]
  readonly selectedValue: string
  readonly customValue: string
  readonly onOpenChange: (open: boolean) => void
  readonly onSelect: (value: string) => void
}

type ResultGroup = {
  readonly category: SynapseAgentProviderCategory
  readonly label: string
  readonly options: readonly ProviderPresetOption[]
}

const ALL_CATEGORIES = "all"

type CategoryFilter = SynapseAgentProviderCategory | typeof ALL_CATEGORIES

function ProviderPresetPickerDialog({
  open,
  options,
  categories,
  selectedValue,
  customValue,
  onOpenChange,
  onSelect,
}: ProviderPresetPickerDialogProps) {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<CategoryFilter>(ALL_CATEGORIES)
  const [initial, setInitial] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery("")
    setCategory(ALL_CATEGORIES)
    setInitial(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const categoryLabels = useMemo(() => new Map(categories.map((item) => [item.value, item.label])), [categories])
  const initials = useMemo(() => presetInitials(options), [options])
  const groups = useMemo(
    () => groupPresetOptions({
      options,
      category,
      initial,
      query,
      categoryLabels,
    }),
    [category, categoryLabels, initial, options, query],
  )

  const handleSelect = (value: string) => {
    onOpenChange(false)
    onSelect(value)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>选择供应商预设</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Input
            ref={inputRef}
            value={query}
            placeholder="搜索名称、模型或地址"
            onChange={(event) => setQuery(event.target.value)}
          />

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={category === ALL_CATEGORIES ? "secondary" : "outline"}
              size="sm"
              onClick={() => setCategory(ALL_CATEGORIES)}
            >
              全部
            </Button>
            {categories.map((item) => (
              <Button
                key={item.value}
                type="button"
                variant={category === item.value ? "secondary" : "outline"}
                size="sm"
                onClick={() => setCategory(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </div>

          {initials.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {initials.map((letter) => (
                <Button
                  key={letter}
                  type="button"
                  variant={initial === letter ? "secondary" : "ghost"}
                  size="xs"
                  onClick={() => setInitial((current) => current === letter ? null : letter)}
                >
                  {letter}
                </Button>
              ))}
            </div>
          ) : null}

          <Button
            type="button"
            variant={selectedValue === customValue ? "secondary" : "outline"}
            className="justify-start"
            onClick={() => handleSelect(customValue)}
          >
            自定义
          </Button>

          <ScrollArea className="h-80">
            <div className="flex flex-col gap-4 pr-3">
              {groups.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">没有匹配的预设</p>
              ) : groups.map((group) => (
                <section key={group.category} className="flex flex-col gap-2">
                  <div className="text-xs font-medium text-muted-foreground">{group.label}</div>
                  <div className="flex flex-col gap-1">
                    {group.options.map((option) => (
                      <ProviderPresetRow
                        key={option.value}
                        option={option}
                        categoryLabel={group.label}
                        selected={option.value === selectedValue}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Add the row component and pure helpers**

Append this code in the same file:

```tsx
function ProviderPresetRow({
  option,
  categoryLabel,
  selected,
  onSelect,
}: {
  readonly option: ProviderPresetOption
  readonly categoryLabel: string
  readonly selected: boolean
  readonly onSelect: (value: string) => void
}) {
  const detail = presetDetail(option.preset)
  const link = option.preset.apiKeyUrl ?? option.preset.websiteUrl

  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2 text-left hover:bg-muted"
      onClick={() => onSelect(option.value)}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{option.preset.name}</span>
        {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
      </span>
      <Badge variant={selected ? "secondary" : "outline"}>{categoryLabel}</Badge>
      {link ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`打开 ${option.preset.name} 链接`}
          onClick={(event) => {
            event.stopPropagation()
            window.open(link, "_blank", "noopener,noreferrer")
          }}
        >
          <ExternalLinkIcon />
        </Button>
      ) : null}
    </button>
  )
}

function groupPresetOptions({
  options,
  category,
  initial,
  query,
  categoryLabels,
}: {
  readonly options: readonly ProviderPresetOption[]
  readonly category: CategoryFilter
  readonly initial: string | null
  readonly query: string
  readonly categoryLabels: ReadonlyMap<SynapseAgentProviderCategory, string>
}): ResultGroup[] {
  const normalizedQuery = normalizeSearchText(query)
  const filtered = options
    .filter((option) => category === ALL_CATEGORIES || option.preset.category === category)
    .filter((option) => !initial || presetInitial(option.preset.name) === initial)
    .filter((option) => matchesPresetQuery(option.preset, normalizedQuery))
    .slice()
    .sort((left, right) => left.preset.name.localeCompare(right.preset.name))

  const byCategory = new Map<SynapseAgentProviderCategory, ProviderPresetOption[]>()
  for (const option of filtered) {
    const group = byCategory.get(option.preset.category) ?? []
    group.push(option)
    byCategory.set(option.preset.category, group)
  }

  return Array.from(byCategory.entries()).map(([groupCategory, groupOptions]) => ({
    category: groupCategory,
    label: categoryLabels.get(groupCategory) ?? groupCategory,
    options: groupOptions,
  }))
}

function presetInitials(options: readonly ProviderPresetOption[]): string[] {
  return Array.from(new Set(options.map((option) => presetInitial(option.preset.name)).filter(Boolean))).sort()
}

function presetInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase()
}

function matchesPresetQuery(preset: SynapseAgentProviderPreset, query: string): boolean {
  if (!query) return true
  return [
    preset.name,
    preset.model,
    preset.baseUrl,
    preset.websiteUrl,
  ].some((value) => normalizeSearchText(value ?? "").includes(query))
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase()
}

function presetDetail(preset: SynapseAgentProviderPreset): string {
  return preset.model ?? preset.baseUrl ?? domainFromUrl(preset.websiteUrl) ?? ""
}

function domainFromUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

export { ProviderPresetPickerDialog }
export type { ProviderPresetOption }
```

- [ ] **Step 3: Run the focused test and confirm remaining failures are integration-only**

Run:

```bash
pnpm --filter @synapse/desktop test -- provider-panel.test.tsx
```

Expected: FAIL because `ProviderPanel` does not yet import or render `ProviderPresetPickerDialog`.

- [ ] **Step 4: Commit the standalone picker**

```bash
git add desktop/src/modules/settings/components/provider-preset-picker-dialog.tsx
git commit -m "feat: add provider preset picker dialog"
```

## Task 3: Integrate Picker Into ProviderFormDialog

**Files:**
- Modify: `desktop/src/modules/settings/components/provider-panel.tsx`

- [ ] **Step 1: Update imports**

Remove these imports if they become unused:

```ts
Select,
SelectContent,
SelectGroup,
SelectItem,
SelectTrigger,
SelectValue,
```

Keep `Select` imports that are still needed by the type and key-field controls. Add:

```ts
import { ChevronDownIcon } from "lucide-react"
import { ProviderPresetPickerDialog, type ProviderPresetOption } from "./provider-preset-picker-dialog"
```

If `lucide-react` already has an import in this file after implementation, merge `ChevronDownIcon` into that import.

- [ ] **Step 2: Add picker dialog open state**

Inside `ProviderFormDialog`, next to the existing preset state:

```ts
const [presetPickerOpen, setPresetPickerOpen] = useState(false)
```

Reset it in the existing `useEffect`:

```ts
useEffect(() => {
  if (!open) {
    setSelectedPresetValue(CUSTOM_PROVIDER_PRESET_ID)
    setPendingPresetSelection(null)
    setTemplateValues({})
    setPresetPickerOpen(false)
  }
}, [open])
```

- [ ] **Step 3: Type preset options for the picker**

Change the existing `presetOptions` memo to include the exported type:

```ts
const presetOptions = useMemo<ProviderPresetOption[]>(
  () => presets.map((preset) => ({
    value: providerPresetSelectValue(preset),
    preset,
  })),
  [presets],
)
```

Add a selected label memo after `selectedPreset`:

```ts
const selectedPresetLabel = selectedPreset?.name ?? "自定义"
```

- [ ] **Step 4: Replace the create-mode preset Select with the trigger and picker**

Replace only the create-mode `供应商预设` field with:

```tsx
{mode === "create" ? (
  <Field>
    <FieldLabel>供应商预设</FieldLabel>
    <Button
      type="button"
      variant="outline"
      className="w-full justify-between"
      disabled={presetsLoading}
      onClick={() => setPresetPickerOpen(true)}
    >
      <span className="truncate">{selectedPresetLabel}</span>
      <ChevronDownIcon className="text-muted-foreground" />
    </Button>
    <ProviderPresetPickerDialog
      open={presetPickerOpen}
      options={presetOptions}
      categories={PROVIDER_CATEGORIES}
      selectedValue={selectedPresetValue}
      customValue={CUSTOM_PROVIDER_PRESET_ID}
      onOpenChange={setPresetPickerOpen}
      onSelect={handlePresetSelect}
    />
  </Field>
) : null}
```

Leave the existing category and API key field `Select` components untouched.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- provider-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run TypeScript check if focused tests pass**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the integration**

```bash
git add desktop/src/modules/settings/components/provider-panel.tsx
git commit -m "feat: use dialog for provider preset selection"
```

## Task 4: Final Verification And Cleanup

**Files:**
- Review: `desktop/src/modules/settings/components/provider-preset-picker-dialog.tsx`
- Review: `desktop/src/modules/settings/components/provider-panel.tsx`
- Review: `desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx`

- [ ] **Step 1: Scan for forbidden UI patterns**

Run:

```bash
rg -n "style=|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|bg-\\[|text-\\[|from-|to-|gradient|console\\.log" desktop/src/modules/settings/components/provider-preset-picker-dialog.tsx desktop/src/modules/settings/components/provider-panel.tsx
```

Expected: no matches for new code. If matches appear in untouched existing code, do not edit unrelated lines; mention them in the completion note.

- [ ] **Step 2: Run focused provider tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- provider-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Inspect diff scope**

Run:

```bash
git diff --stat HEAD~3..HEAD
git status --short
```

Expected: only these implementation files are changed by this task:

- `desktop/src/modules/settings/components/provider-preset-picker-dialog.tsx`
- `desktop/src/modules/settings/components/provider-panel.tsx`
- `desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx`

Existing unrelated dirty files under `desktop/src/modules/agent/` may still appear in `git status`; do not stage or modify them.

- [ ] **Step 5: Commit verification fixes if any were needed**

If Step 1 through Step 3 required small fixes, commit only those fixes:

```bash
git add desktop/src/modules/settings/components/provider-preset-picker-dialog.tsx desktop/src/modules/settings/components/provider-panel.tsx desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx
git commit -m "fix: polish provider preset picker dialog"
```

If no fixes were needed, skip this commit.

## Self-Review

- Spec coverage: the plan covers a dedicated dialog, search, category filters, A-Z filtering as filtering, grouped results, row selection, fixed `自定义`, external link non-selection, reset-confirmation reuse, restrained styling, and test coverage.
- Scope: the plan does not change provider save APIs, bridge APIs, Electron services, preset data, recently used presets, recommendations, or runtime behavior.
- Type consistency: `ProviderPresetOption`, `ProviderCategoryOption`, `CategoryFilter`, and `ResultGroup` are defined in the picker task before they are referenced by integration steps.
- Verification: focused Vitest, renderer typecheck, hard-constraint check, and forbidden-style scan are included.
