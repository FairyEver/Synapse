# Claude Provider Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cc-switch's Claude provider preset catalog to Synapse through copied source data and a Synapse adapter, excluding OAuth/proxy-only presets.

**Architecture:** Keep provider runtime on the existing `ProviderService` path. Add copied preset source data, a focused adapter, encrypted secret-env support for sensitive template values, IPC methods for preset listing/creation, and a restrained preset picker in the existing settings Provider panel.

**Tech Stack:** Electron main process, TypeScript, DataRepository JSON/encrypted-json namespaces, Zod IPC schemas, React, shadcn/ui, Vitest.

---

## File Structure

- Create `desktop/electron/services/provider/claude-provider-presets.ts`
  - Owns copied cc-switch Claude preset source data and support filtering.
- Create `desktop/electron/services/provider/provider-preset-adapter.ts`
  - Converts a supported Claude preset plus user input into `CreateProviderInput`.
- Modify `desktop/electron/services/provider/provider-secret-store.ts`
  - Adds encrypted secret storage helpers for sensitive environment variables.
- Modify `desktop/electron/services/provider/types.ts`
  - Adds preset public types and `secretEnvRefs` to provider types.
- Modify `desktop/electron/services/provider/provider-service.ts`
  - Adds preset listing/creation and resolves secret env refs in `buildEnv()`.
- Modify `desktop/electron/runtime/data-repo/schemas/placeholders.ts`
  - Allows `secretEnvRefs` on provider records.
- Modify `desktop/electron/services/provider/index.ts`
  - Exports preset APIs/types.
- Modify `desktop/electron/modules/agent/ipc-tools.ts`
  - Adds `listProviderPresets` and `createProviderFromPreset` IPC methods.
- Modify `desktop/src/types/bridge.ts`
  - Adds renderer bridge types for preset APIs.
- Modify `desktop/src/modules/settings/components/provider-panel.tsx`
  - Adds a shadcn preset picker dialog and creation flow.
- Modify tests under:
  - `desktop/electron/services/provider/__tests__/provider-presets.test.ts`
  - `desktop/electron/services/provider/__tests__/provider-preset-adapter.test.ts`
  - `desktop/electron/services/provider/__tests__/provider-service.test.ts`
  - `desktop/electron/modules/agent/__tests__/ipc.test.ts`
  - `desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx`

## Task 1: Preset Source Data And Filtering

**Files:**
- Create: `desktop/electron/services/provider/claude-provider-presets.ts`
- Test: `desktop/electron/services/provider/__tests__/provider-presets.test.ts`

- [x] **Step 1: Write the failing preset filter test**

Create `desktop/electron/services/provider/__tests__/provider-presets.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  getClaudeProviderPreset,
  isClaudeProviderPresetSupported,
  listClaudeProviderPresets,
} from "../claude-provider-presets"

describe("Claude provider presets", () => {
  it("lists supported copied Claude presets without OAuth or proxy-conversion presets", () => {
    const presets = listClaudeProviderPresets()
    const names = presets.map((preset) => preset.name)

    expect(names).toContain("Claude Official")
    expect(names).toContain("PackyCode")
    expect(names).toContain("AWS Bedrock (AKSK)")
    expect(names).not.toContain("GitHub Copilot")
    expect(names).not.toContain("Codex")
    expect(names).not.toContain("Gemini Native")
    expect(names).not.toContain("Nvidia")
  })

  it("keeps useful source metadata for supported presets", () => {
    const preset = getClaudeProviderPreset("KAT-Coder")

    expect(preset).toEqual(expect.objectContaining({
      name: "KAT-Coder",
      websiteUrl: "https://console.streamlake.ai",
      apiKeyUrl: "https://console.streamlake.ai/console/api-key",
      category: "cn_official",
    }))
    expect(preset?.templateValues?.ENDPOINT_ID).toEqual(expect.objectContaining({
      label: "Vanchin Endpoint ID",
    }))
  })

  it("reports unsupported presets explicitly", () => {
    expect(isClaudeProviderPresetSupported({
      name: "GitHub Copilot",
      websiteUrl: "https://github.com/features/copilot",
      settingsConfig: { env: {} },
      category: "third_party",
      providerType: "github_copilot",
      requiresOAuth: true,
    })).toBe(false)
    expect(isClaudeProviderPresetSupported({
      name: "Nvidia",
      websiteUrl: "https://build.nvidia.com",
      settingsConfig: { env: {} },
      category: "aggregator",
      apiFormat: "openai_chat",
    })).toBe(false)
    expect(isClaudeProviderPresetSupported({
      name: "PackyCode",
      websiteUrl: "https://www.packyapi.com",
      settingsConfig: { env: { ANTHROPIC_BASE_URL: "https://www.packyapi.com" } },
      category: "third_party",
    })).toBe(true)
  })
})
```

- [x] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/provider/__tests__/provider-presets.test.ts
```

Expected: FAIL because `claude-provider-presets.ts` does not exist.

- [x] **Step 3: Create the copied preset source module**

Create `desktop/electron/services/provider/claude-provider-presets.ts`.

Start by copying `/Users/liyang/Desktop/code-guide/cc-switch-main/src/config/claudeProviderPresets.ts` into this file, then apply these exact local edits:

```ts
import type { ProviderCategory } from "./types"
```

Remove this original cc-switch import:

```ts
import { ProviderCategory } from "../types";
```

Keep the cc-switch interfaces and `providerPresets` array in the copied file. At the end of the file, add:

```ts
const UNSUPPORTED_PROVIDER_TYPES = new Set(["github_copilot", "codex_oauth"])

