# Synapse MCP Capabilities Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add internal reference documentation for Synapse MCP capabilities, covering the overview, current canonical matrix, and maintainer authoring workflow.

**Architecture:** This is a documentation-only change under `docs/reference/`. The overview page explains the capability surface and links to the matrix and authoring guide; the matrix remains the current canonical table; the authoring guide owns maintainer rules, examples, and review checks. Runtime code, CLI behavior, MCP behavior, and generation scripts stay unchanged in this implementation.

**Tech Stack:** Markdown, existing TypeScript capability manifests, existing Vitest unit tests.

---

## Scope Check

This plan implements one documentation subsystem: internal Synapse MCP capability reference docs. It does not need to be split into multiple implementation plans because all tasks produce one cohesive reference set and can be verified together.

## File Structure

- Create `docs/reference/synapse-mcp-capabilities.md`: entry point for the capability system.
- Modify `docs/reference/capability-naming-matrix.md`: keep the current table and remove the historical-name note.
- Create `docs/reference/capability-authoring.md`: maintainer workflow and examples for adding or modifying capabilities.
- Do not modify runtime source files.
- Do not add generation or validation scripts in this pass.

## Source Files To Read Before Editing

- `docs/superpowers/specs/2026-05-03-synapse-mcp-capabilities-reference-design.md`
- `docs/reference/capability-naming-matrix.md`
- `desktop/synapse-capabilities/shared/naming.ts`
- `desktop/synapse-capabilities/shared/registry.ts`
- `desktop/synapse-capabilities/shared/scheduler-domain.ts`
- `desktop/database/shared/capability-registry.ts`
- `desktop/database/shared/mcp-tools.ts`
- `desktop/database/cli/index.ts`
- `desktop/electron/database/http-server.ts`
- `desktop/electron/capabilities/action-router.ts`

---

### Task 1: Add The Capabilities Overview Page

**Files:**
- Create: `docs/reference/synapse-mcp-capabilities.md`

- [ ] **Step 1: Confirm the overview page is new**

Run:

```bash
test ! -e docs/reference/synapse-mcp-capabilities.md
```

Expected: exit 0.

- [ ] **Step 2: Create the overview page**

Create `docs/reference/synapse-mcp-capabilities.md` with this content:

````markdown
# Synapse MCP Capabilities

Synapse exposes local capabilities through one canonical capability surface. A capability starts as a manifest entry, then becomes available through the local HTTP API, MCP tools, CLI commands, and service methods.

```text
capability manifest
  -> HTTP action
  -> MCP tool
  -> CLI command
  -> service method
```

This reference is for maintainers. It documents current public capability names and the rules for adding new capabilities without creating another naming system.

## Source Of Truth

The source of truth is the capability manifest in code.

Current manifest and routing files:

- `desktop/database/shared/capability-registry.ts`
- `desktop/synapse-capabilities/shared/scheduler-domain.ts`
- `desktop/synapse-capabilities/shared/registry.ts`
- `desktop/synapse-capabilities/shared/naming.ts`
- `desktop/electron/capabilities/action-router.ts`

The matrix in [Capability Naming Matrix](./capability-naming-matrix.md) records the current public names. If the matrix and manifest disagree, fix the matrix or the implementation so they match.

## Canonical Ids

Canonical capability ids use:

```text
<domain>.<resource>.<action>
```

Examples:

| Capability id | MCP tool | CLI command | Service method |
| --- | --- | --- | --- |
| `database.table.list` | `database_table_list` | `synapse database table list` | `databaseTableList` |
| `scheduler.runtime.inspect` | `scheduler_runtime_inspect` | `synapse scheduler runtime inspect` | `schedulerRuntimeInspect` |

Public JSON fields use camelCase. CLI flags use kebab-case.

## Current Domains

| Domain | Owns | Manifest |
| --- | --- | --- |
| `database` | Local tables, columns, rows, choices, logs, and SQL actions | `desktop/database/shared/capability-registry.ts` |
| `scheduler` | Scheduled tasks, runs, runtime inspection, and action type discovery | `desktop/synapse-capabilities/shared/scheduler-domain.ts` |

Domain ownership matters. Database behavior stays in the Database domain; Scheduler behavior stays in the Scheduler domain. Cross-domain exposure goes through the shared registry and action router.

## Public Surfaces

### HTTP Action

The local HTTP API receives the canonical id in the top-level `action` field. Other top-level fields are treated as action parameters.

```json
{
  "action": "database.table.list"
}
```

```json
{
  "action": "scheduler.run.list",
  "taskId": "task:1",
  "limit": 5
}
```

### MCP Tool

MCP tool names are derived by replacing dots with underscores.

```text
database.table.list -> database_table_list
scheduler.run.list -> scheduler_run_list
```

Tool arguments use the same public JSON field names as the HTTP action parameters.

