# Model Price Preset Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make model prices empty-by-default, importable from built-in presets, clearable by users, and unambiguous for UI/MCP agents by making `modelPattern` the only user-facing model identifier.

**Architecture:** Keep the existing `model-price` service boundary and `model_price_rules` table. Replace automatic seeding with explicit preset import, add hash-like internal rule IDs, add first-class IPC/preload methods, and update the price rules UI to import or clear rules without displaying IDs. Keep MCP mutation APIs ruleId-based, but clarify that IDs are internal handles.

**Tech Stack:** Electron main process, React, TypeScript, SQLite `DatabaseSync`, shadcn/Radix UI, Vitest.

---

## File Map

- Modify `docs/superpowers/specs/2026-06-09-model-price-preset-import-design.md`: already contains the approved design; keep in sync if implementation discovers a conflict.
- Create `desktop/electron/services/model-price/rule-id.ts`: hash-like `mpr_<short-hash>` ID generation and model-pattern key normalization.
- Create `desktop/electron/services/model-price/presets.ts`: built-in preset summaries and preset rule data.
- Modify `desktop/electron/services/model-price/types.ts`: preset types.
- Modify `desktop/electron/services/model-price/matching.ts`: use hash-like IDs for normalized rules.
- Modify `desktop/electron/services/model-price/db-schema.ts`: empty-by-default schema initialization that preserves existing rows.
- Modify `desktop/electron/services/model-price/service.ts`: add `listPresets`, `importPreset`, and `clearRules`; replace reset behavior.
- Modify `desktop/electron/services/model-price/index.ts`: export new preset APIs/types.
- Modify `desktop/electron/model-price/channels.ts`: add preset and clear channels.
- Modify `desktop/electron/model-price/ipc-handlers.ts`: add handlers and validate preset IDs.
- Modify `desktop/electron/preload.ts`: expose `modelPrice.listPresets`, `modelPrice.importPreset`, and `modelPrice.clearRules`.
- Modify `desktop/src/types/bridge.ts`: add preset summary/id types and bridge methods.
- Modify `desktop/src/modules/model-price/types.ts`: re-export preset types.
- Modify `desktop/src/modules/model-price/index.tsx`: make rules tab left/default.
- Modify `desktop/src/modules/model-price/components/price-rules-view.tsx`: replace reset with clear; add import preset dialog.
- Modify `desktop/synapse-capabilities/shared/model-price-domain.ts`: clarify `id`/`ruleId` semantics.
- Modify `desktop/resources/templates/skills/synapse-model-price-mcp/content.md`: clarify rule ID vs model pattern.
- Modify `desktop/resources/templates/skills/synapse-model-price-mcp/files/api-reference.md`: update examples to hash-like IDs and clarify fields.
- Modify `desktop/tests/unit/synapse-capabilities.test.ts`: assert rule ID descriptions.
- Modify `desktop/tests/unit/database-mcp-rpc.test.ts`: update model-price fixture IDs.
- Modify `desktop/electron/services/model-price/__tests__/model-price-service.test.ts`: service, schema, import, clear, and ID tests.
- Modify `desktop/electron/__tests__/preload.test.ts`: new bridge methods/channels.
- Modify `desktop/src/modules/model-price/__tests__/price-rules-view.test.tsx`: clear/import UI tests.
- Create or modify `desktop/src/modules/model-price/__tests__/model-price-module.test.tsx`: tab order/default view test if no existing module-level test covers it.
- Modify `RELEASE_NOTES_PENDING.md`: user-facing note.

---

### Task 1: Preserve Existing Rules And Stop Default Seeding

**Files:**
- Modify `desktop/electron/services/model-price/db-schema.ts`
- Modify `desktop/electron/services/model-price/service.ts`
- Modify `desktop/electron/services/model-price/__tests__/model-price-service.test.ts`

- [ ] **Step 1: Write failing schema tests**

In `desktop/electron/services/model-price/__tests__/model-price-service.test.ts`, replace the existing default-seed expectation with tests for empty fresh installs and preserving existing rows:

