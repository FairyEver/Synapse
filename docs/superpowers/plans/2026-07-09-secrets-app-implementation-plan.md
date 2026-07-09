# Secrets App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `密钥库` system app as the single owner of user-scoped local secrets and retire the old Settings variables capability.

**Architecture:** Add `desktop/app-capabilities/secrets/` with shared schemas, a main-process `SecretsService`, IPC, MCP dispatcher, and renderer UI. Move active storage from `config.global.variables` to DataRepository namespaces `app.secrets.items` and `app.secrets.settings`, with one-time startup migration from legacy config. Replace old `app.settings.variable.*` MCP tools with `app.secrets.item.*` tools and update installer flows to read/write through Secrets IPC.

**Tech Stack:** Electron 41, Vite 8, React 19, TypeScript 6, zod, shadcn/ui, Tailwind CSS 4, Vitest, DataRepository.

## Global Constraints

- App name is `密钥库`.
- App id is `secrets`.
- App namespace is `secrets`.
- DataRepository namespaces are `app.secrets.items` and `app.secrets.settings`.
- MCP actions are `app.secrets.item.list/get/create/update/upsert/delete`.
- MCP tools are `app_secrets_item_list/get/create/update/upsert/delete`.
- Do not support old `app.settings.variable.*` actions or `app_settings_variable_*` tools.
- Do not keep a Settings page for editing secrets.
- Do not introduce repository-scoped secrets.
- Secret names allow only letters, digits, and underscores, with case-insensitive matching.
- List and default get return safe views without values.
- Only `get({ includeValue: true })` returns `value`, after `secret.read`.
- Mutations require `secret.write` and return safe views only.
- Stored values must not appear in logs, audits, diagnostics, error metadata, or success toasts.
- UI uses existing shadcn components and Tailwind tokens only; no custom colors, card nesting, marketing copy, or decorative styling.
- The existing icon asset is already placed at `desktop/app-capabilities/secrets/renderer/assets/icon.png`; include it in the first implementation commit.

---

## File Structure

Create:

- `desktop/app-capabilities/secrets/shared/capability.ts`: constants for app id, namespaces, capability ids, MCP tool names.
- `desktop/app-capabilities/secrets/shared/schema.ts`: zod schemas and exported TypeScript types for IPC, service input, safe views, and changed events.
- `desktop/app-capabilities/secrets/main/service.ts`: core CRUD, migration, audit-safe event emission, and service factory.
- `desktop/app-capabilities/secrets/main/dispatcher.ts`: MCP dispatcher using `SecretsService` and permission/audit checks.
- `desktop/app-capabilities/secrets/main/ipc.ts`: IPC module and changed event broadcast wiring.
- `desktop/app-capabilities/secrets/main/__tests__/service.test.ts`: service behavior and migration tests.
- `desktop/app-capabilities/secrets/main/__tests__/dispatcher.test.ts`: MCP dispatcher permission and redaction tests.
- `desktop/app-capabilities/secrets/main/__tests__/ipc.test.ts`: IPC schema and event tests.
- `desktop/app-capabilities/secrets/renderer/app-definition.ts`: system app definition.
- `desktop/app-capabilities/secrets/renderer/app-manifest.ts`: system app manifest using `renderer/assets/icon.png`.
- `desktop/app-capabilities/secrets/renderer/index.tsx`: `SecretsModule` UI.
- `desktop/app-capabilities/secrets/renderer/__tests__/secrets-app.test.tsx`: renderer tests.
- `desktop/electron/runtime/data-repo/schemas/secrets.ts`: DataRepository schema definitions.
- `desktop/app-capabilities/synapse-skill/skill-package/secrets/index.md`: Agent guide for the new Secrets MCP.
- `desktop/app-capabilities/synapse-skill/skill-package/secrets/api-reference.md`: new tool reference.

Modify:

- `desktop/electron/runtime/data-repo/schemas/index.ts`: export and register Secrets schemas.
- `desktop/electron/runtime/data-repo/factory.ts`: add SQLite index for `app.secrets.items`.
- `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts`: assert new namespaces.
- `desktop/electron/bootstrap/descriptors.ts`: register `core.secrets`, wire app dispatcher, remove variable dispatcher usage.
- `desktop/electron/bootstrap/ipc-registry.ts`: register `secretsIpcModule`.
- `desktop/electron/preload.ts`: expose `window.synapse.secrets`.
- `desktop/electron/generated/ipc-channels.generated.ts`: update by running `pnpm --filter @synapse/desktop run generate:ipc`.
- `desktop/src/types/bridge.ts`: add Secrets bridge domain types.
- `desktop/src/modules/apps/types.ts`: add `secrets` id and namespace.
- `desktop/src/modules/apps/definitions.ts`: register `secretsAppDefinition`.
- `desktop/src/modules/apps/registry.ts`: register `secretsAppManifest`.
- `desktop/src/modules/apps/components/system-app-content.tsx`: render `<SecretsModule />`.
- `desktop/src/modules/apps/__tests__/registry.test.ts`: update app ordering and manifest expectations.
- `desktop/app-capabilities/dispatcher.ts`: route Secrets app capability ids.
- `desktop/app-capabilities/__tests__/dispatcher.test.ts`: verify routing.
- `desktop/synapse-capabilities/shared/app-domain.ts`: register Secrets capabilities and tools.
- `desktop/synapse-capabilities/shared/registry.ts`: remove variable domain and rely on app domain for Secrets.
- `desktop/synapse-capabilities/shared/variable-domain.ts`: delete after callers are gone.
- `desktop/electron/capabilities/action-router.ts`: remove legacy `variable.` and `app.settings.variable.` routing.
- `desktop/electron/capabilities/__tests__/action-router.test.ts`: assert new routing and old action rejection.
- `desktop/electron/capabilities/__tests__/variable-dispatcher.test.ts`: delete after Secrets dispatcher tests replace it.
- `desktop/src/modules/installers/shared/shared-installer-flow.tsx`: use Secrets bridge instead of `config.global.variables`.
- `desktop/src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx`: update mocks and assertions.
- `desktop/src/modules/content/lib/repository-variables.ts`: keep the existing path and replace contents with secret-change helpers.
- `desktop/src/modules/content/lib/__tests__/repository-variables.test.ts`: replace with Secrets change-set tests.
- `desktop/src/modules/content/components/variable-substitution-dialog.tsx`: accept Secrets safe views and resolved input values.
- `desktop/src/modules/content/components/variable-save-confirmation-dialog.tsx`: rename labels/types to secrets.
- `desktop/src/modules/settings/types.ts`: remove `variables` category.
- `desktop/src/modules/settings/data.ts`: remove variables entry.
- `desktop/src/modules/settings/index.tsx`: remove `VariablesPanel` route.
- `desktop/src/modules/settings/components/variables-panel.tsx`: delete.
- `desktop/src/modules/settings/components/__tests__/variables-panel.test.tsx`: delete.
- `desktop/src/modules/settings/__tests__/settings-categories.test.ts`: assert variables category is absent.
- `desktop/src/types/config.ts`: keep `SynapseVariable` and `global.variables` only as migration input for now.
- `desktop/src/lib/config.ts`: keep legacy normalization for migration input, but do not add new consumers.
- `desktop/electron/services/config-backup-service.ts`: include DataRepository metadata without secret values.
- `desktop/electron/services/__tests__/config-backup-service.test.ts`: assert secret values are omitted/redacted.
- `desktop/electron/services/diagnostics-service.ts`: replace variable diagnostics with secret inventory count/names and omit values.
- `desktop/electron/services/__tests__/diagnostics-service.test.ts`: assert no secret values.
- `desktop/app-capabilities/synapse-skill/skill-package/variable/index.md`: remove.
- `desktop/app-capabilities/synapse-skill/skill-package/variable/api-reference.md`: remove.
- `desktop/tests/unit/api-mcp-capability-surface.test.ts`: update tool surface expectations.
- `desktop/tests/unit/synapse-capabilities.test.ts`: update capability domain expectations.
- `desktop/tests/unit/capability-naming.test.ts`: add app secrets naming coverage.
- `RELEASE_NOTES_PENDING.md`: add user-facing note about the new `密钥库` app and migration.

