# Usage Analysis Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Usage Analysis overview latency by serving aggregate report views from maintained daily/hourly summary tables instead of repeatedly scanning raw usage/tool event tables.

**Architecture:** Keep raw event tables as the source of truth, rebuild summary tables during refresh or on first report read when summaries are missing, and make overview/time/model/project/tool reports read compact aggregate data where possible. Keep detail reports on raw events because they need per-session rows.

**Tech Stack:** Electron main process, `node:sqlite` `DatabaseSync`, TypeScript, Vitest.

---

### Task 1: Lock Aggregate Behavior With Tests

**Files:**
- Modify: `desktop/electron/services/usage-analysis/__tests__/reports.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that verify refresh fills daily/hourly aggregate rows with tool calls, and that report reads rebuild missing aggregates before returning data.

- [ ] **Step 2: Run tests and verify red**

Run: `pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/reports.test.ts`

Expected: FAIL because aggregate tables currently store `tool_calls = 0` and do not backfill when empty.

### Task 2: Rebuild Aggregates Correctly

**Files:**
- Modify: `desktop/electron/services/usage-analysis/cc-service.ts`

- [ ] **Step 1: Fill tool_calls in daily/hourly aggregates**

Update `rebuildAggregates` so it inserts usage aggregates and then updates `tool_calls` from `*_tool_events` grouped by bucket/model/provider/workspace.

- [ ] **Step 2: Add report-read backfill**

Before aggregate-backed report methods run, check whether raw usage rows exist and aggregate rows are empty; if so, rebuild aggregates once.

- [ ] **Step 3: Run tests and verify green**

Run: `pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/reports.test.ts`

Expected: PASS.

### Task 3: Serve Reports From Aggregate Tables

**Files:**
- Modify: `desktop/electron/services/usage-analysis/cc-service.ts`

- [ ] **Step 1: Add compact aggregate helpers**

Add helpers for aggregate bucket table selection, token/cost sums, date/hour filters, and row mapping.

- [ ] **Step 2: Update report methods**

Update `getOverview`, `getTime`, `getModels`, `getProjects`, and `getTools` so overview/time/model/project data read from daily/hourly summaries; keep `getTools` raw until tool failure/duration metrics are needed, but use `LIMIT` for overview top tools.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/reports.test.ts`

Expected: PASS.

### Task 4: Verify Constraints

**Files:**
- No additional source files.

- [ ] **Step 1: Run hard constraints**

Run: `pnpm --filter @synapse/desktop run check:hard-constraints`

Expected: PASS.

- [ ] **Step 2: Run targeted usage-analysis tests**

Run: `pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__`

Expected: PASS.