```ts
it("initializes model price tables without inserting default rules", () => {
  const db = new DatabaseSync(":memory:")
  initModelPriceSchema(db)
  const service = new ModelPriceService(db)

  expect(service.listRules()).toEqual([])
  expect(db.prepare("SELECT value FROM model_price_meta WHERE key = ?").get("initialized_from_defaults_v1")).toBeTruthy()
  db.close()
})

it("does not delete existing model_price_rules when the init marker is missing", () => {
  const db = new DatabaseSync(":memory:")
  db.exec(`
    CREATE TABLE model_price_rules (
      id TEXT PRIMARY KEY,
      model_pattern TEXT NOT NULL,
      input_per_1m REAL NOT NULL DEFAULT 0,
      output_per_1m REAL NOT NULL DEFAULT 0,
      cache_read_per_1m REAL NOT NULL DEFAULT 0,
      cache_write_per_1m REAL NOT NULL DEFAULT 0,
      reasoning_per_1m REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'CNY',
      enabled INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'user',
      sort_index INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `)
  db.prepare(`
    INSERT INTO model_price_rules (
      id, model_pattern, input_per_1m, output_per_1m, updated_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run("legacy-like-id", "qwen3.7-plus", 2, 12, "2026-06-09T00:00:00.000Z")

  initModelPriceSchema(db)
  const service = new ModelPriceService(db)

  expect(service.listRules()).toEqual([
    expect.objectContaining({ id: "legacy-like-id", modelPattern: "qwen3.7-plus", inputPer1M: 2, outputPer1M: 12 }),
  ])
  expect(db.prepare("SELECT value FROM model_price_meta WHERE key = ?").get("initialized_from_defaults_v1")).toBeTruthy()
  db.close()
})
```

- [ ] **Step 2: Run the failing service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/model-price/__tests__/model-price-service.test.ts
```

Expected: tests fail because schema initialization still deletes and inserts defaults.

- [ ] **Step 3: Implement empty-by-default initialization**

In `desktop/electron/services/model-price/db-schema.ts`:

- remove the `DEFAULT_MODEL_PRICE_RULES` import;
- replace `seedModelPriceDefaults` with a marker-only initializer;
- delete the unused `insertSeedRules` helper.

Use this structure:

```ts
function seedModelPriceDefaults(database: DatabaseSync): void {
  const meta = database.prepare("SELECT value FROM model_price_meta WHERE key = ?").get(MODEL_PRICE_DEFAULTS_META_KEY) as { value?: string } | undefined
  if (meta?.value) return
  database.prepare(`
    INSERT OR REPLACE INTO model_price_meta (key, value, updated_at)
    VALUES (?, ?, ?)
  `).run(MODEL_PRICE_DEFAULTS_META_KEY, "1", new Date().toISOString())
}
```

Do not call `DELETE FROM model_price_rules` in schema initialization.

- [ ] **Step 4: Replace reset with clear behavior in service**

In `desktop/electron/services/model-price/service.ts`, remove the `DEFAULT_MODEL_PRICE_RULES` import and replace `resetRulesToDefaults` with:

```ts
clearRules(): ModelPriceRule[] {
  replaceModelPriceRules(this.db, [])
  return []
}
```

Keep `replaceModelPriceRules` transactional.

- [ ] **Step 5: Run service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/model-price/__tests__/model-price-service.test.ts
```

Expected: service tests pass after updating old reset assertions to use `clearRules()`.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/model-price/db-schema.ts desktop/electron/services/model-price/service.ts desktop/electron/services/model-price/__tests__/model-price-service.test.ts
git commit -m "fix(model-price): preserve rules during initialization"
```

---

### Task 2: Add Hash-Like Rule IDs

**Files:**
- Create `desktop/electron/services/model-price/rule-id.ts`
- Modify `desktop/electron/services/model-price/matching.ts`
- Modify `desktop/electron/services/model-price/__tests__/model-price-service.test.ts`

- [ ] **Step 1: Write failing ID tests**

Add tests that new normalized rules use `mpr_` IDs and preserve existing `mpr_` IDs:

```ts
it("generates hash-like internal ids for new rules", () => {
  const db = createDb()
  const service = new ModelPriceService(db)

  const created = service.createRule({ modelPattern: "qwen3.7-plus", inputPer1M: 2 })

  expect(created.id).toMatch(/^mpr_[a-f0-9]{12}$/)
  expect(created.id).not.toContain("qwen")
  expect(created.modelPattern).toBe("qwen3.7-plus")
  db.close()
})

it("preserves existing hash-like ids during manual saves", () => {
  const db = createDb()
  const service = new ModelPriceService(db)

  const saved = service.saveRules([{ id: "mpr_123456789abc", modelPattern: "local-model", inputPer1M: 1 }])

  expect(saved[0]?.id).toBe("mpr_123456789abc")
  db.close()
})
```

