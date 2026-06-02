# Usage Model Price Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update Synapse's built-in usage price rules so new usage databases cover the coding models already seen in local Claude Code and Codex usage.

**Architecture:** Keep the existing flat `UsageModelPriceRule` model. Add and correct default seed rules in `pricing.ts`, prove matching and seeding through focused Vitest coverage, and update pending release notes.

**Tech Stack:** TypeScript, Node `node:sqlite`, Vitest, pnpm workspace scripts.

---

## File Structure

- Modify `desktop/electron/services/usage-analysis/__tests__/pricing.test.ts`
  - Adds exact assertions for corrected OpenAI/Anthropic prices and newly covered DeepSeek, Kimi, GLM, and MiniMax defaults.
  - Proves specific Claude model patterns match before broader aliases.
- Modify `desktop/electron/services/usage-analysis/pricing.ts`
  - Updates `DEFAULT_USAGE_PRICE_RULE_INPUTS` only.
  - Keeps matching, persistence, and estimation logic unchanged.
- Modify `RELEASE_NOTES_PENDING.md`
  - Adds one user-facing note under `功能优化`.

## Task 1: Add Failing Price Coverage Tests

**Files:**
- Modify: `desktop/electron/services/usage-analysis/__tests__/pricing.test.ts`

- [ ] **Step 1: Add exact default rule assertions**

Add this helper near the top of the test file after imports:

```ts
function defaultRule(modelPattern: string) {
  const rule = DEFAULT_USAGE_PRICE_RULES.find((candidate) => candidate.modelPattern === modelPattern)
  expect(rule).toBeTruthy()
  return rule!
}
```

Add these tests after `keeps default in-memory rules in CNY`:

```ts
  it("contains current built-in coding model price defaults", () => {
    expect(defaultRule("gpt-5.5")).toMatchObject({
      inputPer1M: 36,
      outputPer1M: 216,
      cacheReadPer1M: 3.6,
      cacheWritePer1M: 0,
      reasoningPer1M: 216,
      currency: "CNY",
      source: "builtin",
    })
    expect(defaultRule("gpt-5.4")).toMatchObject({
      inputPer1M: 18,
      outputPer1M: 108,
      cacheReadPer1M: 1.8,
      cacheWritePer1M: 0,
      reasoningPer1M: 108,
      currency: "CNY",
      source: "builtin",
    })
    expect(defaultRule("claude-opus-4.7")).toMatchObject({
      inputPer1M: 36,
      outputPer1M: 180,
      cacheReadPer1M: 3.6,
      cacheWritePer1M: 45,
      reasoningPer1M: 180,
      currency: "CNY",
      source: "builtin",
    })
    expect(defaultRule("claude-opus-4.6")).toMatchObject({
      inputPer1M: 36,
      outputPer1M: 180,
      cacheReadPer1M: 3.6,
      cacheWritePer1M: 45,
      reasoningPer1M: 180,
      currency: "CNY",
      source: "builtin",
    })
    expect(defaultRule("deepseek-v4-pro")).toMatchObject({
      inputPer1M: 3.132,
      outputPer1M: 6.264,
      cacheReadPer1M: 0.0261,
      cacheWritePer1M: 0,
      reasoningPer1M: 6.264,
      currency: "CNY",
      source: "builtin",
    })
    expect(defaultRule("deepseek-v4-flash")).toMatchObject({
      inputPer1M: 1.008,
      outputPer1M: 2.016,
      cacheReadPer1M: 0.02016,
      cacheWritePer1M: 0,
      reasoningPer1M: 2.016,
      currency: "CNY",
      source: "builtin",
    })
    expect(defaultRule("kimi-k2.5")).toMatchObject({
      inputPer1M: 4.32,
      outputPer1M: 21.6,
      cacheReadPer1M: 0.72,
      cacheWritePer1M: 0,
      reasoningPer1M: 21.6,
      currency: "CNY",
      source: "builtin",
    })
    expect(defaultRule("kimi-k2.6")).toMatchObject({
      inputPer1M: 6.84,
      outputPer1M: 28.8,
      cacheReadPer1M: 1.152,
      cacheWritePer1M: 0,
      reasoningPer1M: 28.8,
      currency: "CNY",
      source: "builtin",
    })
    expect(defaultRule("glm-5.1")).toMatchObject({
      inputPer1M: 8,
      outputPer1M: 28,
      cacheReadPer1M: 8,
      cacheWritePer1M: 0,
      reasoningPer1M: 28,
      currency: "CNY",
      source: "builtin",
    })
    expect(defaultRule("MiniMax-M2.5")).toMatchObject({
      inputPer1M: 2.16,
      outputPer1M: 8.64,
      cacheReadPer1M: 0.216,
      cacheWritePer1M: 2.7,
      reasoningPer1M: 8.64,
      currency: "CNY",
      source: "builtin",
    })
  })

  it("matches specific Claude 4.6 and 4.7 model rules before broader Claude aliases", () => {
    expect(findUsagePriceRuleForModel("claude-opus-4.6", DEFAULT_USAGE_PRICE_RULES)).toMatchObject({
      id: "claude-opus-4-6",
      modelPattern: "claude-opus-4.6",
      inputPer1M: 36,
    })
    expect(findUsagePriceRuleForModel("claude-opus-4-7", DEFAULT_USAGE_PRICE_RULES)).toMatchObject({
      id: "claude-opus-4-7",
      modelPattern: "claude-opus-4.7",
      inputPer1M: 36,
    })
    expect(findUsagePriceRuleForModel("claude-opus-4.6-thinking", DEFAULT_USAGE_PRICE_RULES)).toMatchObject({
      id: "claude-opus-4-6",
      modelPattern: "claude-opus-4.6",
      outputPer1M: 180,
    })
  })
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/pricing.test.ts
```