---

### Task 1: Shared Contracts And DataRepository Schema

**Files:**
- Create: `desktop/app-capabilities/secrets/shared/capability.ts`
- Create: `desktop/app-capabilities/secrets/shared/schema.ts`
- Create: `desktop/electron/runtime/data-repo/schemas/secrets.ts`
- Modify: `desktop/electron/runtime/data-repo/schemas/index.ts`
- Modify: `desktop/electron/runtime/data-repo/factory.ts`
- Modify: `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts`
- Include: `desktop/app-capabilities/secrets/renderer/assets/icon.png`

**Interfaces:**
- Produces `SECRETS_APP_ID = "secrets"`, `SECRETS_ITEMS_NAMESPACE = "app.secrets.items"`, and `SECRETS_SETTINGS_NAMESPACE = "app.secrets.settings"`.
- Produces zod schemas `secretSafeViewSchema`, `secretItemSchema`, `secretCreateInputSchema`, `secretUpdateInputSchema`, `secretUpsertInputSchema`, `secretDeleteInputSchema`, `secretGetInputSchema`, and `secretsChangedEventSchema`.
- Produces DataRepository interfaces `SecretItemEntryV1` and `SecretSettingsEntryV1`.

- [ ] **Step 1: Write failing schema registration test**

Edit `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts` and add these expected namespace strings to the `allSchemas exposes runtime namespaces` array:

```ts
"app.secrets.items",
"app.secrets.settings",
```

Add backend assertions in `backend kind matches SPEC §5 namespace strategy`:

```ts
expect(secretsItemsSchema.backend).toBe("sqlite")
expect(secretsSettingsSchema.backend).toBe("json")
```

Also import the new schema exports at the top:

```ts
secretsItemsSchema,
secretsSettingsSchema,
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/runtime/data-repo/__tests__/schemas.test.ts
```

Expected: FAIL because `secretsItemsSchema` and `secretsSettingsSchema` are not exported.

- [ ] **Step 3: Add shared capability constants**

Create `desktop/app-capabilities/secrets/shared/capability.ts`:

```ts
import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const SECRETS_APP_ID = "secrets" as const
export const SECRETS_NAMESPACE = "secrets" as const
export const SECRETS_ITEMS_NAMESPACE = "app.secrets.items" as const
export const SECRETS_SETTINGS_NAMESPACE = "app.secrets.settings" as const

export const SECRETS_ITEM_LIST_CAPABILITY_ID = "app.secrets.item.list" as CapabilityId
export const SECRETS_ITEM_GET_CAPABILITY_ID = "app.secrets.item.get" as CapabilityId
export const SECRETS_ITEM_CREATE_CAPABILITY_ID = "app.secrets.item.create" as CapabilityId
export const SECRETS_ITEM_UPDATE_CAPABILITY_ID = "app.secrets.item.update" as CapabilityId
export const SECRETS_ITEM_UPSERT_CAPABILITY_ID = "app.secrets.item.upsert" as CapabilityId
export const SECRETS_ITEM_DELETE_CAPABILITY_ID = "app.secrets.item.delete" as CapabilityId

export const SECRETS_CAPABILITY_IDS = [
  SECRETS_ITEM_LIST_CAPABILITY_ID,
  SECRETS_ITEM_GET_CAPABILITY_ID,
  SECRETS_ITEM_CREATE_CAPABILITY_ID,
  SECRETS_ITEM_UPDATE_CAPABILITY_ID,
  SECRETS_ITEM_UPSERT_CAPABILITY_ID,
  SECRETS_ITEM_DELETE_CAPABILITY_ID,
] as const

export const SECRETS_MCP_TOOL_NAMES = {
  list: "app_secrets_item_list",
  get: "app_secrets_item_get",
  create: "app_secrets_item_create",
  update: "app_secrets_item_update",
  upsert: "app_secrets_item_upsert",
  delete: "app_secrets_item_delete",
} as const
```

- [ ] **Step 4: Add shared zod schemas**

Create `desktop/app-capabilities/secrets/shared/schema.ts`:

```ts
import { z } from "zod"

export const SECRET_NAME_REGEX = /^[A-Za-z0-9_]+$/

export const secretNameSchema = z.string()
  .trim()
  .min(1, "密钥名称不能为空")
  .regex(SECRET_NAME_REGEX, "密钥名称只能包含字母、数字和下划线")

export const secretSafeViewSchema = z.object({
  id: z.string().min(1),
  name: secretNameSchema,
  description: z.string().optional(),
  hasValue: z.boolean(),
})

export const secretValueViewSchema = secretSafeViewSchema.extend({
  value: z.string(),
})

export const secretItemSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  name: secretNameSchema,
  value: z.string(),
  description: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

export const secretListResultSchema = z.object({
  secrets: z.array(secretSafeViewSchema),
  total: z.number().int().nonnegative(),
})

export const secretGetInputSchema = z.object({
  name: secretNameSchema,
  includeValue: z.boolean().optional(),
})

export const secretCreateInputSchema = z.object({
  name: secretNameSchema,
  value: z.string(),
  description: z.string().optional(),
})

export const secretUpdateInputSchema = z.object({
  name: secretNameSchema,
  newName: secretNameSchema.optional(),
  value: z.string().optional(),
  description: z.string().optional(),
})

export const secretUpsertInputSchema = z.object({
  name: secretNameSchema,
  value: z.string().optional(),
  description: z.string().optional(),
})

export const secretDeleteInputSchema = z.object({
  name: secretNameSchema,
})

export const secretsChangedEventSchema = z.object({
  secrets: z.array(secretSafeViewSchema),
})

export type SecretSafeView = z.infer<typeof secretSafeViewSchema>
export type SecretValueView = z.infer<typeof secretValueViewSchema>
export type SecretListResult = z.infer<typeof secretListResultSchema>
export type SecretGetInput = z.infer<typeof secretGetInputSchema>
export type SecretCreateInput = z.infer<typeof secretCreateInputSchema>
export type SecretUpdateInput = z.infer<typeof secretUpdateInputSchema>
export type SecretUpsertInput = z.infer<typeof secretUpsertInputSchema>
export type SecretDeleteInput = z.infer<typeof secretDeleteInputSchema>
export type SecretsChangedEvent = z.infer<typeof secretsChangedEventSchema>
```

- [ ] **Step 5: Add DataRepository schemas**

Create `desktop/electron/runtime/data-repo/schemas/secrets.ts`:

```ts
import type { Migration, NamespaceSchema } from "../types"

export interface SecretItemEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  name: string
  value: string
  description?: string
  createdAt: string
  updatedAt: string
}

export interface SecretSettingsEntryV1 extends Record<string, unknown> {
  schemaVersion: 1
  legacyConfigMigratedAt: string | null
}

const noMigrations: readonly Migration[] = []

export const secretsItemsSchema: NamespaceSchema<SecretItemEntryV1> = {
  name: "app.secrets.items",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isSecretItemEntryV1,
  encrypted: false,
}

export const secretsSettingsSchema: NamespaceSchema<SecretSettingsEntryV1> = {
  name: "app.secrets.settings",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isSecretSettingsEntryV1,
  encrypted: false,
  defaults: () => ({
    schemaVersion: 1,
    legacyConfigMigratedAt: null,
  }),
}

function isSecretItemEntryV1(value: unknown): value is SecretItemEntryV1 {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
    && typeof value.id === "string"
    && value.id.trim().length > 0
    && typeof value.name === "string"
    && /^[A-Za-z0-9_]+$/.test(value.name)
    && typeof value.value === "string"
    && (value.description === undefined || typeof value.description === "string")
    && isIsoDateString(value.createdAt)
    && isIsoDateString(value.updatedAt)
}

function isSecretSettingsEntryV1(value: unknown): value is SecretSettingsEntryV1 {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
    && (value.legacyConfigMigratedAt === null || isIsoDateString(value.legacyConfigMigratedAt))
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && !Number.isNaN(Date.parse(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
```

- [ ] **Step 6: Export schemas and add factory index**

In `desktop/electron/runtime/data-repo/schemas/index.ts`, export the new schema:

```ts
export {
  secretsItemsSchema,
  secretsSettingsSchema,
  type SecretItemEntryV1,
  type SecretSettingsEntryV1,
} from "./secrets"
```

Add `secretsItemsSchema` and `secretsSettingsSchema` to `allSchemas` in the same file.

In `desktop/electron/runtime/data-repo/factory.ts`, add:

```ts
case "app.secrets.items":
  return ["json_extract(value, '$.name'), id"]
```

- [ ] **Step 7: Run schema tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/runtime/data-repo/__tests__/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/app-capabilities/secrets/shared/capability.ts \
  desktop/app-capabilities/secrets/shared/schema.ts \
  desktop/app-capabilities/secrets/renderer/assets/icon.png \
  desktop/electron/runtime/data-repo/schemas/secrets.ts \
  desktop/electron/runtime/data-repo/schemas/index.ts \
  desktop/electron/runtime/data-repo/factory.ts \
  desktop/electron/runtime/data-repo/__tests__/schemas.test.ts
git commit -m "feat: add secrets data schema"
```

---

### Task 2: SecretsService With Migration

**Files:**
- Create: `desktop/app-capabilities/secrets/main/service.ts`
- Create: `desktop/app-capabilities/secrets/main/__tests__/service.test.ts`

**Interfaces:**
- Consumes Task 1 DataRepository schemas and shared zod types.
- Produces `createSecretsService(deps): SecretsService`.
- Produces service methods: `initialize`, `list`, `get`, `create`, `update`, `upsert`, `delete`.
- Produces `events.on("changed", ({ secrets }) => void)`.

- [ ] **Step 1: Write failing CRUD and safe-view tests**

Create `desktop/app-capabilities/secrets/main/__tests__/service.test.ts` with tests covering list, get without value, get with value, create duplicate rejection, update rename, upsert create/update, delete, and no value in safe responses.

Use an in-memory fake namespace shaped like `DataNamespace<T>`:

```ts
function createNamespace<T extends { id: string }>() {
  const rows = new Map<string, T>()
  let singleton: T | null = null
  return {
    async list() { return [...rows.values()] },
    async get(id: string) { return rows.get(id) ?? null },
    async upsert(value: T) { rows.set(value.id, structuredClone(value)) },
    async remove(id: string) { rows.delete(id) },
    async getSingleton() { return singleton ? structuredClone(singleton) : null },
    async setSingleton(value: T) { singleton = structuredClone(value) },
  }
}
```

Test names:

```ts
it("creates and lists safe secret views without values", async () => {})
it("gets a value only when includeValue is true", async () => {})
it("rejects duplicate names case-insensitively", async () => {})
it("updates name value and description", async () => {})
it("upserts existing and new secrets", async () => {})
it("deletes by case-insensitive name", async () => {})
```

- [ ] **Step 2: Write failing migration tests**

Add tests:

```ts
it("migrates legacy config variables and clears config on success", async () => {})
it("keeps existing repository secrets when legacy names conflict", async () => {})
it("does not clear legacy config when migration persistence fails", async () => {})
it("skips migration when legacyConfigMigratedAt is set", async () => {})
```

The successful migration test should start with:

```ts
const legacyConfig = createDefaultConfig()
legacyConfig.global.variables = [
  { name: "TOKEN", value: "secret", description: "api" },
]
```

Expected after `initialize()`:

```ts
expect(await service.list()).toEqual({
  secrets: [{ id: expect.any(String), name: "TOKEN", description: "api", hasValue: true }],
  total: 1,
})
expect(updateConfig).toHaveBeenCalledWith({ global: { variables: [] } })
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/secrets/main/__tests__/service.test.ts
```

Expected: FAIL because `service.ts` does not exist.

- [ ] **Step 4: Implement service**

Create `desktop/app-capabilities/secrets/main/service.ts` with these exported shapes:

```ts
export type SecretsServiceDeps = {
  readonly items: DataNamespace<SecretItemEntryV1>
  readonly settings: DataNamespace<SecretSettingsEntryV1>
  readonly loadConfig: () => Promise<SynapseConfig>
  readonly updateConfig: (patch: SynapseConfigPatch) => Promise<SynapseConfig>
  readonly now?: () => Date
  readonly createId?: () => string
  readonly logger: SecretsLogger
}

export function createSecretsService(deps: SecretsServiceDeps) {
  // returns { events, initialize, list, get, create, update, upsert, delete }
}

export type SecretsService = ReturnType<typeof createSecretsService>
```

Implement helpers:

```ts
function normalizeName(name: string): string {
  const trimmed = name.trim()
  if (!SECRET_NAME_REGEX.test(trimmed)) throw new Error("密钥名称只能包含字母、数字和下划线。")
  return trimmed
}

function normalizeDescription(description: string | undefined): string | undefined {
  const trimmed = description?.trim() ?? ""
  return trimmed ? trimmed : undefined
}

function toSafeView(item: SecretItemEntryV1): SecretSafeView {
  return {
    id: item.id,
    name: item.name,
    ...(item.description ? { description: item.description } : undefined),
    hasValue: item.value.length > 0,
  }
}
```

`upsert` behavior:

- If existing name not found, require `value !== undefined`; otherwise throw `创建密钥时必须提供值。`.
- If existing name found, update only provided fields.

Migration must:

- Load settings default `{ schemaVersion: 1, legacyConfigMigratedAt: null }` when singleton is null.
- Import only if `legacyConfigMigratedAt` is null.
- Use existing DataRepository secret names to skip conflicts.
- Call `deps.updateConfig({ global: { variables: [] } })` only after all item upserts succeed.
- Set settings singleton only after config clear succeeds.

- [ ] **Step 5: Run service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/secrets/main/__tests__/service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/app-capabilities/secrets/main/service.ts \
  desktop/app-capabilities/secrets/main/__tests__/service.test.ts
git commit -m "feat: add secrets service"
```

---

### Task 3: IPC, Preload Bridge, And Bootstrap Service

**Files:**
- Create: `desktop/app-capabilities/secrets/main/ipc.ts`
- Create: `desktop/app-capabilities/secrets/main/__tests__/ipc.test.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts`
- Modify: `desktop/src/types/bridge.ts`

**Interfaces:**
- Consumes `SecretsService` from Task 2.
- Produces bridge domain `window.synapse.secrets`.
- Produces IPC module id `secrets`.