- [ ] **Step 2: Run failing ID tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/model-price/__tests__/model-price-service.test.ts -t "hash-like"
```

Expected: failure because IDs still mirror `modelPattern`.

- [ ] **Step 3: Create ID helper**

Create `desktop/electron/services/model-price/rule-id.ts`:

```ts
import { createHash } from "node:crypto"

const MODEL_PRICE_RULE_ID_PATTERN = /^mpr_[a-f0-9]{12}$/

export function isModelPriceRuleId(value: string): boolean {
  return MODEL_PRICE_RULE_ID_PATTERN.test(value)
}

export function normalizeModelPatternKey(value: string): string {
  return value.trim().toLowerCase()
}

export function createModelPriceRuleId(namespace: string, modelPattern: string): string {
  const hash = createHash("sha256")
    .update(`${namespace}:${normalizeModelPatternKey(modelPattern)}`)
    .digest("hex")
    .slice(0, 12)
  return `mpr_${hash}`
}
```

- [ ] **Step 4: Use helper in normalization**

In `desktop/electron/services/model-price/matching.ts`, replace the old slug ID generation with hash ID generation:

```ts
import { createModelPriceRuleId, isModelPriceRuleId } from "./rule-id"

function makeRuleId(input: ModelPriceRuleInput, index: number, usedIds: Set<string>): string {
  const base = input.id && isModelPriceRuleId(input.id)
    ? input.id
    : createModelPriceRuleId(input.id || `manual-${index + 1}`, input.modelPattern || `price-rule-${index + 1}`)
  let id = base
  let suffix = 2
  while (usedIds.has(id)) {
    id = `${base.slice(0, 16 - String(suffix).length)}${suffix}`
    suffix += 1
  }
  usedIds.add(id)
  return id
}
```

Ensure collision handling still produces an ID that starts with `mpr_`.

- [ ] **Step 5: Run model-price service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/model-price
```

Expected: model-price tests pass.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/model-price/rule-id.ts desktop/electron/services/model-price/matching.ts desktop/electron/services/model-price/__tests__/model-price-service.test.ts
git commit -m "fix(model-price): use internal hash rule ids"
```

---

### Task 3: Add Built-In Preset Data And Import Semantics

**Files:**
- Create `desktop/electron/services/model-price/presets.ts`
- Modify `desktop/electron/services/model-price/types.ts`
- Modify `desktop/electron/services/model-price/service.ts`
- Modify `desktop/electron/services/model-price/index.ts`
- Modify `desktop/electron/services/model-price/__tests__/model-price-service.test.ts`

- [ ] **Step 1: Write failing preset tests**

Add tests for summaries, import append, import overwrite, sequential imports, and unknown preset safety:

```ts
it("lists built-in model price presets without exposing rule payloads", () => {
  const db = createDb()
  const service = new ModelPriceService(db)

  expect(service.listPresets()).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "deepseek-official", label: "DeepSeek 官方", ruleCount: expect.any(Number) }),
    expect.objectContaining({ id: "aliyun-bailian", label: "阿里云百炼", ruleCount: expect.any(Number) }),
  ]))
  db.close()
})

it("imports presets and overwrites by modelPattern instead of rule id", () => {
  const db = createDb()
  const service = new ModelPriceService(db)
  service.saveRules([{ id: "legacy-deepseek", modelPattern: "deepseek-v4-pro", inputPer1M: 999, source: "user" }])

  const imported = service.importPreset("deepseek-official")
  const deepseek = imported.find((rule) => rule.modelPattern === "deepseek-v4-pro")

  expect(deepseek).toMatchObject({
    inputPer1M: 3,
    outputPer1M: 6,
    cacheReadPer1M: 0.025,
    source: "builtin",
  })
  expect(deepseek?.id).toMatch(/^mpr_[a-f0-9]{12}$/)
  db.close()
})

it("lets later preset imports win for overlapping model patterns", () => {
  const db = createDb()
  const service = new ModelPriceService(db)

  service.importPreset("deepseek-official")
  const afterBailian = service.importPreset("aliyun-bailian")

  expect(afterBailian.find((rule) => rule.modelPattern === "deepseek-v4-pro")?.inputPer1M)
    .not.toBe(3)
  db.close()
})

