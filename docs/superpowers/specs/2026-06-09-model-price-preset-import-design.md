# Model Price Preset Import Design

## Summary

Change model price rules from automatic built-in seeding to explicit preset import. The price module should open on `价格规则`, keep existing upgraded user rules intact, let users clear rules manually, and let users import one or more built-in price presets.

## Goals

- Make `价格规则` the left tab and default active view in the `价格` module.
- Stop automatic default price seeding for fresh installs.
- Keep existing price rules when users upgrade from older versions.
- Replace `重置` with an explicit `清空` action.
- Add `导入预设` for built-in price preset packages.
- Let preset import overwrite existing rules with the same `modelPattern`, including user-edited rules.
- Let users import multiple presets in sequence; later imports win for overlapping model names.
- Make `modelPattern` the only user-facing model identifier in the price rules UI.
- Make rule IDs internal hash-like handles instead of model-name-like strings.
- Keep prices in `CNY / 1M token`.

## Non-Goals

- No automatic clearing or replacement of old user rules during app startup or installation.
- No new database file and no dropping the existing usage-analysis database.
- No migration from legacy `usage_model_prices`.
- No provider-bound pricing rules.
- No tiered pricing engine in this change.
- No image, audio, video, or non-text-generation model pricing.
- No external runtime price fetching.
- No historical repricing.

## Product Behavior

The price module has two tabs:

```text
价格规则 · 模型覆盖
```

`价格规则` is active by default.

The price rules header actions are:

- `导入预设`
- `清空`
- `添加`
- `保存`

`清空` opens a confirmation dialog:

- Title: `清空价格规则`
- Description: `当前规则会被删除。`
- Confirm action: `确认清空`

When clearing succeeds, the table becomes empty and the UI shows the existing success notification style.

`导入预设` opens a small dialog that lists built-in presets. The user selects one preset and clicks `导入`. The action writes to the current rules, refreshes the table, and shows `已导入预设`.

UI copy must stay operational and short. Do not add explanatory product text, marketing copy, gradients, custom colors, or nested cards.

The price rules UI must not display `id`. Users only see and edit `modelPattern`, shown as `模型匹配`. Do not add a separate `名称` field. The model price that actually matches usage is always `modelPattern`.

## Upgrade Behavior

Existing users may already have rules inserted by older built-in defaults or edited manually. The new version must not silently delete or overwrite them.

Rules after upgrade:

- Old rules remain as they are.
- Users who want the new preset model can click `清空`, then import the desired preset.
- Users who do nothing keep their current price behavior.

Fresh installs:

- `model_price_rules` starts empty.
- Schema initialization writes an idempotent marker after ensuring the table exists, but it does not insert default rules.

Schema initialization must never delete existing `model_price_rules` rows. If the marker is missing but rows already exist, keep the rows and write the marker.

This makes the user-visible migration safe and easy to explain in release notes.

## Preset Packages

Add built-in model price presets under the `model-price` service boundary. The presets are code-maintained data, not user files.

Initial presets:

- `OpenAI`
- `Anthropic`
- `DeepSeek 官方`
- `阿里云百炼`
- `其他`

`DeepSeek 官方` uses DeepSeek official API prices from `https://api-docs.deepseek.com/zh-cn/quick_start/pricing/`.

As of the design date, DeepSeek lists:

- `deepseek-v4-flash`: cache-hit input `0.02`, cache-miss input `1`, output `2`
- `deepseek-v4-pro`: cache-hit input `0.025`, cache-miss input `3`, output `6`

Map cache-hit input to `cacheReadPer1M`, cache-miss input to `inputPer1M`, and output to both `outputPer1M` and `reasoningPer1M` when reasoning tokens are priced as output.

`阿里云百炼` uses Alibaba Cloud Model Studio pricing from `https://help.aliyun.com/zh/model-studio/model-pricing`.

Use the China mainland service deployment range prices for the Bailian preset. When the page has regional sections, choose the China mainland / 华北 2（北京） rows instead of global, Singapore, Germany, or other international deployment ranges.

The Bailian preset includes common text-generation model families only:

- Qwen / 千问
- DeepSeek
- Kimi
- GLM
- MiniMax
- Mimo

Do not include image, audio, video, embedding, rerank, OCR, or other non-text-generation models in this preset.

If Bailian lists tiered prices for a model, use the highest listed tier that fits the current flat price-rule schema. This is intentionally conservative and avoids underestimating long-context usage.

## Data Model

Keep the existing `model_price_rules` table and `ModelPriceRule` shape:

```ts
{
  id: string
  modelPattern: string
  inputPer1M: number
  outputPer1M: number
  cacheReadPer1M: number
  cacheWritePer1M: number
  reasoningPer1M: number
  currency: "CNY"
  enabled: boolean
  source: "builtin" | "user"
  sortIndex: number
  updatedAt: string
}
```

`id` is an internal rule handle. It is used for update, delete, enable, and disable actions, but it is not a model name and must not be labeled as `名称`.

New rule IDs should be generated as hash-like strings that do not look like model names:

```text
mpr_<short-hash>
```