- [ ] **Step 1: Write failing IPC module tests**

Create `desktop/app-capabilities/secrets/main/__tests__/ipc.test.ts`.

Assert:

```ts
expect(secretsIpcModule.id).toBe("secrets")
expect(secretsIpcModule.methods.list.channel).toBe("synapse:secrets:list")
expect(secretsIpcModule.methods.get.channel).toBe("synapse:secrets:get")
expect(secretsIpcModule.methods.create.channel).toBe("synapse:secrets:create")
expect(secretsIpcModule.methods.update.channel).toBe("synapse:secrets:update")
expect(secretsIpcModule.methods.upsert.channel).toBe("synapse:secrets:upsert")
expect(secretsIpcModule.methods.delete.channel).toBe("synapse:secrets:delete")
expect(secretsIpcModule.events.changed.channel).toBe("synapse:secrets:changed")
```

Add a test that invokes handlers with a fake context whose `resolve("core.secrets")` returns fake methods and verifies method forwarding.

- [ ] **Step 2: Run IPC tests to verify they fail**

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/secrets/main/__tests__/ipc.test.ts
```

Expected: FAIL because `ipc.ts` does not exist.

- [ ] **Step 3: Implement IPC module**

Create `desktop/app-capabilities/secrets/main/ipc.ts`:

```ts
import { z } from "zod"
import type { IpcModule } from "../../../electron/runtime/ipc/types"
import type { WindowManager } from "../../../electron/runtime/window"
import type { SecretsService } from "./service"
import {
  secretCreateInputSchema,
  secretDeleteInputSchema,
  secretGetInputSchema,
  secretListResultSchema,
  secretSafeViewSchema,
  secretUpdateInputSchema,
  secretUpsertInputSchema,
  secretsChangedEventSchema,
} from "../shared/schema"

const wired = new WeakSet<SecretsService>()

function resolveSecretsService(ctx: Parameters<IpcModule["methods"][string]["handler"]>[0]): SecretsService {
  const service = ctx.resolve<SecretsService>("core.secrets")
  if (!wired.has(service)) {
    const windowManager = ctx.resolve<WindowManager>("core.window-manager")
    service.events.on("changed", (payload) => {
      windowManager.broadcast(secretsIpcModule.events.changed.channel, payload)
    })
    wired.add(service)
  }
  return service
}

export const secretsIpcModule: IpcModule = {
  id: "secrets",
  methods: {
    list: {
      channel: "synapse:secrets:list",
      kind: "invoke",
      request: z.void(),
      response: secretListResultSchema,
      handler: (ctx) => resolveSecretsService(ctx).list(),
    },
    get: {
      channel: "synapse:secrets:get",
      kind: "invoke",
      request: secretGetInputSchema,
      response: z.union([secretSafeViewSchema, secretSafeViewSchema.extend({ value: z.string() })]),
      handler: (ctx, request) => resolveSecretsService(ctx).get(request),
    },
    create: {
      channel: "synapse:secrets:create",
      kind: "invoke",
      request: secretCreateInputSchema,
      response: secretSafeViewSchema,
      handler: (ctx, request) => resolveSecretsService(ctx).create(request),
    },
    update: {
      channel: "synapse:secrets:update",
      kind: "invoke",
      request: secretUpdateInputSchema,
      response: secretSafeViewSchema,
      handler: (ctx, request) => resolveSecretsService(ctx).update(request),
    },
    upsert: {
      channel: "synapse:secrets:upsert",
      kind: "invoke",
      request: secretUpsertInputSchema,
      response: secretSafeViewSchema,
      handler: (ctx, request) => resolveSecretsService(ctx).upsert(request),
    },
    delete: {
      channel: "synapse:secrets:delete",
      kind: "invoke",
      request: secretDeleteInputSchema,
      response: secretSafeViewSchema,
      handler: (ctx, request) => resolveSecretsService(ctx).delete(request),
    },
  },
  events: {
    changed: {
      channel: "synapse:secrets:changed",
      kind: "event",
      payload: secretsChangedEventSchema,
    },
  },
}
```

- [ ] **Step 4: Register core service and IPC**

In `desktop/electron/bootstrap/descriptors.ts`:

- Import `createSecretsService`, `SecretsService`, namespaces, and schema entry types.
- Add descriptor `coreSecretsDescriptor` with id `"core.secrets"`, depends on `core.data-repository` and `core.config`.
- In `create`, resolve DataRepository and pass:

```ts
items: dataRepository.namespace<SecretItemEntryV1>(SECRETS_ITEMS_NAMESPACE),
settings: dataRepository.namespace<SecretSettingsEntryV1>(SECRETS_SETTINGS_NAMESPACE),
loadConfig: () => configStore.load(),
updateConfig: (patch) => configStore.update(patch),
logger: ctx.logger.child("secrets"),
```

- In `start`, call `await instance.initialize()`.
- Add descriptor to exported descriptor list in the same pattern used by `coreQuickInputDescriptor`.

In `desktop/electron/bootstrap/ipc-registry.ts`:

```ts
import { secretsIpcModule } from "../../app-capabilities/secrets/main/ipc"
```

Register it in `createIpcRegistry` and `registeredIpcModules`.

- [ ] **Step 5: Add bridge types and preload domain**

In `desktop/src/types/bridge.ts`, import shared Secrets types and add:

```ts
secrets: {
  list: () => Promise<SecretListResult>
  get: (input: SecretGetInput) => Promise<SecretSafeView | SecretValueView>
  create: (input: SecretCreateInput) => Promise<SecretSafeView>
  update: (input: SecretUpdateInput) => Promise<SecretSafeView>
  upsert: (input: SecretUpsertInput) => Promise<SecretSafeView>
  delete: (input: SecretDeleteInput) => Promise<SecretSafeView>
  onChanged: (listener: (event: SecretsChangedEvent) => void) => Unsubscribe
}
```

In `desktop/electron/preload.ts`, add IPC channels:

```ts
"secrets": {
  "list": "synapse:secrets:list",
  "get": "synapse:secrets:get",
  "create": "synapse:secrets:create",
  "update": "synapse:secrets:update",
  "upsert": "synapse:secrets:upsert",
  "delete": "synapse:secrets:delete",
  "changed": "synapse:secrets:changed",
},
```

Add bridge methods:

```ts
secrets: {
  list: invoke(IPC_CHANNELS.secrets.list),
  get: invoke(IPC_CHANNELS.secrets.get),
  create: invoke(IPC_CHANNELS.secrets.create),
  update: invoke(IPC_CHANNELS.secrets.update),
  upsert: invoke(IPC_CHANNELS.secrets.upsert),
  delete: invoke(IPC_CHANNELS.secrets.delete),
  onChanged: (listener) => on(IPC_CHANNELS.secrets.changed, listener),
},
```

- [ ] **Step 6: Generate IPC channels**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Expected: `desktop/electron/generated/ipc-channels.generated.ts` includes the `secrets` domain.

- [ ] **Step 7: Run IPC tests and codegen check**

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/secrets/main/__tests__/ipc.test.ts
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/app-capabilities/secrets/main/ipc.ts \
  desktop/app-capabilities/secrets/main/__tests__/ipc.test.ts \
  desktop/electron/bootstrap/descriptors.ts \
  desktop/electron/bootstrap/ipc-registry.ts \
  desktop/electron/preload.ts \
  desktop/electron/generated/ipc-channels.generated.ts \
  desktop/src/types/bridge.ts
git commit -m "feat: expose secrets ipc"
```

---