export function isClaudeProviderPresetSupported(preset: ProviderPreset): boolean {
  if (preset.hidden) return false
  if (preset.requiresOAuth) return false
  if (preset.providerType && UNSUPPORTED_PROVIDER_TYPES.has(preset.providerType)) return false
  if (preset.apiFormat && preset.apiFormat !== "anthropic") return false
  return true
}

export function listClaudeProviderPresets(): readonly ProviderPreset[] {
  return providerPresets.filter(isClaudeProviderPresetSupported)
}

export function getClaudeProviderPreset(name: string): ProviderPreset | undefined {
  return providerPresets.find((preset) => preset.name === name)
}
```

If TypeScript reports semicolon/style differences from the copied source, remove semicolons in the added Synapse code only. Do not rewrite the copied preset values.

- [x] **Step 4: Run the preset test**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/provider/__tests__/provider-presets.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

Run:

```bash
git add desktop/electron/services/provider/claude-provider-presets.ts desktop/electron/services/provider/__tests__/provider-presets.test.ts
git commit -m "feat: add claude provider preset source"
```

## Task 2: Encrypted Secret Env Support

**Files:**
- Modify: `desktop/electron/runtime/data-repo/schemas/placeholders.ts`
- Modify: `desktop/electron/services/provider/types.ts`
- Modify: `desktop/electron/services/provider/provider-secret-store.ts`
- Modify: `desktop/electron/services/provider/provider-service.ts`
- Test: `desktop/electron/services/provider/__tests__/provider-service.test.ts`

- [x] **Step 1: Write the failing secret env test**

Append this test inside the existing `describe("ProviderService", () => { ... })` in `desktop/electron/services/provider/__tests__/provider-service.test.ts`:

```ts
  it("stores sensitive provider env values in encrypted secret refs", async () => {
    const { service, providers, secrets } = makeProviderService()

    await service.createProvider({
      id: "bedrock-aksk",
      name: "AWS Bedrock (AKSK)",
      category: "cloud_provider",
      baseUrl: "https://bedrock-runtime.us-west-2.amazonaws.com",
      apiKeyField: "ANTHROPIC_API_KEY",
      env: {
        AWS_REGION: "us-west-2",
        AWS_ACCESS_KEY_ID: "AKIA_TEST",
        CLAUDE_CODE_USE_BEDROCK: "1",
      },
      secretEnv: {
        AWS_SECRET_ACCESS_KEY: "secret-access-key",
      },
    })

    await expect(service.buildEnv("bedrock-aksk")).resolves.toMatchObject({
      AWS_REGION: "us-west-2",
      AWS_ACCESS_KEY_ID: "AKIA_TEST",
      AWS_SECRET_ACCESS_KEY: "secret-access-key",
      CLAUDE_CODE_USE_BEDROCK: "1",
    })
    await expect(providers.get("bedrock-aksk")).resolves.toMatchObject({
      secretEnvRefs: {
        AWS_SECRET_ACCESS_KEY: "provider:bedrock-aksk:env:AWS_SECRET_ACCESS_KEY",
      },
    })
    await expect(secrets.get("provider:bedrock-aksk:env:AWS_SECRET_ACCESS_KEY")).resolves.toMatchObject({
      kind: "generic",
      value: "secret-access-key",
    })
  })
```

- [x] **Step 2: Run the failing provider service test**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/provider/__tests__/provider-service.test.ts
```

Expected: FAIL because `secretEnv` is not accepted and `secretEnvRefs` is not resolved.

- [x] **Step 3: Extend provider schema and types**

In `desktop/electron/runtime/data-repo/schemas/placeholders.ts`, add `secretEnvRefs` to `ProviderEntryV1`:

```ts
  secretEnvRefs?: Record<string, string>
```

Add this validation line next to the existing `env` validation:

```ts
    && ((v as ProviderEntryV1).secretEnvRefs === undefined || isStringRecord((v as ProviderEntryV1).secretEnvRefs))
```

In `desktop/electron/services/provider/types.ts`, add to `CCProvider`:

```ts
  secretEnvRefs?: Record<string, string>
```

Add to `CreateProviderInput`:

```ts
  readonly secretEnv?: Record<string, string>
```

Add to `UpdateProviderInput`:

```ts
  readonly secretEnv?: Record<string, string>
  readonly clearSecretEnv?: readonly string[]
```

- [x] **Step 4: Add secret env helpers**

In `desktop/electron/services/provider/provider-secret-store.ts`, add:

```ts
export function providerEnvSecretId(providerId: string, envName: string): string {
  return `provider:${providerId}:env:${envName}`
}
```

Inside `ProviderSecretStore`, add:

```ts
  async setEnvSecret(providerId: string, envName: string, value: string, description: string): Promise<string> {
    const id = providerEnvSecretId(providerId, envName)
    await this.secrets.upsert({
      id,
      schemaVersion: 1,
      kind: "generic",
      value,
      description,
    })
    return id
  }
```

Use the same `this.secrets` field name that `setApiKey()` already uses in the file.

- [x] **Step 5: Store and resolve secret env refs in ProviderService**

In `desktop/electron/services/provider/provider-service.ts`, import `providerEnvSecretId` if needed and add this helper near `compactEnv()`:

