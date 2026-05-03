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