### Task 4: MCP Dispatcher, App Domain, And Router Cleanup

**Files:**
- Create: `desktop/app-capabilities/secrets/main/dispatcher.ts`
- Create: `desktop/app-capabilities/secrets/main/__tests__/dispatcher.test.ts`
- Modify: `desktop/app-capabilities/dispatcher.ts`
- Modify: `desktop/app-capabilities/__tests__/dispatcher.test.ts`
- Modify: `desktop/synapse-capabilities/shared/app-domain.ts`
- Modify: `desktop/synapse-capabilities/shared/registry.ts`
- Modify: `desktop/synapse-capabilities/shared/variable-domain.ts`
- Modify: `desktop/electron/capabilities/action-router.ts`
- Modify: `desktop/electron/capabilities/__tests__/action-router.test.ts`
- Delete: `desktop/electron/capabilities/variable-dispatcher.ts`
- Delete: `desktop/electron/capabilities/__tests__/variable-dispatcher.test.ts`

**Interfaces:**
- Consumes `SecretsService`.
- Produces app-domain MCP tool definitions for `app_secrets_item_*`.
- Removes old variable domain from registry and router.

- [ ] **Step 1: Write failing dispatcher tests**

Create `desktop/app-capabilities/secrets/main/__tests__/dispatcher.test.ts` with tests mirroring old variable dispatcher coverage:

```ts
it("lists secrets without values and audits secret inventory read", async () => {})
it("gets a secret value only when includeValue is true", async () => {})
it("creates updates upserts and deletes through secret.write", async () => {})
it("does not include values in audit events on success or failure", async () => {})
it("denies before reading service data when permission is denied", async () => {})
```

Use a fake `SecretsService` and fake `PermissionGuard`. Assert permission calls use:

```ts
action: "secret.read"
resource: "secret:user:*"
```

for list and:

```ts
resource: "secret:user:TOKEN"
```

for item operations.

- [ ] **Step 2: Write failing router and app dispatcher tests**

In `desktop/electron/capabilities/__tests__/action-router.test.ts`, replace the variable routing test with:

```ts
it("routes Secrets app actions through the app dispatcher", async () => {
  const appDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
  const deps = createRouterDeps({ appDispatch })
  const router = createSynapseActionRouter(deps)

  await expect(router.dispatch("app.secrets.item.list", {}, { source: "api" })).resolves.toEqual({
    ok: true,
    data: [],
  })
  expect(appDispatch).toHaveBeenCalledWith("app.secrets.item.list", {}, { source: "api" })
})
```

Add:

```ts
it("rejects old Settings variable actions", async () => {
  const router = createSynapseActionRouter(createRouterDeps())
  await expect(router.dispatch("app.settings.variable.item.list", {}, { source: "api" }))
    .rejects.toThrow("Unknown action")
  await expect(router.dispatch("variable.item.list", {}, { source: "api" }))
    .rejects.toThrow("Unknown action")
})
```

In `desktop/app-capabilities/__tests__/dispatcher.test.ts`, add `secrets` fake dispatcher and expect `app.secrets.item.list` routes to it.

- [ ] **Step 3: Run tests to verify failures**

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/secrets/main/__tests__/dispatcher.test.ts app-capabilities/__tests__/dispatcher.test.ts electron/capabilities/__tests__/action-router.test.ts
```

Expected: FAIL because dispatcher and routing are not implemented.

- [ ] **Step 4: Implement Secrets MCP dispatcher**

Create `desktop/app-capabilities/secrets/main/dispatcher.ts`:

```ts
import type { ActorIdentity, AuditSink, PermissionAction, PermissionGuard } from "../../../electron/runtime/security"
import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import { checkCapabilityPermission } from "../../../electron/capabilities/permission-audit"
import type { SecretsService } from "./service"
import {
  SECRETS_ITEM_CREATE_CAPABILITY_ID,
  SECRETS_ITEM_DELETE_CAPABILITY_ID,
  SECRETS_ITEM_GET_CAPABILITY_ID,
  SECRETS_ITEM_LIST_CAPABILITY_ID,
  SECRETS_ITEM_UPDATE_CAPABILITY_ID,
  SECRETS_ITEM_UPSERT_CAPABILITY_ID,
} from "../shared/capability"

export function createSecretsCapabilityDispatcher(deps: {
  readonly service: SecretsService
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly actor?: ActorIdentity
}) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      if (action === SECRETS_ITEM_LIST_CAPABILITY_ID) return listSecrets(deps, action, context)
      if (action === SECRETS_ITEM_GET_CAPABILITY_ID) return getSecret(deps, action, params, context)
      if (action === SECRETS_ITEM_CREATE_CAPABILITY_ID) return writeSecret(deps, action, params, context, "create")
      if (action === SECRETS_ITEM_UPDATE_CAPABILITY_ID) return writeSecret(deps, action, params, context, "update")
      if (action === SECRETS_ITEM_UPSERT_CAPABILITY_ID) return writeSecret(deps, action, params, context, "upsert")
      if (action === SECRETS_ITEM_DELETE_CAPABILITY_ID) return writeSecret(deps, action, params, context, "delete")
      throw new Error(`Unknown secrets action: ${action}`)
    },
  }
}
```

Implement permission helpers like the old variable dispatcher, with resource prefix `secret:user:` and no value/description in audit metadata. Return shapes:

```ts
{ ok: true, data: await service.list(), total: result.total }
{ ok: true, data: { secret } }
{ ok: true, data: { secret, created: boolean } }
```

For `upsert`, include `created` from service. If Task 2 returns only a safe view, change the Task 2 service return type before implementing this dispatcher so `upsert` returns `{ secret: SecretSafeView; created: boolean }`.

- [ ] **Step 5: Register Secrets in app domain and dispatcher**

In `desktop/synapse-capabilities/shared/app-domain.ts`:

- Import Secrets capability ids and tool names.
- Add six `CapabilityDefinition` entries with ids `app.secrets.item.*`.
- Add `APP_MCP_TOOL_ACTIONS` entries mapping each `app_secrets_item_*` tool to its capability id.
- Add `buildAppTools()` entries with schemas equivalent to the old variable tools, but with "secret" terminology and no legacy aliases.

In `desktop/app-capabilities/dispatcher.ts`:

- Import `SECRETS_CAPABILITY_IDS`.
- Add `secrets?: AppCapabilitySubDispatcher` to deps.
- Route actions whose id is in the set to `deps.secrets.dispatch`.

In `desktop/electron/bootstrap/descriptors.ts`, create the Secrets dispatcher and pass it into `createAppCapabilityDispatcher`.

- [ ] **Step 6: Remove old variable domain routing**

In `desktop/synapse-capabilities/shared/registry.ts`:

- Remove imports for `VARIABLE_DOMAIN`, `VARIABLE_MCP_TOOL_ACTIONS`, and `buildVariableTools`.
- Remove them from `CAPABILITY_DOMAINS`, `MCP_TOOL_ACTIONS`, and `buildAllMcpTools()`.

Delete `desktop/synapse-capabilities/shared/variable-domain.ts` if no imports remain.

In `desktop/electron/capabilities/action-router.ts`:

- Remove `variableDispatch` from `SynapseActionRouterDeps`.
- Remove `if (domainId === "variable")`.
- Remove legacy conversion for `variable.` and `app.settings.variable.`.

Delete `desktop/electron/capabilities/variable-dispatcher.ts` and its tests.

- [ ] **Step 7: Run MCP/router tests**

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/secrets/main/__tests__/dispatcher.test.ts app-capabilities/__tests__/dispatcher.test.ts electron/capabilities/__tests__/action-router.test.ts tests/unit/synapse-capabilities.test.ts tests/unit/api-mcp-capability-surface.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/app-capabilities/secrets/main/dispatcher.ts \
  desktop/app-capabilities/secrets/main/__tests__/dispatcher.test.ts \
  desktop/app-capabilities/dispatcher.ts \
  desktop/app-capabilities/__tests__/dispatcher.test.ts \
  desktop/synapse-capabilities/shared/app-domain.ts \
  desktop/synapse-capabilities/shared/registry.ts \
  desktop/electron/capabilities/action-router.ts \
  desktop/electron/capabilities/__tests__/action-router.test.ts \
  desktop/tests/unit/synapse-capabilities.test.ts \
  desktop/tests/unit/api-mcp-capability-surface.test.ts
git add -u desktop/synapse-capabilities/shared/variable-domain.ts \
  desktop/electron/capabilities/variable-dispatcher.ts \
  desktop/electron/capabilities/__tests__/variable-dispatcher.test.ts
git commit -m "feat: route secrets mcp actions"
```