it("does not mutate rules for unknown preset ids", () => {
  const db = createDb()
  const service = new ModelPriceService(db)
  service.saveRules([{ modelPattern: "local-model", inputPer1M: 1 }])
  const before = service.listRules()

  expect(() => service.importPreset("missing" as never)).toThrow(/Unknown model price preset/)
  expect(service.listRules()).toEqual(before)
  db.close()
})
```

- [ ] **Step 2: Run failing preset tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/model-price/__tests__/model-price-service.test.ts -t "preset"
```

Expected: failure because preset APIs do not exist.

- [ ] **Step 3: Add preset types**

In `desktop/electron/services/model-price/types.ts`, add:

```ts
export type ModelPricePresetId =
  | "openai"
  | "anthropic"
  | "deepseek-official"
  | "aliyun-bailian"
  | "other"

export interface ModelPricePreset {
  readonly id: ModelPricePresetId
  readonly label: string
  readonly rules: readonly ModelPriceRuleInput[]
}

export interface ModelPricePresetSummary {
  readonly id: ModelPricePresetId
  readonly label: string
  readonly ruleCount: number
}
```

- [ ] **Step 4: Create preset data file**

Create `desktop/electron/services/model-price/presets.ts` with:

- `MODEL_PRICE_PRESETS`;
- `listModelPricePresetSummaries()`;
- `getModelPricePreset(presetId)`;
- `isModelPricePresetId(value)`.

DeepSeek official values must be:

```ts
const DEEPSEEK_OFFICIAL_RULES: readonly ModelPriceRuleInput[] = [
  { modelPattern: "deepseek-v4-flash", inputPer1M: 1, outputPer1M: 2, cacheReadPer1M: 0.02, reasoningPer1M: 2, source: "builtin" },
  { modelPattern: "deepseek-v4-pro", inputPer1M: 3, outputPer1M: 6, cacheReadPer1M: 0.025, reasoningPer1M: 6, source: "builtin" },
]
```

For `阿里云百炼`, use only China mainland / 华北 2（北京） prices from `https://help.aliyun.com/zh/model-studio/model-pricing`, only common text-generation families:

- Qwen / 千问
- DeepSeek
- Kimi
- GLM
- MiniMax
- Mimo

For tiered prices, encode the highest China mainland tier into the flat rule. Do not include image, audio, video, embedding, rerank, or OCR models. Add a short code comment above the Bailian array:

```ts
// China mainland / 华北 2（北京） prices. Tiered models use the highest listed text-generation tier.
```

Do not include `id` in preset rule inputs.

- [ ] **Step 5: Implement service preset import**

In `desktop/electron/services/model-price/service.ts`, add:

```ts
listPresets(): ModelPricePresetSummary[] {
  return listModelPricePresetSummaries()
}

importPreset(presetId: ModelPricePresetId): ModelPriceRule[] {
  const preset = getModelPricePreset(presetId)
  const current = this.listRules()
  const byPattern = new Map(current.map((rule) => [normalizeModelPatternKey(rule.modelPattern), rule]))
  const importedKeys = new Set<string>()
  const now = new Date().toISOString()
  const presetRules = preset.rules.map((rule, index) => ({
    ...rule,
    id: createModelPriceRuleId(`preset:${preset.id}`, rule.modelPattern),
    source: "builtin" as const,
    sortIndex: byPattern.has(normalizeModelPatternKey(rule.modelPattern))
      ? byPattern.get(normalizeModelPatternKey(rule.modelPattern))?.sortIndex
      : current.length + index,
    updatedAt: now,
  }))
  for (const rule of presetRules) importedKeys.add(normalizeModelPatternKey(rule.modelPattern))
  const preserved = current.filter((rule) => !importedKeys.has(normalizeModelPatternKey(rule.modelPattern)))
  const rules = normalizeModelPriceRules([...preserved, ...presetRules])
  replaceModelPriceRules(this.db, rules)
  return this.listRules()
}
```

Import `createModelPriceRuleId` and `normalizeModelPatternKey` from `rule-id.ts`.

- [ ] **Step 6: Export preset APIs**

In `desktop/electron/services/model-price/index.ts`, export preset helpers and types needed by IPC.