```ts
async function storeSecretEnv(
  secretStore: ProviderSecretStore,
  providerId: string,
  providerName: string,
  input?: Record<string, string>,
): Promise<Record<string, string> | undefined> {
  if (!input || Object.keys(input).length === 0) return undefined
  const refs: Record<string, string> = {}
  for (const [envName, value] of Object.entries(input)) {
    refs[envName] = await secretStore.setEnvSecret(
      providerId,
      envName,
      value,
      `${providerName} ${envName}`,
    )
  }
  return refs
}
```

In `createProvider()`, compute secret env refs before `toProviderEntry()`:

```ts
    const secretEnvRefs = await storeSecretEnv(
      this.secretStore,
      input.id,
      input.name,
      input.secretEnv,
    )
```

Include `secretEnvRefs` in the provider object passed to `toProviderEntry()`.

In `updateProvider()`, merge and clear secret env refs:

```ts
    const nextSecretEnvRefs = { ...(existing.secretEnvRefs ?? {}) }
    for (const envName of patch.clearSecretEnv ?? []) {
      delete nextSecretEnvRefs[envName]
    }
    const storedSecretEnvRefs = await storeSecretEnv(
      this.secretStore,
      id,
      patch.name ?? existing.name,
      patch.secretEnv,
    )
    Object.assign(nextSecretEnvRefs, storedSecretEnvRefs)
```

Include `secretEnvRefs: Object.keys(nextSecretEnvRefs).length ? nextSecretEnvRefs : undefined` in the updated provider.

In `buildEnv()`, after the normal env is assembled, resolve secret env refs:

```ts
    const secretEnv = await this.readSecretEnvValues(provider, context)
```

Return:

```ts
    return compactEnv({
      ...env,
      ...provider.env,
      ...secretEnv,
    })
```

Add this private method beside `readSecretValue()`:

```ts
  private async readSecretEnvValues(
    provider: CCProvider,
    context: BuildProviderEnvContext,
  ): Promise<Record<string, string>> {
    const refs = provider.secretEnvRefs ?? {}
    const result: Record<string, string> = {}
    for (const [envName, secretRef] of Object.entries(refs)) {
      const value = await this.readSecretRef(provider, secretRef, context)
      if (value !== undefined) result[envName] = value
    }
    return result
  }
```

Refactor the current `readSecretValue()` body into a reusable `readSecretRef(provider, secretRef, context)` method, then make `readSecretValue()` call it. Preserve the existing audit action `secret.read`, metadata shape, and redacted error behavior.

Update `toProviderEntry()`, `toProvider()`, and `providerPatch()` to carry `secretEnvRefs`.

- [x] **Step 6: Run provider service tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/provider/__tests__/provider-service.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit**

Run:

```bash
git add desktop/electron/runtime/data-repo/schemas/placeholders.ts desktop/electron/services/provider/types.ts desktop/electron/services/provider/provider-secret-store.ts desktop/electron/services/provider/provider-service.ts desktop/electron/services/provider/__tests__/provider-service.test.ts
git commit -m "feat: support encrypted provider env secrets"
```

## Task 3: Preset Adapter

**Files:**
- Create: `desktop/electron/services/provider/provider-preset-adapter.ts`
- Test: `desktop/electron/services/provider/__tests__/provider-preset-adapter.test.ts`

- [x] **Step 1: Write failing adapter tests**

Create `desktop/electron/services/provider/__tests__/provider-preset-adapter.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { getClaudeProviderPreset } from "../claude-provider-presets"
import {
  buildProviderInputFromClaudePreset,
  providerIdFromPresetName,
} from "../provider-preset-adapter"

describe("provider preset adapter", () => {
  it("maps Anthropic env fields into CreateProviderInput", () => {
    const preset = getClaudeProviderPreset("PackyCode")
    if (!preset) throw new Error("PackyCode preset missing")

    const input = buildProviderInputFromClaudePreset({
      preset,
      apiKey: "sk-packy",
      existingIds: new Set(),
    })

    expect(input).toEqual(expect.objectContaining({
      id: "packycode",
      name: "PackyCode",
      category: "third_party",
      baseUrl: "https://www.packyapi.com",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      apiKey: "sk-packy",
      env: {},
    }))
  })

  it("applies template values before mapping", () => {
    const preset = getClaudeProviderPreset("KAT-Coder")
    if (!preset) throw new Error("KAT-Coder preset missing")

    const input = buildProviderInputFromClaudePreset({
      preset,
      apiKey: "sk-kat",
      templateValues: { ENDPOINT_ID: "ep-123" },
      existingIds: new Set(),
    })

    expect(input.baseUrl).toBe("https://vanchin.streamlake.ai/api/gateway/v1/endpoints/ep-123/claude-code-proxy")
    expect(input.model).toBe("KAT-Coder-Pro V1")
  })

  it("stores sensitive template values as secret env values", () => {
    const preset = getClaudeProviderPreset("AWS Bedrock (AKSK)")
    if (!preset) throw new Error("AWS Bedrock (AKSK) preset missing")

    const input = buildProviderInputFromClaudePreset({
      preset,
      templateValues: {
        AWS_REGION: "us-west-2",
        AWS_ACCESS_KEY_ID: "AKIA_TEST",
        AWS_SECRET_ACCESS_KEY: "secret-access-key",
      },
      existingIds: new Set(),
    })

    expect(input.baseUrl).toBe("https://bedrock-runtime.us-west-2.amazonaws.com")
    expect(input.env).toMatchObject({
      AWS_REGION: "us-west-2",
      AWS_ACCESS_KEY_ID: "AKIA_TEST",
      CLAUDE_CODE_USE_BEDROCK: "1",
    })
    expect(input.secretEnv).toEqual({
      AWS_SECRET_ACCESS_KEY: "secret-access-key",
    })
  })

  it("generates deterministic ids and resolves conflicts", () => {
    expect(providerIdFromPresetName("AWS Bedrock (API Key)", new Set())).toBe("aws-bedrock-api-key")
    expect(providerIdFromPresetName("PackyCode", new Set(["packycode"]))).toBe("packycode-2")
    expect(providerIdFromPresetName("PackyCode", new Set(["packycode", "packycode-2"]))).toBe("packycode-3")
  })
})
```

