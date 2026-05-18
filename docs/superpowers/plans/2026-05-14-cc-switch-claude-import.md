# CC Switch Claude Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-reviewed CC Switch import flow that scans local CC Switch Claude providers, previews them, and imports selected providers into Synapse.

**Architecture:** Keep all filesystem, SQLite, permission, audit, and secret handling in Electron main-process provider services. Renderer code only opens the dialog, displays the preview table, tracks checkbox state, and calls typed bridge methods. API keys are passed only through the existing `ProviderService.createProvider` path so they end in encrypted secrets.

**Tech Stack:** Electron main process, `node:sqlite`, TypeScript, React, shadcn/Radix UI, Vitest, existing Synapse IPC registry and preload bridge.

---

## File Structure

- Create `desktop/electron/services/provider/cc-switch-importer.ts`
  - Resolves CC Switch paths.
  - Reads `cc-switch.db` in read-only mode.
  - Reads legacy `config.json` only when SQLite is absent or explicitly selected.
  - Converts CC Switch Claude rows into Synapse import previews and create inputs.
  - Performs permission checks and audit records.

- Modify `desktop/electron/services/provider/types.ts`
  - Add import preview/result/input types.
  - Export them for IPC and renderer bridge typing.

- Modify `desktop/electron/services/provider/provider-service.ts`
  - Add `previewCcSwitchClaudeProviders`.
  - Add `importCcSwitchClaudeProviders`.
  - Delegate scanning/conversion to the importer.
  - Reuse `createProvider` for secret persistence.

- Modify `desktop/electron/services/provider/index.ts`
  - Export the new types.

- Modify `desktop/electron/modules/agent/ipc-tools.ts`
  - Add zod request/response schemas.
  - Register preview/import/source-file-picker IPC handlers.

- Modify `desktop/electron/preload.ts`
  - Add IPC channel keys.
  - Add `window.synapse.agent.previewCcSwitchClaudeProviders`.
  - Add `window.synapse.agent.importCcSwitchClaudeProviders`.
  - Add `window.synapse.agent.chooseCcSwitchClaudeImportSource`.

- Modify `desktop/src/types/bridge.ts`
  - Add renderer-facing CC Switch import types.
  - Add bridge method signatures.

- Create `desktop/src/modules/settings/components/cc-switch-import-dialog.tsx`
  - Dialog UI, preview table, checkbox state, source-file fallback trigger, import action.

- Modify `desktop/src/modules/settings/components/provider-panel.tsx`
  - Add `从 CCS 导入` button next to `新建`.
  - Open the new dialog.
  - Refresh providers after import.

- Add tests:
  - `desktop/electron/services/provider/__tests__/cc-switch-importer.test.ts`
  - Extend `desktop/electron/services/provider/__tests__/provider-service.test.ts`
  - Extend `desktop/electron/modules/agent/__tests__/ipc.test.ts`
  - Add `desktop/src/modules/settings/components/__tests__/cc-switch-import-dialog.test.tsx`
  - Extend `desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx`

---

### Task 1: Main-Process Importer Tests

**Files:**
- Create: `desktop/electron/services/provider/__tests__/cc-switch-importer.test.ts`
- Create in Task 2: `desktop/electron/services/provider/cc-switch-importer.ts`

- [ ] **Step 1: Write failing tests for path resolution, SQLite reading, and conversion**

Create `desktop/electron/services/provider/__tests__/cc-switch-importer.test.ts`:

```ts
import { DatabaseSync } from "node:sqlite"
import { mkdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildCcSwitchClaudeImportPreview,
  readCcSwitchClaudeProvidersFromSource,
  resolveCcSwitchCandidateSources,
} from "../cc-switch-importer"

const tempDirs: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
})

function tempRoot(): string {
  const dir = path.join(os.tmpdir(), `synapse-ccs-import-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  tempDirs.push(dir)
  return dir
}