### CLI Command

CLI commands are derived by replacing dots with spaces and converting snake_case tokens to kebab-case.

```bash
synapse database table list
synapse scheduler action-type list
```

Resource identifiers should be positional arguments when the command remains clear. Complex data should be passed as JSON flags.

### Service Method

Service method names are derived as lower camelCase.

```text
database.choice_usage.get -> databaseChoiceUsageGet
scheduler.action_type.list -> schedulerActionTypeList
```

## Current Capability Matrix

Use [Capability Naming Matrix](./capability-naming-matrix.md) for the current full list of Database and Scheduler capabilities.

The matrix should contain current canonical public names only. It should not become a separate authority from the manifest.

## Adding Or Changing Capabilities

Use [Capability Authoring](./capability-authoring.md) when adding a capability to an existing domain or introducing a future domain.

At minimum, every capability change should check:

- canonical id
- MCP tool name
- CLI command path
- service method name
- domain dispatcher ownership
- mutation and risk metadata
- matrix update
- relevant unit tests
````

- [ ] **Step 3: Verify the overview page has the required links and examples**

Run:

```bash
rg -n "Capability Naming Matrix|Capability Authoring|database.table.list|scheduler.runtime.inspect|desktop/synapse-capabilities/shared/naming.ts" docs/reference/synapse-mcp-capabilities.md
```

Expected: output includes all five searched concepts.

- [ ] **Step 4: Commit the overview page**

Run:

```bash
git add docs/reference/synapse-mcp-capabilities.md
git commit -m "docs: add synapse mcp capabilities overview"
```

Expected: commit succeeds.

---

### Task 2: Keep The Matrix Canonical-Only

**Files:**
- Modify: `docs/reference/capability-naming-matrix.md`

- [ ] **Step 1: Confirm the current matrix still has the historical-name note**

Run:

```bash
tail -n 3 docs/reference/capability-naming-matrix.md
```

Expected: output includes a final sentence about non-canonical public names not being aliases.

- [ ] **Step 2: Replace the final note**

In `docs/reference/capability-naming-matrix.md`, replace the final sentence after the table with:

```markdown
Only the canonical names in this matrix are supported public names.
```

Do not change the table rows in this task.

- [ ] **Step 3: Verify the matrix no longer mentions historical naming**

Run:

```bash
rg -n "Legacy|legacy|deprecated|Deprecated|aliases|historical" docs/reference/capability-naming-matrix.md
```

Expected: exit 1 with no matches.

- [ ] **Step 4: Verify the matrix still contains current Database and Scheduler rows**

Run:

```bash
rg -n "database.table.list|database.choice_usage.get|database.sql.execute|scheduler.task.list|scheduler.runtime.inspect|scheduler.action_type.list" docs/reference/capability-naming-matrix.md
```

Expected: output includes all six capability ids.

- [ ] **Step 5: Commit the matrix cleanup**

Run:

```bash
git add docs/reference/capability-naming-matrix.md
git commit -m "docs: keep capability matrix canonical only"
```

Expected: commit succeeds.

---

### Task 3: Add The Capability Authoring Guide

**Files:**
- Create: `docs/reference/capability-authoring.md`

- [ ] **Step 1: Confirm the authoring guide is new**

Run:

```bash
test ! -e docs/reference/capability-authoring.md
```

Expected: exit 0.

- [ ] **Step 2: Create the authoring guide**

Create `docs/reference/capability-authoring.md` with this content:

````markdown
# Capability Authoring

Use this guide when adding or changing a Synapse capability exposed through the local HTTP API, MCP tools, CLI commands, or public service methods.

The capability manifest is the source of truth. Reference documentation records the current public surface; it does not define behavior on its own.

## Current Source Files

Shared capability layer:

- `desktop/synapse-capabilities/shared/naming.ts`
- `desktop/synapse-capabilities/shared/registry.ts`
- `desktop/synapse-capabilities/shared/types.ts`

Database domain:

- `desktop/database/shared/capability-registry.ts`
- `desktop/database/shared/mcp-tools.ts`
- `desktop/electron/database/dispatcher.ts`
- `desktop/database/cli/database.ts`

Scheduler domain:

- `desktop/synapse-capabilities/shared/scheduler-domain.ts`
- `desktop/electron/services/task-scheduler/external-capabilities.ts`
- `desktop/database/cli/scheduler.ts`

Routing and transport:

- `desktop/electron/capabilities/action-router.ts`
- `desktop/electron/database/http-server.ts`
- `desktop/electron/database/mcp-server.ts`
- `desktop/database/shared/mcp-rpc.ts`
- `desktop/database/mcp/index.ts`

## Naming Rules

Canonical capability ids use:

```text
<domain>.<resource>.<action>
```

Use the helpers in `desktop/synapse-capabilities/shared/naming.ts` to derive public names:

| Helper | Output |
| --- | --- |
| `capabilityIdToMcpTool("database.table.list")` | `database_table_list` |
| `capabilityIdToCliCommand("database.choice_usage.get")` | `database choice-usage get` |
| `capabilityIdToServiceMethod("scheduler.runtime.inspect")` | `schedulerRuntimeInspect` |

Rules:

- Use complete English words for domains and resources.
- Use `database` for Database capabilities.
- Use `scheduler` for Scheduler capabilities.
- Use singular resources unless plural form changes the meaning, such as `database.rows.update`.
- Use snake_case only inside one id token, such as `choice_usage`.
- Use controlled action names from `CAPABILITY_ACTIONS`.
- Use `execute` only for SQL, command, script, or similar execution capabilities.
- Mark mutating capabilities with `mutates: true`.
- Mark high-risk execution capabilities with `risk: "high"`.

Public JSON fields use camelCase. CLI flags use kebab-case.

## Add A Capability To An Existing Domain

1. Add a manifest item to the owning domain.
2. Verify the id passes `isCanonicalCapabilityId`.
3. Verify derived MCP, CLI, and service names.
4. Add or update the MCP tool schema.
5. Add or update the owning domain dispatcher.
6. Add or update the CLI command if CLI exposure is intended.
7. Keep HTTP routing through the canonical action id.
8. Update `docs/reference/capability-naming-matrix.md`.
9. Run the relevant unit tests.

Keep domain behavior inside the owning domain. Database capabilities should not import Scheduler business internals, and Scheduler capabilities should not import Database business internals.

## Add A Future Domain

A future domain needs these pieces before it is exposed publicly:

- Domain id.
- Domain manifest.
- Domain-owned dispatcher.
- Service ownership boundary.
- MCP tool definitions or generation path.
- CLI namespace if CLI exposure is needed.
- HTTP action routing through the shared action router.
- Result normalization rules.
- Permission and audit handling when sensitive operations are involved.
- Tests for domain registration, public name derivation, routing, and hidden operations.
- Matrix rows for public capabilities.

Do not predefine future resource names in this reference. Add concrete resource names only when the domain is implemented.

## MCP Tool Rules

MCP tool names are derived from canonical ids:

```text
database.row.create -> database_row_create
scheduler.task.enable -> scheduler_task_enable
```

MCP schemas should:

- Use an object input schema.
- Require resource identifiers needed for safe lookup.
- Guide agents to list or describe resources before acting when names may be ambiguous.
- Avoid exposing destructive operations unless the product decision explicitly approves them.
- Keep field names aligned with HTTP action parameters.

## CLI Rules

CLI command paths are derived from canonical ids and then exposed under the `synapse` binary.

```bash
synapse database row create tasks --data '{"title":"Ship"}'
synapse scheduler run list task:1 --limit 5
```

Use positional arguments for clear resource identifiers:

- `tableName`
- `columnName`
- `rowId`
- `taskId`

Use JSON flags for structured data:

- `--data`
- `--where-json`
- `--params`

## HTTP Action Rules

The local HTTP API receives the canonical capability id in the top-level `action` field. Other top-level fields are parameters.

```json
{
  "action": "database.row.create",
  "tableName": "tasks",
  "data": {
    "title": "Ship"
  }
}
```

```json
{
  "action": "scheduler.task.enable",
  "taskId": "task:1"
}
```

The HTTP server routes through `createSynapseActionRouter`, so new domains must be registered in the shared capability registry before HTTP actions can dispatch.

## Examples

### Database Table List

Canonical id:

```text
database.table.list
```

MCP tool:

```text
database_table_list
```

MCP arguments:

```json
{}
```

CLI:

```bash
synapse database table list
```

HTTP body:

```json
{
  "action": "database.table.list"
}
```

Service method:

```text
databaseTableList
```

### Database Row Create

Canonical id:

```text
database.row.create
```

MCP tool:

```text
database_row_create
```

MCP arguments:

```json
{
  "tableName": "tasks",
  "data": {
    "title": "Ship"
  }
}
```

CLI:

```bash
synapse database row create tasks --data '{"title":"Ship"}'
```

HTTP body:

```json
{
  "action": "database.row.create",
  "tableName": "tasks",
  "data": {
    "title": "Ship"
  }
}
```

Service method:

```text
databaseRowCreate
```

### Scheduler Task List

Canonical id:

```text
scheduler.task.list
```

MCP tool:

```text
scheduler_task_list
```

MCP arguments:

```json
{
  "enabled": true,
  "limit": 20
}
```

CLI:

```bash
synapse scheduler task list --enabled --limit 20
```

HTTP body:

```json
{
  "action": "scheduler.task.list",
  "enabled": true,
  "limit": 20
}
```

Service method:

```text
schedulerTaskList
```

### Scheduler Run List

Canonical id:

```text
scheduler.run.list
```

MCP tool:

```text
scheduler_run_list
```

MCP arguments:

```json
{
  "taskId": "task:1",
  "limit": 5
}
```

CLI:

```bash
synapse scheduler run list task:1 --limit 5
```

HTTP body:

```json
{
  "action": "scheduler.run.list",
  "taskId": "task:1",
  "limit": 5
}
```

Service method:

```text
schedulerRunList
```

## Review Checklist

For every capability change, verify:

- The canonical id follows `<domain>.<resource>.<action>`.
- The domain owns the behavior.
- MCP tool, CLI command, and service method names are derived from the canonical id.
- Input schemas use camelCase public JSON fields.
- CLI flags use kebab-case.
- Mutating and high-risk metadata are correct.
- Hidden or destructive operations are not exposed accidentally.
- `docs/reference/capability-naming-matrix.md` is updated.
- Existing capability tests pass.

Relevant tests:

```bash
pnpm --filter @synapse/desktop run test -- tests/unit/capability-naming.test.ts tests/unit/synapse-capabilities.test.ts tests/unit/database-capability-parity.test.ts tests/unit/database-mcp-tools.test.ts tests/unit/cli-database.test.ts tests/unit/cli-scheduler.test.ts
```

## Drift Prevention

For now, the matrix can remain hand-written if it is checked against the manifest during review.

Preferred later direction:

```text
hand-written explanations
  + generated or checked capability matrix
```

Do not treat the matrix as a second source of truth. The manifest owns current capability definitions.
````

- [ ] **Step 3: Verify the authoring guide has workflow, examples, and tests**

Run:

```bash
rg -n "Add A Capability To An Existing Domain|Add A Future Domain|Database Row Create|Scheduler Run List|pnpm --filter @synapse/desktop run test" docs/reference/capability-authoring.md
```

Expected: output includes all five searched concepts.

- [ ] **Step 4: Commit the authoring guide**

Run:

```bash
git add docs/reference/capability-authoring.md
git commit -m "docs: add capability authoring guide"
```

Expected: commit succeeds.

---

### Task 4: Verify The Reference Set

**Files:**
- Verify: `docs/reference/synapse-mcp-capabilities.md`
- Verify: `docs/reference/capability-naming-matrix.md`
- Verify: `docs/reference/capability-authoring.md`

- [ ] **Step 1: Run the capability unit tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- tests/unit/capability-naming.test.ts tests/unit/synapse-capabilities.test.ts tests/unit/database-capability-parity.test.ts tests/unit/database-mcp-tools.test.ts tests/unit/cli-database.test.ts tests/unit/cli-scheduler.test.ts
```

Expected: Vitest exits 0.

- [ ] **Step 2: Scan new reference pages for historical naming wording**

Run:

```bash
rg -n "Legacy|legacy|deprecated|Deprecated|aliases|historical|synapse scheduler create" docs/reference/synapse-mcp-capabilities.md docs/reference/capability-naming-matrix.md docs/reference/capability-authoring.md
```

Expected: exit 1 with no matches.

- [ ] **Step 3: Scan for known non-canonical implementation names**

Run:

```bash
rg -n "renameTable|addColumn|updateColumnDescription|updateColumnChoices|getColumnChoicesUsage|schedulerTaskRunsList|schedulerTaskRuntimeStatus|schedulerActionTypesList" docs/reference/synapse-mcp-capabilities.md docs/reference/capability-naming-matrix.md docs/reference/capability-authoring.md
```

Expected: exit 1 with no matches.

- [ ] **Step 4: Verify required canonical examples are present**

Run:

```bash
rg -n "database.table.list|database_row_create|synapse database row create|scheduler.task.list|scheduler_run_list|synapse scheduler run list" docs/reference/synapse-mcp-capabilities.md docs/reference/capability-naming-matrix.md docs/reference/capability-authoring.md
```

Expected: output includes all six searched canonical examples.

- [ ] **Step 5: Check Markdown whitespace**

Run:

```bash
git diff --check
```

Expected: exit 0.

- [ ] **Step 6: Review the final diff**

Run:

```bash
git diff --stat
git diff -- docs/reference/synapse-mcp-capabilities.md docs/reference/capability-naming-matrix.md docs/reference/capability-authoring.md
```

Expected: diff only touches the three reference docs listed above.

- [ ] **Step 7: Commit final verification adjustments if any were needed**

If Task 4 required small documentation corrections after the previous task commits, run:

```bash
git add docs/reference/synapse-mcp-capabilities.md docs/reference/capability-naming-matrix.md docs/reference/capability-authoring.md
git commit -m "docs: polish capability reference verification"
```

Expected: commit succeeds only if there are additional changes. If there are no changes, skip this commit.

