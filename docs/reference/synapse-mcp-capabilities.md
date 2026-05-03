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