- [x] **Step 2: Run the failing adapter test**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/provider/__tests__/provider-preset-adapter.test.ts
```

Expected: FAIL because the adapter does not exist.

- [x] **Step 3: Implement the adapter**

Create `desktop/electron/services/provider/provider-preset-adapter.ts`:

```ts
import type { ProviderPreset } from "./claude-provider-presets"
import type { CreateProviderInput, ProviderApiKeyField } from "./types"

export interface BuildProviderInputFromPresetOptions {
  readonly preset: ProviderPreset
  readonly providerId?: string
  readonly name?: string
  readonly apiKey?: string
  readonly templateValues?: Record<string, string>
  readonly active?: boolean
  readonly sortIndex?: number
  readonly existingIds: ReadonlySet<string>
}

const MAPPED_ENV_KEYS = new Set([
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
])

export function buildProviderInputFromClaudePreset(
  options: BuildProviderInputFromPresetOptions,
): CreateProviderInput {
  const settingsConfig = applyTemplateValues(
    options.preset.settingsConfig,
    options.templateValues ?? {},
  )
  const env = isRecord(settingsConfig.env) ? settingsConfig.env : {}
  const apiKeyField = resolveApiKeyField(options.preset, settingsConfig, env)
  const extraEnv: Record<string, string> = {}
  const secretEnv: Record<string, string> = {}

  for (const [key, rawValue] of Object.entries(env)) {
    if (MAPPED_ENV_KEYS.has(key)) continue
    const value = stringifyEnvValue(rawValue)
    if (value === undefined) continue
    if (isSensitiveEnvName(key)) {
      secretEnv[key] = value
    } else {
      extraEnv[key] = value
    }
  }

  return {
    id: options.providerId?.trim() || providerIdFromPresetName(options.preset.name, options.existingIds),
    name: options.name?.trim() || options.preset.name,
    category: options.preset.category ?? "custom",
    baseUrl: stringValue(env.ANTHROPIC_BASE_URL),
    apiKeyField,
    apiKey: options.apiKey,
    active: options.active,
    model: stringValue(env.ANTHROPIC_MODEL),
    haikuModel: stringValue(env.ANTHROPIC_DEFAULT_HAIKU_MODEL),
    sonnetModel: stringValue(env.ANTHROPIC_DEFAULT_SONNET_MODEL),
    opusModel: stringValue(env.ANTHROPIC_DEFAULT_OPUS_MODEL),
    env: extraEnv,
    secretEnv: Object.keys(secretEnv).length ? secretEnv : undefined,
    sortIndex: options.sortIndex,
  }
}

export function providerIdFromPresetName(name: string, existingIds: ReadonlySet<string>): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "provider"
  if (!existingIds.has(base)) return base
  let suffix = 2
  while (existingIds.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

function applyTemplateValues(value: unknown, templateValues: Record<string, string>): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, key: string) => templateValues[key] ?? "")
  }
  if (Array.isArray(value)) {
    return value.map((item) => applyTemplateValues(item, templateValues))
  }
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, applyTemplateValues(item, templateValues)]),
  )
}

function resolveApiKeyField(
  preset: ProviderPreset,
  settingsConfig: unknown,
  env: Record<string, unknown>,
): ProviderApiKeyField {
  if (preset.apiKeyField) return preset.apiKeyField
  if (typeof env.ANTHROPIC_API_KEY === "string") return "ANTHROPIC_API_KEY"
  if (isRecord(settingsConfig) && typeof settingsConfig.apiKey === "string") return "ANTHROPIC_API_KEY"
  return "ANTHROPIC_AUTH_TOKEN"
}

function isSensitiveEnvName(name: string): boolean {
  return /(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY)$/i.test(name)
}