function createCcSwitchDb(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const db = new DatabaseSync(filePath)
  try {
    db.exec(`
      CREATE TABLE providers (
        id TEXT NOT NULL,
        app_type TEXT NOT NULL,
        name TEXT NOT NULL,
        settings_config TEXT NOT NULL,
        website_url TEXT,
        category TEXT,
        created_at INTEGER,
        sort_index INTEGER,
        notes TEXT,
        icon TEXT,
        icon_color TEXT,
        meta TEXT NOT NULL DEFAULT '{}',
        is_current BOOLEAN NOT NULL DEFAULT 0,
        in_failover_queue BOOLEAN NOT NULL DEFAULT 0,
        PRIMARY KEY (id, app_type)
      );
    `)
    const insert = db.prepare(`
      INSERT INTO providers (
        id, app_type, name, settings_config, website_url, category, created_at, sort_index, notes, meta
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insert.run(
      "deepseek",
      "claude",
      "DeepSeek",
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
          ANTHROPIC_AUTH_TOKEN: "sk-deepseek",
          ANTHROPIC_MODEL: "deepseek-chat",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-chat",
        },
      }),
      "https://platform.deepseek.com",
      "cn_official",
      1,
      2,
      "work account",
      "{}",
    )
    insert.run(
      "codex-only",
      "codex",
      "Codex Only",
      JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "sk-ignore" } }),
      null,
      "custom",
      2,
      3,
      null,
      "{}",
    )
    insert.run(
      "missing-key",
      "claude",
      "Missing Key",
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://example.com" } }),
      null,
      "custom",
      3,
      4,
      null,
      "{}",
    )
  } finally {
    db.close()
  }
}

describe("cc-switch importer", () => {
  it("resolves default and Windows HOME fallback sources without string path concatenation", () => {
    const homeDir = path.join(tempRoot(), "User Profile")
    const homeEnv = path.join(tempRoot(), "Git Home")

    const sources = resolveCcSwitchCandidateSources({
      platform: "win32",
      homeDir,
      envHome: homeEnv,
      exists: (candidate) => candidate.includes("Git Home"),
    })

    expect(sources[0]).toEqual({
      kind: "sqlite",
      path: path.join(homeEnv, ".cc-switch", "cc-switch.db"),
    })
  })

  it("reads only Claude providers from SQLite and classifies preview status", () => {
    const dbPath = path.join(tempRoot(), ".cc-switch", "cc-switch.db")
    createCcSwitchDb(dbPath)

    const source = readCcSwitchClaudeProvidersFromSource({ kind: "sqlite", path: dbPath })
    const preview = buildCcSwitchClaudeImportPreview(source.providers, new Set(["deepseek"]))

    expect(source.kind).toBe("sqlite")
    expect(source.providers.map((item) => item.id)).toEqual(["deepseek", "missing-key"])
    expect(preview.items).toEqual([
      expect.objectContaining({
        id: "deepseek",
        name: "DeepSeek",
        baseUrl: "https://api.deepseek.com/anthropic",
        apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        model: "deepseek-chat",
        category: "cn_official",
        status: "duplicate",
        selectedByDefault: false,
      }),
      expect.objectContaining({
        id: "missing-key",
        status: "missing_api_key",
        selectedByDefault: false,
      }),
    ])
  })

  it("reads legacy config.json only as an explicit JSON source", () => {
    const jsonPath = path.join(tempRoot(), ".cc-switch", "config.json")
    mkdirSync(path.dirname(jsonPath), { recursive: true })
    writeFileSync(jsonPath, JSON.stringify({
      apps: {
        claude: {
          current: "moonshot",
          providers: {
            moonshot: {
              id: "moonshot",
              name: "Moonshot",
              category: "cn_official",
              settingsConfig: {
                env: {
                  ANTHROPIC_AUTH_TOKEN: "sk-moonshot",
                  ANTHROPIC_MODEL: "kimi-k2",
                },
              },
            },
          },
        },
      },
    }))

    const source = readCcSwitchClaudeProvidersFromSource({ kind: "json", path: jsonPath })
    const preview = buildCcSwitchClaudeImportPreview(source.providers, new Set())

    expect(preview.items).toEqual([
      expect.objectContaining({
        id: "moonshot",
        name: "Moonshot",
        apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        model: "kimi-k2",
        status: "ready",
        selectedByDefault: true,
      }),
    ])
  })
})
```

- [ ] **Step 2: Run importer tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop run test -- cc-switch-importer
```

Expected: FAIL because `../cc-switch-importer` does not exist.

- [ ] **Step 3: Commit the failing tests**

```bash
git add desktop/electron/services/provider/__tests__/cc-switch-importer.test.ts
git commit -m "test: cover cc switch claude importer"
```

---

### Task 2: Main-Process Importer Implementation

**Files:**
- Create: `desktop/electron/services/provider/cc-switch-importer.ts`
- Modify: `desktop/electron/services/provider/types.ts`
- Modify: `desktop/electron/services/provider/index.ts`
- Test: `desktop/electron/services/provider/__tests__/cc-switch-importer.test.ts`

- [ ] **Step 1: Add importer types to provider types**

In `desktop/electron/services/provider/types.ts`, add after `CreateProviderFromPresetInput`:

```ts
export type CcSwitchImportSourceKind = "sqlite" | "json"

export interface CcSwitchImportSource {
  readonly kind: CcSwitchImportSourceKind
  readonly path: string
}

export type CcSwitchClaudeProviderImportStatus =
  | "ready"
  | "duplicate"
  | "missing_api_key"
  | "unsupported"

export interface CcSwitchClaudeProviderPreview {
  readonly id: string
  readonly name: string
  readonly baseUrl?: string
  readonly apiKeyField?: ProviderApiKeyField
  readonly model?: string
  readonly category: ProviderCategory
  readonly status: CcSwitchClaudeProviderImportStatus
  readonly selectedByDefault: boolean
}

export interface CcSwitchClaudeProviderPreviewResult {
  readonly sourcePath?: string
  readonly sourceKind?: CcSwitchImportSourceKind
  readonly items: readonly CcSwitchClaudeProviderPreview[]
}

export interface PreviewCcSwitchClaudeProvidersInput {
  readonly sourcePath?: string
}

export interface ImportCcSwitchClaudeProvidersInput {
  readonly providerIds: readonly string[]
  readonly sourcePath?: string
}

export interface CcSwitchClaudeProviderImportResult {
  readonly imported: number
  readonly skipped: number
  readonly providers: readonly CCProvider[]
}
```

- [ ] **Step 2: Create importer implementation**

Create `desktop/electron/services/provider/cc-switch-importer.ts`:

```ts
import { DatabaseSync } from "node:sqlite"
import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import type {
  CcSwitchClaudeProviderPreviewResult,
  CcSwitchImportSource,
  CreateProviderInput,
  ProviderApiKeyField,
  ProviderCategory,
} from "./types"

type Platform = NodeJS.Platform

type CcSwitchProviderRow = {
  id: string
  app_type: string
  name: string
  settings_config: string
  website_url: string | null
  category: string | null
  created_at: number | null
  sort_index: number | null
  notes: string | null
}

type RawCcSwitchClaudeProvider = {
  id: string
  name: string
  settingsConfig: Record<string, unknown>
  websiteUrl?: string
  category?: string
  createdAt?: number
  sortIndex?: number
  note?: string
}

export type CcSwitchSourceReadResult = {
  kind: CcSwitchImportSource["kind"]
  path: string
  providers: RawCcSwitchClaudeProvider[]
}

export type CcSwitchSourceResolutionDeps = {
  platform?: Platform
  homeDir?: string
  envHome?: string
  exists?: (candidate: string) => boolean
}

export function resolveCcSwitchCandidateSources(
  deps: CcSwitchSourceResolutionDeps = {},
): CcSwitchImportSource[] {
  const platform = deps.platform ?? process.platform
  const homeDir = deps.homeDir ?? os.homedir()
  const envHome = deps.envHome ?? process.env.HOME
  const exists = deps.exists ?? existsSync
  const defaultDb = path.join(homeDir, ".cc-switch", "cc-switch.db")
  const defaultJson = path.join(homeDir, ".cc-switch", "config.json")
  const sources: CcSwitchImportSource[] = []

  if (exists(defaultDb)) {
    sources.push({ kind: "sqlite", path: defaultDb })
    return sources
  }

  if (platform === "win32" && envHome && envHome.trim()) {
    const legacyWindowsDb = path.join(envHome, ".cc-switch", "cc-switch.db")
    if (legacyWindowsDb !== defaultDb && exists(legacyWindowsDb)) {
      sources.push({ kind: "sqlite", path: legacyWindowsDb })
      return sources
    }
  }

  if (exists(defaultJson)) {
    sources.push({ kind: "json", path: defaultJson })
  }

  return sources
}

export function sourceFromPath(sourcePath: string): CcSwitchImportSource {
  const ext = path.extname(sourcePath).toLowerCase()
  return {
    kind: ext === ".json" ? "json" : "sqlite",
    path: sourcePath,
  }
}

export function readCcSwitchClaudeProvidersFromSource(
  source: CcSwitchImportSource,
): CcSwitchSourceReadResult {
  if (source.kind === "json") {
    return readLegacyJsonSource(source.path)
  }
  return readSqliteSource(source.path)
}

export function buildCcSwitchClaudeImportPreview(
  providers: readonly RawCcSwitchClaudeProvider[],
  existingIds: ReadonlySet<string>,
): CcSwitchClaudeProviderPreviewResult {
  return {
    items: providers.map((provider) => {
      const input = createInputFromRawProvider(provider)
      const status = existingIds.has(provider.id)
        ? "duplicate"
        : input.apiKey
          ? "ready"
          : "missing_api_key"
      return {
        id: provider.id,
        name: provider.name,
        baseUrl: input.baseUrl,
        apiKeyField: input.apiKeyField,
        model: input.model,
        category: input.category,
        status,
        selectedByDefault: status === "ready",
      }
    }),
  }
}

export function createInputFromRawProvider(provider: RawCcSwitchClaudeProvider): CreateProviderInput {
  const env = readEnv(provider.settingsConfig)
  const apiKeyField = pickApiKeyField(env)
  const apiKey = apiKeyField ? stringValue(env[apiKeyField]) : undefined
  return {
    id: provider.id,
    name: provider.name,
    note: provider.note,
    websiteUrl: provider.websiteUrl,
    category: providerCategory(provider.category),
    baseUrl: stringValue(env.ANTHROPIC_BASE_URL),
    apiKeyField: apiKeyField ?? "ANTHROPIC_AUTH_TOKEN",
    apiKey,
    model: stringValue(env.ANTHROPIC_MODEL),
    haikuModel: stringValue(env.ANTHROPIC_DEFAULT_HAIKU_MODEL),
    sonnetModel: stringValue(env.ANTHROPIC_DEFAULT_SONNET_MODEL),
    opusModel: stringValue(env.ANTHROPIC_DEFAULT_OPUS_MODEL),
    env: {},
    sortIndex: provider.sortIndex,
  }
}

function readSqliteSource(filePath: string): CcSwitchSourceReadResult {
  const db = new DatabaseSync(filePath, { open: true, readOnly: true })
  try {
    const rows = db.prepare(`
      SELECT id, app_type, name, settings_config, website_url, category, created_at, sort_index, notes
      FROM providers
      WHERE app_type = 'claude'
      ORDER BY COALESCE(sort_index, 999999), created_at ASC, id ASC
    `).all() as CcSwitchProviderRow[]
    return {
      kind: "sqlite",
      path: filePath,
      providers: rows.map((row) => ({
        id: row.id,
        name: row.name,
        settingsConfig: parseSettingsConfig(row.settings_config),
        websiteUrl: row.website_url ?? undefined,
        category: row.category ?? undefined,
        createdAt: row.created_at ?? undefined,
        sortIndex: row.sort_index ?? undefined,
        note: row.notes ?? undefined,
      })),
    }
  } finally {
    db.close()
  }
}

function readLegacyJsonSource(filePath: string): CcSwitchSourceReadResult {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown
  const root = isRecord(parsed) ? parsed : {}
  const apps = isRecord(root.apps) ? root.apps : {}
  const claude = isRecord(apps.claude) ? apps.claude : {}
  const providers = isRecord(claude.providers) ? claude.providers : {}

  return {
    kind: "json",
    path: filePath,
    providers: Object.entries(providers).flatMap(([id, raw]) => {
      if (!isRecord(raw)) return []
      const settingsConfig = isRecord(raw.settingsConfig) ? raw.settingsConfig : {}
      return [{
        id,
        name: stringValue(raw.name) ?? id,
        settingsConfig,
        websiteUrl: stringValue(raw.websiteUrl),
        category: stringValue(raw.category),
        createdAt: numberValue(raw.createdAt),
        sortIndex: numberValue(raw.sortIndex),
        note: stringValue(raw.notes),
      }]
    }),
  }
}

function parseSettingsConfig(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown
  return isRecord(parsed) ? parsed : {}
}

function readEnv(settingsConfig: Record<string, unknown>): Record<string, unknown> {
  return isRecord(settingsConfig.env) ? settingsConfig.env : {}
}

function pickApiKeyField(env: Record<string, unknown>): ProviderApiKeyField | undefined {
  if (stringValue(env.ANTHROPIC_AUTH_TOKEN)) return "ANTHROPIC_AUTH_TOKEN"
  if (stringValue(env.ANTHROPIC_API_KEY)) return "ANTHROPIC_API_KEY"
  return undefined
}

function providerCategory(value: unknown): ProviderCategory {
  if (
    value === "official"
    || value === "cn_official"
    || value === "cloud_provider"
    || value === "aggregator"
    || value === "third_party"
    || value === "custom"
  ) {
    return value
  }
  return "custom"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}
```

- [ ] **Step 3: Export new types**

In `desktop/electron/services/provider/index.ts`, extend the type export block:

```ts
  type CcSwitchClaudeProviderImportResult,
  type CcSwitchClaudeProviderPreview,
  type CcSwitchClaudeProviderPreviewResult,
  type CcSwitchImportSource,
  type CcSwitchImportSourceKind,
  type ImportCcSwitchClaudeProvidersInput,
  type PreviewCcSwitchClaudeProvidersInput,
```

- [ ] **Step 4: Run importer tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- cc-switch-importer
```

Expected: PASS.

- [ ] **Step 5: Commit importer implementation**

```bash
git add desktop/electron/services/provider/cc-switch-importer.ts desktop/electron/services/provider/types.ts desktop/electron/services/provider/index.ts
git commit -m "feat: read cc switch claude providers"
```

---

### Task 3: ProviderService Preview and Import Methods

**Files:**
- Modify: `desktop/electron/services/provider/provider-service.ts`
- Modify: `desktop/electron/services/provider/__tests__/provider-service.test.ts`
- Test: `desktop/electron/services/provider/__tests__/provider-service.test.ts`

- [ ] **Step 1: Write failing ProviderService tests**

Append tests inside `describe("ProviderService", () => { ... })` in `desktop/electron/services/provider/__tests__/provider-service.test.ts`:

```ts
  it("previews CC Switch Claude providers without leaking API keys", async () => {
    const { service } = makeProviderService({
      ccSwitchImportSources: [{ kind: "sqlite", path: "/tmp/cc-switch.db" }],
      readCcSwitchClaudeProviders: () => ({
        kind: "sqlite",
        path: "/tmp/cc-switch.db",
        providers: [{
          id: "deepseek",
          name: "DeepSeek",
          category: "cn_official",
          settingsConfig: {
            env: {
              ANTHROPIC_AUTH_TOKEN: "sk-secret",
              ANTHROPIC_MODEL: "deepseek-chat",
            },
          },
        }],
      }),
    })

    await expect(service.previewCcSwitchClaudeProviders()).resolves.toEqual({
      sourcePath: "/tmp/cc-switch.db",
      sourceKind: "sqlite",
      items: [expect.objectContaining({
        id: "deepseek",
        name: "DeepSeek",
        model: "deepseek-chat",
        status: "ready",
        selectedByDefault: true,
      })],
    })
    expect(JSON.stringify(await service.previewCcSwitchClaudeProviders())).not.toContain("sk-secret")
  })

  it("imports selected CC Switch Claude providers through encrypted secrets", async () => {
    const { service, providers, secrets } = makeProviderService({
      ccSwitchImportSources: [{ kind: "sqlite", path: "/tmp/cc-switch.db" }],
      readCcSwitchClaudeProviders: () => ({
        kind: "sqlite",
        path: "/tmp/cc-switch.db",
        providers: [{
          id: "deepseek",
          name: "DeepSeek",
          category: "cn_official",
          settingsConfig: {
            env: {
              ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
              ANTHROPIC_AUTH_TOKEN: "sk-secret",
              ANTHROPIC_MODEL: "deepseek-chat",
            },
          },
        }],
      }),
    })

    await expect(service.importCcSwitchClaudeProviders({ providerIds: ["deepseek"] })).resolves.toMatchObject({
      imported: 1,
      skipped: 0,
      providers: [expect.objectContaining({ id: "deepseek", name: "DeepSeek" })],
    })
    await expect(providers.get("deepseek")).resolves.toMatchObject({
      secretRef: "provider:deepseek:api-key",
      baseUrl: "https://api.deepseek.com/anthropic",
      activeModel: "deepseek-chat",
    })
    await expect(secrets.get("provider:deepseek:api-key")).resolves.toMatchObject({
      value: "sk-secret",
    })
  })
```

Update the local `makeProviderService` helper signature in the same test file:

```ts
function makeProviderService(deps: {
  permissionGuard?: PermissionGuard
  auditSink?: AuditSink
  localClaudeSettingsPath?: string
  readTextFile?: (filePath: string) => Promise<string>
  ccSwitchImportSources?: CcSwitchImportSource[]
  readCcSwitchClaudeProviders?: (source: CcSwitchImportSource) => CcSwitchSourceReadResult
} = {}): {
```

Pass these deps into `new ProviderService({ ... })`.

- [ ] **Step 2: Run ProviderService tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop run test -- provider-service
```

Expected: FAIL because `ProviderService.previewCcSwitchClaudeProviders` does not exist.

- [ ] **Step 3: Implement ProviderService methods and injectable importer deps**

In `desktop/electron/services/provider/provider-service.ts`, add imports:

```ts
import {
  buildCcSwitchClaudeImportPreview,
  createInputFromRawProvider,
  readCcSwitchClaudeProvidersFromSource,
  resolveCcSwitchCandidateSources,
  sourceFromPath,
  type CcSwitchSourceReadResult,
} from "./cc-switch-importer"
```

Extend imported types from `./types`:

```ts
  CcSwitchClaudeProviderImportResult,
  CcSwitchImportSource,
  ImportCcSwitchClaudeProvidersInput,
  PreviewCcSwitchClaudeProvidersInput,
```

Extend `ProviderServiceDeps`:

```ts
  readonly ccSwitchImportSources?: readonly CcSwitchImportSource[]
  readonly readCcSwitchClaudeProviders?: (source: CcSwitchImportSource) => CcSwitchSourceReadResult
```

Add private fields in the class:

```ts
  private readonly ccSwitchImportSources?: readonly CcSwitchImportSource[]
  private readonly readCcSwitchClaudeProviders: (source: CcSwitchImportSource) => CcSwitchSourceReadResult
```

Assign in constructor:

```ts
    this.ccSwitchImportSources = deps.ccSwitchImportSources
    this.readCcSwitchClaudeProviders = deps.readCcSwitchClaudeProviders ?? readCcSwitchClaudeProvidersFromSource
```

Add methods before `buildEnv`:

```ts
  async previewCcSwitchClaudeProviders(
    input: PreviewCcSwitchClaudeProvidersInput = {},
  ): Promise<CcSwitchClaudeProviderPreviewResult> {
    const source = await this.resolveCcSwitchImportSource(input.sourcePath)
    if (!source) return { items: [] }
    await this.checkCcSwitchReadPermission(source.path, "preview")
    const result = this.readCcSwitchClaudeProviders(source)
    const existingIds = new Set((await this.listProviders()).map((provider) => provider.id))
    const preview = buildCcSwitchClaudeImportPreview(result.providers, existingIds)
    this.auditSink?.record({
      action: "provider.cc-switch.preview",
      actor: { kind: "user" },
      resource: source.path,
      outcome: "allowed",
      metadata: {
        sourceKind: source.kind,
        count: preview.items.length,
      },
    })
    return {
      ...preview,
      sourcePath: source.path,
      sourceKind: source.kind,
    }
  }

  async importCcSwitchClaudeProviders(
    input: ImportCcSwitchClaudeProvidersInput,
  ): Promise<CcSwitchClaudeProviderImportResult> {
    const source = await this.resolveCcSwitchImportSource(input.sourcePath)
    if (!source) return { imported: 0, skipped: input.providerIds.length, providers: [] }
    await this.checkCcSwitchReadPermission(source.path, "import")
    const result = this.readCcSwitchClaudeProviders(source)
    const selected = new Set(input.providerIds)
    const existingIds = new Set((await this.listProviders()).map((provider) => provider.id))
    const created: CCProvider[] = []
    let skipped = 0

    for (const provider of result.providers) {
      if (!selected.has(provider.id)) continue
      if (existingIds.has(provider.id)) {
        skipped += 1
        continue
      }
      const createInput = createInputFromRawProvider(provider)
      if (!createInput.apiKey) {
        skipped += 1
        continue
      }
      created.push(await this.createProvider(createInput))
      existingIds.add(provider.id)
    }

    this.auditSink?.record({
      action: "provider.cc-switch.import",
      actor: { kind: "user" },
      resource: source.path,
      outcome: "allowed",
      metadata: {
        sourceKind: source.kind,
        requested: input.providerIds.length,
        imported: created.length,
        skipped,
      },
    })

    return {
      imported: created.length,
      skipped,
      providers: created,
    }
  }
```

Add private helpers:

```ts
  private async resolveCcSwitchImportSource(sourcePath?: string): Promise<CcSwitchImportSource | null> {
    if (sourcePath?.trim()) return sourceFromPath(sourcePath.trim())
    const sources = this.ccSwitchImportSources ?? resolveCcSwitchCandidateSources()
    return sources[0] ?? null
  }

  private async checkCcSwitchReadPermission(filePath: string, action: "preview" | "import"): Promise<void> {
    const actor: ActorIdentity = { kind: "user" }
    const permissionAction = "provider.cc-switch.read"
    if (!this.permissionGuard) return
    const permission = await this.permissionGuard.check({
      action: permissionAction,
      actor,
      resource: filePath,
      context: { flow: action },
    })
    if (!permission.allowed) {
      this.auditSink?.record({
        action: permissionAction,
        actor,
        resource: filePath,
        outcome: "denied",
        metadata: {
          flow: action,
          reason: permission.reason,
          policyId: permission.policyId,
        },
      })
      throw new Error(permission.reason)
    }
  }
```

- [ ] **Step 4: Run ProviderService tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- provider-service
```

Expected: PASS.

- [ ] **Step 5: Commit ProviderService methods**

```bash
git add desktop/electron/services/provider/provider-service.ts desktop/electron/services/provider/__tests__/provider-service.test.ts
git commit -m "feat: import cc switch providers through provider service"
```

---

### Task 4: IPC and Bridge Wiring

**Files:**
- Modify: `desktop/electron/modules/agent/ipc-tools.ts`
- Modify: `desktop/electron/modules/agent/__tests__/ipc.test.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`

- [ ] **Step 1: Add failing IPC tests**

In `desktop/electron/modules/agent/__tests__/ipc.test.ts`, add tests near existing provider IPC tests:

```ts
  it("previews CC Switch Claude providers through IPC", async () => {
    const providerService = {
      previewCcSwitchClaudeProviders: vi.fn().mockResolvedValue({
        sourcePath: "/tmp/cc-switch.db",
        sourceKind: "sqlite",
        items: [{
          id: "deepseek",
          name: "DeepSeek",
          category: "cn_official",
          status: "ready",
          selectedByDefault: true,
        }],
      }),
    }
    const harness = createAgentIpcHarness({
      resolve: serviceResolver({ providerService }),
    })

    await expect(harness.invoke("synapse:agent:preview-cc-switch-claude-providers", {})).resolves.toEqual({
      sourcePath: "/tmp/cc-switch.db",
      sourceKind: "sqlite",
      items: [expect.objectContaining({ id: "deepseek", status: "ready" })],
    })
    expect(providerService.previewCcSwitchClaudeProviders).toHaveBeenCalledWith({})
  })

  it("imports selected CC Switch Claude providers through IPC", async () => {
    const providerService = {
      importCcSwitchClaudeProviders: vi.fn().mockResolvedValue({
        imported: 1,
        skipped: 0,
        providers: [publicProviderFixture({ id: "deepseek", name: "DeepSeek" })],
      }),
    }
    const harness = createAgentIpcHarness({
      resolve: serviceResolver({ providerService }),
    })

    await expect(harness.invoke("synapse:agent:import-cc-switch-claude-providers", {
      providerIds: ["deepseek"],
    })).resolves.toMatchObject({
      imported: 1,
      skipped: 0,
      providers: [expect.objectContaining({ id: "deepseek" })],
    })
    expect(providerService.importCcSwitchClaudeProviders).toHaveBeenCalledWith({
      providerIds: ["deepseek"],
    })
  })

  it("chooses a CC Switch import source through IPC", async () => {
    const harness = createAgentIpcHarness({
      dialog: {
        showOpenDialog: vi.fn().mockResolvedValue({
          canceled: false,
          filePaths: ["/tmp/cc-switch.db"],
        }),
      },
    })

    await expect(harness.invoke("synapse:agent:choose-cc-switch-claude-import-source", {})).resolves.toEqual({
      sourcePath: "/tmp/cc-switch.db",
    })
  })
```

- [ ] **Step 2: Run IPC tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop run test -- ipc.test
```

Expected: FAIL because the new IPC channels do not exist.

- [ ] **Step 3: Add IPC schemas and handlers**

In `desktop/electron/modules/agent/ipc-tools.ts`, change the Electron import:

```ts
import { BrowserWindow, dialog, shell } from "electron"
```

In `desktop/electron/modules/agent/ipc-tools.ts`, add request schemas after `createProviderFromPresetRequestSchema`:

```ts
const previewCcSwitchClaudeProvidersRequestSchema = z.object({
  sourcePath: z.string().min(1).optional(),
})

const importCcSwitchClaudeProvidersRequestSchema = z.object({
  providerIds: z.array(z.string().min(1)),
  sourcePath: z.string().min(1).optional(),
})

const chooseCcSwitchClaudeImportSourceRequestSchema = z.object({})
```

Add response schemas after `publicProviderPresetSchema`:

```ts
const ccSwitchClaudeProviderPreviewSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string().optional(),
  apiKeyField: providerApiKeyFieldSchema.optional(),
  model: z.string().optional(),
  category: providerCategorySchema,
  status: z.enum(["ready", "duplicate", "missing_api_key", "unsupported"]),
  selectedByDefault: z.boolean(),
})

const ccSwitchClaudeProviderPreviewResultSchema = z.object({
  sourcePath: z.string().optional(),
  sourceKind: z.enum(["sqlite", "json"]).optional(),
  items: z.array(ccSwitchClaudeProviderPreviewSchema),
})

const ccSwitchClaudeProviderImportResultSchema = z.object({
  imported: z.number(),
  skipped: z.number(),
  providers: z.array(publicProviderSchema),
})

const ccSwitchClaudeImportSourceSelectionSchema = z.object({
  sourcePath: z.string().optional(),
})
```

Add inferred types:

```ts
type PreviewCcSwitchClaudeProvidersRequest = z.infer<typeof previewCcSwitchClaudeProvidersRequestSchema>
type ImportCcSwitchClaudeProvidersRequest = z.infer<typeof importCcSwitchClaudeProvidersRequestSchema>
type ChooseCcSwitchClaudeImportSourceRequest = z.infer<typeof chooseCcSwitchClaudeImportSourceRequestSchema>
```

Add methods to `toolMethods` after `createProviderFromPreset`:

```ts
  previewCcSwitchClaudeProviders: {
    kind: "invoke",
    channel: "synapse:agent:preview-cc-switch-claude-providers",
    request: previewCcSwitchClaudeProvidersRequestSchema,
    response: ccSwitchClaudeProviderPreviewResultSchema,
    handler: async (ctx, request: PreviewCcSwitchClaudeProvidersRequest) => {
      const providerService = resolveGlobalProviderService(ctx.resolve)
      return providerService.previewCcSwitchClaudeProviders(request)
    },
  },
  importCcSwitchClaudeProviders: {
    kind: "invoke",
    channel: "synapse:agent:import-cc-switch-claude-providers",
    request: importCcSwitchClaudeProvidersRequestSchema,
    response: ccSwitchClaudeProviderImportResultSchema,
    handler: async (ctx, request: ImportCcSwitchClaudeProvidersRequest) => {
      const providerService = resolveGlobalProviderService(ctx.resolve)
      const result = await providerService.importCcSwitchClaudeProviders(request)
      return {
        imported: result.imported,
        skipped: result.skipped,
        providers: result.providers.map(publicProvider),
      }
    },
  },
  chooseCcSwitchClaudeImportSource: {
    kind: "invoke",
    channel: "synapse:agent:choose-cc-switch-claude-import-source",
    request: chooseCcSwitchClaudeImportSourceRequestSchema,
    response: ccSwitchClaudeImportSourceSelectionSchema,
    handler: async (_ctx, _request: ChooseCcSwitchClaudeImportSourceRequest) => {
      const parentWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((window) => window.isVisible()) ?? undefined
      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, {
          properties: ["openFile"],
          filters: [{ name: "CC Switch", extensions: ["db", "json"] }],
        })
        : await dialog.showOpenDialog({
          properties: ["openFile"],
          filters: [{ name: "CC Switch", extensions: ["db", "json"] }],
        })
      return {
        sourcePath: result.canceled ? undefined : result.filePaths[0],
      }
    },
  },