---

### Task 5: Installer Secret Substitution Integration

**Files:**
- Modify: `desktop/src/modules/installers/shared/shared-installer-flow.tsx`
- Modify: `desktop/src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx`
- Modify: `desktop/src/modules/content/lib/repository-variables.ts`
- Modify: `desktop/src/modules/content/lib/__tests__/repository-variables.test.ts`
- Modify: `desktop/src/modules/content/components/variable-substitution-dialog.tsx`
- Modify: `desktop/src/modules/content/components/variable-save-confirmation-dialog.tsx`

**Interfaces:**
- Consumes `window.synapse.secrets` bridge from Task 3.
- Produces installer flow that loads existing substitution values from Secrets and saves new/changed values through Secrets IPC.

- [ ] **Step 1: Update helper tests from variables to secrets**

In `desktop/src/modules/content/lib/__tests__/repository-variables.test.ts`, change the expected helper behavior to return a secret change set that can be saved with `upsert`.

Expected helper exports:

```ts
type UserSecretChangeSet = {
  newSecrets: SecretUpsertInput[]
  updatedSecrets: SecretUpsertInput[]
}

buildUserSecretChangeSet(secrets: SecretSafeView[], substitutions: Record<string, string>): UserSecretChangeSet
hasUserSecretChanges(changeSet: UserSecretChangeSet): boolean
```

Tests:

```ts
it("detects new and updated secrets from submitted substitutions", () => {})
it("ignores blank substitution values", () => {})
it("detects no changes when a saved secret already has a value and the user leaves it blank", () => {})
```

- [ ] **Step 2: Run helper tests to verify they fail**

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/content/lib/__tests__/repository-variables.test.ts
```

Expected: FAIL because helper exports still use config patches.

- [ ] **Step 3: Replace helper implementation**

Keep the existing file path `desktop/src/modules/content/lib/repository-variables.ts` for this implementation. Replace its contents with Secrets change-set helpers:

```ts
import type { SecretSafeView, SecretUpsertInput } from "../../../../app-capabilities/secrets/shared/schema"

export type UserSecretChangeSet = {
  newSecrets: SecretUpsertInput[]
  updatedSecrets: SecretUpsertInput[]
}

export function buildUserSecretChangeSet(
  secrets: SecretSafeView[],
  substitutions: Record<string, string>,
): UserSecretChangeSet {
  const existingByName = new Map(secrets.map((secret) => [secret.name.toLowerCase(), secret]))
  const newSecrets: SecretUpsertInput[] = []
  const updatedSecrets: SecretUpsertInput[] = []

  for (const [name, value] of Object.entries(substitutions)) {
    if (value.length === 0) continue
    const existing = existingByName.get(name.toLowerCase())
    if (!existing) {
      newSecrets.push({ name, value })
    } else {
      updatedSecrets.push({ name: existing.name, value })
    }
  }

  return { newSecrets, updatedSecrets }
}

export function hasUserSecretChanges(changeSet: UserSecretChangeSet): boolean {
  return changeSet.newSecrets.length > 0 || changeSet.updatedSecrets.length > 0
}
```

- [ ] **Step 4: Update dialogs**

Keep the component file and export name as `VariableSubstitutionDialog` for this implementation. Change props:

```ts
secrets: SecretSafeView[]
initialValues: Record<string, string>
```

Initialize fields from `initialValues[name] ?? ""`. Display masked state using `secret.hasValue`.

In `variable-save-confirmation-dialog.tsx`, change labels:

```tsx
title="保存密钥"
description="这些密钥可在之后安装内容时复用。"
```

Sections:

```tsx
<SecretSection label="新增密钥" secrets={newSecrets} />
<SecretSection label="更新密钥" secrets={updatedSecrets} />
```

- [ ] **Step 5: Update installer flow tests**

In `desktop/src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx`:

- Mock `window.synapse.secrets.list`.
- Mock `window.synapse.secrets.get` for `includeValue: true`.
- Mock `window.synapse.secrets.upsert`.
- Remove expectations for `config.update({ global: { variables } })`.

Key assertions:

```ts
expect(mocks.secrets.list).toHaveBeenCalled()
expect(mocks.secrets.get).toHaveBeenCalledWith({ name: "GITEE_TOKEN", includeValue: true })
expect(mocks.secrets.upsert).toHaveBeenCalledWith({ name: "GITEE_TOKEN", value: "new-token" })
expect(mocks.config.update).not.toHaveBeenCalledWith(expect.objectContaining({ global: expect.objectContaining({ variables: expect.any(Array) }) }))
```

- [ ] **Step 6: Update installer implementation**

In `shared-installer-flow.tsx`:

- Remove `updateConfig` and `config.global.variables` usage.
- Add state:

```ts
const [userSecrets, setUserSecrets] = useState<SecretSafeView[]>([])
const [secretInitialValues, setSecretInitialValues] = useState<Record<string, string>>({})
```

- Add bridge:

```ts
const secretsBridge = useMemo(() => requireBridgeDomain("secrets"), [])
```

- Before opening substitution dialog, call:

```ts
const list = await secretsBridge.list()
setUserSecrets(list.secrets)
const initialValues = Object.fromEntries(await Promise.all(placeholders.map(async (name) => {
  const existing = list.secrets.find((secret) => secret.name.toLowerCase() === name.toLowerCase())
  if (!existing?.hasValue) return [name, ""] as const
  const valueView = await secretsBridge.get({ name: existing.name, includeValue: true })
  return [name, "value" in valueView ? valueView.value : ""] as const
})))
setSecretInitialValues(initialValues)
```

- Save changes with:

```ts
for (const secret of [...pendingSecretChanges.newSecrets, ...pendingSecretChanges.updatedSecrets]) {
  await secretsBridge.upsert(secret)
}
```

- On save failure, keep warning text short:

```ts
warning("密钥未保存，安装会继续。")
```

- [ ] **Step 7: Run installer tests**

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/content/lib/__tests__/repository-variables.test.ts src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/modules/installers/shared/shared-installer-flow.tsx \
  desktop/src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx \
  desktop/src/modules/content/lib/repository-variables.ts \
  desktop/src/modules/content/lib/__tests__/repository-variables.test.ts \
  desktop/src/modules/content/components/variable-substitution-dialog.tsx \
  desktop/src/modules/content/components/variable-save-confirmation-dialog.tsx
git commit -m "feat: use secrets for installer substitutions"
```

---

### Task 6: Secrets Renderer App And System App Registration