- [ ] **Step 7: Run service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/model-price
```

Expected: all model-price tests pass.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/services/model-price desktop/electron/services/model-price/__tests__/model-price-service.test.ts
git commit -m "feat(model-price): add preset import service"
```

---

### Task 4: Add IPC, Preload, And Bridge Types

**Files:**
- Modify `desktop/electron/model-price/channels.ts`
- Modify `desktop/electron/model-price/ipc-handlers.ts`
- Modify `desktop/electron/preload.ts`
- Modify `desktop/src/types/bridge.ts`
- Modify `desktop/electron/__tests__/preload.test.ts`

- [ ] **Step 1: Write failing preload tests**

In `desktop/electron/__tests__/preload.test.ts`, update the model price bridge test:

```ts
await bridge.modelPrice.listPresets()
await bridge.modelPrice.importPreset("deepseek-official")
await bridge.modelPrice.clearRules()

expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
  "synapse:model-price:presets:list",
  undefined,
)
expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
  "synapse:model-price:presets:import",
  "deepseek-official",
)
expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
  "synapse:model-price:rules:clear",
  undefined,
)
```

Remove or stop asserting `rules:reset` from the first-class `modelPrice` bridge.

- [ ] **Step 2: Run failing preload test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/__tests__/preload.test.ts -t "model price"
```

Expected: failure because methods/channels do not exist.

- [ ] **Step 3: Add channels**

In `desktop/electron/model-price/channels.ts`, add:

```ts
presetsList: "synapse:model-price:presets:list",
presetsImport: "synapse:model-price:presets:import",
rulesClear: "synapse:model-price:rules:clear",
```

Leave `rulesReset` only if needed for deprecated compatibility, but new renderer code must use `rulesClear`.

- [ ] **Step 4: Add IPC handlers**

In `desktop/electron/model-price/ipc-handlers.ts`:

- import `isModelPricePresetId`;
- add `presetsList` handler returning `modelPrice.listPresets()`;
- add `presetsImport` handler validating the ID and calling `modelPrice.importPreset(id)`;
- add `rulesClear` handler calling `modelPrice.clearRules()`.

Use this validation:

```ts
function normalizePresetId(value: unknown): ModelPricePresetId {
  if (isModelPricePresetId(value)) return value
  throw new Error("Unknown model price preset")
}
```

- [ ] **Step 5: Update preload bridge**

In `desktop/electron/preload.ts`, expose:

```ts
listPresets: invoke(IPC_CHANNELS["model-price"].presetsList),
importPreset: (presetId) => invoke(IPC_CHANNELS["model-price"].presetsImport)(presetId),
clearRules: invoke(IPC_CHANNELS["model-price"].rulesClear),
```

Remove `resetRules` from the first-class `modelPrice` bridge unless another file still requires it. If keeping it temporarily, make it call `rulesClear`.

- [ ] **Step 6: Update renderer bridge types**

In `desktop/src/types/bridge.ts`, add `ModelPricePresetId` and `ModelPricePresetSummary`, then update `modelPrice`:

```ts
listPresets: () => Promise<ModelPricePresetSummary[]>
importPreset: (presetId: ModelPricePresetId) => Promise<ModelPriceRule[]>
clearRules: () => Promise<ModelPriceRule[]>
```

- [ ] **Step 7: Run preload tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/__tests__/preload.test.ts
```

Expected: preload tests pass.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/model-price desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/electron/__tests__/preload.test.ts
git commit -m "feat(model-price): expose preset import bridge"
```

---

### Task 5: Update Price Rules UI

**Files:**
- Modify `desktop/src/modules/model-price/index.tsx`
- Modify `desktop/src/modules/model-price/types.ts`
- Modify `desktop/src/modules/model-price/components/price-rules-view.tsx`
- Modify `desktop/src/modules/model-price/__tests__/price-rules-view.test.tsx`
- Create or modify `desktop/src/modules/model-price/__tests__/model-price-module.test.tsx`

- [ ] **Step 1: Write failing UI tests for tab order and default view**

Create `desktop/src/modules/model-price/__tests__/model-price-module.test.tsx` or extend an existing module test. Assert:

```ts
vi.mock("../components/price-rules-view", () => ({
  PriceRulesView: () => <div data-view="rules">rules-view</div>,
}))

vi.mock("../components/model-coverage-view", () => ({
  ModelCoverageView: () => <div data-view="coverage">coverage-view</div>,
}))