```

- [ ] **Step 4: Add preload channels and bridge methods**

In `desktop/electron/preload.ts`, add to `IPC_CHANNELS.agent`:

```ts
    "previewCcSwitchClaudeProviders": "synapse:agent:preview-cc-switch-claude-providers",
    "importCcSwitchClaudeProviders": "synapse:agent:import-cc-switch-claude-providers",
    "chooseCcSwitchClaudeImportSource": "synapse:agent:choose-cc-switch-claude-import-source",
```

Add to the exposed `agent` object after `createProviderFromPreset`:

```ts
    previewCcSwitchClaudeProviders: (args) =>
      invoke(IPC_CHANNELS.agent.previewCcSwitchClaudeProviders)(args ?? {}),
    importCcSwitchClaudeProviders: (args) =>
      invoke(IPC_CHANNELS.agent.importCcSwitchClaudeProviders)(args),
    chooseCcSwitchClaudeImportSource: () =>
      invoke(IPC_CHANNELS.agent.chooseCcSwitchClaudeImportSource)({}),
```

- [ ] **Step 5: Add renderer bridge types**

In `desktop/src/types/bridge.ts`, add near provider types:

```ts
export type SynapseCcSwitchClaudeProviderImportStatus =
  | "ready"
  | "duplicate"
  | "missing_api_key"
  | "unsupported"