function stringifyEnvValue(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
```

- [x] **Step 4: Run adapter tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/provider/__tests__/provider-preset-adapter.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

Run:

```bash
git add desktop/electron/services/provider/provider-preset-adapter.ts desktop/electron/services/provider/__tests__/provider-preset-adapter.test.ts
git commit -m "feat: adapt claude provider presets"
```

## Task 4: ProviderService Preset APIs And IPC

**Files:**
- Modify: `desktop/electron/services/provider/types.ts`
- Modify: `desktop/electron/services/provider/provider-service.ts`
- Modify: `desktop/electron/services/provider/index.ts`
- Modify: `desktop/electron/modules/agent/ipc-tools.ts`
- Modify: `desktop/src/types/bridge.ts`
- Test: `desktop/electron/services/provider/__tests__/provider-service.test.ts`
- Test: `desktop/electron/modules/agent/__tests__/ipc.test.ts`

- [x] **Step 1: Add failing ProviderService preset API tests**

Append to `desktop/electron/services/provider/__tests__/provider-service.test.ts`:

```ts
  it("lists public supported provider presets", async () => {
    const { service } = makeProviderService()

    await expect(service.listProviderPresets()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "PackyCode",
          category: "third_party",
          baseUrl: "https://www.packyapi.com",
          apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        }),
        expect.objectContaining({
          name: "AWS Bedrock (AKSK)",
          category: "cloud_provider",
          templateValues: expect.arrayContaining([
            expect.objectContaining({ key: "AWS_REGION" }),
            expect.objectContaining({ key: "AWS_SECRET_ACCESS_KEY", sensitive: true }),
          ]),
        }),
      ]),
    )
    const names = (await service.listProviderPresets()).map((preset) => preset.name)
    expect(names).not.toContain("GitHub Copilot")
    expect(names).not.toContain("Codex")
  })

  it("creates a provider from a preset through the existing provider path", async () => {
    const { service } = makeProviderService()

    const provider = await service.createProviderFromPreset({
      presetName: "PackyCode",
      apiKey: "sk-packy",
      active: true,
    })

    expect(provider).toMatchObject({
      id: "packycode",
      name: "PackyCode",
      category: "third_party",
      active: true,
      baseUrl: "https://www.packyapi.com",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
    })
    await expect(service.buildEnv("packycode")).resolves.toMatchObject({
      ANTHROPIC_BASE_URL: "https://www.packyapi.com",
      ANTHROPIC_AUTH_TOKEN: "sk-packy",
      ANTHROPIC_API_KEY: "",
    })
  })
```

- [x] **Step 2: Add failing IPC tests**

Append to `desktop/electron/modules/agent/__tests__/ipc.test.ts` near the provider IPC tests:

```ts
  it("lists provider presets through IPC without secrets", async () => {
    const listProviderPresets = vi.fn().mockResolvedValue([{
      name: "PackyCode",
      category: "third_party",
      websiteUrl: "https://www.packyapi.com",
      apiKeyUrl: "https://www.packyapi.com/register?aff=cc-switch",
      baseUrl: "https://www.packyapi.com",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      model: undefined,
      templateValues: [],
    }])
    const harness = createHarness({
      providerService: {
        listProviderPresets,
      },
    })

    const result = await harness.invoke("synapse:agent:list-provider-presets", {})

    expect(listProviderPresets).toHaveBeenCalled()
    expect(result).toEqual([expect.objectContaining({
      name: "PackyCode",
      baseUrl: "https://www.packyapi.com",
    })])
    expect(JSON.stringify(result)).not.toContain("sk-")
  })

  it("creates a provider from a preset through IPC", async () => {
    const createProviderFromPreset = vi.fn().mockResolvedValue({
      id: "packycode",
      name: "PackyCode",
      category: "third_party",
      baseUrl: "https://www.packyapi.com",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      active: false,
      env: {},
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    })
    const harness = createHarness({
      providerService: {
        createProviderFromPreset,
      },
    })

    const result = await harness.invoke("synapse:agent:create-provider-from-preset", {
      presetName: "PackyCode",
      apiKey: "sk-packy",
    })

    expect(createProviderFromPreset).toHaveBeenCalledWith({
      presetName: "PackyCode",
      apiKey: "sk-packy",
    })
    expect(result).toEqual(expect.objectContaining({
      id: "packycode",
      name: "PackyCode",
    }))
    expect(JSON.stringify(result)).not.toContain("sk-packy")
  })
```

- [x] **Step 3: Run failing service and IPC tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/provider/__tests__/provider-service.test.ts desktop/electron/modules/agent/__tests__/ipc.test.ts
```

Expected: FAIL because service and IPC methods do not exist.

- [x] **Step 4: Add public preset types**

In `desktop/electron/services/provider/types.ts`, add:

```ts
export interface ProviderPresetTemplateValue {
  readonly key: string
  readonly label: string
  readonly placeholder: string
  readonly defaultValue?: string
  readonly sensitive: boolean
}

export interface CCProviderPreset {
  readonly name: string
  readonly category: ProviderCategory
  readonly websiteUrl?: string
  readonly apiKeyUrl?: string
  readonly baseUrl?: string
  readonly apiKeyField: ProviderApiKeyField
  readonly model?: string
  readonly haikuModel?: string
  readonly sonnetModel?: string
  readonly opusModel?: string
  readonly templateValues: readonly ProviderPresetTemplateValue[]
}

export interface CreateProviderFromPresetInput {
  readonly presetName: string
  readonly providerId?: string
  readonly name?: string
  readonly apiKey?: string
  readonly templateValues?: Record<string, string>
  readonly active?: boolean
  readonly sortIndex?: number
}
```

- [x] **Step 5: Implement ProviderService methods**

In `desktop/electron/services/provider/provider-service.ts`, import:

```ts
import {
  getClaudeProviderPreset,
  listClaudeProviderPresets,
} from "./claude-provider-presets"
import { buildProviderInputFromClaudePreset } from "./provider-preset-adapter"
```

Add public methods inside `ProviderService`:

```ts
  async listProviderPresets(): Promise<readonly CCProviderPreset[]> {
    return listClaudeProviderPresets().map(publicPreset)
  }

  async createProviderFromPreset(input: CreateProviderFromPresetInput): Promise<CCProvider> {
    const preset = getClaudeProviderPreset(input.presetName)
    if (!preset) {
      throw new Error(`Provider preset not found: ${input.presetName}`)
    }
    if (!isClaudeProviderPresetSupported(preset)) {
      throw new Error(`Provider preset is not supported: ${input.presetName}`)
    }
    const existingIds = new Set((await this.listProviders()).map((provider) => provider.id))
    return this.createProvider(buildProviderInputFromClaudePreset({
      preset,
      providerId: input.providerId,
      name: input.name,
      apiKey: input.apiKey,
      templateValues: input.templateValues,
      active: input.active,
      sortIndex: input.sortIndex,
      existingIds,
    }))
  }
```

Also import `isClaudeProviderPresetSupported` and the new types. Add `publicPreset()` near `publicProvider` helpers:

```ts
function publicPreset(preset: ProviderPreset): CCProviderPreset {
  const env = isRecord(preset.settingsConfig.env) ? preset.settingsConfig.env : {}
  return {
    name: preset.name,
    category: preset.category ?? "custom",
    websiteUrl: preset.websiteUrl,
    apiKeyUrl: preset.apiKeyUrl,
    baseUrl: stringValue(env.ANTHROPIC_BASE_URL),
    apiKeyField: preset.apiKeyField ?? (typeof env.ANTHROPIC_API_KEY === "string" ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN"),
    model: stringValue(env.ANTHROPIC_MODEL),
    haikuModel: stringValue(env.ANTHROPIC_DEFAULT_HAIKU_MODEL),
    sonnetModel: stringValue(env.ANTHROPIC_DEFAULT_SONNET_MODEL),
    opusModel: stringValue(env.ANTHROPIC_DEFAULT_OPUS_MODEL),
    templateValues: Object.entries(preset.templateValues ?? {}).map(([key, value]) => ({
      key,
      label: value.label,
      placeholder: value.placeholder,
      defaultValue: value.defaultValue ?? value.editorValue,
      sensitive: isSensitiveTemplateKey(key),
    })),
  }
}

function isSensitiveTemplateKey(key: string): boolean {
  return /(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY)$/i.test(key)
}
```

- [x] **Step 6: Export preset APIs**

In `desktop/electron/services/provider/index.ts`, export the adapter and preset types:

```ts
export {
  getClaudeProviderPreset,
  isClaudeProviderPresetSupported,
  listClaudeProviderPresets,
  type ProviderPreset,
} from "./claude-provider-presets"
export {
  buildProviderInputFromClaudePreset,
  providerIdFromPresetName,
} from "./provider-preset-adapter"
```

- [x] **Step 7: Add IPC schemas and handlers**

In `desktop/electron/modules/agent/ipc-tools.ts`, extend imports with:

```ts
  CreateProviderFromPresetInput,
```

Add request schemas:

```ts
const createProviderFromPresetRequestSchema = z.object({
  presetName: z.string().min(1),
  providerId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  apiKey: z.string().optional(),
  templateValues: z.record(z.string(), z.string()).optional(),
  active: z.boolean().optional(),
  sortIndex: z.number().optional(),
})
```

Add response schema:

```ts
const providerPresetTemplateValueSchema = z.object({
  key: z.string(),
  label: z.string(),
  placeholder: z.string(),
  defaultValue: z.string().optional(),
  sensitive: z.boolean(),
})

const publicProviderPresetSchema = z.object({
  name: z.string(),
  category: providerCategorySchema,
  websiteUrl: z.string().optional(),
  apiKeyUrl: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKeyField: providerApiKeyFieldSchema,
  model: z.string().optional(),
  haikuModel: z.string().optional(),
  sonnetModel: z.string().optional(),
  opusModel: z.string().optional(),
  templateValues: z.array(providerPresetTemplateValueSchema),
})
```

Add handlers to `toolMethods`:

```ts
  listProviderPresets: {
    kind: "invoke",
    channel: "synapse:agent:list-provider-presets",
    request: providerRequestSchema,
    response: z.array(publicProviderPresetSchema),
    handler: async (ctx, _request: ProviderRequest) => {
      const providerService = resolveGlobalProviderService(ctx.resolve)
      return providerService.listProviderPresets()
    },
  },
  createProviderFromPreset: {
    kind: "invoke",
    channel: "synapse:agent:create-provider-from-preset",
    request: createProviderFromPresetRequestSchema,
    response: publicProviderSchema,
    handler: async (ctx, request: z.infer<typeof createProviderFromPresetRequestSchema>) => {
      const providerService = resolveGlobalProviderService(ctx.resolve)
      return publicProvider(await providerService.createProviderFromPreset(request as CreateProviderFromPresetInput))
    },
  },
```

- [x] **Step 8: Add bridge types**

In `desktop/src/types/bridge.ts`, add renderer types matching the public preset schemas:

```ts
export type SynapseAgentProviderPresetTemplateValue = {
  readonly key: string
  readonly label: string
  readonly placeholder: string
  readonly defaultValue?: string
  readonly sensitive: boolean
}

export type SynapseAgentProviderPreset = {
  readonly name: string
  readonly category: SynapseAgentProviderCategory
  readonly websiteUrl?: string
  readonly apiKeyUrl?: string
  readonly baseUrl?: string
  readonly apiKeyField: SynapseAgentProviderApiKeyField
  readonly model?: string
  readonly haikuModel?: string
  readonly sonnetModel?: string
  readonly opusModel?: string
  readonly templateValues: readonly SynapseAgentProviderPresetTemplateValue[]
}

export type SynapseCreateProviderFromPresetInput = {
  readonly presetName: string
  readonly providerId?: string
  readonly name?: string
  readonly apiKey?: string
  readonly templateValues?: Record<string, string>
  readonly active?: boolean
  readonly sortIndex?: number
}
```