expect(document.querySelector('[data-view="rules"]')).toBeTruthy()
expect(document.querySelector('[data-view="coverage"]')).toBeNull()
```

Also assert tab trigger order by reading trigger text:

```ts
const tabs = [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)
expect(tabs).toEqual(["价格规则", "模型覆盖"])
```

- [ ] **Step 2: Write failing UI tests for clear and import**

In `desktop/src/modules/model-price/__tests__/price-rules-view.test.tsx`:

- replace `resetRules` mock with `clearRules`, `listPresets`, and `importPreset`;
- assert `重置` and `恢复内置默认价格` are absent;
- assert clear confirmation calls `clearRules`;
- assert import dialog calls `importPreset("deepseek-official")`.

Use mock preset data:

```ts
modelPriceBridge.listPresets.mockResolvedValueOnce([
  { id: "deepseek-official", label: "DeepSeek 官方", ruleCount: 2 },
])
modelPriceBridge.importPreset.mockResolvedValueOnce([
  priceRule({ id: "mpr_123456789abc", modelPattern: "deepseek-v4-pro", inputPer1M: 3 }),
])
```

- [ ] **Step 3: Run failing UI tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/model-price
```

Expected: UI tests fail because current UI defaults to coverage and still has reset.

- [ ] **Step 4: Update module tab order/default**

In `desktop/src/modules/model-price/index.tsx`:

```ts
const MODEL_PRICE_VIEWS = [
  { id: "rules", label: "价格规则" },
  { id: "coverage", label: "模型覆盖" },
] as const

const [view, setView] = useState<ModelPriceViewId>("rules")
```

- [ ] **Step 5: Add preset renderer types**

In `desktop/src/modules/model-price/types.ts`, re-export `ModelPricePresetId` and `ModelPricePresetSummary`.

- [ ] **Step 6: Replace reset with clear and import dialog**

In `desktop/src/modules/model-price/components/price-rules-view.tsx`:

- remove `RotateCcw` reset behavior;
- use `Trash2` or another existing icon for `清空`;
- add `导入预设` button using existing `Dialog`, `RadioGroup`, and `Button`;
- load presets when dialog opens through `requireSynapseBridge().modelPrice.listPresets()`;
- call `requireSynapseBridge().modelPrice.importPreset(selectedPresetId)`;
- call `requireSynapseBridge().modelPrice.clearRules()` from the clear confirmation.

Keep copy short:

- `导入预设`
- `清空`
- `清空价格规则`
- `当前规则会被删除。`
- `确认清空`
- `导入`
- notifications: `已导入预设`, `导入失败`, `已清空`, `清空失败`

Do not render `id` or a `名称` column.

- [ ] **Step 7: Run UI tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/model-price
```

Expected: model-price renderer tests pass.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/modules/model-price
git commit -m "feat(model-price): add preset import UI"
```

---

### Task 6: Update MCP And AI-Facing Docs

**Files:**
- Modify `desktop/synapse-capabilities/shared/model-price-domain.ts`
- Modify `desktop/resources/templates/skills/synapse-model-price-mcp/content.md`
- Modify `desktop/resources/templates/skills/synapse-model-price-mcp/files/api-reference.md`
- Modify `desktop/tests/unit/synapse-capabilities.test.ts`
- Modify `desktop/tests/unit/database-mcp-rpc.test.ts`

- [ ] **Step 1: Write failing MCP wording tests**

In `desktop/tests/unit/synapse-capabilities.test.ts`, extend the model-price schema test:

```ts
const ruleList = tools.find((tool) => tool.name === "model_price_rule_list")
const ruleGet = tools.find((tool) => tool.name === "model_price_rule_get")
expect(JSON.stringify(ruleGet)).toContain("Rule ID")
expect(JSON.stringify(ruleGet)).not.toContain("name")
expect(ruleList?.description).toContain("ruleId")
```

In `desktop/tests/unit/database-mcp-rpc.test.ts`, update fixtures to use `mpr_123456789abc` instead of model-name-like IDs.

