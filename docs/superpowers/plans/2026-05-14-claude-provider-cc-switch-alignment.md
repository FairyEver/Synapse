# Claude Provider cc-switch Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Synapse's Claude provider configuration with the core cc-switch provider experience while excluding unified providers, usage, speed testing, endpoint benchmarking, and model testing.

**Architecture:** Keep the existing provider service as the source of truth, extend the renderer/IPC bridge so provider `env` can round-trip, and replace the dialog-first settings experience with a hybrid inline editor. Presets remain defined in Electron service code and are exposed through the existing `listProviderPresets` bridge.

**Tech Stack:** Electron, React, TypeScript, shadcn/ui + Radix, Tailwind token utilities, Vitest.

---

## File Structure

- Modify `desktop/electron/services/provider/claude-provider-presets.ts`: align supported Claude presets with cc-switch values.
- Modify `desktop/electron/services/provider/types.ts`: expose `env` and `secretEnv` through create/update types that already exist at the service boundary.
- Modify `desktop/electron/modules/agent/ipc-tools.ts`: allow provider create/update IPC payloads to include `env`, `secretEnv`, and `clearSecretEnv`.
- Modify `desktop/src/types/bridge.ts`: mirror the bridge create/update/provider types so renderer code can send and receive config JSON env data.
- Modify `desktop/src/modules/settings/components/provider-panel.tsx`: keep provider management, replace dialog-first editing with an inline cc-switch-like editor for the selected Claude provider.
- Modify `desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx`: cover inline form behavior, JSON env saves, and invalid JSON.
- Modify `desktop/electron/services/provider/__tests__/provider-preset-adapter.test.ts`: cover aligned preset defaults.
- Modify `desktop/electron/services/provider/__tests__/provider-presets.test.ts`: cover supported preset visibility.

Before editing any modified file, inspect its current diff. The working tree may already contain user changes; preserve them.

## Task 1: Preset Parity

**Files:**
- Modify: `desktop/electron/services/provider/claude-provider-presets.ts`
- Test: `desktop/electron/services/provider/__tests__/provider-preset-adapter.test.ts`
- Test: `desktop/electron/services/provider/__tests__/provider-presets.test.ts`

- [ ] **Step 1: Write failing preset adapter tests**

Add tests for the cc-switch-aligned DeepSeek defaults and the two supported missing presets:

```ts
it("maps DeepSeek using cc-switch model defaults", () => {
  const preset = getClaudeProviderPreset("DeepSeek")
  if (!preset) throw new Error("DeepSeek preset missing")

  const input = buildProviderInputFromClaudePreset({
    preset,
    apiKey: "sk-deepseek",
    existingIds: new Set(),
  })

  expect(input.baseUrl).toBe("https://api.deepseek.com/anthropic")
  expect(input.model).toBe("deepseek-v4-pro")
  expect(input.haikuModel).toBe("deepseek-v4-flash")
  expect(input.sonnetModel).toBe("deepseek-v4-pro")
  expect(input.opusModel).toBe("deepseek-v4-pro")
})

it("maps Baidu Qianfan Coding Plan from cc-switch presets", () => {
  const preset = getClaudeProviderPreset("Baidu Qianfan Coding Plan")
  if (!preset) throw new Error("Baidu Qianfan Coding Plan preset missing")

  const input = buildProviderInputFromClaudePreset({
    preset,
    apiKey: "sk-qianfan",
    existingIds: new Set(),
  })

  expect(input).toEqual(expect.objectContaining({
    id: "baidu-qianfan-coding-plan",
    name: "Baidu Qianfan Coding Plan",
    category: "cn_official",
    baseUrl: "https://qianfan.baidubce.com/anthropic/coding",
    apiKeyField: "ANTHROPIC_AUTH_TOKEN",
    model: "qianfan-code-latest",
    haikuModel: "qianfan-code-latest",
    sonnetModel: "qianfan-code-latest",
    opusModel: "qianfan-code-latest",
  }))
})

it("maps Compshare Coding Plan from cc-switch presets", () => {
  const preset = getClaudeProviderPreset("Compshare Coding Plan")
  if (!preset) throw new Error("Compshare Coding Plan preset missing")

  const input = buildProviderInputFromClaudePreset({
    preset,
    apiKey: "sk-compshare-coding",
    existingIds: new Set(),
  })

  expect(input).toEqual(expect.objectContaining({
    id: "compshare-coding-plan",
    name: "Compshare Coding Plan",
    category: "aggregator",
    baseUrl: "https://cp.compshare.cn",
    apiKeyField: "ANTHROPIC_AUTH_TOKEN",
  }))
})
```