Add to `SynapseBridge["agent"]`:

```ts
    listProviderPresets: () => Promise<SynapseAgentProviderPreset[]>
    createProviderFromPreset: (
      args: SynapseCreateProviderFromPresetInput,
    ) => Promise<SynapseAgentProvider>
```

- [x] **Step 9: Regenerate IPC bridge code**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Expected: generated IPC channel/preload files include the two new provider preset methods.

- [x] **Step 10: Run service and IPC tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/provider/__tests__/provider-service.test.ts desktop/electron/modules/agent/__tests__/ipc.test.ts
```

Expected: PASS.

- [x] **Step 11: Commit**

Run:

```bash
git add desktop/electron/services/provider/types.ts desktop/electron/services/provider/provider-service.ts desktop/electron/services/provider/index.ts desktop/electron/modules/agent/ipc-tools.ts desktop/src/types/bridge.ts desktop/electron/generated/ipc-channels.generated.ts desktop/electron/services/provider/__tests__/provider-service.test.ts desktop/electron/modules/agent/__tests__/ipc.test.ts
git commit -m "feat: expose claude provider presets"
```

## Task 5: Provider Settings Preset Picker

**Files:**
- Modify: `desktop/src/modules/settings/components/provider-panel.tsx`
- Test: `desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx`

- [x] **Step 1: Add failing renderer tests**

Append to `desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx`:

```tsx
describe("ProviderPanel presets", () => {
  it("opens provider presets and creates from a selected preset", async () => {
    const listProviders = vi.fn().mockResolvedValue([])
    const listProviderPresets = vi.fn().mockResolvedValue([{
      name: "PackyCode",
      category: "third_party",
      websiteUrl: "https://www.packyapi.com",
      apiKeyUrl: "https://www.packyapi.com/register?aff=cc-switch",
      baseUrl: "https://www.packyapi.com",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      templateValues: [],
    }])
    const createProviderFromPreset = vi.fn().mockResolvedValue(customProvider())
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders,
          listProviderPresets,
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
      buttonByText(container, "从预设添加").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(listProviderPresets).toHaveBeenCalled()
    expect(document.body.textContent).toContain("PackyCode")

    await act(async () => {
      buttonByText(document.body, "选择 PackyCode").click()
      await Promise.resolve()
    })

    const apiKeyInput = document.body.querySelector<HTMLInputElement>("#provider-preset-api-key")
    if (!apiKeyInput) throw new Error("API key input not found")
    await act(async () => {
      apiKeyInput.value = "sk-packy"
      apiKeyInput.dispatchEvent(new Event("input", { bubbles: true }))
    })

    await act(async () => {
      buttonByText(document.body, "添加").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(createProviderFromPreset).toHaveBeenCalledWith({
      presetName: "PackyCode",
      apiKey: "sk-packy",
      templateValues: {},
    })
    expect(toast).toHaveBeenCalledWith("Provider 已保存")
  })
})
```

- [x] **Step 2: Run the failing renderer test**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx
```

Expected: FAIL because the preset button/dialog does not exist.

- [x] **Step 3: Add preset state and handlers**

In `desktop/src/modules/settings/components/provider-panel.tsx`, import:

```ts
import { Search } from "lucide-react"
```

Add bridge types:

```ts
  SynapseAgentProviderPreset,
```

Add state inside `ProviderPanel`:

```ts
  const [presetDialogOpen, setPresetDialogOpen] = useState(false)
```

Add handlers:

```ts
  const openPresetDialog = useCallback(() => {
    setPresetDialogOpen(true)
  }, [])

  const handleCreateFromPreset = useCallback(async (input: {
    readonly presetName: string
    readonly apiKey?: string
    readonly templateValues: Record<string, string>
  }) => {
    setSaving(true)
    try {
      await requireSynapseBridge().agent.createProviderFromPreset(input)
      setPresetDialogOpen(false)
      await refresh()
      toast("Provider 已保存")
    } catch (rawError) {
      logger.error("Provider preset save failed.", {
        boundary: "settings.providers.preset.save",
        action: "createProviderFromPreset",
        providerId: input.presetName,
        ...providerErrorDiagnostic(rawError),
      })
      toast("保存 Provider 失败")
    } finally {
      setSaving(false)
    }
  }, [refresh])
```

Render the preset dialog next to `ProviderFormDialog`:

```tsx
      <ProviderPresetDialog
        open={presetDialogOpen}
        saving={saving}
        onOpenChange={setPresetDialogOpen}
        onSubmit={handleCreateFromPreset}
      />
```

Pass `onAddPreset={openPresetDialog}` into `ProviderPanelView`.

- [x] **Step 4: Add the preset button**

Update `ProviderPanelViewProps`:

```ts
  readonly onAddPreset: () => void
```

In `ProviderPanelView`, change the header actions to:

```tsx
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onAddPreset}>
            从预设添加
          </Button>
          <Button type="button" size="sm" onClick={onAdd}>
            <Plus data-icon="inline-start" />
            添加
          </Button>
        </div>
```

- [x] **Step 5: Add ProviderPresetDialog**

Add this component before `ProviderFormDialog`:

```tsx
function ProviderPresetDialog({
  open,
  saving,
  onOpenChange,
  onSubmit,
}: {
  readonly open: boolean
  readonly saving: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (input: {
    readonly presetName: string
    readonly apiKey?: string
    readonly templateValues: Record<string, string>
  }) => Promise<void>
}) {
  const [presets, setPresets] = useState<SynapseAgentProviderPreset[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<SynapseAgentProviderPreset | null>(null)
  const [apiKey, setApiKey] = useState("")
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setLoading(true)
    requireSynapseBridge().agent.listProviderPresets()
      .then((nextPresets) => {
        setPresets(nextPresets)
      })
      .catch((rawError) => {
        logger.error("Provider presets list failed.", {
          boundary: "settings.providers.preset.list",
          action: "listProviderPresets",
          ...providerErrorDiagnostic(rawError),
        })
        toast("读取预设失败")
      })
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    if (!open) {
      setSelected(null)
      setApiKey("")
      setTemplateValues({})
      setQuery("")
    }
  }, [open])

  const visiblePresets = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return presets
    return presets.filter((preset) => preset.name.toLowerCase().includes(keyword))
  }, [presets, query])

  const templateComplete = selected
    ? selected.templateValues.every((item) => {
      const value = templateValues[item.key] ?? item.defaultValue ?? ""
      return value.trim().length > 0
    })
    : false

  const handleSubmit = () => {
    if (!selected || !templateComplete || saving) return
    void onSubmit({
      presetName: selected.name,
      apiKey: optionalTrimmed(apiKey),
      templateValues,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>从预设添加</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="provider-preset-search">搜索</FieldLabel>
              <div className="flex items-center gap-2">
                <Search data-icon="inline-start" />
                <Input
                  id="provider-preset-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </Field>
            <div className="max-h-80 overflow-auto">
              <Table>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell className="text-muted-foreground">正在加载</TableCell>
                    </TableRow>
                  ) : visiblePresets.length === 0 ? (
                    <TableRow>
                      <TableCell className="text-muted-foreground">暂无预设</TableCell>
                    </TableRow>
                  ) : visiblePresets.map((preset) => (
                    <TableRow key={preset.name}>
                      <TableCell>
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="truncate font-medium">{preset.name}</span>
                          <span className="truncate text-xs text-muted-foreground">{preset.baseUrl ?? preset.model ?? "-"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant={selected?.name === preset.name ? "secondary" : "outline"}
                          size="sm"
                          onClick={() => {
                            setSelected(preset)
                            setTemplateValues(Object.fromEntries(
                              preset.templateValues.map((item) => [item.key, item.defaultValue ?? ""]),
                            ))
                          }}
                        >
                          {selected?.name === preset.name ? "已选择" : `选择 ${preset.name}`}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="provider-preset-api-key">API Key</FieldLabel>
              <Input
                id="provider-preset-api-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                disabled={!selected}
              />
            </Field>
            {selected?.templateValues.map((item) => (
              <Field key={item.key}>
                <FieldLabel htmlFor={`provider-preset-template-${item.key}`}>{item.label}</FieldLabel>
                <Input
                  id={`provider-preset-template-${item.key}`}
                  type={item.sensitive ? "password" : "text"}
                  value={templateValues[item.key] ?? item.defaultValue ?? ""}
                  placeholder={item.placeholder}
                  onChange={(event) => setTemplateValues({
                    ...templateValues,
                    [item.key]: event.target.value,
                  })}
                />
              </Field>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={!selected || !templateComplete || saving} onClick={handleSubmit}>
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

If the icon inside the search field violates local shadcn input composition, remove the icon and keep the `Input`; do not add custom input styling.

- [x] **Step 6: Run renderer test**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx
```

Expected: PASS.

- [x] **Step 7: Commit**

Run:

```bash
git add desktop/src/modules/settings/components/provider-panel.tsx desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx
git commit -m "feat: add provider preset picker"
```

## Task 6: Final Verification

**Files:**
- Verify only. No planned source edits.

- [x] **Step 1: Run focused provider tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/provider/__tests__/provider-presets.test.ts desktop/electron/services/provider/__tests__/provider-preset-adapter.test.ts desktop/electron/services/provider/__tests__/provider-service.test.ts desktop/electron/modules/agent/__tests__/ipc.test.ts desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx
```

Expected: PASS.

- [x] **Step 2: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [x] **Step 4: Inspect diff scope**

Run:

```bash
git diff --stat HEAD~5..HEAD
```

Expected: diff is limited to provider service, agent IPC, bridge types, provider settings panel, generated IPC files, and tests.

- [x] **Step 5: Commit fixes only if verification required changes**

If verification required fixes, commit them:

```bash
git add desktop/electron/runtime/data-repo/schemas/placeholders.ts desktop/electron/services/provider desktop/electron/modules/agent/ipc-tools.ts desktop/electron/modules/agent/__tests__/ipc.test.ts desktop/electron/generated/ipc-channels.generated.ts desktop/src/types/bridge.ts desktop/src/modules/settings/components/provider-panel.tsx desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx
git commit -m "fix: stabilize claude provider presets"
```

Expected: no commit if verification passes without changes.