- [ ] **Step 2: Run failing MCP tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/synapse-capabilities.test.ts tests/unit/database-mcp-rpc.test.ts
```

Expected: failure until descriptions/examples are updated.

- [ ] **Step 3: Update capability descriptions**

In `desktop/synapse-capabilities/shared/model-price-domain.ts`:

- change rule ID property description to `"Internal model price rule ID. It is not a model name; use modelPattern as the model-matching value."`;
- update rule list description to mention returned `id` is an internal handle;
- ensure `modelPattern` description says it is the model-matching value.

- [ ] **Step 4: Update bundled skill docs**

In `desktop/resources/templates/skills/synapse-model-price-mcp/content.md`, add:

```md
- `id` is an internal rule ID for mutations. It is not a model name.
- `modelPattern` is the model-matching value. When the user asks for the model name, use `modelPattern`.
```

In `api-reference.md`, change examples:

```json
{ "ruleId": "mpr_123456789abc" }
```

and add a returned rule example that clearly labels `id` as internal.

- [ ] **Step 5: Run MCP tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/synapse-capabilities.test.ts tests/unit/database-mcp-rpc.test.ts
```

Expected: tests pass.

- [ ] **Step 6: Commit**

```bash
git add desktop/synapse-capabilities/shared/model-price-domain.ts desktop/resources/templates/skills/synapse-model-price-mcp desktop/tests/unit/synapse-capabilities.test.ts desktop/tests/unit/database-mcp-rpc.test.ts
git commit -m "docs(model-price): clarify rule id semantics"
```

---

### Task 7: Release Notes And Compatibility Cleanup

**Files:**
- Modify `desktop/electron/services/usage-analysis/cc-service.ts`
- Modify `desktop/electron/services/model-price/defaults.ts`
- Modify `RELEASE_NOTES_PENDING.md`
- Modify impacted tests from `rg DEFAULT_MODEL_PRICE_RULES`

- [ ] **Step 1: Audit compatibility references**

Run:

```bash
rg -n "resetRulesToDefaults|resetRules|DEFAULT_MODEL_PRICE_RULES|rulesReset|pricingRulesReset" desktop/electron desktop/src desktop/tests
```

Expected: identify remaining reset/default references.

- [ ] **Step 2: Update compatibility reset paths**

If `usageAnalysis.resetPricingRules` or other compatibility APIs remain, make them call `ModelPriceService.clearRules()` rather than repopulating defaults. Do not remove compatibility methods unless no tests or callers reference them.

- [ ] **Step 3: Keep or retire defaults export safely**

If tests still import `DEFAULT_MODEL_PRICE_RULES`, either:

- replace those tests with explicit local fixture rules; or
- set `DEFAULT_MODEL_PRICE_RULES` to `[]` and rename usages in tests where the meaning is no longer "built-in defaults".

Do not leave a non-empty `DEFAULT_MODEL_PRICE_RULES` path that can be used by schema init or reset.

- [ ] **Step 4: Update release notes**

Under `## 功能优化` in `RELEASE_NOTES_PENDING.md`, add:

```md
- 价格规则改为按需导入预设包；升级后会保留已有规则，用户可以先清空旧规则，再导入 DeepSeek 官方、阿里云百炼等预设。
```

Under `## 问题修复`, add:

```md
- 价格规则不再把内部规则 ID 当作模型名称展示，避免模型匹配值和名称不一致造成误解。
```

- [ ] **Step 5: Commit**

```bash
git add desktop/electron desktop/src desktop/tests RELEASE_NOTES_PENDING.md
git commit -m "chore(model-price): clean up preset compatibility"
```

---

### Task 8: Final Verification

**Files:**
- No source edits expected unless verification finds failures.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/model-price electron/model-price electron/__tests__/preload.test.ts src/modules/model-price tests/unit/synapse-capabilities.test.ts tests/unit/database-mcp-rpc.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: pass.

- [ ] **Step 3: Run broader model-price search**

Run:

```bash
rg -n "恢复内置默认价格|重置|名称|DEFAULT_MODEL_PRICE_RULES|resetRulesToDefaults" desktop/src/modules/model-price desktop/electron/services/model-price desktop/resources/templates/skills/synapse-model-price-mcp desktop/synapse-capabilities/shared/model-price-domain.ts
```

Expected:

- no `恢复内置默认价格`;
- no user-facing `名称` for price rule ID;
- no non-empty default-reset path;
- any remaining `重置` is unrelated or compatibility-only and not shown in the price rules UI.

- [ ] **Step 4: Check git status**

Run:

```bash
git status --short
```

Expected: clean or only intentional uncommitted verification artifacts. Do not commit generated build output.
