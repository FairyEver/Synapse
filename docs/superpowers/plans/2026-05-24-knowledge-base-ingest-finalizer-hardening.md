# Knowledge Base Ingest Finalizer Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the remaining Knowledge Base ingest finalizer gaps: natural-language no-op false errors, concurrent manifest write races, zero-valid-source address side effects, and warning-code message mismatches.

**Architecture:** Keep all behavior inside the existing Knowledge Base contribution/coordinator/finalizer boundary. Add a no-finalize turn marker to the ingest coordinator, serialize manifest finalization by resolved project path, skip address finalization when source finalization accepts no sources, and align warning formatting with parser codes.

**Tech Stack:** Electron main-process TypeScript, Vitest, existing Agent Runtime project-contribution hooks, existing Knowledge Base service modules.

---

## File Map

- Modify: `desktop/electron/services/knowledge-base/ingest-turn-store.ts`
  - Add a union state so a turn can be either a real ingest preflight or a no-finalize marker.
- Modify: `desktop/electron/services/knowledge-base/ingest-coordinator.ts`
  - Expose a no-finalize marker method and consume it without warning.
  - Update warning-code formatting to match `ingest-report.ts`.
- Modify: `desktop/electron/services/knowledge-base/agent-contribution.ts`
  - When natural-language ingest preparation returns a direct result, mark the turn as no-finalize.
- Modify: `desktop/electron/services/knowledge-base/manifest-finalizer.ts`
  - Add per-project serialization around the full finalizer body.
  - Do not run address finalization when no source entry is accepted.
- Modify tests:
  - `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`
  - `desktop/electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts`
  - `desktop/electron/services/knowledge-base/__tests__/manifest-finalizer.test.ts`

## Task 1: Natural-Language No-Op Finalization

**Files:**
- Modify: `desktop/electron/services/knowledge-base/ingest-turn-store.ts`
- Modify: `desktop/electron/services/knowledge-base/ingest-coordinator.ts`
- Modify: `desktop/electron/services/knowledge-base/agent-contribution.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that prepare a natural-language `汲取知识` turn with unchanged sources and invalid manifest, then run `afterTurn()` and expect no finalization error events.

```ts
expect(result?.events ?? []).toEqual([])
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts
```

Expected: FAIL because `afterTurn()` still reports `preflight-missing`.

- [ ] **Step 3: Implement no-finalize markers**

Use a store union:

```ts
export type KnowledgeBaseIngestTurnRecord =
  | { readonly kind: "preflight"; readonly state: KnowledgeBaseIngestTurnState }
  | { readonly kind: "no-finalize"; readonly reason: "direct-result" }
```

Expose `markTurnNoFinalize(turnId)` from `KnowledgeBaseIngestCoordinator`. In `finalizeTurn()`, consume the record and return `{ status: "skipped", warnings: [] }` when it is `no-finalize`.

In `agent-contribution.ts`, after natural-language `prepareTurn()`, call `markTurnNoFinalize()` when the returned output is `kind: "result"`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts
```

Expected: PASS.

## Task 2: Manifest Finalizer Project Lock

**Files:**
- Modify: `desktop/electron/services/knowledge-base/manifest-finalizer.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/manifest-finalizer.test.ts`

- [ ] **Step 1: Write failing concurrency test**

Add a test that starts two `KnowledgeBaseManifestFinalizer.finalize()` calls for the same project with different sources. The address finalizer should delay briefly so both calls overlap. Assert the final manifest preserves both source entries.

```ts
expect(Object.keys(manifest.manifest.sources).sort()).toEqual([
  ".raw/a.md",
  ".raw/b.md",
])
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/manifest-finalizer.test.ts
```

Expected: FAIL because one source entry can be lost.

- [ ] **Step 3: Implement project lock**

Add a module-level lock:

```ts
const manifestFinalizerLocks = new Map<string, Promise<void>>()
```

Wrap `finalize()` with `withProjectFinalizerLock(input.projectPath, () => this.finalizeLocked(input))`. Resolve the project path for the key. Keep the manifest read inside the locked function.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/manifest-finalizer.test.ts
```

Expected: PASS.

## Task 3: Fail Closed When No Source Is Accepted

**Files:**
- Modify: `desktop/electron/services/knowledge-base/manifest-finalizer.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/manifest-finalizer.test.ts`

- [ ] **Step 1: Write failing test**

Add a test where the report references a source not present in preflight and the vault has an eligible wiki page. Assert the address finalizer is not called and manifest `address_map` remains empty.

```ts
expect(addressFinalizer.finalize).not.toHaveBeenCalled()
expect(manifest.manifest.address_map).toEqual({})
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/manifest-finalizer.test.ts
```

Expected: FAIL because the address finalizer currently runs even when no source is accepted.

- [ ] **Step 3: Implement fail-closed branch**

After processing report entries, return immediately when `writtenSources.length === 0`. Do this before calling `addressFinalizer.finalize()`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/manifest-finalizer.test.ts
```

Expected: PASS.

## Task 4: Warning Code Mapping

**Files:**
- Modify: `desktop/electron/services/knowledge-base/ingest-coordinator.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for duplicate report blocks, invalid JSON, and wrong schema. Each test should seed a preflight record first, call `finalizeTurn()`, and assert the Chinese message contains the mapped reason.

```ts
expect(result.message).toContain("检测到多个 synapse_kb_ingest_report")
expect(result.message).toContain("synapse_kb_ingest_report 不是有效 JSON")
expect(result.message).toContain("synapse_kb_ingest_report schema 不匹配")
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts
```

Expected: FAIL because the formatter checks different warning codes.

- [ ] **Step 3: Update formatter**

Change `formatWarningCodes()` to check `report-multiple`, `report-json`, `report-schema`, and `report-object`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts
```

Expected: PASS.

## Final Verification

- [ ] Run the focused test set:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-report.test.ts electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts electron/services/knowledge-base/__tests__/manifest-finalizer.test.ts electron/services/knowledge-base/__tests__/ingest-finalizer.test.ts electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts electron/services/agent-runtime/__tests__/conversation-router.test.ts
```

Expected: all selected tests pass.

- [ ] Run hard constraints:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: command exits successfully.

## Notes

The current workspace already contains many uncommitted Knowledge Base changes from another session. Do not revert them, and do not make an unrelated cleanup commit. Keep this patch limited to the files listed above.