- [ ] **Step 2: Write failing supported preset visibility test**

In `provider-presets.test.ts`, add:

```ts
it("includes supported cc-switch Claude presets and hides unsupported OAuth presets", () => {
  const names = listClaudeProviderPresets().map((preset) => preset.name)

  expect(names).toEqual(expect.arrayContaining([
    "Baidu Qianfan Coding Plan",
    "Compshare Coding Plan",
    "DeepSeek",
  ]))
  expect(names).not.toContain("GitHub Copilot")
  expect(names).not.toContain("Codex")
})
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop run test -- provider-preset
```

Expected: tests fail because the new presets or updated DeepSeek values are not present.

- [ ] **Step 4: Update preset source**

In `claude-provider-presets.ts`:

```ts
{
  name: "DeepSeek",
  websiteUrl: "https://platform.deepseek.com",
  settingsConfig: {
    env: {
      ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
      ANTHROPIC_AUTH_TOKEN: "",
      ANTHROPIC_MODEL: "deepseek-v4-pro",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro",
    },
  },
  category: "cn_official",
  modelsUrl: "https://api.deepseek.com/models",
  icon: "deepseek",
  iconColor: "#1E88E5",
}
```

Add the two missing presets using cc-switch env defaults:

```ts
{
  name: "Baidu Qianfan Coding Plan",
  websiteUrl: "https://cloud.baidu.com/product/qianfan_modelbuilder",
  apiKeyUrl: "https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application",
  settingsConfig: {
    env: {
      ANTHROPIC_BASE_URL: "https://qianfan.baidubce.com/anthropic/coding",
      ANTHROPIC_AUTH_TOKEN: "",
      ANTHROPIC_MODEL: "qianfan-code-latest",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "qianfan-code-latest",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "qianfan-code-latest",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "qianfan-code-latest",
    },
  },
  category: "cn_official",
  endpointCandidates: ["https://qianfan.baidubce.com/anthropic/coding"],
  icon: "baidu",
  iconColor: "#2932E1",
}
```

```ts
{
  name: "Compshare Coding Plan",
  nameKey: "providerForm.presets.ucloudCoding",
  websiteUrl: "https://www.compshare.cn",
  apiKeyUrl: "https://www.compshare.cn/coding-plan?ytag=GPU_YY_YX_git_cc-switch",
  settingsConfig: {
    env: {
      ANTHROPIC_BASE_URL: "https://cp.compshare.cn",
      ANTHROPIC_AUTH_TOKEN: "",
    },
  },
  endpointCandidates: ["https://cp.compshare.cn"],
  category: "aggregator",
  isPartner: true,
  partnerPromotionKey: "ucloud",
  icon: "ucloud",
  iconColor: "#000000",
}
```

Also align Kimi For Coding:

```ts
websiteUrl: "https://www.kimi.com/code/docs/",
```

- [ ] **Step 5: Run preset tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- provider-preset
```

Expected: preset tests pass.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/provider/claude-provider-presets.ts \
  desktop/electron/services/provider/__tests__/provider-preset-adapter.test.ts \
  desktop/electron/services/provider/__tests__/provider-presets.test.ts
git commit -m "feat: align Claude provider presets with cc-switch"
```

## Task 2: Provider Config Env Round Trip

**Files:**
- Modify: `desktop/electron/modules/agent/ipc-tools.ts`
- Modify: `desktop/src/types/bridge.ts`
- Test: `desktop/electron/services/provider/__tests__/provider-service.test.ts`

