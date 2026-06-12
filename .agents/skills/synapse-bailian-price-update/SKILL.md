---
name: synapse-bailian-price-update
description: Use when working in the Synapse repository and the user asks to 从百炼更新价格, 更新百炼价格, 检查百炼模型价格, 刷新阿里云百炼价格预设, or otherwise update Synapse model price presets from Alibaba Cloud Model Studio / Bailian text model pricing. This skill gathers current Bailian text-model prices and context-cache prices from official pages and, when needed, the logged-in Bailian console model detail pages, then updates desktop/electron/services/model-price/presets.ts, related tests, and release notes.
---

# Synapse Bailian Price Update

## Scope

Update only the built-in `aliyun-bailian` price preset unless the user explicitly asks for other providers.

Primary files:
- `desktop/electron/services/model-price/presets.ts`
- `desktop/electron/services/model-price/__tests__/model-price-service.test.ts`
- `RELEASE_NOTES_PENDING.md`

Official sources:
- `https://help.aliyun.com/zh/model-studio/model-pricing`
- `https://help.aliyun.com/zh/model-studio/context-cache`
- Bailian console model market / detail pages, when official docs are ambiguous or mention "see console".

## Workflow

1. Read the current preset and tests with `rg`/`sed`.
2. Fetch current official pricing and context-cache docs. Prefer official docs for base input/output prices.
3. Use the user's already-open/logged-in Chrome Bailian console only for details not present in docs, especially exact special cache prices.
4. Build a model table for China mainland / 华北 2（北京） text generation models.
5. Patch `ALIYUN_BAILIAN_RULES` surgically.
6. Update focused tests that assert representative model IDs and cache behavior.
7. Update `RELEASE_NOTES_PENDING.md` with one user-facing line.
8. Run:
   `pnpm --filter @synapse/desktop exec vitest run electron/services/model-price/__tests__/model-price-service.test.ts`
9. Run `git diff --check` on changed files and report any broader test failures separately from the targeted result.

## Pricing Rules

- Prices are CNY per 1M tokens.
- Use China mainland / 华北 2（北京） values unless the user explicitly asks for another region.
- For tiered text models, use the highest listed input-token tier because Synapse currently stores one flat price per model pattern.
- If the table separates non-thinking output and thinking output, set:
  - `outputPer1M` to non-thinking output
  - `reasoningPer1M` to thinking / 思维链+回答 output
- If the table has only one output price, set `reasoningPer1M` equal to `outputPer1M`.
- Include free/limited-free text models with `0` prices if they appear in the Bailian text model pricing table and are callable enough to affect coverage.
- Do not add image, video, audio, embedding, VL, Omni, or OCR models unless the user expands the scope beyond text models.

## Cache Mapping

Synapse fields map to Bailian fields as follows:
- `cacheReadPer1M`: cached input token price. Prefer explicit cache hit price when explicit cache is supported; otherwise use implicit cached-token price.
- `cacheWritePer1M`: explicit cache creation price only. Leave absent for implicit-only cache.

Current Bailian docs describe:
- Explicit cache creation: input price * 125%
- Explicit cache hit: input price * 10%
- Implicit cache hit: usually input price * 20%, with provider-specific exceptions listed on the context-cache page.

Important provider exceptions from the context-cache doc:
- `deepseek-v4-pro`: not the generic 20%; verify exact `输入（缓存命中）` in console.
- Kimi 月之暗面 deployment: `kimi/kimi-k2.6` 16.9%, `kimi/kimi-k2.5` 17.5%.
- MiniMax 稀宇科技 deployment: `MiniMax/MiniMax-M3` and `MiniMax/MiniMax-M2.7` 20%; `MiniMax/MiniMax-M2.5` and `MiniMax/MiniMax-M2.1` 10%.
- GLM 智谱 deployment: 25%.
- DeepSeek 快手万擎 deployment: `vanchin/deepseek-v3.2-think` 10%; `vanchin/deepseek-v3.1-terminus`, `vanchin/deepseek-r1`, and `vanchin/deepseek-v3` 40%.

If a model detail page shows both `显式缓存命中` / `输入（缓存命中）` and `显式缓存创建`, use those exact values rather than recomputing.

## Console Automation Notes

Use the Chrome plugin / skill when the task depends on the user's logged-in Bailian console. Keep console automation read-only:
- Search model name in the model market.
- Open the model detail page.
- Read pricing rows and cache fields.
- Do not create API keys, subscribe, deploy, or change console settings.

If console crawling is slow, use official docs as the base dataset and only spot-check ambiguous models in Chrome.

## Code Rules

- Preserve existing ordering by provider family where practical.
- Keep helper functions small. Prefer separate helpers for explicit and implicit cache so future diffs show intent.
- Do not change user-created model price rules or database migrations for a preset-only update.
- Do not update unrelated presets unless the source pages reveal an overlap that the user explicitly requested.
- Keep edits limited to the preset, focused tests, and pending release note.

## Final Report

Summarize:
- Source pages used.
- Model/provider families updated.
- Cache interpretation used.
- Verification command and result.
- Any unresolved ambiguity, especially values that required console confirmation.