**Files:**
- Create: `desktop/app-capabilities/secrets/renderer/app-definition.ts`
- Create: `desktop/app-capabilities/secrets/renderer/app-manifest.ts`
- Create: `desktop/app-capabilities/secrets/renderer/index.tsx`
- Create: `desktop/app-capabilities/secrets/renderer/__tests__/secrets-app.test.tsx`
- Modify: `desktop/src/modules/apps/types.ts`
- Modify: `desktop/src/modules/apps/definitions.ts`
- Modify: `desktop/src/modules/apps/registry.ts`
- Modify: `desktop/src/modules/apps/components/system-app-content.tsx`
- Modify: `desktop/src/modules/apps/__tests__/registry.test.ts`
- Modify: `desktop/src/modules/apps/__tests__/system-app-window-app.test.tsx`

**Interfaces:**
- Consumes Secrets bridge.
- Produces system app `secrets` with app name `密钥库`.

- [ ] **Step 1: Write failing renderer tests**

Create `desktop/app-capabilities/secrets/renderer/__tests__/secrets-app.test.tsx`.

Test cases:

```ts
it("renders empty state and opens create dialog", async () => {})
it("lists secrets without values", async () => {})
it("creates a secret", async () => {})
it("edits metadata without pre-filling the old value", async () => {})
it("updates value only when the update value control is enabled", async () => {})
it("deletes a secret after confirmation", async () => {})
it("shows retry when loading fails", async () => {})
```

Mock `requireBridgeDomain("secrets")` to return `list`, `create`, `update`, `delete`, and `onChanged`.

- [ ] **Step 2: Update registry tests to expect app**

In `desktop/src/modules/apps/__tests__/registry.test.ts`, add `"secrets"` to app id order immediately after `"synapse-skill"`. Add manifest expectation:

```ts
expect(getSystemAppManifest("secrets")).toMatchObject({
  id: "secrets",
  name: "密钥库",
  windowTitle: "密钥库",
})
```

- [ ] **Step 3: Run tests to verify failures**

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/secrets/renderer/__tests__/secrets-app.test.tsx src/modules/apps/__tests__/registry.test.ts
```

Expected: FAIL because app files are not registered.

- [ ] **Step 4: Add app definition and manifest**

Create `desktop/app-capabilities/secrets/renderer/app-definition.ts`:

```ts
import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { SECRETS_APP_ID } from "../shared/capability"

