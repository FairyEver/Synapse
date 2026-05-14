# Provider Preset Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move provider presets into the Add Provider form as a dropdown that confirms before resetting the form and filling provider defaults.

**Architecture:** Keep the change local to the existing Settings provider panel. Replace the old preset-only dialog path with create-form state and module-local pure helpers for preset mapping, template substitution, and ID generation. The Electron/service layer remains unchanged.

**Tech Stack:** Electron bridge, React, TypeScript, shadcn/Radix UI, Vitest/jsdom.

---

## File Structure

- Modify `desktop/src/modules/settings/components/provider-panel.tsx`
  - Remove the old `ProviderPresetDialog` and `handleCreateFromPreset` UI path.
  - Load presets for create mode through `listProviderPresets()`.
  - Extend `ProviderFormDialog` with a create-only preset dropdown, confirmation dialog, template parameter inputs, and module-local helper functions.
- Modify `desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx`
  - Replace the old direct preset-create test.
  - Add create/edit visibility, confirm/cancel, create path, and template parameter tests.

No new shared component, dependency, service, IPC channel, or backend mutation is required.

## Task 1: Replace The Old Preset Creation Test With Create-Form Expectations

**Files:**
- Modify: `desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx`

- [ ] **Step 1: Add test helpers for provider presets and text inputs**

Add these helpers near the existing `customProvider`, `buttonByText`, and `setInputValue` helpers:

```ts
function packyPreset() {
  return {
    name: "PackyCode",
    category: "third_party",
    websiteUrl: "https://www.packyapi.com",
    apiKeyUrl: "https://www.packyapi.com/register?aff=cc-switch",
    baseUrl: "https://www.packyapi.com",
    apiKeyField: "ANTHROPIC_AUTH_TOKEN",
    model: "claude-sonnet-4-5",
    haikuModel: "claude-haiku-4-5",
    sonnetModel: "claude-sonnet-4-5",
    opusModel: "claude-opus-4-5",
    templateValues: [],
  } as const
}

function templatedPreset() {
  return {
    name: "KAT-Coder",
    category: "third_party",
    baseUrl: "https://api.example.com/${ENDPOINT_ID}",
    apiKeyField: "ANTHROPIC_AUTH_TOKEN",
    model: "claude-sonnet-4-5",
    templateValues: [{
      key: "ENDPOINT_ID",
      label: "Endpoint ID",
      placeholder: "endpoint-id",
      defaultValue: "default-endpoint",
      sensitive: false,
    }],
  } as const
}

function inputById(id: string): HTMLInputElement {
  const input = document.body.querySelector<HTMLInputElement>(`#${id}`)
  if (!input) throw new Error(`Input not found: ${id}`)
  return input
}
```

- [ ] **Step 2: Replace the old preset dialog test with a failing create-form preset test**

Delete the old `opens provider presets and creates from a selected preset` test body and replace it with:

```ts
it("applies a selected preset to the create form and saves through createProvider", async () => {
  const listProviders = vi.fn().mockResolvedValue([])
  const listProviderPresets = vi.fn().mockResolvedValue([packyPreset()])
  const createProvider = vi.fn().mockResolvedValue(customProvider())
  const createProviderFromPreset = vi.fn()
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: {
      agent: {
        listProviders,
        listProviderPresets,
        createProvider,
        createProviderFromPreset,
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

  expect(listProviderPresets).toHaveBeenCalled()
  expect(document.body.textContent).toContain("供应商预设")
  expect(document.body.textContent).not.toContain("从预设添加")

  await act(async () => {
    buttonByText(document.body, "自定义").click()
    await Promise.resolve()
  })
  await act(async () => {
    buttonByText(document.body, "PackyCode").click()
    await Promise.resolve()
  })

  expect(document.body.textContent).toContain("重置表单")

  await act(async () => {
    buttonByText(document.body, "确认").click()
    await Promise.resolve()
  })

  expect(inputById("provider-id").value).toBe("packycode")
  expect(inputById("provider-name").value).toBe("PackyCode")
  expect(inputById("provider-base-url").value).toBe("https://www.packyapi.com")
  expect(inputById("provider-model").value).toBe("claude-sonnet-4-5")

  await act(async () => {
    setInputValue(inputById("provider-api-key"), "sk-packy")
    inputById("provider-api-key").dispatchEvent(new Event("input", { bubbles: true }))
  })

  await act(async () => {
    buttonByText(document.body, "保存").click()
    await Promise.resolve()
    await Promise.resolve()
  })

  expect(createProvider).toHaveBeenCalledWith({
    provider: expect.objectContaining({
      id: "packycode",
      name: "PackyCode",
      category: "third_party",
      baseUrl: "https://www.packyapi.com",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      apiKey: "sk-packy",
      model: "claude-sonnet-4-5",
      haikuModel: "claude-haiku-4-5",
      sonnetModel: "claude-sonnet-4-5",
      opusModel: "claude-opus-4-5",
    }),
  })
  expect(createProviderFromPreset).not.toHaveBeenCalled()
  expect(toast).toHaveBeenCalledWith("Provider 已保存")
})
```

- [ ] **Step 3: Run the targeted test and verify it fails for the current behavior**

Run:

```bash
pnpm --filter @synapse/desktop test -- provider-panel
```

Expected result: FAIL because the current UI still has `从预设添加`, opens `ProviderPresetDialog`, and calls `createProviderFromPreset`.

## Task 2: Load Presets In The Provider Panel And Remove The Old Dialog Path

**Files:**
- Modify: `desktop/src/modules/settings/components/provider-panel.tsx`

- [ ] **Step 1: Update imports**

Replace the current icon import and add alert dialog imports:

```ts
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Plus } from "lucide-react"
```

Add:

```ts
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
```

Remove `Search` from the lucide import after `ProviderPresetDialog` is deleted.

- [ ] **Step 2: Replace preset dialog state with preset list state**

In `ProviderPanel`, remove:

```ts
const [presetDialogOpen, setPresetDialogOpen] = useState(false)
```

Add:

```ts
const [providerPresets, setProviderPresets] = useState<SynapseAgentProviderPreset[]>([])
const [providerPresetsLoading, setProviderPresetsLoading] = useState(false)
const providerPresetsLoadedRef = useRef(false)
```

- [ ] **Step 3: Add a guarded preset loader**

Add this callback inside `ProviderPanel`:

```ts
const loadProviderPresets = useCallback(async () => {
  if (providerPresetsLoadedRef.current || providerPresetsLoading) return
  setProviderPresetsLoading(true)
  try {
    const nextPresets = await requireSynapseBridge().agent.listProviderPresets()
    setProviderPresets(nextPresets)
    providerPresetsLoadedRef.current = true
  } catch (rawError) {
    logger.error("Provider presets list failed.", {
      boundary: "settings.providers.preset.list",
      action: "listProviderPresets",
      ...providerErrorDiagnostic(rawError),
    })
    toast("读取预设失败")
  } finally {
    setProviderPresetsLoading(false)
  }
}, [providerPresetsLoading])
```

- [ ] **Step 4: Load presets when opening create mode**

Replace `openAddDialog` with:

```ts
const openAddDialog = useCallback(() => {
  setEditingProvider(null)
  setFormValues(emptyProviderForm())
  setFormOpen(true)
  void loadProviderPresets()
}, [loadProviderPresets])
```

Delete `openPresetDialog`.

- [ ] **Step 5: Remove direct preset creation handler and dialog render**

Delete `handleCreateFromPreset`.

In the JSX:

- Remove `onAddPreset={openPresetDialog}` from `ProviderPanelView`.
- Remove the `<ProviderPresetDialog ... />` block.
- Pass these props to `ProviderFormDialog`:

```tsx
providers={providers}
presets={providerPresets}
presetsLoading={providerPresetsLoading}
```

- [ ] **Step 6: Update ProviderPanelView props and actions**

Remove `onAddPreset` from `ProviderPanelViewProps` and `ProviderPanelView`.

Replace the card header action area with only:

```tsx
<Button type="button" size="sm" onClick={onAdd}>
  <Plus data-icon="inline-start" />
  添加
</Button>
```

- [ ] **Step 7: Delete `ProviderPresetDialog`**

Remove the entire `ProviderPresetDialog` function.

- [ ] **Step 8: Run the targeted test**

Run:

```bash
pnpm --filter @synapse/desktop test -- provider-panel
```

Expected result: tests still fail because the create form has not yet rendered or applied the preset dropdown.

## Task 3: Add Create-Only Preset Selection To ProviderFormDialog

**Files:**
- Modify: `desktop/src/modules/settings/components/provider-panel.tsx`

- [ ] **Step 1: Add constants and types**

Near the existing constants, add:

```ts
const CUSTOM_PROVIDER_PRESET_ID = "custom"

type PendingPresetSelection = {
  readonly value: string
  readonly preset: SynapseAgentProviderPreset | null
}
```

- [ ] **Step 2: Extend ProviderFormDialog props**

Add these props:

```ts
readonly providers: SynapseAgentProvider[]
readonly presets: SynapseAgentProviderPreset[]
readonly presetsLoading: boolean
```

Update the call site from Task 2 to satisfy the new props.

- [ ] **Step 3: Add create-form preset state**

Inside `ProviderFormDialog`, add:

```ts
const [selectedPresetValue, setSelectedPresetValue] = useState(CUSTOM_PROVIDER_PRESET_ID)
const [pendingPresetSelection, setPendingPresetSelection] = useState<PendingPresetSelection | null>(null)
const [templateValues, setTemplateValues] = useState<Record<string, string>>({})

useEffect(() => {
  if (!open) {
    setSelectedPresetValue(CUSTOM_PROVIDER_PRESET_ID)
    setPendingPresetSelection(null)
    setTemplateValues({})
  }
}, [open])
```

- [ ] **Step 4: Add dropdown selection handlers**

Inside `ProviderFormDialog`, add:

```ts
const existingProviderIds = useMemo(
  () => new Set(providers.map((provider) => provider.id)),
  [providers],
)

const presetOptions = useMemo(
  () => presets.map((preset) => ({
    value: providerPresetSelectValue(preset),
    preset,
  })),
  [presets],
)

const handlePresetSelect = (value: string) => {
  if (value === selectedPresetValue) return
  const preset = presetOptions.find((option) => option.value === value)?.preset ?? null
  setPendingPresetSelection({ value, preset })
}

const applyPresetSelection = () => {
  if (!pendingPresetSelection) return
  setSelectedPresetValue(pendingPresetSelection.value)
  if (!pendingPresetSelection.preset) {
    setTemplateValues({})
    onValuesChange(emptyProviderForm())
    setPendingPresetSelection(null)
    return
  }
  const defaults = templateDefaultsFromPreset(pendingPresetSelection.preset)
  setTemplateValues(defaults)
  onValuesChange(formFromPreset(pendingPresetSelection.preset, existingProviderIds, defaults))
  setPendingPresetSelection(null)
}

const cancelPresetSelection = () => {
  setPendingPresetSelection(null)
}
```

- [ ] **Step 5: Render the create-only preset dropdown**

At the top of `FieldGroup`, before the ID/name row, add:

```tsx
{mode === "create" ? (
  <Field>
    <FieldLabel>供应商预设</FieldLabel>
    <Select
      value={selectedPresetValue}
      onValueChange={handlePresetSelect}
      disabled={presetsLoading}
    >
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={CUSTOM_PROVIDER_PRESET_ID}>自定义</SelectItem>
          {presetOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.preset.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  </Field>
) : null}
```

- [ ] **Step 6: Render the reset confirmation dialog**

Inside the `DialogContent`, after the closing `</form>` or as a sibling to the main form inside the root fragment, add:

```tsx
<AlertDialog open={Boolean(pendingPresetSelection)} onOpenChange={(nextOpen) => {
  if (!nextOpen) cancelPresetSelection()
}}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>重置表单</AlertDialogTitle>
      <AlertDialogDescription>
        当前表单将被重置，并填入供应商默认值。
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel onClick={cancelPresetSelection}>取消</AlertDialogCancel>
      <AlertDialogAction onClick={applyPresetSelection}>确认</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 7: Run the targeted test**

Run:

```bash
pnpm --filter @synapse/desktop test -- provider-panel
```

Expected result: the create-form test advances further and may fail on missing helper functions or template behavior.

## Task 4: Add Preset Mapping And Template Helpers

**Files:**
- Modify: `desktop/src/modules/settings/components/provider-panel.tsx`

- [ ] **Step 1: Add select-value and ID helpers**

Near the existing helper functions, add:

```ts
function providerPresetSelectValue(preset: SynapseAgentProviderPreset): string {
  return `preset:${preset.name}`
}

function providerIdFromPresetName(name: string, existingIds: ReadonlySet<string>): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "provider"
  if (!existingIds.has(base)) return base
  let suffix = 2
  while (existingIds.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}
```

- [ ] **Step 2: Add template application helpers**

Add:

```ts
function applyTemplateValues(value: string | undefined, values: Record<string, string>): string | undefined {
  if (!value) return value
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, key: string) => values[key] ?? "")
}

function formFromPreset(
  preset: SynapseAgentProviderPreset,
  existingIds: ReadonlySet<string>,
  templateValues: Record<string, string>,
): ProviderFormValues {
  return {
    ...emptyProviderForm(),
    id: providerIdFromPresetName(preset.name, existingIds),
    name: preset.name,
    category: preset.category,
    baseUrl: applyTemplateValues(preset.baseUrl, templateValues) ?? "",
    apiKeyField: preset.apiKeyField,
    model: applyTemplateValues(preset.model, templateValues) ?? "",
    haikuModel: applyTemplateValues(preset.haikuModel, templateValues) ?? "",
    sonnetModel: applyTemplateValues(preset.sonnetModel, templateValues) ?? "",
    opusModel: applyTemplateValues(preset.opusModel, templateValues) ?? "",
  }
}
```

- [ ] **Step 3: Reuse the existing `templateDefaultsFromPreset` helper**

Keep the existing `templateDefaultsFromPreset` function. It already returns default template values and should be reused by `applyPresetSelection`.

- [ ] **Step 4: Run the targeted test**

Run:

```bash
pnpm --filter @synapse/desktop test -- provider-panel
```

Expected result: the main create-form preset test should pass or fail only on Radix interaction details that need test helper adjustment.

## Task 5: Add Template Parameter Rendering And Update Behavior

**Files:**
- Modify: `desktop/src/modules/settings/components/provider-panel.tsx`
- Modify: `desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx`

- [ ] **Step 1: Add selected preset lookup and template edit handler**

Inside `ProviderFormDialog`, add:

```ts
const selectedPreset = useMemo(() => {
  if (selectedPresetValue === CUSTOM_PROVIDER_PRESET_ID) return null
  return presetOptions.find((option) => option.value === selectedPresetValue)?.preset ?? null
}, [presetOptions, selectedPresetValue])

const updateTemplateValue = (key: string, value: string) => {
  if (!selectedPreset) return
  const nextValues = {
    ...templateValues,
    [key]: value,
  }
  setTemplateValues(nextValues)
  onValuesChange(formFromPreset(selectedPreset, existingProviderIds, nextValues))
}
```

- [ ] **Step 2: Render template parameter fields**

After the API Key field and before model fields, add:

```tsx
{mode === "create" && selectedPreset && selectedPreset.templateValues.length > 0 ? (
  <div className="grid gap-4 sm:grid-cols-2">
    {selectedPreset.templateValues.map((item) => (
      <Field key={item.key}>
        <FieldLabel htmlFor={`provider-template-${item.key}`}>{item.label}</FieldLabel>
        <Input
          id={`provider-template-${item.key}`}
          type={item.sensitive ? "password" : "text"}
          value={templateValues[item.key] ?? item.defaultValue ?? ""}
          placeholder={item.placeholder}
          onChange={(event) => updateTemplateValue(item.key, event.target.value)}
        />
      </Field>
    ))}
  </div>
) : null}
```

- [ ] **Step 3: Add a template-parameter test**

Add this test under `describe("ProviderPanel presets", ...)`:

```ts
it("updates preset-derived fields when template parameters change", async () => {
  const listProviders = vi.fn().mockResolvedValue([])
  const listProviderPresets = vi.fn().mockResolvedValue([templatedPreset()])
  const createProvider = vi.fn().mockResolvedValue(customProvider())
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: {
      agent: {
        listProviders,
        listProviderPresets,
        createProvider,
        createProviderFromPreset: vi.fn(),
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
    buttonByText(document.body, "自定义").click()
    await Promise.resolve()
  })
  await act(async () => {
    buttonByText(document.body, "KAT-Coder").click()
    await Promise.resolve()
  })
  await act(async () => {
    buttonByText(document.body, "确认").click()
    await Promise.resolve()
  })

  expect(inputById("provider-base-url").value).toBe("https://api.example.com/default-endpoint")

  await act(async () => {
    setInputValue(inputById("provider-template-ENDPOINT_ID"), "custom-endpoint")
    inputById("provider-template-ENDPOINT_ID").dispatchEvent(new Event("input", { bubbles: true }))
  })

  expect(inputById("provider-base-url").value).toBe("https://api.example.com/custom-endpoint")
})
```

- [ ] **Step 4: Run the targeted test**

Run:

```bash
pnpm --filter @synapse/desktop test -- provider-panel
```

Expected result: PASS for provider-panel tests.

## Task 6: Cover Edit Mode And Cancel Behavior

**Files:**
- Modify: `desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx`

- [ ] **Step 1: Add edit-mode visibility test**

Add:

```ts
it("does not show provider preset selection while editing", async () => {
  const listProviders = vi.fn().mockResolvedValue([customProvider()])
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
    buttonByText(container, "编辑").click()
    await Promise.resolve()
  })

  expect(document.body.textContent).toContain("编辑 Provider")
  expect(document.body.textContent).not.toContain("供应商预设")
})
```

- [ ] **Step 2: Add cancel-confirmation test**

Add:

```ts
it("leaves create form unchanged when preset reset confirmation is canceled", async () => {
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
    setInputValue(inputById("provider-id"), "manual-provider")
    inputById("provider-id").dispatchEvent(new Event("input", { bubbles: true }))
  })
  await act(async () => {
    buttonByText(document.body, "自定义").click()
    await Promise.resolve()
  })
  await act(async () => {
    buttonByText(document.body, "PackyCode").click()
    await Promise.resolve()
  })
  await act(async () => {
    buttonByText(document.body, "取消").click()
    await Promise.resolve()
  })

  expect(inputById("provider-id").value).toBe("manual-provider")
  expect(inputById("provider-name").value).toBe("")
})
```

- [ ] **Step 3: Run the targeted test**

Run:

```bash
pnpm --filter @synapse/desktop test -- provider-panel
```

Expected result: PASS.

## Task 7: Run Hard Constraint Verification And Review Diff

**Files:**
- Verify only.

- [ ] **Step 1: Run provider-panel tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- provider-panel
```

Expected result: PASS.

- [ ] **Step 2: Run hard-constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected result: PASS.

- [ ] **Step 3: Review the final diff**

Run:

```bash
git diff -- desktop/src/modules/settings/components/provider-panel.tsx desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx
```

Expected result:

- No independent `从预设添加` button.
- No `ProviderPresetDialog`.
- No `createProviderFromPreset` call from `provider-panel.tsx`.
- Preset dropdown appears only in create mode.
- Confirmation dialog copy is short.
- Existing unrelated files are not modified.

- [ ] **Step 4: Commit implementation**

Stage only the implementation files:

```bash
git add desktop/src/modules/settings/components/provider-panel.tsx desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx
git commit -m "feat: apply provider presets in create form"
```

Expected result: commit succeeds without staging unrelated existing changes.
