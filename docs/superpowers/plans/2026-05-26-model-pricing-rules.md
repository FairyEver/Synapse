# Model Pricing Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editable usage-analysis pricing rules keyed only by model name, without provider-specific pricing.

**Architecture:** Store model pricing rules in `usage.db`, expose them through the existing usage-analysis IPC namespace, and recalculate stored usage costs after rule changes. Renderer changes stay inside `desktop/src/modules/usage-analysis`, using existing shadcn/Radix components.

**Tech Stack:** Electron main process, SQLite via `node:sqlite`, React, TypeScript, shadcn/ui, Vitest.

---

### Task 1: Backend Pricing Rules

**Files:**
- Modify: `desktop/electron/services/usage-analysis/db-schema.ts`
- Modify: `desktop/electron/services/usage-analysis/pricing.ts`
- Modify: `desktop/electron/services/usage-analysis/cc-service.ts`
- Test: `desktop/electron/services/usage-analysis/__tests__/pricing.test.ts`
- Test: `desktop/electron/services/usage-analysis/__tests__/reports.test.ts`

- [ ] Add tests for model-only rule matching, unknown price status, saving a rule, and recalculating existing report costs.
- [ ] Add `usage_model_prices` storage plus cost status columns on usage event and aggregate tables.
- [ ] Rework pricing so provider is ignored and unknown models are marked unpriced.
- [ ] Recalculate event costs before rebuilding aggregates and after rule saves.

### Task 2: IPC And Types

**Files:**
- Modify: `desktop/electron/usage-analysis/channels.ts`
- Modify: `desktop/electron/usage-analysis/ipc-handlers.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`

- [ ] Add `getPricingRules` and `savePricingRules` channels under `usageAnalysis`.
- [ ] Normalize incoming rules defensively in the main process.
- [ ] Return typed pricing rule data to renderer callers.

### Task 3: Renderer Pricing Editor

**Files:**
- Modify: `desktop/src/modules/usage-analysis/shared/components/usage-analysis-shell.tsx`
- Create: `desktop/src/modules/usage-analysis/shared/components/pricing-rules-dialog.tsx`
- Modify: `desktop/src/modules/usage-analysis/cc/cc-usage-page.tsx`
- Modify: `desktop/src/modules/usage-analysis/codex/codex-usage-page.tsx`
- Modify: `desktop/src/modules/usage-analysis/shared/components/report-views.tsx`
- Modify: `desktop/src/modules/usage-analysis/shared/components/today-report-view.tsx`
- Test: `desktop/src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx`
- Test: `desktop/src/modules/usage-analysis/__tests__/report-views.test.tsx`

- [ ] Add a compact `价格规则` button next to refresh.
- [ ] Implement a dialog with table-like editable model price rows.
- [ ] Show `未定价` for unpriced rows instead of formatting zero as USD.
- [ ] Keep copy short and avoid provider-specific UI.

### Task 4: Validation

**Commands:**
- `pnpm --filter @synapse/desktop test -- usage-analysis`
- `pnpm --filter @synapse/desktop run check:hard-constraints`

- [ ] Run focused tests.
- [ ] Run hard-constraints if the focused tests pass.
- [ ] Update `RELEASE_NOTES_PENDING.md` because this is user-visible.
