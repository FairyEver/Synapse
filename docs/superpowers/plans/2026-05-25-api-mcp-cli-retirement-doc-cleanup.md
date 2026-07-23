# API + MCP CLI Retirement Documentation Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove misleading Synapse-owned CLI capability entrypoint promises from historical superpowers docs and guard the cleanup with a regression test.

**Architecture:** Treat current API + MCP capability docs as canonical and historical superpowers specs/plans as advisory context. Add a focused docs regression test to reject unqualified `CLI command` columns and `synapse database/scheduler/content` command examples in `docs/superpowers`. Keep the implementation limited to tests and Markdown docs.

**Tech Stack:** TypeScript, Vitest, Markdown docs, Node `fs`/`path`.

---

### Task 1: Add Docs Regression Test

**Files:**
- Modify: `desktop/tests/unit/api-mcp-capability-surface.test.ts`

- [ ] **Step 1: Add a recursive Markdown reader**

Add helpers that walk `docs/superpowers/specs` and `docs/superpowers/plans`, read Markdown files, and return relative path plus content.

- [ ] **Step 2: Add the failing assertion**

Assert that superpowers docs do not contain active Synapse-owned CLI capability entrypoint patterns:

```ts
const retiredSynapseCliPatterns = [
  /\bCLI command\b/u,
  /CLI 命令/u,
  /synapse database/u,
  /synapse scheduler/u,
  /synapse content/u,
]
```

The failure output should include matching file paths.

- [ ] **Step 3: Verify red**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/api-mcp-capability-surface.test.ts
```

Expected: FAIL with affected `docs/superpowers` Markdown files listed.

### Task 2: Clean Historical Superpowers Docs

**Files:**
- Modify affected files under `docs/superpowers/specs/`
- Modify affected files under `docs/superpowers/plans/`

- [ ] **Step 1: Add superseded note where old CLI plans remain useful historically**

Use this note near the top of affected historical documents:

```md
> Superseded note: Synapse-owned CLI and stdio MCP capability entrypoints were retired after this document was written. Current external capability access uses loopback HTTP MCP; local HTTP `/api` remains an authenticated internal API.
```

- [ ] **Step 2: Replace active CLI capability chains**

Change active chains from:

```text
API action -> CLI command -> MCP tool
```

to:

```text
API action -> MCP tool
```

- [ ] **Step 3: Neutralize `synapse database/scheduler/content` command examples**

Prefer replacing command examples with MCP tool names or HTTP action names when the surrounding text is still current. For historical plans/specs that are useful as archives, add the superseded note near the top so retained command text is clearly retired historical context.

- [ ] **Step 4: Verify green**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/api-mcp-capability-surface.test.ts
```

Expected: PASS.

### Task 3: Final Verification

**Files:**
- No additional edits expected.

- [ ] **Step 1: Run focused capability and docs tests**

```bash
pnpm --filter @synapse/desktop exec vitest run \
  tests/unit/api-mcp-capability-surface.test.ts \
  tests/unit/synapse-capabilities.test.ts \
  tests/unit/database-capability-parity.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run required checks**

```bash
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run build:database
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: all commands exit 0.

- [ ] **Step 3: Search for residual active Synapse-owned CLI entrypoint text**

```bash
rg -n "CLI command|CLI 命令|synapse database|synapse scheduler|synapse content" docs/superpowers docs/reference website desktop/src desktop/electron desktop/database desktop/tests/unit
```

Expected: no active product docs or runtime code matches. Historical `docs/superpowers` matches are acceptable only when the containing file is explicitly marked with the superseded note, or when the match is inside this cleanup plan/spec or the regression test itself.