- [ ] **Step 1: Add provider service coverage for updating extra env**

In `provider-service.test.ts`, add or adapt a test that creates a provider with extra env, updates it, and confirms `buildEnv` contains the values:

```ts
it("round-trips extra provider env through create and update", async () => {
  const service = createTestProviderService()

  await service.createProvider({
    id: "extra-env-provider",
    name: "Extra Env Provider",
    category: "custom",
    baseUrl: "https://api.example.com",
    apiKeyField: "ANTHROPIC_AUTH_TOKEN",
    apiKey: "sk-extra",
    env: {
      ENABLE_TOOL_SEARCH: "true",
    },
  })

  await service.updateProvider("extra-env-provider", {
    env: {
      ENABLE_TOOL_SEARCH: "false",
      CLAUDE_CODE_EFFORT_LEVEL: "max",
    },
  })

  const env = await service.buildEnv("extra-env-provider")

  expect(env.ENABLE_TOOL_SEARCH).toBe("false")
  expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe("max")
})
```

If the file uses a different helper name, reuse the existing in-file test setup instead of creating a new framework.

- [ ] **Step 2: Extend IPC schemas**

In `ipc-tools.ts`, change the create/update IPC input aliases so they no longer omit `env`:

```ts
type CreateProviderIpcInput = CreateProviderInput
type UpdateProviderIpcInput = UpdateProviderInput
```

Add schemas:

```ts
const providerEnvSchema = z.record(z.string(), z.string())

const createProviderInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: providerCategorySchema,
  baseUrl: z.string().optional(),
  apiKeyField: providerApiKeyFieldSchema,
  apiKey: z.string().optional(),
  active: z.boolean().optional(),
  model: z.string().optional(),
  haikuModel: z.string().optional(),
  sonnetModel: z.string().optional(),
  opusModel: z.string().optional(),
  env: providerEnvSchema.default({}),
  secretEnv: providerEnvSchema.optional(),
  sortIndex: z.number().optional(),
}) satisfies z.ZodType<CreateProviderIpcInput>
```

```ts
const updateProviderInputSchema = z.object({
  name: z.string().optional(),
  category: providerCategorySchema.optional(),
  baseUrl: z.string().optional(),
  apiKeyField: providerApiKeyFieldSchema.optional(),
  apiKey: z.string().optional(),
  active: z.boolean().optional(),
  model: z.string().optional(),
  haikuModel: z.string().optional(),
  sonnetModel: z.string().optional(),
  opusModel: z.string().optional(),
  env: providerEnvSchema.optional(),
  secretEnv: providerEnvSchema.optional(),
  clearSecretEnv: z.array(z.string()).optional(),
  archived: z.boolean().optional(),
  sortIndex: z.number().optional(),
}) satisfies z.ZodType<UpdateProviderIpcInput>
```

- [ ] **Step 3: Extend bridge types**

In `bridge.ts`, add env fields:

```ts
export type SynapseAgentProvider = {
  readonly id: string
  readonly name: string
  readonly category: SynapseAgentProviderCategory
  readonly source?: "local" | "user"
  readonly readonly?: boolean
  readonly configured?: boolean
  readonly configPath?: string
  readonly baseUrl?: string
  readonly apiKeyField: SynapseAgentProviderApiKeyField
  readonly active?: boolean
  readonly model?: string
  readonly haikuModel?: string
  readonly sonnetModel?: string
  readonly opusModel?: string
  readonly env?: Record<string, string>
  readonly archived?: boolean
  readonly sortIndex?: number
  readonly createdAt: string
  readonly updatedAt: string
}
```

```ts
export type SynapseCreateAgentProviderInput = {
  readonly id: string
  readonly name: string
  readonly category: SynapseAgentProviderCategory
  readonly baseUrl?: string
  readonly apiKeyField: SynapseAgentProviderApiKeyField
  readonly apiKey?: string
  readonly active?: boolean
  readonly model?: string
  readonly haikuModel?: string
  readonly sonnetModel?: string
  readonly opusModel?: string
  readonly env?: Record<string, string>
  readonly secretEnv?: Record<string, string>
  readonly sortIndex?: number
}
```

