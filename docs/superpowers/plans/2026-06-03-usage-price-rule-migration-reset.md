# Usage Price Rule Migration And Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Existing users receive missing built-in Usage Analysis prices, and the price rules dialog can restore built-in defaults.

**Architecture:** Keep pricing persistence in `desktop/electron/services/usage-analysis/pricing.ts`. Add one append-only migration helper, one explicit reset helper, route reset through existing IPC/preload bridge, and use the existing CC price-rule hash to trigger reparse when rules change.

**Tech Stack:** TypeScript, React, Electron IPC, shadcn/ui, Vitest.

---

## File Structure

- Modify `desktop/electron/services/usage-analysis/pricing.ts`: add append-only built-in migration and explicit reset.
- Modify `desktop/electron/services/usage-analysis/db-schema.ts`: run the append-only migration during schema init.
- Modify `desktop/electron/services/usage-analysis/cc-scan-state.ts`: classify price-rule hash changes as replace.
- Modify `desktop/electron/services/usage-analysis/cc-service.ts`: expose `resetPricingRules()`.
- Modify `desktop/electron/usage-analysis/channels.ts`, `desktop/electron/usage-analysis/ipc-handlers.ts`, `desktop/electron/preload.ts`, `desktop/electron/generated/ipc-channels.generated.ts`, `desktop/src/types/bridge.ts`: add reset bridge route.
- Modify `desktop/src/modules/usage-analysis/shared/components/pricing-rules-dialog.tsx`: add reset button and confirmation dialog.
- Modify focused tests under `desktop/electron/services/usage-analysis/__tests__` and `desktop/src/modules/usage-analysis/__tests__`.
- Modify `RELEASE_NOTES_PENDING.md`: record the user-visible behavior.

## Tasks

### Task 1: Pricing Migration And Reset Tests

- [ ] Add pricing tests that prove missing defaults are appended without overwriting same-id or same-pattern existing rules.
- [ ] Add pricing tests that prove explicit reset replaces custom rules with `DEFAULT_USAGE_PRICE_RULES`.
- [ ] Run `pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/pricing.test.ts` and verify the new tests fail.
- [ ] Implement the migration and reset helpers.
- [ ] Re-run the same test and verify it passes.

### Task 2: Price Hash Reparse Tests

- [ ] Add a CC scan-state test showing same fingerprint plus changed `pricingRulesHash` returns `replace`.
- [ ] Update the report refresh test so changing price rules and refreshing an unchanged file reprices old events.
- [ ] Run `pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/cc-scan-state.test.ts electron/services/usage-analysis/__tests__/reports.test.ts` and verify the new/updated tests fail.
- [ ] Use `pricingRulesHash` in scan classification.
- [ ] Re-run the same test command and verify it passes.

### Task 3: Reset Bridge And UI Tests

- [ ] Add bridge/channel/preload types for `resetPricingRules`.
- [ ] Add a UI test for reset confirmation and returned-row rendering.
- [ ] Run `pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__` and verify the UI test fails before implementation.
- [ ] Implement the reset button using existing `Button` and `AlertDialog`.
- [ ] Re-run the same UI test command and verify it passes.

### Task 4: Final Verification

- [ ] Run focused backend and UI tests.
- [ ] Run `pnpm --filter @synapse/desktop run typecheck`.
- [ ] Review `git diff` for scope.