export type SynapseCcSwitchClaudeProviderPreview = {
  readonly id: string
  readonly name: string
  readonly baseUrl?: string
  readonly apiKeyField?: SynapseAgentProviderApiKeyField
  readonly model?: string
  readonly category: SynapseAgentProviderCategory
  readonly status: SynapseCcSwitchClaudeProviderImportStatus
  readonly selectedByDefault: boolean
}

export type SynapseCcSwitchClaudeProviderPreviewResult = {
  readonly sourcePath?: string
  readonly sourceKind?: "sqlite" | "json"
  readonly items: readonly SynapseCcSwitchClaudeProviderPreview[]
}

export type SynapseCcSwitchClaudeProviderImportResult = {
  readonly imported: number
  readonly skipped: number
  readonly providers: readonly SynapseAgentProvider[]
}

export type SynapseCcSwitchClaudeImportSourceSelection = {
  readonly sourcePath?: string
}
```

Add methods to `SynapseBridge["agent"]`:

```ts
    previewCcSwitchClaudeProviders: (
      args?: { sourcePath?: string },
    ) => Promise<SynapseCcSwitchClaudeProviderPreviewResult>
    importCcSwitchClaudeProviders: (
      args: { providerIds: readonly string[]; sourcePath?: string },
    ) => Promise<SynapseCcSwitchClaudeProviderImportResult>
    chooseCcSwitchClaudeImportSource: () => Promise<SynapseCcSwitchClaudeImportSourceSelection>