The hash input should include the normalized `modelPattern` plus a stable namespace such as the preset ID for preset rules or a generated draft seed for manually created duplicate patterns. This keeps IDs stable enough for rule mutation while avoiding human-readable model-name IDs such as `qwen3-6-plus`.

Preset data should not hand-write rule IDs. Preset rule IDs are derived by the import path from preset ID and `modelPattern`.

Add preset metadata types:

```ts
type ModelPricePresetId =
  | "openai"
  | "anthropic"
  | "deepseek-official"
  | "aliyun-bailian"
  | "other"

interface ModelPricePreset {
  id: ModelPricePresetId
  label: string
  rules: readonly ModelPriceRuleInput[]
}
```

Preset-imported rules should use `source: "builtin"` because they come from Synapse-maintained preset data. When the user later edits and saves the table manually, the existing save path can continue to mark the saved rows as `source: "user"`.

Expose summaries to the renderer without sending every rule until import:

```ts
interface ModelPricePresetSummary {
  id: ModelPricePresetId
  label: string
  ruleCount: number
}
```

## Import Semantics

Import is a write operation.

1. Load the selected preset by ID.
2. Read current rules.
3. Build a map keyed by normalized `modelPattern`.
4. For each preset rule:
   - if a current rule has the same normalized `modelPattern`, replace it with the preset rule;
   - if no current rule matches, append the preset rule.
5. Preserve non-overlapping current rules.
6. Normalize rule order and save the full list.
7. Return the saved rules.

The normalized key is trimmed and case-insensitive. It must not use `id` as the primary overwrite key, because different presets may price the same model with different rule IDs.

When a preset overwrites an existing rule with the same `modelPattern`, the saved row should receive the preset-derived hash ID. Existing stale model-name-like IDs are allowed to disappear during explicit preset import or manual save normalization. No automatic startup migration is required.

Example:

1. User imports `DeepSeek 官方`.
2. User imports `阿里云百炼`.
3. Final rules contain Bailian's DeepSeek prices for overlapping DeepSeek model names, plus the rest of Bailian's common text-generation models.

## Main Process API

Extend the model-price service:

- `listPresets(): ModelPricePresetSummary[]`
- `importPreset(presetId: ModelPricePresetId): ModelPriceRule[]`
- `clearRules(): ModelPriceRule[]`

`clearRules` replaces the current rules with an empty list and returns `[]`.

Add IPC channels under the model-price namespace:

- `synapse:model-price:presets:list`
- `synapse:model-price:presets:import`
- `synapse:model-price:rules:clear`

IPC handlers must validate preset IDs in the main process. They must keep using the existing validated IPC boundary and must not introduce naked `ipcMain.handle/on`.

## Renderer API

Extend `window.synapse.modelPrice`:

- `listPresets()`
- `importPreset(presetId)`
- `clearRules()`

`PriceRulesView` owns the dialog/menu state and updates rows from the returned rule list after import or clear.

## MCP And AI-Facing Semantics

MCP rule list/get responses may include `id` because mutation actions need a stable handle. Tool descriptions, schemas, and AI-facing docs must call it `规则 ID` or `ruleId`, never `名称`.

For humans and agents:

- `id` / `ruleId`: internal rule handle for update, delete, enable, and disable.
- `modelPattern`: the only model-matching identifier and the only user-facing model value.

Do not expose or document a `name` field for model price rules. If an agent asks for the model name, it should use `modelPattern`.

## Error Handling

- Unknown preset ID returns a clear error and does not change rules.
- Import failure leaves existing rules unchanged.
- Clear failure leaves existing rules unchanged.
- Invalid preset rule data should fail during normalization before writing.
- Renderer notifications stay short: `导入失败`, `清空失败`, `保存失败`.

## Tests

Main process tests:

- Fresh schema initialization creates empty `model_price_rules`.
- Existing `model_price_rules` are preserved after schema initialization.
- Legacy `usage_model_prices` remains ignored.
- `clearRules()` deletes model-price rules only.
- `importPreset()` appends new preset rules.
- `importPreset()` overwrites same `modelPattern`, including user-source rules.
- Sequential imports let later preset prices win.
- Unknown preset IDs do not mutate the database.

Renderer tests:

- Price module defaults to `价格规则` and orders tabs as `价格规则`, `模型覆盖`.
- Price rules UI does not render rule IDs or a `名称` column.
- Price rules view calls `clearRules()` after confirmation.
- Price rules view calls `importPreset()` and refreshes rows.
- Reset copy no longer appears.

Preload and IPC tests:

- New model-price bridge methods invoke the expected channels.
- New IPC handlers validate inputs and return normalized rows.
- Preset-imported IDs use the `mpr_<short-hash>` shape and do not mirror `modelPattern`.
- MCP/action docs and tests refer to `id` as `规则 ID` or `ruleId`, not `名称`.

## Release Notes

Update `RELEASE_NOTES_PENDING.md` during implementation:

- Mention that price rules now support importing built-in presets.
- Mention that existing price rules are preserved on upgrade.
- Mention that users can clear old rules before importing the preset they need.