`SynapseUpdateAgentProviderInput` can remain based on `Partial<Omit<SynapseCreateAgentProviderInput, "id">>` and should add:

```ts
readonly clearSecretEnv?: readonly string[]
```

- [ ] **Step 4: Include provider env in public IPC response**

In `publicProvider(provider)`, add:

```ts
env: provider.env,
```

In `publicProviderSchema`, add:

```ts
env: providerEnvSchema.optional(),
```

- [ ] **Step 5: Run provider service and IPC tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- provider-service agent
```

Expected: tests pass, or failures point only to schema snapshots that need explicit update for `env`.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/modules/agent/ipc-tools.ts \
  desktop/src/types/bridge.ts \
  desktop/electron/services/provider/__tests__/provider-service.test.ts
git commit -m "feat: round-trip Claude provider env config"
```

## Task 3: Inline Editor State And JSON Helpers

**Files:**
- Modify: `desktop/src/modules/settings/components/provider-panel.tsx`
- Test: `desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx`

- [ ] **Step 1: Add renderer tests for JSON config saves**

Add tests that start from a provider with extra env and assert update payload includes it:

```tsx
it("saves extra env from provider config JSON", async () => {
  const listProviders = vi.fn().mockResolvedValue([customProvider({
    env: { ENABLE_TOOL_SEARCH: "true" },
  })])
  const updateProvider = vi.fn().mockResolvedValue(customProvider())
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: {
      agent: {
        listProviders,
        listProviderPresets: vi.fn().mockResolvedValue([]),
        updateProvider,
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

  const editor = textareaByLabel("配置 JSON")
  await act(async () => {
    setTextareaValue(editor, JSON.stringify({
      env: {
        ENABLE_TOOL_SEARCH: "false",
        CLAUDE_CODE_EFFORT_LEVEL: "max",
      },
      hooks: {},
      permissions: { allow: [], deny: [] },
    }, null, 2))
    editor.dispatchEvent(new Event("input", { bubbles: true }))
  })

  await act(async () => {
    buttonByText(document.body, "保存").click()
    await Promise.resolve()
    await Promise.resolve()
  })

  expect(updateProvider).toHaveBeenCalledWith({
    providerId: "custom-provider",
    patch: expect.objectContaining({
      env: {
        ENABLE_TOOL_SEARCH: "false",
        CLAUDE_CODE_EFFORT_LEVEL: "max",
      },
    }),
  })
})
```

Add helper functions:

```ts
function textareaByLabel(label: string): HTMLTextAreaElement {
  const textareas = Array.from(document.body.querySelectorAll<HTMLTextAreaElement>("textarea"))
  const match = textareas.find((candidate) => candidate.getAttribute("aria-label") === label)
  if (!match) throw new Error(`Textarea not found: ${label}`)
  return match
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
  if (!setter) throw new Error("Textarea value setter not found")
  setter.call(textarea, value)
}
```

- [ ] **Step 2: Add invalid JSON test**

```tsx
it("blocks save when provider config JSON is invalid", async () => {
  const listProviders = vi.fn().mockResolvedValue([customProvider()])
  const updateProvider = vi.fn()
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: {
      agent: {
        listProviders,
        listProviderPresets: vi.fn().mockResolvedValue([]),
        updateProvider,
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

  const editor = textareaByLabel("配置 JSON")
  await act(async () => {
    setTextareaValue(editor, "{")
    editor.dispatchEvent(new Event("input", { bubbles: true }))
  })

  await act(async () => {
    buttonByText(document.body, "保存").click()
    await Promise.resolve()
  })

  expect(updateProvider).not.toHaveBeenCalled()
  expect(toast).toHaveBeenCalledWith("配置 JSON 格式错误")
})
```

- [ ] **Step 3: Add config helper types in provider panel**

In `provider-panel.tsx`, extend form state:

```ts
type ProviderFormValues = {
  id: string
  name: string
  note: string
  websiteUrl: string
  category: SynapseAgentProviderCategory
  baseUrl: string
  apiKeyField: SynapseAgentProviderApiKeyField
  apiKey: string
  active: boolean
  model: string
  haikuModel: string
  sonnetModel: string
  opusModel: string
  sortIndex: string
  configJson: string
}
```

Add helpers near existing form builders:

```ts
type ProviderConfigJson = {
  readonly env?: Record<string, unknown>
  readonly hooks?: Record<string, unknown>
  readonly permissions?: Record<string, unknown>
}

function providerConfigJsonFromProvider(provider: SynapseAgentProvider): string {
  return JSON.stringify({
    env: provider.env ?? {},
    hooks: {},
    permissions: {
      allow: [],
      deny: [],
    },
  }, null, 2)
}

function providerConfigJsonFromValues(values: ProviderFormValues): {
  readonly env: Record<string, string>
} | null {
  let parsed: ProviderConfigJson
  try {
    parsed = JSON.parse(values.configJson || "{}") as ProviderConfigJson
  } catch {
    return null
  }
  return {
    env: stringifyEnvRecord(parsed.env),
  }
}

function stringifyEnvRecord(value: Record<string, unknown> | undefined): Record<string, string> {
  if (!value) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
      .map(([key, item]) => [key, String(item)]),
  )
}
```

- [ ] **Step 4: Wire create/update builders to JSON env**

Change `buildCreateInput` to accept parsed config:

```ts
function buildCreateInput(
  values: ProviderFormValues,
  config: { readonly env: Record<string, string> },
): SynapseCreateAgentProviderInput {
  return {
    id: values.id.trim(),
    name: values.name.trim(),
    category: values.category,
    baseUrl: optionalTrimmed(values.baseUrl),
    apiKeyField: values.apiKeyField,
    apiKey: optionalTrimmed(values.apiKey),
    active: values.active,
    model: optionalTrimmed(values.model),
    haikuModel: optionalTrimmed(values.haikuModel),
    sonnetModel: optionalTrimmed(values.sonnetModel),
    opusModel: optionalTrimmed(values.opusModel),
    env: config.env,
    sortIndex: optionalNumber(values.sortIndex),
  }
}
```

Apply the same `env: config.env` in `buildUpdateInput`.

- [ ] **Step 5: Parse before save**

In `handleSubmit`, before calling the bridge:

```ts
const config = providerConfigJsonFromValues(formValues)
if (!config) {
  toast("配置 JSON 格式错误")
  return
}
```

Pass `config` into `buildCreateInput` or `buildUpdateInput`.

- [ ] **Step 6: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- provider-panel
```

Expected: new JSON tests pass. Existing tests may fail because labels and layout are changing; fix only failures caused by intentional UI changes.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/modules/settings/components/provider-panel.tsx \
  desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx
git commit -m "feat: save Claude provider config JSON"
```

## Task 4: Hybrid Inline Claude Provider UI

**Files:**
- Modify: `desktop/src/modules/settings/components/provider-panel.tsx`
- Test: `desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx`

- [ ] **Step 1: Add inline editor expectations**

Update tests so they expect no add/edit dialog as the primary workflow. Add a test:

```tsx
it("renders a cc-switch-like inline editor for the selected provider", async () => {
  const listProviders = vi.fn().mockResolvedValue([customProvider()])
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: {
      agent: {
        listProviders,
        listProviderPresets: vi.fn().mockResolvedValue([packyPreset()]),
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

  expect(document.body.textContent).toContain("预设供应商")
  expect(document.body.textContent).toContain("自定义配置")
  expect(document.body.textContent).toContain("供应商名称")
  expect(document.body.textContent).toContain("官网链接")
  expect(document.body.textContent).toContain("API Key")
  expect(document.body.textContent).toContain("请求地址")
  expect(document.body.textContent).toContain("高级选项")
  expect(document.body.textContent).toContain("配置 JSON")
})
```

- [ ] **Step 2: Replace table-first view with selector plus editor**