```

- [ ] **Step 6: Regenerate IPC channels and run IPC tests**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
pnpm --filter @synapse/desktop run test -- ipc.test
```

Expected: PASS.

- [ ] **Step 7: Commit IPC and bridge wiring**

```bash
git add desktop/electron/modules/agent/ipc-tools.ts desktop/electron/modules/agent/__tests__/ipc.test.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/electron/generated/ipc-channels.generated.ts
git commit -m "feat: expose cc switch provider import ipc"
```

---

### Task 5: Import Dialog UI Tests

**Files:**
- Create: `desktop/src/modules/settings/components/cc-switch-import-dialog.tsx`
- Create: `desktop/src/modules/settings/components/__tests__/cc-switch-import-dialog.test.tsx`

- [ ] **Step 1: Write failing dialog tests**

Create `desktop/src/modules/settings/components/__tests__/cc-switch-import-dialog.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CcSwitchImportDialog } from "@/modules/settings/components/cc-switch-import-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const logger = vi.hoisted(() => ({ error: vi.fn() }))
const toast = vi.hoisted(() => vi.fn())

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => logger,
}))

vi.mock("sonner", () => ({ toast }))

let roots: Root[] = []

beforeEach(() => {
  logger.error.mockClear()
  toast.mockClear()
})

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("CcSwitchImportDialog", () => {
  it("loads preview, selects ready rows, and imports selected providers", async () => {
    const previewCcSwitchClaudeProviders = vi.fn().mockResolvedValue({
      sourcePath: "/Users/test/.cc-switch/cc-switch.db",
      sourceKind: "sqlite",
      items: [
        {
          id: "deepseek",
          name: "DeepSeek",
          baseUrl: "https://api.deepseek.com/anthropic",
          apiKeyField: "ANTHROPIC_AUTH_TOKEN",
          model: "deepseek-chat",
          category: "cn_official",
          status: "ready",
          selectedByDefault: true,
        },
        {
          id: "missing",
          name: "Missing",
          category: "custom",
          status: "missing_api_key",
          selectedByDefault: false,
        },
      ],
    })
    const importCcSwitchClaudeProviders = vi.fn().mockResolvedValue({
      imported: 1,
      skipped: 0,
      providers: [],
    })
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          previewCcSwitchClaudeProviders,
          importCcSwitchClaudeProviders,
          chooseCcSwitchClaudeImportSource: vi.fn(),
        },
      },
    })
    const onImported = vi.fn()

    renderDialog({ open: true, onImported })
    await flush()

    expect(document.body.textContent).toContain("从 CCS 导入")
    expect(document.body.textContent).toContain("DeepSeek")
    expect(document.body.textContent).toContain("https://api.deepseek.com/anthropic")
    expect(document.body.textContent).toContain("可导入")
    expect(document.body.textContent).toContain("缺少 API Key")

    await act(async () => {
      buttonByText("导入所选").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(importCcSwitchClaudeProviders).toHaveBeenCalledWith({
      providerIds: ["deepseek"],
      sourcePath: "/Users/test/.cc-switch/cc-switch.db",
    })
    expect(onImported).toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith("已导入")
  })

  it("shows empty state and retry state with short copy", async () => {
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          previewCcSwitchClaudeProviders: vi.fn().mockResolvedValue({ items: [] }),
          importCcSwitchClaudeProviders: vi.fn(),
          chooseCcSwitchClaudeImportSource: vi.fn().mockResolvedValue({
            sourcePath: "/Users/test/.cc-switch/config.json",
          }),
        },
      },
    })

    renderDialog({ open: true })
    await flush()

    expect(document.body.textContent).toContain("未找到 CC Switch 配置")
    expect(document.body.textContent).toContain("选择文件")
    expect(buttonByText("导入所选").hasAttribute("disabled")).toBe(true)

    await act(async () => {
      buttonByText("选择文件").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.synapse.agent.previewCcSwitchClaudeProviders).toHaveBeenLastCalledWith({
      sourcePath: "/Users/test/.cc-switch/config.json",
    })
  })
})

function renderDialog(props: Partial<React.ComponentProps<typeof CcSwitchImportDialog>> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(
      <CcSwitchImportDialog
        open={props.open ?? true}
        onOpenChange={props.onOpenChange ?? vi.fn()}
        onImported={props.onImported ?? vi.fn()}
      />,
    )
  })
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button")).find((item) => item.textContent?.includes(text))
  if (!button) throw new Error(`Button not found: ${text}`)
  return button as HTMLButtonElement
}
```