export const secretsAppDefinition = {
  id: SECRETS_APP_ID,
  namespace: "secrets",
  type: "system",
  name: "密钥库",
  windowTitle: "密钥库",
  dock: { pinnedByDefault: false, order: 260 },
  window: { openable: true },
  capabilities: {
    primaryMcpPrefix: "app_secrets",
  },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
```

Create `desktop/app-capabilities/secrets/renderer/app-manifest.ts`:

```ts
import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import { secretsAppDefinition } from "./app-definition"
import icon from "./assets/icon.png"

export const secretsAppManifest = {
  ...secretsAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
```

- [ ] **Step 5: Implement UI**

Create `desktop/app-capabilities/secrets/renderer/index.tsx`.

Use imports from existing components:

```ts
import { EyeOff, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "../../../src/components/ui/button"
import { Checkbox } from "../../../src/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../../src/components/ui/dialog"
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "../../../src/components/ui/empty"
import { Field, FieldContent, FieldError, FieldGroup, FieldLabel } from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../src/components/ui/table"
import { SystemAppTopBarActionButton } from "../../../src/modules/apps/components/system-app-top-bar"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
```

UI behavior:

- Load with `secretsBridge.list()`.
- Render table columns `名称`, `描述`, `状态`, `操作`.
- Show `有值` or `空值`.
- Create dialog fields: `名称`, `值`, `描述`.
- Edit dialog fields: `名称`, checkbox `更新值`, conditional `值`, `描述`.
- Edit form value starts as `""` and never receives existing value.
- Delete alert displays only `secret.name`.

- [ ] **Step 6: Register system app**

In `desktop/src/modules/apps/types.ts`:

- Add `"secrets"` to `SYSTEM_APP_IDS`.
- Add `"secrets"` to `SynapseSystemAppNamespace`.

In `definitions.ts`, import and add `secretsAppDefinition`.

In `registry.ts`, import and add `secretsAppManifest`.

In `system-app-content.tsx`, import `SecretsModule` and add:

```tsx
if (appId === "secrets") return <SecretsModule />
```

In `system-app-window-app.test.tsx`, add a mock for `../../../../app-capabilities/secrets/renderer`.

- [ ] **Step 7: Run renderer and app tests**

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/secrets/renderer/__tests__/secrets-app.test.tsx src/modules/apps/__tests__/registry.test.ts src/modules/apps/__tests__/system-app-window-app.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/app-capabilities/secrets/renderer/app-definition.ts \
  desktop/app-capabilities/secrets/renderer/app-manifest.ts \
  desktop/app-capabilities/secrets/renderer/index.tsx \
  desktop/app-capabilities/secrets/renderer/__tests__/secrets-app.test.tsx \
  desktop/src/modules/apps/types.ts \
  desktop/src/modules/apps/definitions.ts \
  desktop/src/modules/apps/registry.ts \
  desktop/src/modules/apps/components/system-app-content.tsx \
  desktop/src/modules/apps/__tests__/registry.test.ts \
  desktop/src/modules/apps/__tests__/system-app-window-app.test.tsx
git commit -m "feat: add secrets system app"
```

---

### Task 7: Remove Settings Variables Surface

**Files:**
- Modify: `desktop/src/modules/settings/types.ts`
- Modify: `desktop/src/modules/settings/data.ts`
- Modify: `desktop/src/modules/settings/index.tsx`
- Modify: `desktop/src/modules/settings/__tests__/settings-categories.test.ts`
- Modify: `desktop/src/modules/settings/__tests__/settings-layout.test.tsx`
- Delete: `desktop/src/modules/settings/components/variables-panel.tsx`
- Delete: `desktop/src/modules/settings/components/__tests__/variables-panel.test.tsx`

**Interfaces:**
- Consumes Secrets app from Task 6.
- Produces Settings without variables category or editing surface.

- [ ] **Step 1: Update settings tests**

In `settings-categories.test.ts`, assert the category ids do not include `"variables"`:

```ts
expect(SETTINGS_CATEGORIES.map((category) => category.id)).not.toContain("variables")
```

Update any snapshots or expected arrays by removing `"variables"`.

- [ ] **Step 2: Run tests to verify failures**

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/settings/__tests__/settings-categories.test.ts src/modules/settings/__tests__/settings-layout.test.tsx
```

Expected: FAIL while UI still includes variables.

- [ ] **Step 3: Remove category and panel**

In `desktop/src/modules/settings/types.ts`, remove `"variables"` from `SettingsCategoryId`.

In `desktop/src/modules/settings/data.ts`, remove the variables category entry.

In `desktop/src/modules/settings/index.tsx`, remove import and rendering branch for `VariablesPanel`.

Delete `variables-panel.tsx` and `variables-panel.test.tsx`.

- [ ] **Step 4: Run settings tests**

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/settings/__tests__/settings-categories.test.ts src/modules/settings/__tests__/settings-layout.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/settings/types.ts \
  desktop/src/modules/settings/data.ts \
  desktop/src/modules/settings/index.tsx \
  desktop/src/modules/settings/__tests__/settings-categories.test.ts \
  desktop/src/modules/settings/__tests__/settings-layout.test.tsx
git add -u desktop/src/modules/settings/components/variables-panel.tsx \
  desktop/src/modules/settings/components/__tests__/variables-panel.test.tsx
git commit -m "feat: remove settings variables panel"
```

---

### Task 8: Backup, Diagnostics, Skill Guide, And Release Notes

**Files:**
- Modify: `desktop/electron/services/config-backup-service.ts`
- Modify: `desktop/electron/services/__tests__/config-backup-service.test.ts`
- Modify: `desktop/electron/services/diagnostics-service.ts`
- Modify: `desktop/electron/services/__tests__/diagnostics-service.test.ts`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/secrets/index.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/secrets/api-reference.md`
- Delete: `desktop/app-capabilities/synapse-skill/skill-package/variable/index.md`
- Delete: `desktop/app-capabilities/synapse-skill/skill-package/variable/api-reference.md`
- Modify: `RELEASE_NOTES_PENDING.md`

**Interfaces:**
- Consumes Secrets MCP action/tool names from Task 4.
- Produces no user-facing path that exposes secret values in backup or diagnostics.

- [ ] **Step 1: Update backup tests**

In `config-backup-service.test.ts`, add a DataRepository fixture containing:

```ts
{
  id: "secret-1",
  schemaVersion: 1,
  name: "API_TOKEN",
  value: "sk-secret-value",
  description: "api",
  createdAt: "2026-07-09T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
}
```

Assert exported backup JSON does not contain `"sk-secret-value"` and does contain namespace metadata for `"app.secrets.items"`.

- [ ] **Step 2: Update diagnostics tests**

In `diagnostics-service.test.ts`, replace the old variables fixture with a Secrets fixture and assert the summary never includes `value`:

```ts
expect(JSON.stringify(report)).toContain("API_TOKEN")
expect(JSON.stringify(report)).not.toContain("sk-secret-value")
```

- [ ] **Step 3: Run tests to verify failures**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/config-backup-service.test.ts electron/services/__tests__/diagnostics-service.test.ts
```

Expected: FAIL until services read the new Secrets namespace and stop reading active variable data from config.

- [ ] **Step 4: Update backup and diagnostics**

In `config-backup-service.ts`:

- Ensure DataRepository namespace discovery includes `app.secrets.items`.
- When serializing secret items, omit `value`.
- Keep `id`, `schemaVersion`, `name`, `description`, `createdAt`, and `updatedAt`.

In `diagnostics-service.ts`:

- Replace config variable summary with Secrets inventory summary by reading the `app.secrets.items` DataRepository namespace through the existing diagnostics service dependency path.
- Report count and names only.
- Do not include descriptions if existing diagnostics treat descriptions as sensitive metadata.

- [ ] **Step 5: Replace Synapse Skill guide**

Create `desktop/app-capabilities/synapse-skill/skill-package/secrets/index.md`:

```md
# Synapse Secrets MCP

Use Synapse Secrets MCP tools to manage user-scoped local secrets used by `${{ NAME }}` placeholders.

## Scope Boundary

Use this guide only for Synapse local secrets stored in the `密钥库` app.

Do not use these tools for Workflow variables, Database rows, Automation schedules, provider settings, shell environment variables, Resource Repository publishing, or editor installation state.

## Default Flow

1. Use `app_secrets_item_list` to inspect secret names without values.
2. Use `app_secrets_item_get` without `includeValue` for metadata.
3. Use `app_secrets_item_get` with `includeValue: true` only when the user explicitly needs the stored value.
4. Use `app_secrets_item_upsert` when setting a value and creation/update are both acceptable.
5. Use `app_secrets_item_create` when creation must fail if the name already exists.
6. Use `app_secrets_item_update` for existing secrets or renames.
7. Use `app_secrets_item_delete` only after the name is clear.

## Sensitive Value Rules

- List never returns values.
- Mutation tools never return values.
- Do not repeat token, password, secret, credential, API key, cookie, or authorization values in final answers.
- After writing a value, report the secret name and operation result only.

## Name Rules

Names must contain only letters, digits, and underscores. Names are matched case-insensitively.
```

Create `api-reference.md` with the six tool names and canonical action strings from the spec. Delete the old `variable/` guide files.

- [ ] **Step 6: Update release notes**

Append to `RELEASE_NOTES_PENDING.md`:

```md
- 新增“密钥库”系统应用，原设置里的私人令牌会迁移到独立应用管理，安装内容时的占位符密钥也改为从密钥库读取和保存。
```

- [ ] **Step 7: Run docs/service tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/config-backup-service.test.ts electron/services/__tests__/diagnostics-service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/services/config-backup-service.ts \
  desktop/electron/services/__tests__/config-backup-service.test.ts \
  desktop/electron/services/diagnostics-service.ts \
  desktop/electron/services/__tests__/diagnostics-service.test.ts \
  desktop/app-capabilities/synapse-skill/skill-package/secrets/index.md \
  desktop/app-capabilities/synapse-skill/skill-package/secrets/api-reference.md \
  RELEASE_NOTES_PENDING.md
git add -u desktop/app-capabilities/synapse-skill/skill-package/variable/index.md \
  desktop/app-capabilities/synapse-skill/skill-package/variable/api-reference.md
git commit -m "docs: update secrets mcp guide"
```

---

### Task 9: Final Verification And Cleanup

**Files:**
- Modify only files needed to fix verification failures.

**Interfaces:**
- Consumes all previous tasks.
- Produces a clean, verified implementation.

- [ ] **Step 1: Search for retired names**

Run:

```bash
rg -n "app\\.settings\\.variable|app_settings_variable|variable-domain|VariablesPanel|config\\.global\\.variables|global\\.variables" desktop/src desktop/electron desktop/app-capabilities desktop/synapse-capabilities desktop/tests
```

Expected:

- No `app.settings.variable` or `app_settings_variable` hits.
- No `VariablesPanel` hits.
- `config.global.variables` hits only in legacy config normalization/migration tests or comments that explicitly describe migration source.

- [ ] **Step 2: Run focused test suite**

```bash
pnpm --filter @synapse/desktop exec vitest run \
  app-capabilities/secrets/main/__tests__/service.test.ts \
  app-capabilities/secrets/main/__tests__/dispatcher.test.ts \
  app-capabilities/secrets/main/__tests__/ipc.test.ts \
  app-capabilities/secrets/renderer/__tests__/secrets-app.test.tsx \
  app-capabilities/__tests__/dispatcher.test.ts \
  electron/capabilities/__tests__/action-router.test.ts \
  electron/runtime/data-repo/__tests__/schemas.test.ts \
  src/modules/apps/__tests__/registry.test.ts \
  src/modules/apps/__tests__/system-app-window-app.test.tsx \
  src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx \
  src/modules/settings/__tests__/settings-categories.test.ts \
  electron/services/__tests__/config-backup-service.test.ts \
  electron/services/__tests__/diagnostics-service.test.ts \
  tests/unit/synapse-capabilities.test.ts \
  tests/unit/api-mcp-capability-surface.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run generated IPC check**

```bash
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: PASS with no generated diff.

- [ ] **Step 4: Run typecheck**

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 5: Run full desktop tests if focused tests and typecheck pass**

```bash
pnpm --filter @synapse/desktop run test
```

Expected: PASS.

- [ ] **Step 6: Inspect git status**

```bash
git status --short
```

Expected: no unstaged generated files and only intentional changes before the final commit.

- [ ] **Step 7: Commit verification fixes**

If Step 1-6 required changes, commit them:

```bash
git add <changed-files>
git commit -m "test: verify secrets app migration"
```

If no files changed, do not create an empty commit.