Refactor `ProviderPanelView` to render:

```tsx
<Card>
  <CardHeader className="flex flex-row items-center justify-between gap-2">
    <CardTitle className="text-base">Claude 供应商</CardTitle>
    <Button type="button" size="sm" onClick={onAdd}>
      <Plus data-icon="inline-start" />
      新建
    </Button>
  </CardHeader>
  <CardContent className="flex flex-col gap-2">
    <ProviderSelector
      providers={visibleProviders}
      selectedProviderId={selectedProvider?.id}
      onSelect={setSelectedProviderId}
      onSetActive={onSetActive}
      onArchive={onArchive}
    />
    <ProviderInlineEditor
      mode={selectedProvider ? "edit" : "create"}
      provider={selectedProvider}
      presets={providerPresets}
      presetsLoading={providerPresetsLoading}
      providers={providers}
      values={formValues}
      saving={saving}
      onValuesChange={setFormValues}
      onSubmit={handleSubmit}
      onPresetPickerOpen={() => setPresetPickerOpen(true)}
    />
  </CardContent>
</Card>
```

Use existing `Button`, `Badge`, `Field`, `Input`, `Textarea`, `Collapsible`, `Select`, and `ScrollArea`. Keep class names token/layout based.

- [ ] **Step 3: Add preset chips inline**

Inside `ProviderInlineEditor`, render preset buttons:

```tsx
<Field>
  <FieldLabel>预设供应商</FieldLabel>
  <div className="flex flex-wrap gap-2">
    <Button
      type="button"
      variant={selectedPresetValue === CUSTOM_PROVIDER_PRESET_ID ? "default" : "secondary"}
      size="sm"
      onClick={() => handlePresetSelect(CUSTOM_PROVIDER_PRESET_ID)}
    >
      自定义配置
    </Button>
    {presetOptions.map((option) => (
      <Button
        key={option.value}
        type="button"
        variant={selectedPresetValue === option.value ? "default" : "secondary"}
        size="sm"
        onClick={() => handlePresetSelect(option.value)}
      >
        {option.preset.name}
      </Button>
    ))}
  </div>
</Field>
```

Do not copy cc-switch inline styles, hex colors, emoji hints, or gradient partner badges.

- [ ] **Step 4: Add core fields with screenshot order**

Render fields in this order:

```tsx
<div className="grid gap-2 sm:grid-cols-2">
  <Field>
    <FieldLabel htmlFor="provider-name">供应商名称</FieldLabel>
    <Input
      id="provider-name"
      value={values.name}
      placeholder="例如：Claude 官方"
      disabled={disabled}
      required
      onChange={(event) => setValue("name", event.target.value)}
    />
  </Field>
  <Field>
    <FieldLabel htmlFor="provider-note">备注</FieldLabel>
    <Input
      id="provider-note"
      value={values.note}
      placeholder="例如：公司专用账号"
      disabled={disabled}
      onChange={(event) => setValue("note", event.target.value)}
    />
  </Field>
</div>
<Field>
  <FieldLabel htmlFor="provider-website-url">官网链接</FieldLabel>
  <Input
    id="provider-website-url"
    value={values.websiteUrl}
    placeholder="https://example.com"
    disabled={disabled}
    onChange={(event) => setValue("websiteUrl", event.target.value)}
  />
</Field>
<Field>
  <FieldLabel htmlFor="provider-api-key">API Key</FieldLabel>
  <Input
    id="provider-api-key"
    type="password"
    autoComplete="off"
    value={values.apiKey}
    placeholder={mode === "edit" ? "保持不变" : undefined}
    disabled={disabled}
    onChange={(event) => setValue("apiKey", event.target.value)}
  />
</Field>
<Field>
  <FieldLabel htmlFor="provider-base-url">请求地址</FieldLabel>
  <Input
    id="provider-base-url"
    value={values.baseUrl}
    placeholder="https://your-api-endpoint.com"
    disabled={disabled}
    onChange={(event) => setValue("baseUrl", event.target.value)}
  />
</Field>
```