- [ ] **Step 2: Run dialog tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop run test -- cc-switch-import-dialog
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Commit failing dialog tests**

```bash
git add desktop/src/modules/settings/components/__tests__/cc-switch-import-dialog.test.tsx
git commit -m "test: cover cc switch import dialog"
```

---

### Task 6: Import Dialog UI Implementation

**Files:**
- Create: `desktop/src/modules/settings/components/cc-switch-import-dialog.tsx`
- Modify: `desktop/src/modules/settings/components/provider-panel.tsx`
- Modify: `desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx`
- Test: `desktop/src/modules/settings/components/__tests__/cc-switch-import-dialog.test.tsx`
- Test: `desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx`

- [ ] **Step 1: Implement dialog component**

Create `desktop/src/modules/settings/components/cc-switch-import-dialog.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react"
import { FileUp, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { createRendererLogger } from "@/app-shell/logging"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseCcSwitchClaudeProviderImportStatus,
  SynapseCcSwitchClaudeProviderPreview,
  SynapseCcSwitchClaudeProviderPreviewResult,
} from "@/types/bridge"

const logger = createRendererLogger("settings.providers.cc-switch-import")

type CcSwitchImportDialogProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onImported: () => void | Promise<void>
}

function CcSwitchImportDialog({
  open,
  onOpenChange,
  onImported,
}: CcSwitchImportDialogProps) {
  const [preview, setPreview] = useState<SynapseCcSwitchClaudeProviderPreviewResult | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPreview = useCallback(async (sourcePath?: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = await requireSynapseBridge().agent.previewCcSwitchClaudeProviders(
        sourcePath ? { sourcePath } : undefined,
      )
      setPreview(result)
      setSelectedIds(new Set(result.items.filter((item) => item.selectedByDefault).map((item) => item.id)))
    } catch (rawError) {
      logger.error("CC Switch provider preview failed.", {
        boundary: "settings.providers.cc-switch.preview",
        ...errorDiagnostic(rawError),
      })
      setPreview(null)
      setSelectedIds(new Set())
      setError("读取失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void loadPreview()
  }, [loadPreview, open])

  const items = preview?.items ?? []
  const selectedCount = selectedIds.size
  const canImport = selectedCount > 0 && !loading && !importing

  const toggleItem = (item: SynapseCcSwitchClaudeProviderPreview, checked: boolean) => {
    if (item.status !== "ready") return
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(item.id)
      else next.delete(item.id)
      return next
    })
  }

  const handleChooseSource = useCallback(async () => {
    try {
      const result = await requireSynapseBridge().agent.chooseCcSwitchClaudeImportSource()
      if (!result.sourcePath) return
      await loadPreview(result.sourcePath)
    } catch (rawError) {
      logger.error("CC Switch import source picker failed.", {
        boundary: "settings.providers.cc-switch.choose-source",
        ...errorDiagnostic(rawError),
      })
      toast("选择文件失败")
    }
  }, [loadPreview])

  const handleImport = async () => {
    if (!canImport) return
    setImporting(true)
    try {
      await requireSynapseBridge().agent.importCcSwitchClaudeProviders({
        providerIds: Array.from(selectedIds),
        sourcePath: preview?.sourcePath,
      })
      toast("已导入")
      await onImported()
      onOpenChange(false)
    } catch (rawError) {
      logger.error("CC Switch provider import failed.", {
        boundary: "settings.providers.cc-switch.import",
        ...errorDiagnostic(rawError),
      })
      toast("导入失败")
    } finally {
      setImporting(false)
    }
  }

  const body = useMemo(() => {
    if (loading) {
      return <p className="text-sm text-muted-foreground">正在扫描</p>
    }
    if (error) {
      return (
        <div className="flex items-center gap-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadPreview()}>
            <RefreshCw data-icon="inline-start" />
            重试
          </Button>
        </div>
      )
    }
    if (items.length === 0) {
      return (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">未找到 CC Switch 配置</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleChooseSource()}>
            <FileUp data-icon="inline-start" />
            选择文件
          </Button>
        </div>
      )
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">选择</TableHead>
            <TableHead>名称</TableHead>
            <TableHead>请求地址</TableHead>
            <TableHead>模型</TableHead>
            <TableHead>Key 字段</TableHead>
            <TableHead>状态</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <Checkbox
                  aria-label={`选择 ${item.name}`}
                  checked={selectedIds.has(item.id)}
                  disabled={item.status !== "ready"}
                  onCheckedChange={(checked) => toggleItem(item, checked === true)}
                />
              </TableCell>
              <TableCell className="font-medium">{item.name}</TableCell>
              <TableCell>{item.baseUrl || "-"}</TableCell>
              <TableCell>{item.model || "-"}</TableCell>
              <TableCell>{item.apiKeyField || "-"}</TableCell>
              <TableCell>
                <Badge variant={item.status === "ready" ? "secondary" : "outline"}>
                  {statusLabel(item.status)}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }, [error, handleChooseSource, items, loadPreview, loading, selectedIds])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>从 CCS 导入</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          {body}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={!canImport} onClick={() => void handleImport()}>
            导入所选
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function statusLabel(status: SynapseCcSwitchClaudeProviderImportStatus): string {
  if (status === "ready") return "可导入"
  if (status === "duplicate") return "已存在"
  if (status === "missing_api_key") return "缺少 API Key"
  return "无法识别"
}

function errorDiagnostic(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const text = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: text.length,
  }
}

export { CcSwitchImportDialog }
```

