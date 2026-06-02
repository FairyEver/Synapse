# Synapse Usage Model Price Defaults Design

## Context

Synapse usage analysis stores model price rules in `usage_model_prices` and seeds default rules from `desktop/electron/services/usage-analysis/pricing.ts`. Prices are CNY per 1M tokens. The current built-in defaults mostly cover GPT and Claude models, while this machine's usage history also includes DeepSeek, Kimi, GLM, and MiniMax models.

Current local usage records show meaningful usage for:

- `deepseek-v4-pro`
- `deepseek-v4-flash`
- `glm-5.1`
- `kimi-k2.5`
- `kimi-k2.6`
- `MiniMax-M2.5`

Some user price rules already exist locally for those models, but they are not part of the built-in default seed. This means fresh Synapse installs or fresh usage databases will still miss those prices.

## Goals

- Add built-in default price rules for used non-OpenAI and non-Anthropic coding models.
- Correct built-in GPT and Claude defaults where they no longer match current official prices.
- Keep all prices in CNY per 1M tokens, matching the existing `UsageModelPriceRule` domain.
- Preserve existing user rules and avoid historical repricing.

## Non-Goals

- Do not recalculate old `cc_usage_events` or `cx_usage_events` rows.
- Do not add a tiered pricing engine in this change.
- Do not modify the pricing rules dialog or other UI.
- Do not introduce new dependencies or external runtime price fetching.

## Price Sources

Use official provider or platform pricing pages where available:

- OpenAI GPT-5.4 and GPT-5.5: `https://openai.com/index/introducing-gpt-5-4/` and `https://openai.com/index/introducing-gpt-5-5/`
- Anthropic Claude: `https://claude.com/pricing`
- DeepSeek V4: `https://api-docs.deepseek.com/quick_start/pricing`
- Moonshot Kimi: `https://platform.moonshot.ai/`
- MiniMax M2.5: `https://platform.minimax.io/docs/api-reference/anthropic-api-compatible-cache`
- Alibaba Cloud Model Studio / Bailian GLM pricing: `https://help.aliyun.com/zh/model-studio/model-pricing`

## Proposed Default Rules

### OpenAI

Use the current API prices converted with Synapse's existing fixed USD-to-CNY rate of `7.2`.

- `gpt-5.5`: input `36`, output `216`, cache read `3.6`, reasoning `216`
- `gpt-5.4`: input `18`, output `108`, cache read `1.8`, reasoning `108`

Keep existing patterns for `gpt-5.3-codex` and `gpt-5-codex` unless a more specific current official Codex API price is verified during implementation.

### Anthropic

Use standard Claude API prices converted with the same fixed USD-to-CNY rate. Prompt caching uses 5-minute cache write pricing.

- `claude-opus-4.7`: input `36`, output `180`, cache read `3.6`, cache write `45`, reasoning `180`
- `claude-opus-4.6`: input `36`, output `180`, cache read `3.6`, cache write `45`, reasoning `180`
- `claude-sonnet-4.6`: input `21.6`, output `108`, cache read `2.16`, cache write `27`, reasoning `108`
- `claude-haiku-4.5`: input `7.2`, output `36`, cache read `0.72`, cache write `9`, reasoning `36`

Keep broader `claude-sonnet-4` and `claude-haiku-4` coverage only if tests prove the more specific rules sort and match correctly before broader patterns.

### DeepSeek

Use official DeepSeek V4 API prices converted with the fixed USD-to-CNY rate.

- `deepseek-v4-pro`: input `3.132`, output `6.264`, cache read `0.0261`, reasoning `6.264`
- `deepseek-v4-flash`: input `1.008`, output `2.016`, cache read `0.02016`, reasoning `2.016`

### Kimi

Use Moonshot Kimi platform prices converted with the fixed USD-to-CNY rate.

- `kimi-k2.5`: input `4.32`, output `21.6`, cache read `0.72`, reasoning `21.6`
- `kimi-k2.6`: input `6.84`, output `28.8`, cache read `1.152`, reasoning `28.8`

### GLM

Use Alibaba Cloud Bailian as the reference for GLM pricing. Bailian has tiered prices for `glm-5.1`, but Synapse's current price rule model is flat. Use the conservative higher tier so long-context usage is not underestimated.

- `glm-5.1`: input `8`, output `28`, cache read `8`, reasoning `28`

This follows the `ZHIPU/GLM-5.1` flat entry and the high-context tier for `glm-5.1` on Bailian. `cacheWritePer1M` remains `0` because the Bailian GLM price table does not expose a separate cache write price in the same way Anthropic-compatible caching does.

### MiniMax

Use MiniMax's Anthropic-compatible explicit prompt caching prices.

- `MiniMax-M2.5`: input `2.16`, output `8.64`, cache read `0.216`, cache write `2.7`, reasoning `8.64`

## Matching Strategy

- Prefer exact model-family patterns already observed in usage events.
- Add specific patterns before broad patterns where overlap exists.
- Keep source as `builtin`.
- Do not create alias rules for raw transcript-only values such as `sonnet`, `haiku`, `opus`, `<synthetic>`, `unknown`, or `nomic-embed-text`, because they are not reliable priced usage model identifiers.

## Data Flow

1. `seedDefaultUsagePriceRules()` inserts defaults only when `usage_model_prices` is empty and the seed marker has not been set.
2. Existing users with local user rules keep those rules unchanged.
3. New usage parsing uses the currently enabled rules to set `price_known` and costs.
4. Historical rows remain unchanged unless a separate, explicit repricing feature is introduced later.

## Testing

- Update pricing unit tests to cover the new default rules and corrected GPT/Claude rates.
- Add matching tests for specific Claude 4.6/4.7 names so they do not accidentally depend on broader older patterns.
- Add a default seed test that verifies the new builtin rules have `currency: "CNY"` and `source: "builtin"`.
- Do not add UI tests because no UI behavior changes.

## Future Followups

- Verify whether `gpt-5.3-codex` and `gpt-5-codex` should receive separate Codex-specific prices in a future pass. This change keeps their existing defaults.
- Consider tiered pricing by input length for GLM and other long-context models in a separate feature. This change uses flat default prices only.