- [ ] **Step 5: Add advanced collapsible**

Use existing `Collapsible`:

```tsx
<Collapsible>
  <CollapsibleTrigger asChild>
    <Button type="button" variant="ghost" className="justify-start px-0">
      <ChevronRightIcon data-icon="inline-start" />
      高级选项
    </Button>
  </CollapsibleTrigger>
  <CollapsibleContent className="grid gap-2 sm:grid-cols-2">
    <Field>
      <FieldLabel htmlFor="provider-id">ID</FieldLabel>
      <Input
        id="provider-id"
        value={values.id}
        disabled={disabled || mode === "edit"}
        required
        onChange={(event) => setValue("id", event.target.value)}
      />
    </Field>
    <Field>
      <FieldLabel>Key 字段</FieldLabel>
      <Select
        value={values.apiKeyField}
        disabled={disabled}
        onValueChange={(value) => setValue("apiKeyField", value as SynapseAgentProviderApiKeyField)}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {API_KEY_FIELDS.map((field) => (
              <SelectItem key={field} value={field}>
                {field}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
    <Field>
      <FieldLabel htmlFor="provider-model">默认模型</FieldLabel>
      <Input
        id="provider-model"
        value={values.model}
        disabled={disabled}
        onChange={(event) => setValue("model", event.target.value)}
      />
    </Field>
  </CollapsibleContent>
</Collapsible>
```

Fields inside:

- API key field select
- provider id for create
- category select
- default model
- Haiku/Sonnet/Opus model
- sort index

- [ ] **Step 6: Add config JSON textarea**

Use shadcn `Textarea`:

```tsx
<Field>
  <FieldLabel htmlFor="provider-config-json">配置 JSON</FieldLabel>
  <Textarea
    id="provider-config-json"
    aria-label="配置 JSON"
    value={values.configJson}
    rows={14}
    spellCheck={false}
    onChange={(event) => setValue("configJson", event.target.value)}
  />
</Field>
```

- [ ] **Step 7: Keep readonly behavior**

If selected provider has `readonly`, render values and detail badges, but disable inputs and hide destructive save/delete actions:

```tsx
const disabled = Boolean(provider?.readonly || saving)
```

Apply `disabled={disabled}` to edit controls. Keep "设为默认" available only when allowed by current service behavior.

- [ ] **Step 8: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- provider-panel
```

Expected: provider panel tests pass.

- [ ] **Step 9: Commit**

```bash
git add desktop/src/modules/settings/components/provider-panel.tsx \
  desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx
git commit -m "feat: add inline Claude provider editor"
```

## Task 5: Final Verification

**Files:**
- No planned source changes unless verification exposes a task-related bug.

- [ ] **Step 1: Run targeted provider tests**

```bash
pnpm --filter @synapse/desktop run test -- provider
```

Expected: all provider-related tests pass.

- [ ] **Step 2: Run hard constraints**

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: pass.

- [ ] **Step 3: Inspect final diff**

```bash
git diff --stat
git diff -- desktop/electron/services/provider/claude-provider-presets.ts \
  desktop/electron/modules/agent/ipc-tools.ts \
  desktop/src/types/bridge.ts \
  desktop/src/modules/settings/components/provider-panel.tsx
```

Expected: diff is limited to cc-switch Claude provider alignment and env/config UI plumbing.

- [ ] **Step 4: Final commit if needed**

If verification fixes were made:

```bash
git add <changed-task-files>
git commit -m "fix: stabilize Claude provider alignment"
```

If no fixes were made, do not create an empty commit.

## Self-Review

- Spec coverage: preset alignment is Task 1, env round-trip is Task 2, JSON save behavior is Task 3, hybrid inline UI is Task 4, verification is Task 5.
- Placeholder scan: no unresolved plan markers or ellipsis snippets are present.
- Type consistency: renderer uses `SynapseCreateAgentProviderInput` and `SynapseUpdateAgentProviderInput`; IPC uses `CreateProviderInput` and `UpdateProviderInput`; service already owns `env` and `secretEnv`.