- [ ] **Step 2: Add button and dialog to ProviderPanel**

In `desktop/src/modules/settings/components/provider-panel.tsx`, add imports:

```tsx
import { CcSwitchImportDialog } from "./cc-switch-import-dialog"
```

Add state in `ProviderPanel`:

```tsx
  const [ccSwitchImportOpen, setCcSwitchImportOpen] = useState(false)
```

Pass props to `ProviderPanelView`:

```tsx
        onImportFromCcSwitch={() => setCcSwitchImportOpen(true)}
```

Render dialog after `ProviderFormDialog`:

```tsx
      <CcSwitchImportDialog
        open={ccSwitchImportOpen}
        onOpenChange={setCcSwitchImportOpen}
        onImported={() => refresh()}
      />
```

Extend `ProviderPanelViewProps`:

```ts
  readonly onImportFromCcSwitch: () => void
```

Add the button next to `新建`:

```tsx
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onImportFromCcSwitch}>
            从 CCS 导入
          </Button>
          <Button type="button" size="sm" onClick={onAdd}>
            <Plus data-icon="inline-start" />
            新建
          </Button>
        </div>
```

- [ ] **Step 3: Add ProviderPanel integration test**

In `desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx`, add:

```tsx
  it("opens the CC Switch import dialog from the provider panel", async () => {
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
          previewCcSwitchClaudeProviders: vi.fn().mockResolvedValue({
            items: [{
              id: "deepseek",
              name: "DeepSeek",
              category: "cn_official",
              status: "ready",
              selectedByDefault: true,
            }],
          }),
          importCcSwitchClaudeProviders: vi.fn(),
        },
      },
    })

    renderProviderPanel()
    await flush()

    await act(async () => {
      buttonByText(document.body, "从 CCS 导入").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("从 CCS 导入")
    expect(document.body.textContent).toContain("DeepSeek")
    expect(document.body.textContent).toContain("可导入")
  })
```