Expected: FAIL because `gpt-5.5`, `gpt-5.4`, and `claude-opus-4.6` still have old prices and the new model defaults do not exist.

## Task 2: Update Built-In Default Rules

**Files:**
- Modify: `desktop/electron/services/usage-analysis/pricing.ts`

- [ ] **Step 1: Replace default rule inputs**

Replace `DEFAULT_USAGE_PRICE_RULE_INPUTS` with:

```ts
const DEFAULT_USAGE_PRICE_RULE_INPUTS: readonly UsageModelPriceRuleInput[] = [
  { id: "gpt-5-5", modelPattern: "gpt-5.5", inputPer1M: 36, outputPer1M: 216, cacheReadPer1M: 3.6, reasoningPer1M: 216, source: "builtin" },
  { id: "gpt-5-4", modelPattern: "gpt-5.4", inputPer1M: 18, outputPer1M: 108, cacheReadPer1M: 1.8, reasoningPer1M: 108, source: "builtin" },
  { id: "gpt-5-3-codex", modelPattern: "gpt-5.3-codex", inputPer1M: 9, outputPer1M: 72, cacheReadPer1M: 0.9, reasoningPer1M: 72, source: "builtin" },
  { id: "gpt-5-codex", modelPattern: "gpt-5-codex", inputPer1M: 9, outputPer1M: 72, cacheReadPer1M: 0.9, reasoningPer1M: 72, source: "builtin" },
  { id: "claude-opus-4-7", modelPattern: "claude-opus-4.7", inputPer1M: 36, outputPer1M: 180, cacheReadPer1M: 3.6, cacheWritePer1M: 45, reasoningPer1M: 180, source: "builtin" },
  { id: "claude-opus-4-7-hyphen", modelPattern: "claude-opus-4-7", inputPer1M: 36, outputPer1M: 180, cacheReadPer1M: 3.6, cacheWritePer1M: 45, reasoningPer1M: 180, source: "builtin" },
  { id: "claude-opus-4-6", modelPattern: "claude-opus-4.6", inputPer1M: 36, outputPer1M: 180, cacheReadPer1M: 3.6, cacheWritePer1M: 45, reasoningPer1M: 180, source: "builtin" },
  { id: "claude-opus-4-6-hyphen", modelPattern: "claude-opus-4-6", inputPer1M: 36, outputPer1M: 180, cacheReadPer1M: 3.6, cacheWritePer1M: 45, reasoningPer1M: 180, source: "builtin" },
  { id: "claude-opus-4", modelPattern: "claude-opus-4", inputPer1M: 108, outputPer1M: 540, cacheReadPer1M: 10.8, cacheWritePer1M: 135, reasoningPer1M: 540, source: "builtin" },
  { id: "claude-sonnet-4-6", modelPattern: "claude-sonnet-4.6", inputPer1M: 21.6, outputPer1M: 108, cacheReadPer1M: 2.16, cacheWritePer1M: 27, reasoningPer1M: 108, source: "builtin" },
  { id: "claude-sonnet-4", modelPattern: "claude-sonnet-4", inputPer1M: 21.6, outputPer1M: 108, cacheReadPer1M: 2.16, cacheWritePer1M: 27, reasoningPer1M: 108, source: "builtin" },
  { id: "claude-haiku-4-5", modelPattern: "claude-haiku-4.5", inputPer1M: 7.2, outputPer1M: 36, cacheReadPer1M: 0.72, cacheWritePer1M: 9, reasoningPer1M: 36, source: "builtin" },
  { id: "claude-haiku-4", modelPattern: "claude-haiku-4", inputPer1M: 7.2, outputPer1M: 36, cacheReadPer1M: 0.72, cacheWritePer1M: 9, reasoningPer1M: 36, source: "builtin" },
  { id: "deepseek-v4-pro", modelPattern: "deepseek-v4-pro", inputPer1M: 3.132, outputPer1M: 6.264, cacheReadPer1M: 0.0261, reasoningPer1M: 6.264, source: "builtin" },
  { id: "deepseek-v4-flash", modelPattern: "deepseek-v4-flash", inputPer1M: 1.008, outputPer1M: 2.016, cacheReadPer1M: 0.02016, reasoningPer1M: 2.016, source: "builtin" },
  { id: "kimi-k2-5", modelPattern: "kimi-k2.5", inputPer1M: 4.32, outputPer1M: 21.6, cacheReadPer1M: 0.72, reasoningPer1M: 21.6, source: "builtin" },
  { id: "kimi-k2-6", modelPattern: "kimi-k2.6", inputPer1M: 6.84, outputPer1M: 28.8, cacheReadPer1M: 1.152, reasoningPer1M: 28.8, source: "builtin" },
  { id: "glm-5-1", modelPattern: "glm-5.1", inputPer1M: 8, outputPer1M: 28, cacheReadPer1M: 8, reasoningPer1M: 28, source: "builtin" },
  { id: "minimax-m2-5", modelPattern: "MiniMax-M2.5", inputPer1M: 2.16, outputPer1M: 8.64, cacheReadPer1M: 0.216, cacheWritePer1M: 2.7, reasoningPer1M: 8.64, source: "builtin" },
]
```

- [ ] **Step 2: Run focused pricing tests and verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/pricing.test.ts
```

Expected: PASS.

## Task 3: Release Note and Final Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Under `## 功能优化`, add:

```md
- 用量分析内置价格补全了 GPT、Claude、DeepSeek、Kimi、GLM 和 MiniMax 等常用编码模型，新建或重新扫描用量时费用估算更完整。
```

- [ ] **Step 2: Run focused test suite**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/pricing.test.ts electron/capabilities/__tests__/model-price-dispatcher.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Review diff**

Run:

```bash
git diff -- desktop/electron/services/usage-analysis/pricing.ts desktop/electron/services/usage-analysis/__tests__/pricing.test.ts RELEASE_NOTES_PENDING.md
```

Expected: Diff only changes price defaults, pricing tests, and release notes.

## Self-Review

- Spec coverage: tasks cover default rules, corrected GPT/Claude prices, non-goal of no repricing, and release notes.
- Placeholder scan: no deferred implementation steps.
- Type consistency: all rule field names match `UsageModelPriceRuleInput`.