- [ ] **Step 4: Run UI tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- cc-switch-import-dialog provider-panel
```

Expected: PASS.

- [ ] **Step 5: Commit UI implementation**

```bash
git add desktop/src/modules/settings/components/cc-switch-import-dialog.tsx desktop/src/modules/settings/components/provider-panel.tsx desktop/src/modules/settings/components/__tests__/cc-switch-import-dialog.test.tsx desktop/src/modules/settings/components/__tests__/provider-panel.test.tsx
git commit -m "feat: add cc switch import dialog"
```

---

### Task 7: Final Verification

**Files:**
- No new files.
- Verify all implementation files touched in Tasks 1-6.

- [ ] **Step 1: Run typecheck**

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run focused tests**

```bash
pnpm --filter @synapse/desktop run test -- cc-switch-importer provider-service ipc.test cc-switch-import-dialog provider-panel
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Inspect diff for UI and security constraints**

Run:

```bash
git diff --check
rg -n "style=\\{|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|console\\.log|ipcMain\\.handle|ipcMain\\.on|webContents\\.send|fs\\.writeFile" desktop/src/modules/settings desktop/electron/services/provider desktop/electron/modules/agent desktop/electron/preload.ts desktop/src/types/bridge.ts
```

Expected:

- `git diff --check` prints no errors.
- `rg` prints no new violations from the CC Switch import changes.

- [ ] **Step 5: Commit final verification fixes if needed**

If verification required small fixes:

```bash
git add desktop/electron/services/provider desktop/electron/modules/agent desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/src/modules/settings
git commit -m "fix: polish cc switch import verification"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Only `claude` providers are imported: Tasks 1 and 2 filter `app_type = 'claude'`.
- SQLite primary source and JSON fallback are covered: Tasks 1 and 2.
- macOS/Windows path differences are covered: Task 1 path test and Task 2 resolver.
- Scan/preview/checkbox import UX is covered: Tasks 5 and 6.
- API Key secret handling is covered: Task 3.
- PermissionGuard/AuditSink boundary is covered: Task 3 implementation.
- IPC and bridge typing are covered: Task 4.
- shadcn/Radix UI constraints are covered: Task 6 implementation and Task 7 scan.
- Verification without dev server/browser preview is covered: Task 7.

Placeholder scan:

- No placeholder markers or unspecified “add tests” steps.
- Each task names exact files and commands.

Type consistency:

- Main-process result types use `CcSwitch...`.
- Renderer-facing result types use `SynapseCcSwitch...`.
- IPC method names match preload and bridge: `previewCcSwitchClaudeProviders`, `importCcSwitchClaudeProviders`, and `chooseCcSwitchClaudeImportSource`.
